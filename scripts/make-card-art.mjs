/**
 * Makes the home-page card pictures by running Cutmoor's REAL tool pages on its own sample media and saving what they
 * produce. Nothing is drawn by hand: each "after" is the file the tool's own Download button gave, and every number
 * shown on a card (sizes, lengths, sizes in pixels) is read from those files.
 *
 *   npm run build && npx vite preview --port 4173 --strictPort &
 *   node scripts/make-card-art.mjs [http://localhost:4173] [--only=slug,slug]
 *
 * Writes public/cards/<slug>-before.webp and -after.webp (or -before-strip / -after-strip for tools that change time,
 * where six real frames are laid side by side) and src/lib/card-art.generated.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { mergeCardArt } from "./card-data.mjs";
import { serveCoreLocally } from "./verify/local-core.mjs";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:4173").replace(/\/$/, "");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const OUT = "public/cards";
mkdirSync(OUT, { recursive: true });
mkdirSync(".team/auto/r7/src", { recursive: true });
// Sources made by scripts/make-card-sources.mjs: one scene per tool, chosen so the change is obvious.
const S = (name) => `.team/card-sources/${name}`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1100 });
await serveCoreLocally(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const click = (text, { exact = false } = {}) =>
  page.evaluate(
    (t, ex) => {
      const all = [...document.querySelectorAll("main button")].filter((b) => !b.disabled && b.offsetParent !== null);
      const el = all.find((b) => (ex ? b.innerText.trim().toLowerCase() === t.toLowerCase() : b.innerText.trim().toLowerCase().startsWith(t.toLowerCase())));
      if (!el) throw new Error(`no button "${t}". Have: ${all.map((b) => b.innerText.trim().split("\n")[0]).join(" | ").slice(0, 300)}`);
      el.click();
    },
    text,
    exact,
  );
const setNumber = (index, value) =>
  page.evaluate(
    (i, v) => {
      const el = [...document.querySelectorAll("main input[type=number], main input[type=text]")][i];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    },
    index,
    value,
  );
const waitDone = () =>
  page.waitForFunction(() => document.querySelector("a[download]") || document.querySelector(".job-state-error") || document.querySelector(".field-error"), { timeout: 600_000, polling: 200 });

/** Reads the finished output and the original, turns each into pictures, and returns the numbers. */
async function capture(slug, sourcePath, kind, mode, srcType) {
  const sourceBuffer = readFileSync(sourcePath);
  const sourceBytes = sourceBuffer.length;
  const sourceB64 = sourceBuffer.toString("base64");
  const sourceType = srcType ?? (kind === "video" ? "video/mp4" : "image/png");
  const result = await page.evaluate(
    async (kind, mode, slug, sourceB64, sourceType) => {
      const link = document.querySelector("a[download]");
      if (!link) throw new Error(document.querySelector(".job-error, .field-error")?.textContent || "no download link");
      const blob = await (await fetch(link.href)).blob();
      const name = link.getAttribute("download");
      const bin = atob(sourceB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const src = new Blob([bytes], { type: sourceType });
      const grab = async (b, isVideo) => {
        if (!isVideo) {
          const bmp = await createImageBitmap(b);
          return { w: bmp.width, h: bmp.height, draw: (ctx, x, y, w, h) => ctx.drawImage(bmp, x, y, w, h) };
        }
        const url = URL.createObjectURL(b);
        const v = document.createElement("video");
        v.muted = true; v.preload = "auto"; v.src = url;
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("video failed to load")); });
        return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, video: v, url };
      };
      const frameAt = async (g, t) => {
        g.video.currentTime = t;
        await new Promise((res) => { g.video.onseeked = res; });
      };
      const toWebp = (canvas) => canvas.toDataURL("image/webp", 0.82);
      const picture = async (g, isVideo, t) => {
        if (isVideo) await frameAt(g, t);
        const c = document.createElement("canvas");
        const scale = Math.min(1, 720 / g.w);
        c.width = Math.round(g.w * scale); c.height = Math.round(g.h * scale);
        const ctx = c.getContext("2d");
        if (isVideo) ctx.drawImage(g.video, 0, 0, c.width, c.height); else g.draw(ctx, 0, 0, c.width, c.height);
        return toWebp(c);
      };
      const strip = async (g) => {
        const n = 6, fw = 160, fh = Math.round(160 * (g.h / g.w));
        const c = document.createElement("canvas");
        c.width = fw * n; c.height = fh;
        const ctx = c.getContext("2d");
        for (let i = 0; i < n; i++) {
          await frameAt(g, Math.min(g.duration - 0.05, (g.duration * (i + 0.5)) / n));
          ctx.drawImage(g.video, i * fw, 0, fw, fh);
        }
        return toWebp(c);
      };
      const sourceIsVideo = kind === "video";
      const outIsVideo = /\.(mp4|webm|mov)$/i.test(name);
      const before = await grab(src, sourceIsVideo);
      const after = await grab(blob, outIsVideo);
      const out = { name, afterBytes: blob.size, before: { w: before.w, h: before.h, duration: before.duration ?? null }, after: { w: after.w, h: after.h, duration: after.duration ?? null } };
      if (mode === "strip") {
        out.beforeImg = await strip(before);
        out.afterImg = await strip(after);
      } else {
        out.beforeImg = await picture(before, sourceIsVideo, Math.min(2.5, (before.duration ?? 3) / 2));
        out.afterImg = await picture(after, outIsVideo, Math.min(2.5, (after.duration ?? 3) / 2));
      }
      return out;
    },
    kind,
    mode,
    slug,
    sourceB64,
    sourceType,
  );
  const suffix = mode === "strip" ? "-strip" : "";
  writeFileSync(`${OUT}/${slug}-before${suffix}.webp`, Buffer.from(result.beforeImg.split(",")[1], "base64"));
  writeFileSync(`${OUT}/${slug}-after${suffix}.webp`, Buffer.from(result.afterImg.split(",")[1], "base64"));
  delete result.beforeImg;
  delete result.afterImg;
  return { slug, mode, beforeBytes: sourceBytes, ...result };
}

