/**
 * Renders the card scenes (scripts/card-scenes.js) into real source files: stills as lossless PNG, clips as H.264 MP4
 * encoded with the site's own FFmpeg at a phone-camera-like bitrate, with a soft synthesized sound. These are the
 * files that scripts/make-card-art.mjs then drops on the real tool pages.
 *
 *   npx vite --port 5174 --strictPort          (the dev server serves /node_modules/@ffmpeg)
 *   node scripts/make-card-sources.mjs [http://localhost:5174] [--only=name,name]
 *
 * Writes to .team/card-sources/ (not shipped: only the card pictures made from them are).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:5174").replace(/\/$/, "");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const OUT = ".team/card-sources";
mkdirSync(OUT, { recursive: true });
const FPS = 24;
const VIDEO_KBPS = 8000;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 3_600_000,
});
const page = await browser.newPage();
page.on("console", (m) => m.text().startsWith("[src]") && console.log(m.text()));
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${BASE}/about/`, { waitUntil: "load", timeout: 600_000 });
await page.evaluate(() => document.fonts.ready);
await page.addScriptTag({ content: readFileSync("scripts/card-scenes.js", "utf8") });

const names = await page.evaluate(() => ({ clips: Object.keys(window.CARD_SCENES.clips), stills: Object.keys(window.CARD_SCENES.stills) }));

for (const name of names.stills) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const b64 = await page.evaluate(async (n) => {
    const s = window.CARD_SCENES.stills[n];
    const c = document.createElement("canvas");
    c.width = s.width;
    c.height = s.height;
    s.draw(c.getContext("2d"), 0);
    const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer());
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }, name);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, "base64"));
  console.log(`${name}.png`, Buffer.from(b64, "base64").length);
}

for (const name of names.clips) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const b64 = await page.evaluate(
    async (n, fps, kbps) => {
      const s = window.CARD_SCENES.clips[n];
      const c = document.createElement("canvas");
      c.width = s.width;
      c.height = s.height;
      const ctx = c.getContext("2d");
      const frames = [];
      for (let i = 0; i < s.duration * fps; i++) {
        ctx.save();
        s.draw(ctx, i / fps);
        ctx.restore();
        frames.push(new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95))).arrayBuffer()));
      }
      const mjpeg = new Uint8Array(frames.reduce((a, f) => a + f.length, 0));
      let o = 0;
      for (const f of frames) {
        mjpeg.set(f, o);
        o += f.length;
      }
      console.log(`[src] ${n}: ${frames.length} frames`);
      // a quiet two-note pad, so the clip has real sound like a phone recording
      const rate = 48000, total = s.duration * rate;
      const wav = new DataView(new ArrayBuffer(44 + total * 2));
      const text = (at, str) => [...str].forEach((ch, k) => wav.setUint8(at + k, ch.charCodeAt(0)));
      text(0, "RIFF");
      wav.setUint32(4, 36 + total * 2, true);
      text(8, "WAVEfmt ");
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true);
      wav.setUint16(22, 1, true);
      wav.setUint32(24, rate, true);
      wav.setUint32(28, rate * 2, true);
      wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true);
      text(36, "data");
      wav.setUint32(40, total * 2, true);
      for (let i = 0; i < total; i++) {
        const t = i / rate;
        const fade = Math.min(1, t / 0.3) * Math.min(1, (s.duration - t) / 0.6);
        const v = 0.18 * fade * (Math.sin(2 * Math.PI * 220 * t) * 0.6 + Math.sin(2 * Math.PI * 330 * t) * 0.4) * (0.7 + 0.3 * Math.sin(t * 1.7));
        wav.setInt16(44 + i * 2, Math.round(v * 32767), true);
      }
      const { FFmpeg } = await import("/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js");
      const ff = new FFmpeg();
      const log = [];
      ff.on("log", ({ message }) => {
        log.push(message);
        if (log.length > 30) log.shift();
      });
      const blobUrl = async (url, type) => URL.createObjectURL(new Blob([await (await fetch(url)).arrayBuffer()], { type }));
      await ff.load({ coreURL: await blobUrl("/ffmpeg/ffmpeg-core.js", "text/javascript"), wasmURL: await blobUrl("/ffmpeg/ffmpeg-core.wasm", "application/wasm") });
      await ff.writeFile("f.mjpeg", mjpeg);
      await ff.writeFile("a.wav", new Uint8Array(wav.buffer));
      const code = await ff.exec([
        "-f", "mjpeg", "-framerate", String(fps), "-i", "f.mjpeg", "-i", "a.wav",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:v", "libx264", "-preset", "medium", "-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.3)}k`, "-bufsize", `${kbps * 2}k`,
        "-g", String(fps * 2), "-r", String(fps), "-c:a", "aac", "-b:a", "128k",
        "-t", String(s.duration), "-movflags", "+faststart", "-y", "out.mp4",
      ]);
      if (code !== 0) throw new Error(log.join("\n"));
      const bytes = await ff.readFile("out.mp4");
      ff.terminate();
      let out = "";
      for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(out);
    },
    name,
    FPS,
    VIDEO_KBPS,
  );
  writeFileSync(`${OUT}/${name}.mp4`, Buffer.from(b64, "base64"));
  console.log(`${name}.mp4`, Buffer.from(b64, "base64").length);
}
await browser.close();
