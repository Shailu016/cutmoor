/**
 * Real-browser verification for Compress video with large and awkward files.
 *
 *   node scripts/verify/large-video.mjs <base-url>
 *
 * Runs the production build's /tools/compress/ page in Chrome, drives the real
 * file input and buttons, and checks each result in a video element. Fixtures
 * are built in the OS temp folder and deleted at the end, including the sparse
 * 2.9 GiB MP4.
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MB = 1024 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE = join(ROOT, "public", "samples", "sample-clip.mp4");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const NO_AUDIO_MESSAGE =
  "The sound in this video could not be converted, so the job was stopped rather than making a silent video.";
const BIG_FREE_BYTES = Math.round(2.9 * 1024 ** 3);
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const SETTINGS_TIMEOUT_MS = 3 * 60 * 1000;

const baseUrl = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!baseUrl) {
  console.error("usage: node scripts/verify/large-video.mjs <base-url>");
  process.exit(2);
}
const toolUrl = `${baseUrl}/tools/compress/`;

const results = [];
let browser = null;
let tempDir = null;

function stamp() {
  const now = new Date();
  return now.toISOString().slice(11, 19);
}

function report(status, name, details) {
  results.push({ status, name, details });
  console.log(`${stamp()} ${status.padEnd(7)} ${name}: ${details}`);
}

function info(message) {
  console.log(`${stamp()} INFO    ${message}`);
}

function bytesText(bytes) {
  const mib = bytes / MB;
  return `${bytes.toLocaleString("en-US")} B (${mib.toFixed(2)} MiB)`;
}

function secondsText(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

function shortError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 500);
}

async function removeTempFiles() {
  if (!tempDir) return;
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (existsSync(tempDir)) {
      console.error(`WARNING  temporary folder still exists: ${tempDir}`);
    } else {
      info(`temporary folder deleted: ${tempDir}`);
      tempDir = null;
    }
  } catch (error) {
    console.error(`WARNING  could not delete ${tempDir}: ${shortError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Big MP4: stco offsets moved past 2 GB, sparse free box written with positioned
// writes. The 2.9 GiB gap is never held in memory.
// ---------------------------------------------------------------------------

function topLevelBoxes(buffer) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < header || offset + size > buffer.length) break;
    boxes.push({ type, offset, size, header });
    offset += size;
  }
  return boxes;
}

function patchChunkOffsets(moov, delta) {
  let count = 0;
  let minOffset = Infinity;
  let maxOffset = 0;
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"]);

  const walk = (start, end) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = moov.readUInt32BE(offset);
      const type = moov.toString("latin1", offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        size = Number(moov.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) break;
      if (type === "stco") {
        const entries = moov.readUInt32BE(offset + header + 4);
        for (let index = 0; index < entries; index += 1) {
          const at = offset + header + 8 + index * 4;
          const next = moov.readUInt32BE(at) + delta;
          if (next > 0xffffffff) throw new Error("chunk offset no longer fits in stco");
          moov.writeUInt32BE(next, at);
          minOffset = Math.min(minOffset, next);
          maxOffset = Math.max(maxOffset, next);
          count += 1;
        }
      } else if (type === "co64") {
        const entries = moov.readUInt32BE(offset + header + 4);
        for (let index = 0; index < entries; index += 1) {
          const at = offset + header + 8 + index * 8;
          const next = moov.readBigUInt64BE(at) + BigInt(delta);
          moov.writeBigUInt64BE(next, at);
          minOffset = Math.min(minOffset, Number(next));
          maxOffset = Math.max(maxOffset, Number(next));
          count += 1;
        }
      }
      if (containers.has(type)) walk(offset + header, offset + size);
      offset += size;
    }
  };

  walk(0, moov.length);
  return { count, minOffset, maxOffset };
}

async function makeBigFixture() {
  const source = await readFile(SAMPLE);
  const boxes = topLevelBoxes(source);
  const order = boxes.map((box) => box.type).join(",");
  if (order !== "ftyp,moov,free,mdat") {
    throw new Error(`sample-clip.mp4 layout changed: expected ftyp,moov,free,mdat, found ${order}`);
  }
  const moovBox = boxes[1];
  const freeBox = boxes[2];
  const mdatBox = boxes[3];
  if (freeBox.offset + freeBox.size !== mdatBox.offset) throw new Error("the free box is not directly before mdat");

  const moov = Buffer.from(source.subarray(moovBox.offset, moovBox.offset + moovBox.size));
  const delta = BIG_FREE_BYTES - freeBox.size;
  const patched = patchChunkOffsets(moov, delta);
  if (patched.count === 0) throw new Error("sample-clip.mp4 has no chunk offset table");

  const mdatAt = moovBox.offset + moovBox.size + BIG_FREE_BYTES;
  const total = mdatAt + mdatBox.size;
  const target = join(tempDir, "big.mp4");
  const started = performance.now();
  const handle = await open(target, "w");
  try {
    // Reserve the full length first, then write the three small regions. On a
    // filesystem that supports sparse files the 2.9 GiB hole stays unallocated.
    await handle.truncate(total);
    const head = Buffer.concat([source.subarray(0, moovBox.offset), moov]);
    await handle.write(head, 0, head.length, 0);
    const freeHeader = Buffer.alloc(8);
    freeHeader.writeUInt32BE(BIG_FREE_BYTES, 0);
    freeHeader.write("free", 4, "latin1");
    await handle.write(freeHeader, 0, 8, moovBox.offset + moovBox.size);
    const mdat = source.subarray(mdatBox.offset, mdatBox.offset + mdatBox.size);
    await handle.write(mdat, 0, mdat.length, mdatAt);
  } finally {
    await handle.close();
  }
  const builtMs = performance.now() - started;
  const made = await stat(target);
  if (made.size !== total) throw new Error(`big.mp4 is ${made.size} B, expected ${total} B`);
  if (patched.minOffset <= 2 ** 31) {
    throw new Error(`first chunk offset ${patched.minOffset} is not past 2 GB`);
  }
  if (patched.minOffset < mdatAt + mdatBox.header || patched.maxOffset >= mdatAt + mdatBox.size) {
    throw new Error("a patched chunk offset does not point inside the moved mdat");
  }
  info(
    `big fixture: ${bytesText(total)}, ${patched.count} chunk offsets shifted by ${delta.toLocaleString("en-US")} B, ` +
      `first frame at ${patched.minOffset.toLocaleString("en-US")} B, mdat at ${mdatAt.toLocaleString("en-US")} B, built in ${secondsText(builtMs)}`,
  );
  return target;
}

// ---------------------------------------------------------------------------
// Browser-side helpers. These are installed on every navigation.
// ---------------------------------------------------------------------------

async function installPageHelpers(page) {
  await page.evaluateOnNewDocument(() => {
    const picked = [];
    window.__lvPickedFiles = picked;
    document.addEventListener(
      "change",
      (event) => {
        const input = event.target;
        if (input instanceof HTMLInputElement && input.type === "file" && input.files) {
          for (const file of input.files) picked.push(file);
        }
      },
      true,
    );

    const metadata = (video) => ({
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    });

    window.__lvProbeSource = async () => {
      const file = picked[picked.length - 1];
      if (!file) return { error: "the page did not receive a file" };
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      const first = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        video.onloadedmetadata = () => finish({ ok: true });
        video.onerror = () => finish({ error: "the video element could not read the source file" });
        video.src = url;
        setTimeout(() => finish({ error: "source metadata did not load within 10 s" }), 10_000);
      });
      const out = { name: file.name, size: file.size };
      if (first.ok) {
        Object.assign(out, metadata(video));
        if (!Number.isFinite(out.duration) || out.duration <= 0) {
          video.currentTime = 1e7;
          const duration = await new Promise((resolve) => {
            const done = () => resolve(video.duration);
            video.ondurationchange = done;
            video.onseeked = done;
            setTimeout(done, 5000);
          });
          out.duration = Number.isFinite(duration) ? duration : 0;
        }
        if (!Number.isFinite(out.duration)) out.duration = 0;
      } else {
        out.error = first.error;
      }
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      return out;
    };

    window.__lvProbeResult = async (href) => {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`fetching the download returned ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      const meta = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        video.onloadedmetadata = () => finish({ ok: true, ...metadata(video) });
        video.onerror = () => finish({ error: "the video element could not read the result" });
        video.src = url;
        setTimeout(() => finish({ error: "result metadata did not load within 15 s" }), 15_000);
      });
      let playback = null;
      if (meta.ok) {
        playback = await new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          video.onseeked = () => finish({ ok: true, readyState: video.readyState });
          video.onerror = () => finish({ ok: false, error: "seeking the result failed" });
          video.currentTime = Math.min(0.2, Math.max(0.01, Number(meta.duration) / 2));
          setTimeout(() => finish({ ok: false, error: "seeking the result timed out" }), 5000);
        });
      }
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);

      let audio = null;
      let audioError = null;
      try {
        const context = new OfflineAudioContext(2, 1, 48_000);
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        let peak = 0;
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
          const samples = decoded.getChannelData(channel);
          const step = Math.max(1, Math.floor(samples.length / 2000));
          for (let index = 0; index < samples.length; index += step) peak = Math.max(peak, Math.abs(samples[index]));
        }
        audio = { channels: decoded.numberOfChannels, seconds: decoded.duration, peak };
      } catch (error) {
        audioError = String(error instanceof Error ? error.message : error).slice(0, 200);
      }
      return { bytes: blob.size, meta, playback, audio, audioError };
    };

    window.__lvStorage = async () => {
      if (!navigator.storage?.getDirectory) return { error: "navigator.storage.getDirectory is not available" };
      const directory = await navigator.storage.getDirectory();
      const entries = [];
      for await (const name of directory.keys()) {
        const handle = await directory.getFileHandle(name);
        const file = await handle.getFile();
        entries.push({ name, size: file.size });
      }
      return { entries };
    };

    window.__lvClearStorage = async () => {
      if (!navigator.storage?.getDirectory) return;
      const directory = await navigator.storage.getDirectory();
      const names = [];
      for await (const name of directory.keys()) names.push(name);
      for (const name of names) await directory.removeEntry(name).catch(() => undefined);
    };
  });
}

async function openToolPage(page) {
  await page.goto(toolUrl, { waitUntil: "networkidle0", timeout: 120_000 });
  await page.waitForSelector('input[type="file"]', { timeout: 30_000 });
}

async function uploadFixture(page, path) {
  const input = await page.$('input[type="file"]');
  if (!input) throw new Error("the file input is missing");
  const started = performance.now();
  await input.uploadFile(path);
  return started;
}

async function waitForSettings(page) {
  await page.waitForFunction(
    () => Boolean(document.querySelector(".settings-card button.button-primary") || document.querySelector(".settings-card [role='alert']")),
    { timeout: SETTINGS_TIMEOUT_MS, polling: 200 },
  );
  return page.evaluate(() => {
    const card = document.querySelector(".settings-card");
    if (!card) return { error: "the settings card is missing" };
    const texts = (selector) => [...document.querySelectorAll(selector)].map((element) => element.textContent.trim());
    const blocked = card.querySelector("[role='alert']");
    return {
      blocked: blocked ? blocked.textContent.trim() : null,
      sizes: texts('.chips[aria-label="How much smaller"] button'),
      footnote: card.querySelector(".settings-footnote")?.textContent.trim() ?? "",
      text: card.innerText.slice(0, 1200),
    };
  });
}

async function setExactSize(page, value) {
  const field = await page.$('input[aria-label="Exact size in megabytes"]');
  if (!field) throw new Error("the exact size field is missing");
  await field.click({ clickCount: 3 });
  await field.press("Backspace");
  if (value) await field.type(String(value));
  return page.evaluate(() => ({
    note: document.querySelector(".settings-card .settings-note")?.textContent.trim() ?? "",
    footnote: document.querySelector(".settings-footnote")?.textContent.trim() ?? "",
  }));
}

const chooseTargetSize = (page, targetMb) => setExactSize(page, targetMb);

/** Clears the exact size, which leaves Cutmoor's own percentage and automatic quality. */
const chooseAutomatic = (page) => setExactSize(page, "");

