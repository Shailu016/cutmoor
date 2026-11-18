/**
 * Makes the Auto captions card on the home page from the tool's REAL screen: it opens /tools/auto-captions/ on a
 * development server with the tool's own development stand-in engine (`?captions-test`, which writes made-up sample
 * words, in English for the global home page, because the speech model is not published yet), drops our own presenter clip on it, picks the "Bold" caption
 * style, and takes the tool's own live preview (the real caption overlay, the real word highlight) once before the first word
 * and once per word. The frames become one picture; the card steps through it. The card says "Sample captions", because the words
 * come from the stand-in and not from the clip's sound (the clip has no real speech).
 *
 *   npx vite --port 5174 --strictPort                       (the stand-in only exists on a development server)
 *   node scripts/make-card-sources.mjs http://localhost:5174 --only=presenter   (once, makes .team/card-sources/presenter.mp4)
 *   node scripts/make-captions-card.mjs [http://localhost:5174]
 *
 * Writes public/cards/auto-captions-frames.webp and the card's entry in src/lib/card-art.generated.ts.
 */
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { mergeCardArt } from "./card-data.mjs";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:5174").replace(/\/$/, "");
const SOURCE = ".team/card-sources/presenter.mp4";
// Moments of the 6-second clip: before any caption, then each word lighting up in turn.
// 0.15 s is before the first word; the others are the middle of each of the ten words the stand-in places (see makeSampleWords).
const TIMES = [0.15, 0.43, 0.78, 1.22, 1.64, 2.02, 2.49, 2.94, 3.35, 3.85, 4.33];
const FRAME_W = 480;
const OUT = "public/cards";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 900_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 1000, deviceScaleFactor: 2 });
await page.goto(`${BASE}/tools/auto-captions/?captions-test=fast,cached,english`, { waitUntil: "domcontentloaded", timeout: 600_000 });
// The development server compiles the page on first visit, which can take a while.
await page.waitForSelector("input[type=file]", { timeout: 600_000 });
await new Promise((r) => setTimeout(r, 1500));
await (await page.$("input[type=file]")).uploadFile(SOURCE);
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim().startsWith("Generate captions")).click());
await page.waitForFunction(() => document.querySelector("main video") && [...document.querySelectorAll("main button")].some((b) => /\S/.test(b.innerText) && b.closest("[class*=caption], [class*=editor]")), { timeout: 120_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.replace(/\s+/g, " ").trim().includes("Bold")).click());
await new Promise((r) => setTimeout(r, 800));

const sampleText = await page.evaluate(() => {
  // the words the stand-in wrote, as the tool's own editor shows them
  const words = [...document.querySelectorAll("main button")].map((b) => b.innerText.trim()).filter((t) => /^[A-Za-z'’,.!?-]+$/.test(t));
  const stop = words.indexOf("Listen"); // the tool's own buttons follow the words
  const all = stop === -1 ? words : words.slice(0, stop);
  // the card shows the first sentence only
  const end = all.findIndex((word) => /[.!?]$/.test(word));
  return (end === -1 ? all : all.slice(0, end + 1)).join(" ");
});

await page.evaluate(() => {
  const v = document.querySelector("main video");
  v.scrollIntoView({ block: "center", behavior: "instant" });
  v.pause();
  v.controls = false;
});
// Only the tool's own "Preview" badge (interface, not output) is hidden; the caption overlay stays exactly as the tool draws it.
await page.addStyleTag({ content: '[class*="karaoke"] [class*="badge"], .job-screen .demo-badge { display:none !important; }' });

const frames = [];
let rect = null;
for (const t of TIMES) {
  await page.evaluate(async (time) => {
    const v = document.querySelector("main video");
    v.currentTime = time;
    await new Promise((r) => {
      v.onseeked = r;
      setTimeout(r, 800);
    });
  }, t);
  await new Promise((r) => setTimeout(r, 450));
  rect ??= await page.evaluate(() => {
    const r = document.querySelector("main video").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  frames.push((await page.screenshot({ type: "png", encoding: "base64" })));
}

// Build one picture, one row of eight frames, in the page itself (the browser draws and encodes the WebP).
const sprite = await page.evaluate(
  async (frames, rect, frameW) => {
    const scale = 2;
    const h = Math.round((frameW * rect.h) / rect.w);
    const canvas = document.createElement("canvas");
    canvas.width = frameW * frames.length;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < frames.length; i++) {
      const img = new Image();
      img.src = `data:image/png;base64,${frames[i]}`;
      await img.decode();
      ctx.drawImage(img, rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale, i * frameW, 0, frameW, h);
    }
    return { data: canvas.toDataURL("image/webp", 0.82), w: frameW, h };
  },
  frames,
  rect,
  FRAME_W,
);
await browser.close();

writeFileSync(`${OUT}/auto-captions-frames.webp`, Buffer.from(sprite.data.split(",")[1], "base64"));
const bytes = statSync(`${OUT}/auto-captions-frames.webp`).size;
mergeCardArt({
  "auto-captions": {
    mode: "frames",
    beforeBytes: 0,
    afterBytes: 0,
    name: "presenter.mp4",
    before: { w: 1280, h: 720, duration: 10 },
    after: { w: 1280, h: 720, duration: 10 },
    frames: TIMES.length,
    sampleText,
  },
});
console.log(`auto-captions-frames.webp ${bytes} bytes, ${TIMES.length} frames of ${sprite.w}x${sprite.h}; text: ${sampleText}`);
