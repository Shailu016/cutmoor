/**
 * Makes the sample clip and sample photo used by the homepage demo.
 *
 * The picture is drawn in code (scripts/sample-scene.js), the soundtrack is
 * synthesized here, and both are encoded with the site's own FFmpeg in a real
 * browser. Nothing is downloaded and there is no camera footage, so the files
 * are ours to ship. The scene draws the same frames on every run; the encoded bytes can differ with the browser and FFmpeg build.
 *
 *   npm run dev -- --port 5174                    (in one terminal)
 *   npm install --no-save puppeteer-core          (once)
 *   node scripts/make-sample.mjs [base-url]
 *
 * Afterwards: update the byte sizes in src/lib/samples.ts (the script prints
 * them; a unit test checks them), re-record the walkthrough clips with
 * scripts/capture-walkthroughs.mjs, and raise MEDIA_VERSION in src/lib/samples.ts
 * so browsers and the edge cache fetch the new files instead of the cached ones.
 *
 * Set CHROME_PATH if Chrome is not in the default Windows location.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5174";
const OUT_DIR = join(process.cwd(), "public", "samples");
const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const VIDEO_KBPS = 4500;
const PHOTO_AT_SECONDS = 1.5;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
page.on("console", (message) => {
  if (message.text().startsWith("[sample]")) console.log(message.text());
});
await page.goto(`${BASE}/about`, { waitUntil: "networkidle0" });
await page.addScriptTag({ content: await readFile(join(HERE, "sample-scene.js"), "utf8") });

const started = Date.now();
const result = await page.evaluate(
  async ({ fps, videoKbps, photoAt }) => {
    const scene = window.SAMPLE_SCENE;
    const canvas = document.createElement("canvas");
    canvas.width = scene.width;
    canvas.height = scene.height;
    const ctx = canvas.getContext("2d");
    const toBytes = async (type, quality) => {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const toBase64 = (bytes) => {
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };

    // ---- picture: every frame as a JPEG, joined into one MJPEG stream ----
    const frameCount = scene.duration * fps;
    const frames = [];
    for (let i = 0; i < frameCount; i += 1) {
      scene.draw(ctx, i / fps, i);
      frames.push(await toBytes("image/jpeg", 0.97));
    }
    const mjpeg = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    let offset = 0;
    for (const frame of frames) {
      mjpeg.set(frame, offset);
      offset += frame.length;
    }
    console.log(`[sample] drew ${frameCount} frames, ${(mjpeg.length / 1048576).toFixed(1)} MB of JPEG`);

    scene.draw(ctx, photoAt, Math.round(photoAt * fps));
    const photo = await toBytes("image/jpeg", 0.86);

    // ---- sound: a soft pad with a plucked melody, written as a 16-bit WAV ----
    const rate = 48_000;
    const total = scene.duration * rate;
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    const TAU = Math.PI * 2;
    const pad = [146.83, 220.0, 293.66, 369.99, 440.0]; // D major, spread over two octaves
    for (let i = 0; i < total; i += 1) {
      const t = i / rate;
      let l = 0;
      let r = 0;
      pad.forEach((freq, n) => {
        const swell = 0.6 + 0.4 * Math.sin(TAU * (0.11 + n * 0.035) * t + n);
        const level = (0.09 / (1 + n * 0.35)) * swell;
        l += level * Math.sin(TAU * freq * 0.998 * t);
        r += level * Math.sin(TAU * freq * 1.002 * t + 0.4);
      });
      left[i] = l;
      right[i] = r;
    }
    const melody = [587.33, 739.99, 880.0, 739.99, 987.77, 880.0, 739.99, 659.25, 587.33, 739.99, 880.0, 1174.66, 987.77, 880.0, 739.99, 587.33];
    const step = 0.375;
    melody.forEach((freq, n) => {
      const start = Math.floor(n * step * rate);
      const pan = 0.5 + 0.32 * Math.sin(n * 1.9);
      // The note, then two quieter echoes.
      [
        [0, 1],
        [0.28, 0.34],
        [0.56, 0.13],
      ].forEach(([delay, gain], echo) => {
        const from = start + Math.floor(delay * rate);
        const echoPan = echo % 2 === 0 ? pan : 1 - pan;
        for (let i = 0; i < rate * 1.6 && from + i < total; i += 1) {
          const t = i / rate;
          const envelope = (1 - Math.exp(-t * 400)) * Math.exp(-t * 3.6);
          const tone = Math.sin(TAU * freq * t) + 0.32 * Math.sin(TAU * freq * 2 * t) * Math.exp(-t * 6) + 0.1 * Math.sin(TAU * freq * 3 * t) * Math.exp(-t * 10);
          const sample = 0.16 * gain * envelope * tone;
          left[from + i] += sample * Math.cos((echoPan * Math.PI) / 2);
          right[from + i] += sample * Math.sin((echoPan * Math.PI) / 2);
        }
      });
    });
    let peak = 0;
    for (let i = 0; i < total; i += 1) {
      const t = i / rate;
      const fade = Math.min(1, t / 0.25) * Math.min(1, (scene.duration - t) / 0.9);
      left[i] *= fade;
      right[i] *= fade;
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    const gain = 0.7 / peak;
    const wav = new DataView(new ArrayBuffer(44 + total * 4));
    const text = (at, s) => [...s].forEach((ch, k) => wav.setUint8(at + k, ch.charCodeAt(0)));
    text(0, "RIFF");
    wav.setUint32(4, 36 + total * 4, true);
    text(8, "WAVEfmt ");
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 2, true);
    wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 4, true);
    wav.setUint16(32, 4, true);
    wav.setUint16(34, 16, true);
    text(36, "data");
    wav.setUint32(40, total * 4, true);
    for (let i = 0; i < total; i += 1) {
      wav.setInt16(44 + i * 4, Math.round(left[i] * gain * 32767), true);
      wav.setInt16(46 + i * 4, Math.round(right[i] * gain * 32767), true);
    }

    // ---- encode with the site's FFmpeg ----
    const { FFmpeg } = await import("/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js");
    const ffmpeg = new FFmpeg();
    const log = [];
    ffmpeg.on("log", ({ message }) => {
      log.push(message);
      if (log.length > 30) log.shift();
    });
    // Blob URLs, as the site does it: the dev server would otherwise rewrite the import.
    const blobUrl = async (url, type) => URL.createObjectURL(new Blob([await (await fetch(url)).arrayBuffer()], { type }));
    await ffmpeg.load({
      coreURL: await blobUrl("/ffmpeg/ffmpeg-core.js", "text/javascript"),
      wasmURL: await blobUrl("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
    });
    await ffmpeg.writeFile("frames.mjpeg", mjpeg);
    await ffmpeg.writeFile("sound.wav", new Uint8Array(wav.buffer));
    const code = await ffmpeg.exec([
      "-f", "mjpeg", "-framerate", String(fps), "-i", "frames.mjpeg",
      "-i", "sound.wav",
      // JPEG is full-range BT.601; video players expect limited-range BT.709 at this size.
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-c:v", "libx264", "-preset", "slow", "-profile:v", "high",
      "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.4)}k`, "-bufsize", `${videoKbps * 2}k`,
      "-g", String(fps * 2), "-r", String(fps),
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-t", String(scene.duration), "-movflags", "+faststart", "-y", "sample.mp4",
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}:\n${log.join("\n")}`);
    const video = await ffmpeg.readFile("sample.mp4");
    ffmpeg.terminate();
    return { video: toBase64(video), photo: toBase64(photo) };
  },
  { fps: FPS, videoKbps: VIDEO_KBPS, photoAt: PHOTO_AT_SECONDS },
);

const video = Buffer.from(result.video, "base64");
const photo = Buffer.from(result.photo, "base64");
await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "sample-clip.mp4"), video);
await writeFile(join(OUT_DIR, "sample-photo.jpg"), photo);
await browser.close();

console.log(`sample-clip.mp4   ${video.length} bytes`);
console.log(`sample-photo.jpg  ${photo.length} bytes`);
console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s. Put those two numbers in src/lib/samples.ts.`);