async function clickPrimaryAndWait(page) {
  const button = await page.$(".settings-card button.button-primary");
  if (!button) throw new Error("the Compress video button is missing");
  const started = performance.now();
  await button.click();
  await page.waitForFunction(() => document.querySelector(".job-state")?.textContent === "Working", {
    timeout: 30_000,
    polling: 50,
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector("a[download]") || document.querySelector(".job-error")),
    { timeout: JOB_TIMEOUT_MS, polling: 200 },
  );
  const elapsed = performance.now() - started;
  const outcome = await page.evaluate(() => {
    const link = document.querySelector("a[download]");
    if (link) {
      return {
        kind: "done",
        href: link.getAttribute("href"),
        name: link.getAttribute("download"),
        notes: [...document.querySelectorAll(".job-note")].map((element) => element.textContent.trim()),
        summary: document.querySelector(".result-summary")?.innerText ?? "",
      };
    }
    const error = document.querySelector(".job-error");
    return { kind: "error", message: error?.textContent.trim() ?? "(no message)" };
  });
  return { elapsed, ...outcome };
}

function verifyResult(probe, expected) {
  const problems = [];
  if (!probe || probe.error) {
    problems.push(probe?.error ?? "no result was read");
    return { ok: false, problems, math: null };
  }
  const meta = probe.meta ?? {};
  if (meta.error) problems.push(meta.error);
  const bytes = probe.bytes ?? 0;
  if (bytes <= 0) problems.push("the result is empty");
  if (meta.ok) {
    if (Math.abs(meta.duration - expected.duration) > 0.5) {
      problems.push(
        `duration ${meta.duration.toFixed(3)} s differs from the source's ${expected.duration.toFixed(3)} s by more than 0.5 s`,
      );
    }
    if (meta.width !== expected.width || meta.height !== expected.height) {
      problems.push(`dimensions ${meta.width}×${meta.height} are not the expected ${expected.width}×${expected.height}`);
    }
    if (probe.playback && !probe.playback.ok) problems.push(`the result did not seek: ${probe.playback.error}`);
  }
  if (expected.audio) {
    if (!probe.audio) problems.push(`expected an audio track, but the result has none (${probe.audioError ?? "no decoder output"})`);
  } else if (probe.audio) {
    problems.push(`expected no audio track, but the result has ${probe.audio.channels} channel(s)`);
  }
  let ratio = null;
  if (expected.targetMb) {
    ratio = bytes / (expected.targetMb * MB);
    if (ratio > 1.1) problems.push(`size ${bytes.toLocaleString("en-US")} B is ${ratio.toFixed(2)}× the ${expected.targetMb} MB target (limit 1.1×)`);
  }
  return { ok: problems.length === 0, problems, math: { bytes, ratio } };
}