const flows = {
  compress: { src: S("neon-city.mp4"), kind: "video", mode: "split", run: async () => { await setNumber(0, 1); await click("Compress video"); } },
  resize: { src: S("desert-road.mp4"), kind: "video", mode: "split", run: async () => { await click("9:16"); await click("Crop to fill"); await click("Resize to"); } },
  trim: { src: S("slate-shot.mp4"), kind: "video", mode: "strip", meta: { keep: [2, 6] }, run: async () => { await setNumber(0, "0:02"); await setNumber(1, "0:06"); await click("Trim video"); } },
  "video-speed": { src: S("timelapse.mp4"), kind: "video", mode: "strip", run: async () => { await click("2×", { exact: true }); await click("Speed the video up"); } },
  "rotate-video": { src: S("sideways-phone.mp4"), kind: "video", mode: "split", run: async () => { await click("90° right"); await click("Rotate video"); } },
  "compress-image": { src: S("studio.png"), kind: "image", mode: "split", run: async () => { await click("Compress image"); } },
  "resize-image": { src: S("mountains.png"), kind: "image", mode: "split", run: async () => { await click("Instagram square"); await click("Resize to"); } },
  "crop-image": { src: S("product.png"), kind: "image", mode: "split", run: async () => { await click("1:1 square"); await click("Crop picture"); } },
  "convert-image": { src: S("poster.png"), kind: "image", mode: "split", run: async () => { await click("WebP", { exact: true }); await click("Convert to WebP"); } },
  "watermark-image": { src: S("lake.png"), kind: "image", mode: "split", run: async () => { await click("Add watermark"); } },
  "blur-image": {
    src: S("car.png"), kind: "image", mode: "split",
    run: async () => {
      const box = await (await page.$(".stage")).boundingBox();
      // Mark the licence plate (its place is fixed in card-scenes.js): a real drag, as a visitor would do it.
      const x = box.x + box.width * 0.395, y = box.y + box.height * 0.645;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + box.width * 0.21, y + box.height * 0.09, { steps: 12 });
      await page.mouse.up();
      await sleep(300);
      await click("Pixelate");
      await click("Hide the marked areas");
    },
  },
};

const results = [];
for (const [slug, flow] of Object.entries(flows)) {
  if (ONLY.length && !ONLY.includes(slug)) continue;
  try {
    if (flow.prepare) await flow.prepare();
    await page.goto(`${BASE}/tools/${slug}/`, { waitUntil: "load" });
    await sleep(700);
    await (await page.$("input[type=file]")).uploadFile(flow.src);
    await sleep(2500);
    await flow.run();
    await waitDone();
    const got = { ...(await capture(slug, flow.src, flow.kind, flow.mode, flow.srcType)), ...(flow.meta ?? {}) };
    results.push(got);
    console.log("ok", slug, JSON.stringify(got));
  } catch (error) {
    console.log("FAIL", slug, error.message.slice(0, 200));
  }
}
await browser.close();

// Merge into the generated data file (kept in git, so a partial run updates only the tools it ran).
const entries = {};
for (const r of results) entries[r.slug] = { mode: r.mode, beforeBytes: r.beforeBytes, afterBytes: r.afterBytes, name: r.name, before: r.before, after: r.after, ...(r.keep ? { keep: r.keep } : {}) };
mergeCardArt(entries);
