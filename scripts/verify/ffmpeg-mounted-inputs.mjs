/**
 * Proves that every FFmpeg video tool still works when the encoder reads its inputs from a mounted folder
 * (`/job-input-N/...`) instead of a copy in the encoder's own file system.
 *
 *   node scripts/verify/ffmpeg-mounted-inputs.mjs [http://localhost:4192] [--skip-large]
 *
 * Needs a production build served at the base URL (`node scripts/serve-local.mjs 4192`), puppeteer-core
 * and Chrome (CHROME_PATH, default C:/Program Files/Google/Chrome/Application/chrome.exe).
 *
 * Every flow uses the real page: choose a file in the page's own file box, press the page's own button, wait
 * for its output panel, then decode the download in the page. Input file names deliberately contain spaces,
 * brackets and uppercase extensions. A generated sparse file over 2 GiB gets one Trim and one Extract audio
 * run, and is deleted at the end.
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import puppeteer from "puppeteer-core";

const BASE = (process.argv.find((argument) => argument.startsWith("http")) || "http://localhost:4192").replace(/\/$/, "");
const SKIP_LARGE = process.argv.includes("--skip-large");
const SAMPLE = join(process.cwd(), "public", "samples", "sample-clip.mp4");
const TMP = mkdtempSync(join(tmpdir(), "cutmoor-mounted-"));

const FILES = {
  main: join(TMP, "Holiday clip (final) [v2].MP4"),
  second: join(TMP, "Second clip [B].MP4"),
  audio: join(TMP, "Sound track (voice) [take 3].MP3"),
  logo: join(TMP, "Logo [white] mark.PNG"),
  gif: join(TMP, "Anim [loop] (odd).GIF"),
  sparse: join(TMP, "Big clip (sparse) [2GiB+].MP4"),
};

// ---- small fixtures ---------------------------------------------------------------------------------------

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "latin1");
  const out = Buffer.alloc(12 + name.length + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + name.length);
  return out;
}

/** A 160x80 white picture frame on a transparent background, so the watermark page has a real logo to stamp. */
function makeLogo() {
  const width = 160;
  const height = 80;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const border = x >= 10 && x < width - 10 && y >= 10 && y < height - 10;
      const hole = x >= 24 && x < width - 24 && y >= 24 && y < height - 24;
      const on = border && !hole;
      const at = 1 + x * 4;
      row[at] = 255;
      row[at + 1] = 255;
      row[at + 2] = 255;
      row[at + 3] = on ? 255 : 0;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Number of image blocks in a GIF, so a converted GIF can be shown to be animated, not a single still. */
function gifFrameCount(bytes) {
  if (bytes.toString("latin1", 0, 3) !== "GIF") return 0;
  let at = 6;
  const packed = bytes[at + 4];
  if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
  at += 7;
  const skipSubBlocks = () => {
    while (at < bytes.length) {
      const size = bytes[at];
      at += 1;
      if (size === 0) return;
      at += size;
    }
  };
  let frames = 0;
  while (at < bytes.length) {
    const marker = bytes[at];
    at += 1;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      at += 1;
      skipSubBlocks();
    } else if (marker === 0x2c) {
      frames += 1;
      const local = bytes[at + 8];
      at += 9;
      if (local & 0x80) at += 3 * 2 ** ((local & 7) + 1);
      at += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      break;
    }
  }
  return frames;
}

// ---- sparse MP4 over 2 GiB -------------------------------------------------------------------------------

function boxesIn(bytes, start, end) {
  const list = [];
  let at = start;
  while (at + 8 <= end) {
    let size = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1 && at + 16 <= end) {
      size = Number(bytes.readBigUInt64BE(at + 8));
      header = 16;
    }
    if (size < header || at + size > end) break;
    list.push({ start: at, size, type, header });
    at += size;
  }
  return list;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"]);

function findBoxes(bytes, parent, type, found = []) {
  if (parent.type === type) found.push(parent);
  if (CONTAINERS.has(parent.type)) {
    for (const child of boxesIn(bytes, parent.start + parent.header, parent.start + parent.size)) {
      findBoxes(bytes, child, type, found);
    }
  }
  return found;
}

/**
 * Copies the sample MP4 with a huge `free` box inserted before `mdat`, and moves every `stco` offset by the
 * inserted size. On Windows the file is marked sparse first, so the hole takes almost no disk.
 * Returns facts about what was built, for the log.
 */