function describeProbe(probe, verification, expected, elapsed) {
  const parts = [secondsText(elapsed)];
  if (probe?.meta?.ok) {
    parts.push(`out ${bytesText(probe.bytes)}`);
    if (verification.math?.ratio != null) parts.push(`${verification.math.ratio.toFixed(2)}× target`);
    parts.push(`${probe.meta.width}×${probe.meta.height}`);
    parts.push(`${probe.meta.duration.toFixed(2)} s (source ${expected.duration.toFixed(2)} s)`);
    parts.push(probe.audio ? `audio ${probe.audio.channels}ch peak ${probe.audio.peak.toFixed(3)}` : "no audio track");
  } else {
    parts.push("no readable result");
  }
  return parts.join(" · ");
}

async function runFixture(page, fixture) {
  const { key, path, width, height, duration, audio } = fixture;
  if (!path) {
    report("NOT RUN", `${key}/analysis`, fixture.skipReason ?? "fixture was not built");
    report("NOT RUN", `${key}/target size`, "fixture was not built");
    report("NOT RUN", `${key}/automatic`, "fixture was not built");
    return;
  }

  let settings;
  try {
    await openToolPage(page);
    const uploadStarted = await uploadFixture(page, path);
    settings = await waitForSettings(page);
    const uploadMs = performance.now() - uploadStarted;
    if (settings.error) throw new Error(settings.error);
    if (settings.blocked) {
      report("NOT RUN", `${key}/analysis`, `blocked by the page: ${settings.blocked}`);
      report("NOT RUN", `${key}/target size`, "the page blocked this video");
      report("NOT RUN", `${key}/automatic`, "the page blocked this video");
      return;
    }
    info(
      `${key} offered [${settings.sizes.join(", ")}]; settings in ${secondsText(uploadMs)}; ${settings.footnote}`,
    );
  } catch (error) {
    report("FAIL", `${key}/analysis`, shortError(error));
    report("NOT RUN", `${key}/target size`, "the settings card did not appear");
    report("NOT RUN", `${key}/automatic`, "the settings card did not appear");
    return;
  }

  const source = await page.evaluate(() => window.__lvProbeSource());
  if (source.error) info(`${key} source probe: ${source.error}; using the fixture's known values`);
  const expected = {
    width: source.width > 0 ? source.width : width,
    height: source.height > 0 ? source.height : height,
    duration: source.duration > 0 ? source.duration : duration,
    audio,
  };
  info(`${key} source: ${source.width ?? 0}×${source.height ?? 0}, ${Number(source.duration ?? 0).toFixed(2)} s, ${bytesText(source.size ?? (await stat(path)).size)}`);

  // An exact size of 1 MB, which the page accepts for every video.
  {
    try {
      const chosen = await chooseTargetSize(page, 1);
      info(`${key} target setup: ${chosen.note} | ${chosen.footnote}`);
      const job = await clickPrimaryAndWait(page);
      if (job.kind === "error") {
        report("FAIL", `${key}/target 1 MB`, `${secondsText(job.elapsed)} · page error: ${job.message}`);
      } else {
        const probe = await page.evaluate((href) => window.__lvProbeResult(href), job.href);
        const check = verifyResult(probe, { ...expected, targetMb: 1 });
        const detail = describeProbe(probe, check, expected, job.elapsed);
        report(check.ok ? "PASS" : "FAIL", `${key}/target 1 MB`, check.ok ? detail : `${detail} — ${check.problems.join("; ")}`);
      }
    } catch (error) {
      report("FAIL", `${key}/target 1 MB`, shortError(error));
    }
  }

  // Cutmoor's own choice.
  try {
    const chosen = await chooseAutomatic(page);
    info(`${key} automatic setup: ${chosen.note}`);
    const job = await clickPrimaryAndWait(page);
    if (job.kind === "error") {
      report("FAIL", `${key}/automatic`, `${secondsText(job.elapsed)} · page error: ${job.message}`);
    } else {
      const probe = await page.evaluate((href) => window.__lvProbeResult(href), job.href);
      const check = verifyResult(probe, expected);
      const detail = describeProbe(probe, check, expected, job.elapsed);
      report(check.ok ? "PASS" : "FAIL", `${key}/automatic`, check.ok ? detail : `${detail} — ${check.problems.join("; ")}`);
    }
  } catch (error) {
    report("FAIL", `${key}/automatic`, shortError(error));
  }
}

