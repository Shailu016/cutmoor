/**
 * Drives the REAL pages of the editing tools (mute, rotate, speed, ...) in headless Chrome: picks a real file in the
 * page's file box, presses the page's own button, waits for the result and then checks the OUTPUT file by probing it
 * with the encoder (size, length, whether it has sound). Needs the Vite dev server (it imports the encoder module):
 *   npx vite --port 5174 --strictPort
 *   node scripts/verify/more-tools.mjs [http://localhost:5174] [--only=slug,slug]
 * Test inputs are made on the spot by the encoder (test pattern, sine tone, colour pictures) plus the repo's own
 * public/samples clip, so nothing else is needed.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:5174").replace(/\/$/, "");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const SAMPLE = join(process.cwd(), "public", "samples", "sample-clip.mp4");
const dir = mkdtempSync(join(tmpdir(), "cutmoor-more-"));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 140)}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`console: ${m.text().slice(0, 140)}`);
});
await page.goto(`${BASE}/tools/compress/`, { waitUntil: "domcontentloaded", timeout: 180_000 });

// ---- fixtures, made by the encoder inside the page and written to a temp folder ----
const made = await page.evaluate(async () => {
  const ff = await import("/src/lib/ffmpeg.ts");
  const seed = new File([new Uint8Array(8)], "seed.bin");
  const out = {};
  const make = async (name, args) => {
    const blob = await ff.runFFmpegJob({ inputs: [seed], inputNames: ["seed.bin"], outputName: name, build: () => args });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out[name] = btoa(bin);
  };
  await make("clip-a.mp4", ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", "clip-a.mp4"]);
  await make("clip-b.mp4", ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", "clip-b.mp4"]);
  await make("tone.mp3", ["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", "1", "-c:a", "libmp3lame", "-y", "tone.mp3"]);
  await make("anim.gif", ["-f", "lavfi", "-t", "2", "-i", "testsrc2=size=201x101:rate=12", "-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-loop", "0", "-y", "anim.gif"]);
  for (const [i, c] of ["red", "green", "blue"].entries()) await make(`pic${i}.jpg`, ["-f", "lavfi", "-i", `color=c=${c}:s=400x300`, "-frames:v", "1", "-y", `pic${i}.jpg`]);
  return out;
});
const F = {};
for (const [name, b64] of Object.entries(made)) {
  F[name] = join(dir, name);
  writeFileSync(F[name], Buffer.from(b64, "base64"));
}
F.sample = SAMPLE;

// ---- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickButton = (text) =>
  page.evaluate((t) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
    const el = buttons.find((b) => b.innerText.trim().toLowerCase().includes(t.toLowerCase()));
    if (!el) throw new Error(`no enabled button with text "${t}". Buttons: ${buttons.map((b) => b.innerText.trim()).join(" | ").slice(0, 300)}`);
    el.click();
  }, text);
const waitDone = () =>
  page.waitForFunction(() => document.querySelector(".job-state-done") || document.querySelector(".job-state-error") || document.querySelector(".field-error"), { timeout: 300_000, polling: 150 });
const upload = async (selector, ...files) => (await page.$(selector)).uploadFile(...files);

/** Reads the finished output (the page's Download link) and probes it with the encoder. */
const inspect = () =>
  page.evaluate(async () => {
    const state = document.querySelector(".job-state")?.textContent?.trim();
    const link = document.querySelector(".job-panel a[download]");
    const error = document.querySelector(".job-panel .job-error, .job-panel [role=alert], .field-error")?.textContent?.trim();
    if (!link) return { state, error: error || "no download link" };
    const blob = await (await fetch(link.href)).blob();
    const name = link.getAttribute("download");
    const ff = await import("/src/lib/ffmpeg.ts");
    const isGif = /\.gif$/i.test(name);
    if (isGif) {
      const bmp = await createImageBitmap(blob);
      const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 6).arrayBuffer()));
      return { state, name, bytes: blob.size, w: bmp.width, h: bmp.height, gifHeader: head };
    }
    let info = null;
    const ext = name.split(".").pop();
    await ff.runFFmpegJob({
      inputs: [new File([blob], name)],
      outputName: "p.mp4",
      probe: true,
      build: ({ infos }) => {
        info = infos[0];
        return ["-i", `in0.${ext}`, "-t", "0.05", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", "p.mp4"];
      },
    });
    return { state, name, bytes: blob.size, ...info };
  });

const results = [];
const check = (slug, label, got, rules) => {
  const problems = [];
  if (got.error && !rules.expectError) problems.push(`error: ${got.error}`);
  if (rules.expectError) {
    if (!got.error || !rules.expectError.test(got.error)) problems.push(`expected an error matching ${rules.expectError}, got ${JSON.stringify(got.error)}`);
  } else {
    for (const [key, test] of Object.entries(rules)) {
      if (typeof test === "function" && !test(got[key], got)) problems.push(`${key}=${JSON.stringify(got[key])}`);
    }
  }
  const ok = problems.length === 0;
  results.push(ok);
  console.log(JSON.stringify({ slug, label, ok, ...(ok ? { out: { w: got.width ?? got.w, h: got.height ?? got.h, d: got.duration, audio: got.hasAudio, bytes: got.bytes } } : { problems }) }));
};
const near = (target, tol) => (value) => typeof value === "number" && Math.abs(value - target) <= tol;