function buildSparseMp4(source, target, extra) {
  const bytes = readFileSync(source);
  const top = boxesIn(bytes, 0, bytes.length);
  const moov = top.find((box) => box.type === "moov");
  const mdat = top.find((box) => box.type === "mdat");
  if (!moov || !mdat) throw new Error("The sample MP4 has no moov or mdat box.");
  if (moov.start > mdat.start) throw new Error("The sample MP4 stores moov after mdat; the sparse copy helper expects moov first.");
  const stcos = findBoxes(bytes, moov, "stco");
  const co64s = findBoxes(bytes, moov, "co64");
  if (stcos.length === 0 && co64s.length === 0) throw new Error("The sample MP4 has no chunk offset table.");
  // Every track has its own table (video and sound here), so every entry in every table has to move.
  const head = Buffer.from(bytes.subarray(0, mdat.start));
  let firstBefore = null;
  let firstAfter = null;
  for (const stco of stcos) {
    const count = bytes.readUInt32BE(stco.start + stco.header + 4);
    const entries = stco.start + stco.header + 8;
    if (entries + count * 4 > stco.start + stco.size) throw new Error("The sample MP4 has a malformed stco box.");
    for (let index = 0; index < count; index += 1) {
      const at = entries + index * 4;
      const before = head.readUInt32BE(at);
      const moved = before + extra;
      if (moved > 0xffffffff) throw new Error("A moved stco offset no longer fits in 32 bits.");
      if (firstBefore === null) {
        firstBefore = before;
        firstAfter = moved;
      }
      head.writeUInt32BE(moved, at);
    }
  }
  for (const co64 of co64s) {
    const count = bytes.readUInt32BE(co64.start + co64.header + 4);
    const entries = co64.start + co64.header + 8;
    if (entries + count * 8 > co64.start + co64.size) throw new Error("The sample MP4 has a malformed co64 box.");
    for (let index = 0; index < count; index += 1) {
      const at = entries + index * 8;
      const before = head.readBigUInt64BE(at);
      if (before > 0xffffffffffffffffn - BigInt(extra)) throw new Error("A moved co64 offset overflowed.");
      if (firstBefore === null) {
        firstBefore = Number(before);
        firstAfter = Number(before) + extra;
      }
      head.writeBigUInt64BE(before + BigInt(extra), at);
    }
  }

  writeFileSync(target, Buffer.alloc(0));
  if (process.platform === "win32") {
    spawnSync("fsutil", ["sparse", "setflag", target], { stdio: "ignore" });
  }
  const free = Buffer.alloc(8);
  free.writeUInt32BE(extra, 0);
  free.write("free", 4, "latin1");
  const fd = openSync(target, "r+");
  try {
    writeSync(fd, head, 0, head.length, 0);
    writeSync(fd, free, 0, free.length, head.length);
    ftruncateSync(fd, head.length + extra);
    writeSync(fd, bytes, mdat.start, bytes.length - mdat.start, head.length + extra);
  } finally {
    closeSync(fd);
  }

  const size = statSync(target).size;
  if (size <= 2 ** 31) throw new Error(`The sparse file is only ${size} bytes; it must be over 2 GiB.`);
  const probe = Buffer.alloc(16);
  const check = openSync(target, "r");
  try {
    readSync(check, probe, 0, 16, head.length + extra);
  } finally {
    closeSync(check);
  }
  if (!probe.equals(bytes.subarray(mdat.start, mdat.start + 16))) throw new Error("The sparse file's mdat is not where the moved chunk offsets say it is.");
  return { size, shiftedBy: extra, chunkTablesMoved: stcos.length + co64s.length, firstOffsetBefore: firstBefore, firstOffsetAfter: firstAfter };
}

// ---- browser helpers --------------------------------------------------------------------------------------

const results = [];
const consoleErrors = [];

function record(tool, label, ok, detail = {}) {
  results.push(ok);
  console.log(JSON.stringify({ tool, label, ok, ...detail }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const near = (target, tolerance) => (value) => typeof value === "number" && Math.abs(value - target) <= tolerance;

copyFileSync(SAMPLE, FILES.main);
writeFileSync(FILES.logo, makeLogo());

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 200)}`));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`console: ${message.text().slice(0, 200)}`);
});

async function open(slug) {
  await page.goto(`${BASE}/tools/${slug}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
  await sleep(250);
}

async function upload(selector, ...files) {
  const input = await page.$(selector);
  if (!input) throw new Error(`no file input at ${selector}`);
  await input.uploadFile(...files);
}