// ---------------------------------------------------------------------------
// Fixtures built in the page: AV1, AC3 MKV, silent MP4, rotated portrait MP4,
// and an MP4 with intact H.264 video but corrupted AC3 audio.
// ---------------------------------------------------------------------------

async function makeAv1Fixture(page) {
  const result = await page.evaluate(async () => {
    if (typeof MediaRecorder === "undefined") return { error: "MediaRecorder is not available" };
    const mime = "video/webm;codecs=av1,opus";
    if (!MediaRecorder.isTypeSupported(mime)) return { error: `MediaRecorder cannot record ${mime}` };
    const width = 640;
    const height = 360;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { error: "a 2d canvas could not be created" };
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = 440;
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    const stream = canvas.captureStream(30);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 96_000, videoBitsPerSecond: 4_000_000 });
    } catch (error) {
      return { error: `MediaRecorder rejected ${mime}: ${String(error instanceof Error ? error.message : error)}` };
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    const started = performance.now();
    recorder.start(200);
    let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = `hsl(${(frame * 9) % 360},65%,45%)`;
      context.fillRect(0, 0, width, height);
      for (let index = 0; index < 12; index += 1) {
        context.fillStyle = `hsl(${(frame * 17 + index * 43) % 360},80%,60%)`;
        context.beginPath();
        context.arc((frame * 11 + index * 67) % width, (frame * 7 + index * 53) % height, 24, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = "#fff";
      context.fillRect((frame * 5) % (width - 80), height - 80, 80, 40);
      frame += 1;
    }, 33);
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    recorder.stop();
    clearInterval(timer);
    await stopped;
    oscillator.stop();
    await audio.close();
    for (const track of stream.getTracks()) track.stop();
    const blob = new Blob(chunks, { type: "video/webm" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    await window.saveLargeVideoFixture("av1.webm", btoa(binary));
    return { bytes: blob.size, mime: recorder.mimeType, elapsedMs: performance.now() - started };
  });
  if (result.error) return result;
  const target = join(tempDir, "av1.webm");
  const made = await stat(target);
  if (made.size !== result.bytes) return { error: `saved AV1 file is ${made.size} B, expected ${result.bytes} B` };
  info(`av1 fixture: ${bytesText(made.size)}, ${result.mime}, recorded in ${secondsText(result.elapsedMs)}`);
  return { path: target };
}