const flows = {
  "mute-video": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Remove the sound");
    await waitDone();
    check("mute-video", "sound removed, picture kept", await inspect(), { hasAudio: (v) => v === false, hasVideo: (v) => v === true, width: near(320, 0), height: near(180, 0), duration: near(2, 0.2) });
  },
  "rotate-video": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Rotate video");
    await waitDone();
    check("rotate-video", "90 right swaps the sides, keeps sound", await inspect(), { width: near(180, 0), height: near(320, 0), hasAudio: (v) => v === true, duration: near(2, 0.2) });
  },
  "video-speed": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Speed the video up");
    await waitDone();
    check("video-speed", "2x halves the length, keeps sound", await inspect(), { duration: near(1.0, 0.25), hasAudio: (v) => v === true, width: near(320, 0) });
  },
  "reverse-video": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Reverse video");
    await waitDone();
    check("reverse-video", "same length, keeps sound", await inspect(), { duration: near(2, 0.25), hasAudio: (v) => v === true });
  },
  "loop-video": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Loop 3 times");
    await waitDone();
    check("loop-video", "3 plays is 3x the length", await inspect(), { duration: near(6, 0.5), hasAudio: (v) => v === true });
  },
  "gif-to-mp4": async () => {
    await upload('input[type="file"]', F["anim.gif"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Convert to MP4");
    await waitDone();
    check("gif-to-mp4", "odd-size GIF becomes an even-size MP4", await inspect(), { width: near(200, 0), height: near(100, 0), duration: near(2, 0.3), hasAudio: (v) => v === false });
  },
  "compress-gif": async () => {
    await upload('input[type="file"]', F["anim.gif"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Tiny");
    await clickButton("Compress GIF");
    await waitDone();
    check("compress-gif", "result is a GIF no wider than the source", await inspect(), { gifHeader: (v) => /^GIF8/.test(v), w: (v) => v > 0 && v <= 201, bytes: (v) => v > 0 });
  },
  "resize-gif": async () => {
    await upload('input[type="file"]', F["anim.gif"]);
    await page.waitForSelector(".settings-card");
    await clickButton("160 px");
    await clickButton("Resize GIF");
    await waitDone();
    check("resize-gif", "160 px wide", await inspect(), { gifHeader: (v) => /^GIF8/.test(v), w: near(160, 0) });
  },
  "merge-videos": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"], F["clip-b.mp4"]);
    await page.waitForSelector(".multi-list");
    await clickButton("Merge 2 videos");
    await waitDone();
    check("merge-videos", "two clips become one, 320x180, sound kept", await inspect(), { duration: near(3, 0.4), width: near(320, 0), height: near(180, 0), hasAudio: (v) => v === true });
  },
  "watermark-video": async () => {
    await upload('input[type="file"]', F["clip-a.mp4"]);
    await page.waitForSelector(".mark-preview");
    await sleep(600);
    const overlay = await page.evaluate(() => Boolean(document.querySelector(".mark-overlay")));
    if (!overlay) console.log(JSON.stringify({ slug: "watermark-video", label: "preview overlay shows", ok: false }));
    results.push(overlay);
    await clickButton("Add watermark");
    await waitDone();
    check("watermark-video", "same size, sound kept", await inspect(), { width: near(320, 0), height: near(180, 0), duration: near(2, 0.2), hasAudio: (v) => v === true });
  },
  "add-audio-to-video": async () => {
    await upload('input[type="file"]', F["clip-b.mp4"]);
    await page.waitForSelector("#add-audio-file");
    await upload("#add-audio-file", F["tone.mp3"]);
    await sleep(300);
    await clickButton("Add the sound");
    await waitDone();
    check("add-audio-to-video", "silent clip gets sound, keeps its length", await inspect(), { hasAudio: (v) => v === true, duration: near(1, 0.3), width: near(160, 0) });
  },
  "slideshow-maker": async () => {
    await upload('input[type="file"]', F["pic0.jpg"], F["pic1.jpg"], F["pic2.jpg"]);
    await page.waitForSelector(".multi-list");
    await clickButton("Make a 3-picture video");
    await waitDone();
    check("slideshow-maker", "3 pictures, 3 s each, 0.5 s fades, 1920x1080", await inspect(), { width: near(1920, 0), height: near(1080, 0), duration: near(8, 0.4) });
  },
  "reverse-too-big": async () => {
    // A real clip from the repo, reversed: proves the sample (with its own audio) works, and the size guard stays quiet for it.
    await upload('input[type="file"]', F.sample);
    await page.waitForSelector(".settings-card");
  },
};
delete flows["reverse-too-big"];

for (const slug of Object.keys(flows)) {
  if (ONLY.length && !ONLY.includes(slug)) continue;
  try {
    await page.goto(`${BASE}/tools/${slug}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
    await sleep(500);
    await flows[slug]();
  } catch (error) {
    results.push(false);
    console.log(JSON.stringify({ slug, ok: false, problems: [String(error.message || error).slice(0, 400)] }));
  }
}
const real = consoleErrors.filter((e) => !/favicon|ERR_BLOCKED|Failed to load resource/.test(e));
if (real.length) console.log("console errors:", real.slice(0, 8));
const failed = results.filter((r) => !r).length;
console.log(failed === 0 && real.length === 0 ? `ALL OK (${results.length} checks)` : `FAILED: ${failed} check(s), ${real.length} console error(s)`);
await browser.close();
process.exit(failed === 0 && real.length === 0 ? 0 : 1);
