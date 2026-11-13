/**
 * Records the homepage demo's walkthrough clips.
 *
 * Each clip is a recording of the real demo screen running one real tool on the
 * sample, so the clips show exactly what a visitor gets when they press "Try it
 * live". They are encoded with the site's own FFmpeg. Re-run this whenever the
 * demo's screen, the sample, or a tool's settings change, then commit the files
 * in public/walkthroughs.
 *
 *   npm run dev                                   (in one terminal)
 *   npm install --no-save puppeteer-core          (once)
 *   node scripts/capture-walkthroughs.mjs [base-url] [--only compress,crop]
 *
 * Set CHROME_PATH if Chrome is not in the default Windows location.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith("http")) ?? "http://localhost:5174";
const onlyIndex = args.indexOf("--only");
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1].split(",") : null;
const OUT_DIR = join(process.cwd(), "public", "walkthroughs");
const FPS = 12;
const WORKING_MAX_SECONDS = 3;
const HOLD_SECONDS = { ready: 1.4, after: 1.6, before: 1.2, afterAgain: 1.4 };
const CAPTIONS = {
  ready: "1 · Sample loaded",
  working: "2 · Running on this device (sped up)",
  after: "3 · The real result",
  before: "Before",
  afterAgain: "After",
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 900_000,
});
await mkdir(OUT_DIR, { recursive: true });

// ---- one page for the demo, one for encoding ----
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await page.addStyleTag({
  content: `
    .cap { position:absolute; top:max(8px,2.2cqw); left:50%; transform:translateX(-50%); max-width:56%; padding:.32em .9em;
      border-radius:999px; background:rgba(45,75,240,.92); color:#fff; font:600 max(10px,2.2cqw)/1.2 var(--font-ui); white-space:nowrap; z-index:5; }
  `,
});
// Background tabs do not run animation frames, so each page is brought to the front before it is used.
const encoder = await browser.newPage();
await encoder.goto(`${BASE}/tools/compress`, { waitUntil: "networkidle0" });
await page.bringToFront();

const click = (selector, text) =>
  page.evaluate(
    ({ selectorText, labelText }) => {
      const els = [...document.querySelectorAll(selectorText)];
      const el = labelText ? els.find((e) => e.innerText.trim().toLowerCase().includes(labelText.toLowerCase())) : els[0];
      if (!el) throw new Error(`nothing to click: ${selectorText} ${labelText ?? ""}`);
      el.click();
    },
    { selectorText: selector, labelText: text },
  );
const phase = () => page.evaluate(() => document.querySelector(".demo")?.dataset.phase);
const waitPhase = (wanted, timeout = 300_000) =>
  page.waitForFunction((p) => document.querySelector(".demo")?.dataset.phase === p, { timeout, polling: 100 }, wanted);
const setCaption = (text) =>
  page.evaluate((t) => {
    const screen = document.querySelector(".demo-screen");
    let el = screen.querySelector(".cap");
    if (!el) {
      el = document.createElement("div");
      el.className = "cap";
      screen.append(el);
    }
    el.textContent = t;
  }, text);

const screen = await page.$(".demo-screen");
const grab = async () => ({ t: performance.now(), buf: Buffer.from(await screen.screenshot({ type: "jpeg", quality: 78 })) });

async function captureFor(seconds) {
  const frames = [];
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) frames.push(await grab());
  return frames;
}

async function captureUntilDone() {
  const frames = [];
  while ((await phase()) === "working") frames.push(await grab());
  frames.push(await grab());
  return frames;
}

/** Pick `ticks` frames spread evenly over the captured time range. */
function resample(frames, ticks) {
  if (frames.length === 0) return [];
  const start = frames[0].t;
  const span = Math.max(1, frames[frames.length - 1].t - start);
  const out = [];
  let cursor = 0;
  for (let k = 0; k < ticks; k += 1) {
    const target = start + (span * k) / Math.max(1, ticks - 1);
    while (cursor < frames.length - 1 && frames[cursor + 1].t <= target) cursor += 1;
    out.push(frames[cursor]);
  }
  return out;
}

const realTime = (frames) => resample(frames, Math.max(1, Math.round(((frames.at(-1).t - frames[0].t) / 1000) * FPS)));