async function makeFfmpegFixtures(page) {
  const result = await page.evaluate(async () => {
    const coreUrl = new URL("/ffmpeg/ffmpeg-core.js", location.origin).href;
    let core;
    try {
      const module = await import(coreUrl);
      const wasmUrl = coreUrl.replace(/\.js$/, ".wasm");
      const workerUrl = coreUrl.replace(/\.js$/, ".worker.js");
      core = await module.default({
        mainScriptUrlOrBlob: `${coreUrl}#${btoa(JSON.stringify({ wasmURL: wasmUrl, workerURL: workerUrl }))}`,
      });
    } catch (error) {
      return { error: `the FFmpeg core could not be loaded: ${String(error instanceof Error ? error.message : error)}` };
    }
    const logs = [];
    core.setLogger((message) => {
      logs.push(typeof message === "string" ? message : message?.message ?? String(message));
    });
    const run = (label, args) => {
      logs.length = 0;
      try {
        core.exec("-hide_banner", ...args);
      } catch (error) {
        return { label, ret: -1, log: String(error instanceof Error ? error.message : error) };
      }
      return { label, ret: core.ret, log: logs.slice(-3).join(" | ") };
    };
    const toBase64 = (bytes) => {
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    };
    const save = async (fsName, outName) => {
      const bytes = core.FS.readFile(fsName);
      await window.saveLargeVideoFixture(outName, toBase64(bytes));
      return bytes.length;
    };

    const out = { runs: [], sizes: {} };
    const note = (runResult) => {
      out.runs.push(runResult);
      return runResult.ret === 0;
    };

    const silent = run("silent", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
      "-t", "6", "-vf", "noise=alls=8:allf=t",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an", "-movflags", "+faststart", "-y", "silent.mp4",
    ]);
    if (!note(silent)) return { error: `silent MP4 failed: ${silent.log}`, runs: out.runs };
    out.sizes.silent = await save("silent.mp4", "silent.mp4");
    core.FS.unlink("silent.mp4");

    const ac3 = run("ac3", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "6", "-vf", "noise=alls=8:allf=t",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "ac3", "-b:a", "192k", "-y", "ac3.mkv",
    ]);
    if (!note(ac3)) return { error: `AC3 MKV failed: ${ac3.log}`, runs: out.runs };
    out.sizes.ac3 = await save("ac3.mkv", "ac3.mkv");
    core.FS.unlink("ac3.mkv");

    const land = run("landscape", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "4", "-vf", "noise=alls=8:allf=t",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", "land.mp4",
    ]);
    if (!note(land)) return { error: `rotated source failed: ${land.log}`, runs: out.runs };
    const rotate = run("rotate", ["-i", "land.mp4", "-c", "copy", "-metadata:s:v:0", "rotate=90", "-y", "rotated.mp4"]);
    if (!note(rotate)) return { error: `rotating the clip failed: ${rotate.log}`, runs: out.runs };
    out.sizes.rotated = await save("rotated.mp4", "rotated.mp4");
    core.FS.unlink("land.mp4");
    core.FS.unlink("rotated.mp4");

    const video = run("bad-audio video", [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
      "-t", "6", "-vf", "noise=alls=8:allf=t",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an", "-y", "vid.mp4",
    ]);
    if (!note(video)) return { error: `bad-audio video failed: ${video.log}`, runs: out.runs };
    const tone = run("bad-audio tone", [
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "6", "-c:a", "ac3", "-b:a", "192k", "-y", "tone.ac3",
    ]);
    if (!note(tone)) return { error: `bad-audio AC3 failed: ${tone.log}`, runs: out.runs };
    // Keep the AC3 sync word but destroy the frame payload. The demuxer still
    // sees an AC3 track; both Chrome and the FFmpeg build fail to decode it.
    const ac3Bytes = core.FS.readFile("tone.ac3");
    for (let index = 0; index < ac3Bytes.length; index += 1) {
      if (index % 768 === 0) {
        ac3Bytes[index] = 0x0b;
        if (index + 1 < ac3Bytes.length) ac3Bytes[index + 1] = 0x77;
        for (let offset = 2; offset < 20 && index + offset < ac3Bytes.length; offset += 1) ac3Bytes[index + offset] = 0;
      } else if (index % 768 >= 20) {
        ac3Bytes[index] = 0;
      }
    }
    core.FS.writeFile("bad.ac3", ac3Bytes);
    const mux = run("bad-audio mux", [
      "-i", "vid.mp4", "-i", "bad.ac3",
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "copy", "-shortest",
      "-movflags", "+faststart", "-y", "badaudio.mp4",
    ]);
    if (!note(mux)) return { error: `bad-audio mux failed: ${mux.log}`, runs: out.runs };
    out.sizes.badaudio = await save("badaudio.mp4", "badaudio.mp4");
    core.FS.unlink("vid.mp4");
    core.FS.unlink("tone.ac3");
    core.FS.unlink("bad.ac3");
    core.FS.unlink("badaudio.mp4");
    return out;
  });

  if (result.error) return result;
  const paths = {};
  for (const [key, bytes] of Object.entries(result.sizes)) {
    const path = join(tempDir, `${key}.${key === "ac3" ? "mkv" : "mp4"}`);
    const made = await stat(path);
    if (made.size !== bytes) return { error: `saved ${key} file is ${made.size} B, expected ${bytes} B` };
    paths[key] = path;
  }
  info(
    `ffmpeg fixtures: silent ${bytesText(result.sizes.silent)}, ac3 ${bytesText(result.sizes.ac3)}, ` +
      `rotated ${bytesText(result.sizes.rotated)}, bad-audio ${bytesText(result.sizes.badaudio)}`,
  );
  return paths;
}