async function setValue(selector, value) {
  await page.evaluate(
    ({ target, text }) => {
      const element = document.querySelector(target);
      if (!element) throw new Error(`no field at ${target}`);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { target: selector, text: value },
  );
}

/** Clicks an enabled button whose visible text is exactly `text`, then one that contains it. Scoped to the tool. */
async function click(text, scope = ".tool-input") {
  await page.evaluate(
    ({ wanted, rootSelector }) => {
      const root = document.querySelector(rootSelector) ?? document;
      const buttons = [...root.querySelectorAll("button")].filter((button) => !button.disabled && button.offsetParent !== null);
      const element =
        buttons.find((button) => button.innerText.trim().toLowerCase() === wanted.toLowerCase()) ??
        buttons.find((button) => button.innerText.toLowerCase().includes(wanted.toLowerCase()));
      if (!element) throw new Error(`no enabled button "${wanted}" in ${rootSelector}. Buttons: ${buttons.map((button) => button.innerText.trim()).join(" | ").slice(0, 400)}`);
      element.click();
    },
    { wanted: text, rootSelector: scope },
  );
}

async function clickFormat(label) {
  await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll(".format-grid button")].find((element) => element.querySelector("strong")?.textContent?.trim() === wanted);
    if (!button) throw new Error(`no format button "${wanted}"`);
    button.click();
  }, label);
}

async function waitForJob(timeout = 600_000) {
  await page.waitForFunction(() => /Complete|Failed/i.test(document.querySelector(".job-state")?.textContent ?? ""), { timeout, polling: 200 });
}

/**
 * Reads the page's Download link, checks that the file decodes and starts playing, and returns its facts.
 * `wantBytes` also returns the bytes as base64 so a result can become the next flow's fixture.
 */