async function encode(frames) {
  await encoder.bringToFront();
  const all = Buffer.concat(frames.map((f) => f.buf));
  const chunks = [];
  for (let i = 0; i < all.length; i += 3_000_000) chunks.push(all.subarray(i, i + 3_000_000).toString("base64"));
  const base64 = await encoder.evaluate(
    async (parts, fps) => {
      const ff = await import("/src/lib/ffmpeg.ts");
      const bytes = Uint8Array.from(atob(parts.join("")), (c) => c.charCodeAt(0));
      const blob = await ff.runFFmpeg({
        file: new File([bytes], "frames.mjpeg"),
        outputName: "out.mp4",
        args: (input) => [
          "-f", "mjpeg", "-framerate", String(fps), "-i", input,
          "-vf", "scale=960:540:flags=lanczos,format=yuv420p",
          "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-movflags", "+faststart", "-an", "-y", "out.mp4",
        ],
      });
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    },
    chunks,
    FPS,
  );
  await page.bringToFront();
  return Buffer.from(base64, "base64");
}

const tabIds = await page.evaluate(() => [...document.querySelectorAll(".demo-tab")].map((t) => t.id.replace("demo-tab-", "")));
const report = [];

for (const id of tabIds) {
  if (ONLY && !ONLY.includes(id)) continue;
  process.stdout.write(`Recording ${id}… `);

  await click(`#demo-tab-${id}`);
  await click(".demo-controls .button-primary", "Try it live");
  await page.waitForFunction(() => document.querySelector(".demo")?.dataset.phase === "ready", { timeout: 60_000, polling: 100 });
  // Move the pointer off the demo so no hover state is recorded, and let the source video start.
  await page.mouse.move(5, 5);
  await new Promise((r) => setTimeout(r, 400));

  const timeline = [];

  await setCaption(CAPTIONS.ready);
  timeline.push(...realTime(await captureFor(HOLD_SECONDS.ready)));

  await click(".demo-controls .button-primary", "Run");
  await page.waitForFunction(() => document.querySelector(".demo")?.dataset.phase === "working", { timeout: 30_000, polling: 100 });
  await setCaption(CAPTIONS.working);
  const workingFrames = await captureUntilDone();
  const realSeconds = (workingFrames.at(-1).t - workingFrames[0].t) / 1000;
  const keepSeconds = Math.min(realSeconds, WORKING_MAX_SECONDS);
  timeline.push(...resample(workingFrames, Math.max(2, Math.round(keepSeconds * FPS))));

  await waitPhase("done");
  await page.mouse.move(5, 5);
  await setCaption(CAPTIONS.after);
  await new Promise((r) => setTimeout(r, 250));
  const afterFrames = await captureFor(HOLD_SECONDS.after);
  timeline.push(...realTime(afterFrames));
  const poster = timeline[0].buf; // the clip's first frame: starting playback must not change the picture

  await click(".demo-switch button", "Before");
  await setCaption(CAPTIONS.before);
  await new Promise((r) => setTimeout(r, 250));
  timeline.push(...realTime(await captureFor(HOLD_SECONDS.before)));

  await click(".demo-switch button", "After");
  await setCaption(CAPTIONS.afterAgain);
  await new Promise((r) => setTimeout(r, 250));
  timeline.push(...realTime(await captureFor(HOLD_SECONDS.afterAgain)));

  const video = await encode(timeline);
  await writeFile(join(OUT_DIR, `${id}.mp4`), video);
  await writeFile(join(OUT_DIR, `${id}.jpg`), poster);
  report.push({ id, frames: timeline.length, seconds: Math.round((timeline.length / FPS) * 10) / 10, kb: Math.round(video.length / 1024), posterKb: Math.round(poster.length / 1024), realWorkingSeconds: Math.round(realSeconds * 10) / 10 });
  console.log(`${(video.length / 1024).toFixed(0)} KB, ${(timeline.length / FPS).toFixed(1)} s`);

  await page.evaluate(() => document.querySelector(".demo-screen .cap")?.remove());
  await click(".demo-controls .button-ghost", "Reset");
}

console.table(report);
console.log(`Total video: ${report.reduce((n, r) => n + r.kb, 0)} KB, posters: ${report.reduce((n, r) => n + r.posterKb, 0)} KB`);
await browser.close();