// ---------------------------------------------------------------------------
// Storage and failure-path cases.
// ---------------------------------------------------------------------------

async function storageEntries(page) {
  return page.evaluate(() => window.__lvStorage());
}

async function clearStorage(page) {
  await page.evaluate(() => window.__lvClearStorage());
}

async function waitForStorageGone(page, timeoutMs) {
  const started = performance.now();
  let entries = [];
  while (performance.now() - started < timeoutMs) {
    const state = await storageEntries(page);
    if (state.error) return { error: state.error, entries: [], elapsed: performance.now() - started };
    entries = state.entries;
    if (!entries.some((entry) => entry.name.startsWith("cutmoor-output-"))) {
      return { entries, elapsed: performance.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { entries, elapsed: performance.now() - started };
}

async function cancelMidJob(page, diskPath, label) {
  try {
    await openToolPage(page);
    if ((await storageEntries(page)).error) {
      report("NOT RUN", "cancel/storage", "navigator.storage.getDirectory is not available");
      return false;
    }
    await clearStorage(page);
    await uploadFixture(page, diskPath);
    const settings = await waitForSettings(page);
    if (settings.blocked || !settings.sizes.length) {
      report("NOT RUN", "cancel/storage", "the page did not offer a compressible target size");
      return false;
    }
    info(`cancel case uses ${label}; offered [${settings.sizes.join(", ")}]`);
    await chooseTargetSize(page, 100);
    const button = await page.$(".settings-card button.button-primary");
    await button.click();
    await page.waitForFunction(() => document.querySelector(".job-state")?.textContent === "Working", {
      timeout: 30_000,
      polling: 50,
    });

    const started = performance.now();
    let writtenText = "";
    let entries = [];
    while (performance.now() - started < 60_000) {
      writtenText = await page.evaluate(() => document.querySelector(".job-elapsed")?.textContent ?? "");
      const state = await storageEntries(page);
      entries = state.entries ?? [];
      if (writtenText.includes("written") && entries.some((entry) => entry.name.startsWith("cutmoor-output-"))) break;
      if (await page.evaluate(() => ["Complete", "Failed"].includes(document.querySelector(".job-state")?.textContent ?? ""))) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const diskEntries = entries.filter((entry) => entry.name.startsWith("cutmoor-output-"));
    if (!diskEntries.length) {
      report("NOT RUN", "cancel/storage", `the job never made a disk file before it ended (${writtenText || "no progress text"})`);
      return false;
    }
    info(`cancel setup: ${writtenText} | ${diskEntries.map((entry) => `${entry.name} ${entry.size} B`).join(", ")}`);

    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((element) => element.textContent.includes("Cancel job"));
      button?.click();
      return Boolean(button);
    });
    if (!clicked) throw new Error("the Cancel job button was missing");
    await page.waitForFunction(() => ["Cancelled", "Ready"].includes(document.querySelector(".job-state")?.textContent ?? ""), {
      timeout: 15_000,
      polling: 100,
    });
    const phase = await page.evaluate(() => document.querySelector(".job-state")?.textContent ?? "");
    const after = await waitForStorageGone(page, 20_000);
    if (after.error) {
      report("FAIL", "cancel/storage", after.error);
      return false;
    }
    const kept = after.entries.filter((entry) => entry.name.startsWith("cutmoor-output-"));
    const detail =
      `${phase} after ${secondsText(after.elapsed)}; ` +
      (kept.length
        ? `${kept.length} file(s) still there: ${kept.map((entry) => `${entry.name} ${entry.size} B`).join(", ")}`
        : "no cutmoor-output-* files remain");
    report(kept.length ? "FAIL" : "PASS", "cancel/storage", `${detail} (was writing: ${writtenText || "unknown"})`);
    return phase === "Cancelled";
  } catch (error) {
    report("FAIL", "cancel/storage", shortError(error));
    return false;
  }
}

async function normalJobAfterCancel(page, fixturePath, hasAudio) {
  try {
    if (!page.url().includes("/tools/compress")) await openToolPage(page);
    const state = await page.evaluate(() => ({
      hasFile: Boolean(document.querySelector(".file-card")),
      hasPrimary: Boolean(document.querySelector(".settings-card button.button-primary")),
      phase: document.querySelector(".job-state")?.textContent ?? "",
    }));
    if (!state.hasPrimary) {
      await openToolPage(page);
      await uploadFixture(page, fixturePath);
      await waitForSettings(page);
    }
    const settings = await waitForSettings(page);
    if (settings.blocked || !settings.sizes.length) {
      report("NOT RUN", "after-cancel/H.264 target 1 MB", "the page did not offer a target size");
      return;
    }
    await chooseTargetSize(page, 1);
    const job = await clickPrimaryAndWait(page);
    if (job.kind === "error") {
      report("FAIL", "after-cancel/H.264 target 1 MB", `${secondsText(job.elapsed)} · page error: ${job.message}`);
      return;
    }
    const probe = await page.evaluate((href) => window.__lvProbeResult(href), job.href);
    const source = await page.evaluate(() => window.__lvProbeSource());
    const expected = {
      width: source.width || 640,
      height: source.height || 360,
      duration: source.duration || 6,
      audio: hasAudio,
      targetMb: 1,
    };
    const check = verifyResult(probe, expected);
    const detail = describeProbe(probe, check, expected, job.elapsed);
    report(check.ok ? "PASS" : "FAIL", "after-cancel/H.264 target 1 MB", check.ok ? detail : `${detail} — ${check.problems.join("; ")}`);
  } catch (error) {
    report("FAIL", "after-cancel/H.264 target 1 MB", shortError(error));
  }
}

async function clearDiskJob(page, diskPath, label) {
  try {
    await openToolPage(page);
    await clearStorage(page);
    await uploadFixture(page, diskPath);
    const settings = await waitForSettings(page);
    if (settings.blocked || !settings.sizes.length) {
      report("NOT RUN", "clear/storage", "the page did not offer a target size");
      return;
    }
    info(`clear case uses ${label}; offered [${settings.sizes.join(", ")}]`);
    await chooseTargetSize(page, 100);
    const job = await clickPrimaryAndWait(page);
    if (job.kind === "error") {
      report("FAIL", "clear/storage", `${secondsText(job.elapsed)} · page error: ${job.message}`);
      return;
    }
    const before = await storageEntries(page);
    const files = (before.entries ?? []).filter((entry) => entry.name.startsWith("cutmoor-output-"));
    if (!files.length) {
      report("FAIL", "clear/storage", `the finished job left no disk-backed file to clear (result: ${job.name ?? "unknown"})`);
      return;
    }
    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((element) => element.textContent.includes("Start another file"));
      button?.click();
      return Boolean(button);
    });
    if (!clicked) throw new Error("the Start another file button was missing");
    const after = await waitForStorageGone(page, 10_000);
    if (after.error) {
      report("FAIL", "clear/storage", after.error);
      return;
    }
    const kept = after.entries.filter((entry) => entry.name.startsWith("cutmoor-output-"));
    const detail =
      `${files.map((entry) => `${entry.name} ${entry.size} B`).join(", ")} existed after the job; ` +
      (kept.length ? `${kept.length} file(s) remain after Clear` : `all gone after ${secondsText(after.elapsed)}`);
    report(kept.length ? "FAIL" : "PASS", "clear/storage", detail);
  } catch (error) {
    report("FAIL", "clear/storage", shortError(error));
  }
}