async function readResult(wantBytes) {
  return page.evaluate(async (withBytes) => {
    const state = document.querySelector(".job-state")?.textContent?.trim() ?? "";
    const link = document.querySelector(".job-panel a[download]");
    const pageError = document.querySelector(".job-panel .job-error, .job-panel [role=alert]")?.textContent?.trim() ?? "";
    if (!link) return { state, error: pageError || "no download link" };
    const blob = await (await fetch(link.href)).blob();
    const name = link.getAttribute("download") ?? "";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const magic = [...bytes.subarray(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const extension = (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
    const image = ["png", "jpg", "jpeg", "gif", "webp"].includes(extension);
    const sound = ["mp3", "m4a", "wav", "ogg", "aac"].includes(extension);
    const url = URL.createObjectURL(blob);
    const probe = {};
    try {
      if (image) {
        const bitmap = await createImageBitmap(blob);
        probe.kind = "image";
        probe.width = bitmap.width;
        probe.height = bitmap.height;
        bitmap.close?.();
      } else {
        const element = document.createElement(sound ? "audio" : "video");
        element.muted = true;
        element.preload = "auto";
        element.style.display = "none";
        document.body.append(element);
        element.src = url;
        await new Promise((resolve, reject) => {
          element.onloadedmetadata = resolve;
          element.onerror = () => reject(new Error("the output does not decode"));
          setTimeout(() => reject(new Error("timed out reading the output's metadata")), 20_000);
        });
        probe.kind = sound ? "audio" : "video";
        probe.duration = Number(element.duration.toFixed(3));
        if (!sound) {
          probe.width = element.videoWidth;
          probe.height = element.videoHeight;
        }
        probe.playStarted = await Promise.race([
          element.play().then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 8_000)),
        ]);
        if (probe.playStarted) {
          const deadline = Date.now() + 2_000;
          while (element.currentTime === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
          probe.played = element.currentTime > 0;
        } else {
          probe.played = false;
        }
        // A seek proves the picture or sound data itself decodes, even if this browser refuses to autoplay.
        const seekTo = Math.min(0.2, Math.max(0, (Number.isFinite(element.duration) ? element.duration : 0) / 2));
        try {
          element.currentTime = seekTo;
          await Promise.race([
            new Promise((resolve) => element.addEventListener("seeked", resolve, { once: true })),
            new Promise((resolve) => setTimeout(resolve, 4_000)),
          ]);
          probe.decoded = element.readyState >= 2;
        } catch {
          probe.decoded = false;
        }
        element.pause();
        element.remove();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    let base64 = "";
    if (withBytes) {
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      base64 = btoa(binary);
    }
    return { state, name, bytes: bytes.length, extension, magic, ...probe, base64 };
  }, wantBytes);
}

const MP4_MAGIC = (value) => value.slice(8, 16) === "66747970";
const PNG_MAGIC = (value) => value.startsWith("89504e47");
const GIF_MAGIC = (value) => value.startsWith("47494638");
const MP3_MAGIC = (value) => value.startsWith("494433") || value.startsWith("fffb") || value.startsWith("fff3") || value.startsWith("fff2");

function check(tool, label, got, rules = {}) {
  const problems = [];
  if (got.state !== "Complete") problems.push(`state ${JSON.stringify(got.state)}`);
  if (got.error) problems.push(got.error);
  if (!got.bytes) problems.push("empty output");
  if (rules.extension && got.extension !== rules.extension) problems.push(`extension ${got.extension}, expected ${rules.extension}`);
  if (rules.magic) {
    if (typeof got.magic !== "string") problems.push(`no file signature${got.error ? `: ${got.error}` : ""}`);
    else if (!rules.magic(got.magic)) problems.push(`wrong file signature ${got.magic}`);
  }
  if (rules.kind && got.kind !== rules.kind) problems.push(`kind ${got.kind}, expected ${rules.kind}`);
  if (rules.played && !got.played) problems.push("output did not start playing");
  if (rules.width && !rules.width(got.width)) problems.push(`width ${got.width}`);
  if (rules.height && !rules.height(got.height)) problems.push(`height ${got.height}`);
  if (rules.duration && !rules.duration(got.duration)) problems.push(`duration ${got.duration}`);
  const fact = {
    out: {
      name: got.name,
      bytes: got.bytes,
      kind: got.kind,
      width: got.width,
      height: got.height,
      duration: got.duration,
      played: got.played,
      decoded: got.decoded,
    },
  };
  record(tool, label, problems.length === 0, problems.length === 0 ? fact : { ...fact, problems });
  return { ok: problems.length === 0, got };
}

async function runAndCheck(tool, label, rules, options = {}) {
  await waitForJob(options.timeout);
  const got = await readResult(options.wantBytes ?? false);
  return check(tool, label, got, rules);
}

// ---- flows through the real pages -------------------------------------------------------------------------

let secondReady = false;
let audioReady = false;
let gifReady = false;

try {
  // Trim, and a second Trim on the same page without reloading: proves a mount is released and the next job works.
  await open("trim");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  // The page fills End from the file's metadata after the settings card first appears; wait for that before overriding it.
  await page.waitForFunction(() => (document.querySelector('input[aria-label="End time"]')?.value ?? "").trim() !== "", { timeout: 30_000 });
  await setValue('input[aria-label="End time"]', "0:02");
  await click("Trim video");
  const firstTrim = await runAndCheck("trim", "trim reads its input from a mount and plays", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(1280, 0),
    height: near(720, 0),
    duration: near(2, 0.5),
  }, { wantBytes: true });
  if (firstTrim.ok) {
    writeFileSync(FILES.second, Buffer.from(firstTrim.got.base64, "base64"));
    secondReady = true;
  }
  await setValue('input[aria-label="End time"]', "0:01");
  await click("Trim video");
  await runAndCheck("trim", "two jobs in a row on one page", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    duration: near(1, 0.4),
  });

  // Crop & resize, at a small custom square so the crop filter itself is exercised without a long upscale.
  await open("resize");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Custom");
  const dimensions = await page.$$(".inline-fields input[type=number]");
  if (dimensions.length !== 2) throw new Error("the custom crop fields did not appear");
  await dimensions[0].evaluate((element) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, "320");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.blur();
  });
  await dimensions[1].evaluate((element) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, "320");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.blur();
  });
  await click("Resize to");
  await runAndCheck("crop", "crop to 320x320 from a mounted input", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(320, 0),
    height: near(320, 0),
    duration: near(6, 0.5),
  });

  // Convert to MP4, then a second job on the same page: convert the short clip to a GIF fixture.
  await open("convert");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Convert to MP4");
  await runAndCheck("convert", "convert to MP4 from a mounted input", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(1280, 0),
    height: near(720, 0),
    duration: near(6, 0.5),
  });
  if (secondReady) {
    await page.goto(`${BASE}/tools/convert/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
    await upload('input[type="file"]', FILES.second);
    await page.waitForSelector(".settings-card", { timeout: 60_000 });
    await clickFormat("GIF");
    await click("Convert to GIF");
    await waitForJob();
    const gif = await readResult(true);
    const gifProblems = [];
    const frames = gif.base64 ? gifFrameCount(Buffer.from(gif.base64, "base64")) : 0;
    if (gif.state !== "Complete") gifProblems.push(`state ${JSON.stringify(gif.state)}`);
    if (!gif.bytes) gifProblems.push("empty output");
    if (gif.extension !== "gif") gifProblems.push(`extension ${gif.extension}`);
    if (!GIF_MAGIC(gif.magic ?? "")) gifProblems.push(`wrong file signature ${gif.magic}`);
    if (frames < 2) gifProblems.push(`only ${frames} frame(s) in the GIF`);
    record("convert", "GIF fixture for the GIF-to-MP4 test is animated", gifProblems.length === 0, gifProblems.length === 0 ? { out: { name: gif.name, bytes: gif.bytes, frames } } : { problems: gifProblems });
    if (gifProblems.length === 0) {
      writeFileSync(FILES.gif, Buffer.from(gif.base64, "base64"));
      gifReady = true;
    }
  } else {
    record("convert", "GIF fixture for the GIF-to-MP4 test is animated", false, { problems: ["skipped: the Trim fixture was not produced"] });
  }

  // Extract audio; its MP3 becomes the Add audio fixture.
  await open("audio");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Extract MP3");
  const mp3 = await runAndCheck("extract-audio", "extract MP3 from a mounted input and play it", {
    extension: "mp3",
    magic: MP3_MAGIC,
    kind: "audio",
    played: true,
    duration: near(6, 0.5),
  }, { wantBytes: true });
  if (mp3.ok) {
    writeFileSync(FILES.audio, Buffer.from(mp3.got.base64, "base64"));
    audioReady = true;
  }

  // Save frame.
  await open("frame");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Save this frame");
  await runAndCheck("save-frame", "save a full-resolution PNG frame", {
    extension: "png",
    magic: PNG_MAGIC,
    kind: "image",
    width: near(1280, 0),
    height: near(720, 0),
  });

  // Rotate.
  await open("rotate-video");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Rotate video");
  await runAndCheck("rotate", "rotate 90 degrees from a mounted input", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(720, 0),
    height: near(1280, 0),
    duration: near(6, 0.5),
  });

  // Mute.
  await open("mute-video");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Remove the sound");
  await runAndCheck("mute", "remove the sound from a mounted input", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(1280, 0),
    height: near(720, 0),
    duration: near(6, 0.5),
  });

  // Merge two inputs.
  if (secondReady) {
    await open("merge-videos");
    await upload('input[type="file"]', FILES.main, FILES.second);
    await page.waitForSelector(".multi-list", { timeout: 60_000 });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => !button.disabled && button.innerText.includes("Merge 2 videos")), { timeout: 60_000 });
    await click("Merge 2 videos");
    await runAndCheck("merge", "merge two mounted inputs", {
      extension: "mp4",
      magic: MP4_MAGIC,
      kind: "video",
      played: true,
      width: near(1280, 0),
      height: near(720, 0),
      duration: near(8, 1.2),
    });
  } else {
    record("merge", "merge two mounted inputs", false, { problems: ["skipped: the Trim fixture was not produced"] });
  }

  // Add audio: a mounted video plus a mounted MP3.
  if (audioReady) {
    await open("add-audio-to-video");
    await upload('input[type="file"]', FILES.main);
    await page.waitForSelector("#add-audio-file", { timeout: 60_000 });
    await upload("#add-audio-file", FILES.audio);
    await sleep(300);
    await click("Add the sound");
    await runAndCheck("add-audio", "add a mounted sound track to a mounted video", {
      extension: "mp4",
      magic: MP4_MAGIC,
      kind: "video",
      played: true,
      width: near(1280, 0),
      height: near(720, 0),
      duration: near(6, 0.5),
    });
  } else {
    record("add-audio", "add a mounted sound track to a mounted video", false, { problems: ["skipped: the MP3 fixture was not produced"] });
  }

  // Watermark video with a logo file.
  await open("watermark-video");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Logo or picture");
  await page.waitForSelector("#mark-logo", { timeout: 30_000 });
  await upload("#mark-logo", FILES.logo);
  await page.waitForFunction(() => !!document.querySelector(".mark-overlay") && [...document.querySelectorAll("button")].some((button) => !button.disabled && button.innerText.includes("Add watermark")), { timeout: 30_000 });
  await click("Add watermark");
  await runAndCheck("watermark", "stamp a logo on a mounted video", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(1280, 0),
    height: near(720, 0),
    duration: near(6, 0.5),
  });

  // GIF to MP4.
  if (gifReady) {
    await open("gif-to-mp4");
    await upload('input[type="file"]', FILES.gif);
    await page.waitForSelector(".settings-card", { timeout: 60_000 });
    await click("Convert to MP4");
    await runAndCheck("gif-to-mp4", "turn an animated mounted GIF into an MP4", {
      extension: "mp4",
      magic: MP4_MAGIC,
      kind: "video",
      played: true,
      width: near(640, 0),
      height: near(360, 0),
      duration: near(2, 0.6),
    });
  } else {
    record("gif-to-mp4", "turn an animated mounted GIF into an MP4", false, { problems: ["skipped: the GIF fixture was not produced"] });
  }

  // A cancelled job must not poison the next one on the same page.
  await open("convert");
  await upload('input[type="file"]', FILES.main);
  await page.waitForSelector(".settings-card", { timeout: 60_000 });
  await click("Convert to MP4");
  await page.waitForFunction(() => /Working/i.test(document.querySelector(".job-state")?.textContent ?? ""), { timeout: 60_000, polling: 100 });
  await sleep(700);
  await click("Cancel job", ".job-panel");
  const cancelled = await page
    .waitForFunction(
      () => /Cancelled/i.test(document.querySelector(".job-state")?.textContent ?? "") && /cancelled/i.test(document.querySelector(".job-note-cancelled")?.textContent ?? ""),
      { timeout: 30_000, polling: 100 },
    )
    .then(() => true, () => false);
  record("cancel", "Cancel job returns the page to a cancelled ready state", cancelled);
  await click("Convert to MP4");
  await runAndCheck("cancel", "a good job runs after a cancelled one", {
    extension: "mp4",
    magic: MP4_MAGIC,
    kind: "video",
    played: true,
    width: near(1280, 0),
    height: near(720, 0),
    duration: near(6, 0.5),
  });

  // A real file over 2 GiB, with its mdat after a huge free box. Only the header and the samples should be read.
  if (!SKIP_LARGE) {
    try {
      const built = buildSparseMp4(SAMPLE, FILES.sparse, 2_200_000_000);
      console.log(JSON.stringify({ part: "sparse-fixture", ...built }));

      await open("trim");
      await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
      await upload('input[type="file"]', FILES.sparse);
      await page.waitForSelector(".settings-card", { timeout: 180_000 });
      const card = await page.evaluate(() => document.querySelector(".file-card")?.textContent?.trim() ?? "");
      record("sparse", "the page reads the >2 GiB file's metadata", card.includes("GB"), { card });
      await page.waitForFunction(() => (document.querySelector('input[aria-label="End time"]')?.value ?? "").trim() !== "", { timeout: 60_000 }).catch(() => undefined);
      await setValue('input[aria-label="End time"]', "0:01");
      await click("Trim video");
      await runAndCheck("sparse", "trim 1 s out of a >2 GiB mounted MP4", {
        extension: "mp4",
        magic: MP4_MAGIC,
        kind: "video",
        played: true,
        width: near(1280, 0),
        height: near(720, 0),
        duration: near(1, 0.4),
      }, { timeout: 900_000 });

      await open("audio");
      await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
      await upload('input[type="file"]', FILES.sparse);
      await page.waitForSelector(".settings-card", { timeout: 180_000 });
      await click("Extract MP3");
      await runAndCheck("sparse", "extract audio from a >2 GiB mounted MP4", {
        extension: "mp3",
        magic: MP3_MAGIC,
        kind: "audio",
        played: true,
        duration: near(6, 0.6),
      }, { timeout: 900_000 });
    } catch (error) {
      record("sparse", "the >2 GiB flows ran", false, { problems: [String(error.message ?? error).slice(0, 500)] });
    } finally {
      await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          rmSync(FILES.sparse, { force: true });
          break;
        } catch {
          await sleep(500);
        }
      }
      record("sparse", "the >2 GiB temporary file was deleted", !existsSync(FILES.sparse));
    }
  }

  const realErrors = consoleErrors.filter((text) => !/favicon|ERR_BLOCKED|Failed to load resource/.test(text));
  if (realErrors.length > 0) {
    console.log(JSON.stringify({ part: "console-errors", errors: [...new Set(realErrors)].slice(0, 8) }));
  }
} finally {
  await browser.close().catch(() => undefined);
  if (!SKIP_LARGE) rmSync(FILES.sparse, { force: true });
  rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL OK (${results.length} checks)` : `FAILED: ${failed} check(s), ${results.length} run`);
process.exit(failed === 0 ? 0 : 1);