async function continueWithoutSound(page, badAudioPath, brokenPath) {
  try {
    await openToolPage(page);
    await uploadFixture(page, badAudioPath);
    const settings = await waitForSettings(page);
    if (settings.blocked) {
      report("NOT RUN", "audio-failure/gate", `the page blocked the file: ${settings.blocked}`);
      return;
    }
    info(`audio-failure fixture offered [${settings.sizes.join(", ")}]`);
    const job = await clickPrimaryAndWait(page);
    if (job.kind !== "error") {
      const probe = await page.evaluate((href) => window.__lvProbeResult(href), job.href);
      report(
        "FAIL",
        "audio-failure/gate",
        `the job finished instead of failing (${bytesText(probe.bytes)}, audio ${probe.audio ? `${probe.audio.channels}ch` : "none"})`,
      );
      return;
    }
    const gate = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === "Continue without sound");
      return button ? button.textContent.trim() : null;
    });
    const messageOk = job.message === NO_AUDIO_MESSAGE;
    report(
      messageOk && gate ? "PASS" : "FAIL",
      "audio-failure/gate",
      `${secondsText(job.elapsed)} · error "${job.message}" · button ${gate ? `"${gate}"` : "missing"}`,
    );
    if (!gate) return;

    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === "Continue without sound");
      button?.click();
      return Boolean(button);
    });
    if (!clicked) throw new Error("the Continue without sound button disappeared");
    const continueStarted = performance.now();
    await page.waitForFunction(() => document.querySelector(".job-state")?.textContent === "Working", { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(document.querySelector("a[download]") || document.querySelector(".job-error")), {
      timeout: JOB_TIMEOUT_MS,
      polling: 200,
    });
    const outcome = await page.evaluate(() => {
      const link = document.querySelector("a[download]");
      if (link) {
        return {
          kind: "done",
          href: link.getAttribute("href"),
          notes: [...document.querySelectorAll(".job-note")].map((element) => element.textContent.trim()),
        };
      }
      return { kind: "error", message: document.querySelector(".job-error")?.textContent.trim() ?? "(no message)" };
    });
    const elapsed = performance.now() - continueStarted;
    if (outcome.kind === "error") {
      report("FAIL", "audio-failure/continue", `page error: ${outcome.message}`);
      return;
    }
    const probe = await page.evaluate((href) => window.__lvProbeResult(href), outcome.href);
    const expected = { width: 640, height: 360, duration: 6, audio: false };
    const check = verifyResult(probe, expected);
    const noteOk = outcome.notes.some((note) => note.includes("made without sound"));
    const detail = `${describeProbe(probe, check, expected, elapsed)} · note ${noteOk ? "says without sound" : "missing"}`;
    report(check.ok && noteOk ? "PASS" : "FAIL", "audio-failure/continue", check.ok && noteOk ? detail : `${detail} — ${check.problems.join("; ")}`);

    // Negative side of the same gate: a different failure must not offer it.
    await openToolPage(page);
    await uploadFixture(page, brokenPath);
    await waitForSettings(page);
    const broken = await clickPrimaryAndWait(page);
    const brokenGate = await page.evaluate(() =>
      Boolean([...document.querySelectorAll("button")].find((element) => element.textContent.includes("Continue without sound"))),
    );
    report(
      broken.kind === "error" && !brokenGate ? "PASS" : "FAIL",
      "audio-failure/other-error-gate",
      broken.kind === "error"
        ? `${secondsText(broken.elapsed)} · error "${broken.message}" · button ${brokenGate ? "shown" : "not shown"}`
        : "the broken file unexpectedly produced a download",
    );
  } catch (error) {
    report("FAIL", "audio-failure/gate", shortError(error));
  }
}

// ---------------------------------------------------------------------------

async function main() {
  tempDir = await mkdtemp(join(tmpdir(), "cutmoor-large-video-"));
  info(`temporary folder: ${tempDir}`);
  const failures = [];
  const skipped = [];

  try {
    let bigPath = null;
    try {
      bigPath = await makeBigFixture();
    } catch (error) {
      report("FAIL", "big/fixture", shortError(error));
    }

    const browserErrors = [];
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      protocolTimeout: 3_000_000,
      args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on("pageerror", (error) => {
      browserErrors.push(`pageerror: ${error.message}`);
      if (browserErrors.length > 20) browserErrors.shift();
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(`console: ${message.text()}`);
        if (browserErrors.length > 20) browserErrors.shift();
      }
    });
    await page.exposeFunction("saveLargeVideoFixture", async (name, base64) => {
      if (!/^[a-z0-9.-]+$/i.test(name)) throw new Error(`bad fixture name: ${name}`);
      await writeFile(join(tempDir, name), Buffer.from(base64, "base64"));
      return true;
    });
    await installPageHelpers(page);

    await openToolPage(page);
    const opfs = await storageEntries(page);
    if (!opfs.error) {
      await clearStorage(page);
      info("cleared any earlier cutmoor-output-* files from the browser's private storage");
    } else {
      info(`private storage unavailable: ${opfs.error}`);
    }

    info("building the AV1 fixture with MediaRecorder (12 s of canvas and a 440 Hz tone)");
    const av1 = await makeAv1Fixture(page);
    if (av1.error) info(`AV1 fixture could not be made: ${av1.error}`);

    info("building the FFmpeg fixtures from the production /ffmpeg/ffmpeg-core.js");
    const ffmpeg = await makeFfmpegFixtures(page);
    if (ffmpeg.error) info(`FFmpeg fixtures could not all be made: ${ffmpeg.error}`);

    const brokenPath = join(tempDir, "broken.mp4");
    await writeFile(brokenPath, Buffer.from("this file is not a video. ".repeat(400), "utf8"));

    const fixtures = [
      { key: "big", path: bigPath, width: 1280, height: 720, duration: 6.016, audio: true },
      { key: "av1", path: av1.path, width: 640, height: 360, duration: 12, audio: true, skipReason: av1.error },
      { key: "ac3-mkv", path: ffmpeg.ac3, width: 640, height: 360, duration: 6, audio: true, skipReason: ffmpeg.error },
      { key: "silent", path: ffmpeg.silent, width: 640, height: 360, duration: 6, audio: false, skipReason: ffmpeg.error },
      { key: "portrait", path: ffmpeg.rotated, width: 360, height: 640, duration: 4, audio: true, skipReason: ffmpeg.error },
    ];

    for (const fixture of fixtures) {
      info(`---- ${fixture.key} ----`);
      await runFixture(page, fixture);
    }

    info("---- storage and failure paths ----");
    if (ffmpeg.silent && ffmpeg.badaudio) {
      const diskPath = bigPath ?? ffmpeg.silent;
      const diskLabel = bigPath ? "the 2.9 GiB MP4" : "the silent MP4";
      const cancelled = await cancelMidJob(page, diskPath, diskLabel);
      if (cancelled) {
        await normalJobAfterCancel(page, diskPath, Boolean(bigPath));
      } else {
        report("NOT RUN", "after-cancel/H.264 target 1 MB", "no cancelled job to follow");
      }
      // Remove whatever the cancel case left, so the next case starts clean.
      await clearStorage(page);
      await clearDiskJob(page, diskPath, diskLabel);
      await continueWithoutSound(page, ffmpeg.badaudio, brokenPath);
    } else {
      report("NOT RUN", "cancel/storage", "the silent fixture could not be built");
      report("NOT RUN", "clear/storage", "the silent fixture could not be built");
      report("NOT RUN", "audio-failure/gate", "the bad-audio fixture could not be built");
    }

    info("---- browser errors seen (not all are case failures) ----");
    for (const line of browserErrors.slice(-10)) info(line);
  } finally {
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages[0]) {
          await pages[0].evaluate(() => window.__lvClearStorage?.()).catch(() => undefined);
        }
      } catch {
        // The browser may already be gone.
      }
      await browser.close().catch(() => undefined);
      browser = null;
    }
    await removeTempFiles();
  }

  for (const result of results) {
    if (result.status === "FAIL") failures.push(result);
    if (result.status === "NOT RUN") skipped.push(result);
  }
  console.log("");
  console.log(`SUMMARY ${results.filter((result) => result.status === "PASS").length} passed, ${failures.length} failed, ${skipped.length} not run`);
  for (const failure of failures) console.log(`FAILED  ${failure.name}: ${failure.details}`);
  for (const skip of skipped) console.log(`NOT RUN ${skip.name}: ${skip.details}`);
  if (failures.length) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`FATAL ${shortError(error)}`);
  await removeTempFiles();
  if (browser) await browser.close().catch(() => undefined);
  process.exitCode = 1;
}
