/**
 * Runs the real FFmpeg build against every editing command in src/lib/video-edit-args.ts and checks the OUTPUT
 * file in the browser (does it decode, how big, how long). Needs the Vite dev server:
 *   npx vite --port 5174 --strictPort
 *   node scripts/verify/video-edit-args.mjs [http://localhost:5174]
 * The sources are made on the spot by FFmpeg (test pattern + sine tone), so no media file is needed.
 */
import puppeteer from "puppeteer-core";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:5174").replace(/\/$/, "");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const RESET = process.argv.includes("--reset-between");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
let failures = 0;
await page.exposeFunction("report", (r) => {
  if (r.ok === false) failures += 1;
  console.log(JSON.stringify(r));
});
await page.goto(`${BASE}/tools/compress`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector("body");

await page.evaluate(async (ONLY, RESET) => {
  const ff = await import("/src/lib/ffmpeg.ts");
  const A = await import("/src/lib/video-edit-args.ts");
  const say = (r) => window.report(r);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms))]);

  const probeMedia = async (blob, name) => {
    const url = URL.createObjectURL(blob);
    try {
      const isImage = /\.(png|jpg|gif)$/.test(name);
      if (isImage) {
        const bmp = await createImageBitmap(blob);
        return { ok: bmp.width > 0, w: bmp.width, h: bmp.height };
      }
      const el = document.createElement("video");
      el.muted = true;
      el.src = url;
      return await new Promise((resolve) => {
        el.onloadedmetadata = () => resolve({ ok: el.duration > 0, w: el.videoWidth, h: el.videoHeight, d: Number(el.duration.toFixed(2)) });
        el.onerror = () => resolve({ ok: false, err: "does not decode" });
        setTimeout(() => resolve({ ok: false, err: "metadata timeout" }), 15000);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const job = async (name, inputs, outputName, build, { probe = true, expect = {} } = {}) => {
    if (ONLY && !name.includes(ONLY)) return null;
    if (RESET) ff.resetFFmpeg();
    const t = performance.now();
    try {
      const blob = await withTimeout(ff.runFFmpegJob({ inputs, outputName, probe, build }), 240000);
      const info = await probeMedia(blob, outputName);
      const problems = [];
      if (!info.ok) problems.push(info.err || "output does not decode");
      if (expect.w && info.w !== expect.w) problems.push(`width ${info.w}, expected ${expect.w}`);
      if (expect.h && info.h !== expect.h) problems.push(`height ${info.h}, expected ${expect.h}`);
      if (expect.dMin && !(info.d >= expect.dMin)) problems.push(`duration ${info.d}, expected >= ${expect.dMin}`);
      if (expect.dMax && !(info.d <= expect.dMax)) problems.push(`duration ${info.d}, expected <= ${expect.dMax}`);
      say({ tool: name, ok: problems.length === 0 && blob.size > 0, bytes: blob.size, ms: Math.round(performance.now() - t), ...info, problems: problems.join("; ") || undefined });
      return blob;
    } catch (e) {
      ff.resetFFmpeg();
      say({ tool: name, ok: false, error: String((e && e.message) || e).slice(0, 300) });
      return null;
    }
  };

  const seed = new File([new Uint8Array(8)], "seed.bin");
  const make = async (label, name, extra) => {
    const log = [];
    const stop = ff.onFFmpegLog((m) => log.push(m));
    try {
      const blob = await ff.runFFmpegJob({ inputs: [seed], inputNames: ["seed.bin"], outputName: name, build: () => extra });
      return new File([blob], name);
    } catch (e) {
      say({ source: label, ok: false, error: String(e.message).slice(0, 120), log: log.slice(-8).join(" | ").slice(0, 700) });
      throw e;
    } finally {
      stop();
    }
  };

  // ---- sources ----
  const withSound = await make("clip with sound", "with-sound.mp4", ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", "with-sound.mp4"]);
  const silent = await make("silent clip", "silent.mp4", ["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", "silent.mp4"]);
  const tone = await make("tone", "tone.mp3", ["-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", "1", "-c:a", "libmp3lame", "-y", "tone.mp3"]);
  const gif = await make("gif", "anim.gif", ["-f", "lavfi", "-t", "2", "-i", "testsrc2=size=201x101:rate=12", "-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-loop", "0", "-y", "anim.gif"]);
  const png = await make("logo", "logo.png", ["-f", "lavfi", "-i", "color=c=red:s=60x30", "-frames:v", "1", "-y", "logo.png"]);
  const jpgs = [];
  for (const [i, c] of ["red", "green", "blue"].entries()) jpgs.push(await make("frame", `f${i}.jpg`, ["-f", "lavfi", "-i", `color=c=${c}:s=320x180`, "-frames:v", "1", "-y", `f${i}.jpg`]));

  say({ part: "sources", ok: true, sizes: { withSound: withSound.size, silent: silent.size, tone: tone.size, gif: gif.size, png: png.size } });

  // probe parsing against the real encoder log
  {
    const lines = [];
    const stop = ff.onFFmpegLog((m) => lines.push(m));
    await ff.runFFmpegJob({ inputs: [withSound], outputName: "x.mp4", probe: false, build: () => ["-i", "in0.mp4", "-t", "0.2", "-y", "x.mp4"] }).catch(() => null);
    stop();
    const { parseMediaInfo } = await import("/src/lib/media-info.ts");
    const info = parseMediaInfo(lines);
    say({ tool: "probe-parse", ok: info.hasAudio && info.hasVideo && info.width === 320 && info.height === 180 && Math.abs(info.fps - 24) < 0.1 && info.duration > 1.9, info });
  }

  const N = (f, i = 0) => `in${i}.${f.name.split(".").pop()}`;
  // ---- mute ----
  await job("mute", [withSound], "o.mp4", ({ names }) => A.buildMuteArgs({ input: names[0], output: "o.mp4" }), { expect: { w: 320, h: 180, dMin: 1.8 } });
  // ---- rotate / flip ----
  await job("rotate 90", [withSound], "o.mp4", ({ names }) => A.buildRotateArgs({ input: names[0], output: "o.mp4", rotate: 90, flipH: false, flipV: false }), { expect: { w: 180, h: 320 } });
  await job("rotate 270 + flipH", [withSound], "o.mp4", ({ names }) => A.buildRotateArgs({ input: names[0], output: "o.mp4", rotate: 270, flipH: true, flipV: false }), { expect: { w: 180, h: 320 } });
  await job("rotate 180", [withSound], "o.mp4", ({ names }) => A.buildRotateArgs({ input: names[0], output: "o.mp4", rotate: 180, flipH: false, flipV: false }), { expect: { w: 320, h: 180 } });
  await job("flip only (silent)", [silent], "o.mp4", ({ names }) => A.buildRotateArgs({ input: names[0], output: "o.mp4", rotate: 0, flipH: true, flipV: true }), { expect: { w: 160, h: 90 } });
  // ---- speed ----
  await job("speed 2x (sound)", [withSound], "o.mp4", ({ names, infos }) => A.buildSpeedArgs({ input: names[0], output: "o.mp4", factor: 2, hasAudio: infos[0].hasAudio }), { expect: { dMin: 0.8, dMax: 1.3 } });
  await job("speed 0.25x (sound)", [withSound], "o.mp4", ({ names, infos }) => A.buildSpeedArgs({ input: names[0], output: "o.mp4", factor: 0.25, hasAudio: infos[0].hasAudio }), { expect: { dMin: 7, dMax: 9 } });
  await job("speed 4x (sound)", [withSound], "o.mp4", ({ names, infos }) => A.buildSpeedArgs({ input: names[0], output: "o.mp4", factor: 4, hasAudio: infos[0].hasAudio }), { expect: { dMin: 0.3, dMax: 0.9 } });
  await job("speed 2x (silent)", [silent], "o.mp4", ({ names, infos }) => A.buildSpeedArgs({ input: names[0], output: "o.mp4", factor: 2, hasAudio: infos[0].hasAudio }), { expect: { dMin: 0.3, dMax: 0.8 } });
  // ---- reverse / loop ----
  await job("reverse (sound)", [withSound], "o.mp4", ({ names, infos }) => A.buildReverseArgs({ input: names[0], output: "o.mp4", hasAudio: infos[0].hasAudio }), { expect: { dMin: 1.8, dMax: 2.3 } });
  await job("reverse (silent)", [silent], "o.mp4", ({ names, infos }) => A.buildReverseArgs({ input: names[0], output: "o.mp4", hasAudio: infos[0].hasAudio }), { expect: { dMin: 0.8, dMax: 1.3 } });
  await job("loop x3 (sound)", [withSound], "o.mp4", ({ names, infos }) => A.buildLoopArgs({ input: names[0], output: "o.mp4", plays: 3, hasAudio: infos[0].hasAudio }), { expect: { dMin: 5.5, dMax: 6.6 } });
  await job("loop x2 (silent)", [silent], "o.mp4", ({ names, infos }) => A.buildLoopArgs({ input: names[0], output: "o.mp4", plays: 2, hasAudio: infos[0].hasAudio }), { expect: { dMin: 1.8, dMax: 2.4 } });
  // ---- GIF ----
  await job("gif to mp4 (odd size)", [gif], "o.mp4", ({ names }) => A.buildGifToMp4Args({ input: names[0], output: "o.mp4" }), { expect: { w: 200, h: 100, dMin: 1.5 } });
  for (const [key, p] of Object.entries(A.GIF_PRESETS)) {
    await job(`gif ${key}`, [gif], "o.gif", ({ names }) => A.buildGifArgs({ input: names[0], output: "o.gif", width: p.width, fps: p.fps, colors: p.colors }), { expect: { w: Math.min(p.width, 201), dMin: 1.0 } });
  }
  await job("gif resize 100px", [gif], "o.gif", ({ names }) => A.buildGifArgs({ input: names[0], output: "o.gif", width: 100, fps: 12, colors: 128 }), { expect: { w: 100 } });
  // ---- merge ----
  await job("merge sound + silent", [withSound, silent], "o.mp4", ({ names, infos }) =>
    A.buildMergeArgs({ output: "o.mp4", width: 320, height: 180, fps: 24, clips: names.map((name, i) => ({ name, hasAudio: infos[i].hasAudio, duration: infos[i].duration })) }), { expect: { w: 320, h: 180, dMin: 2.8, dMax: 3.4 } });
  await job("merge silent + silent (vertical)", [silent, silent], "o.mp4", ({ names, infos }) =>
    A.buildMergeArgs({ output: "o.mp4", width: 180, height: 320, fps: 24, clips: names.map((name, i) => ({ name, hasAudio: infos[i].hasAudio, duration: infos[i].duration })) }), { expect: { w: 180, h: 320, dMin: 1.8, dMax: 2.4 } });
  // ---- watermark ----
  for (const position of ["top-left", "bottom-right", "center"]) {
    await job(`watermark ${position}`, [withSound, png], "o.mp4", ({ names, infos }) => A.buildWatermarkArgs({ input: names[0], mark: names[1], output: "o.mp4", position, markWidth: 64, opacity: 0.6, margin: 8, hasAudio: infos[0].hasAudio }), { expect: { w: 320, h: 180, dMin: 1.8 } });
  }
  await job("watermark (silent video)", [silent, png], "o.mp4", ({ names, infos }) => A.buildWatermarkArgs({ input: names[0], mark: names[1], output: "o.mp4", position: "top-right", markWidth: 30, opacity: 1, margin: 4, hasAudio: infos[0].hasAudio }), { expect: { w: 160, h: 90 } });
  // ---- add sound ----
  await job("add sound: replace", [withSound, tone], "o.mp4", ({ names, infos }) => A.buildAddAudioArgs({ video: names[0], audio: names[1], output: "o.mp4", mode: "replace", volume: 1, loop: true, videoHasAudio: infos[0].hasAudio, duration: infos[0].duration }), { expect: { dMin: 1.8, dMax: 2.4 } });
  await job("add sound: mix", [withSound, tone], "o.mp4", ({ names, infos }) => A.buildAddAudioArgs({ video: names[0], audio: names[1], output: "o.mp4", mode: "mix", volume: 0.5, loop: false, videoHasAudio: infos[0].hasAudio, duration: infos[0].duration }), { expect: { dMin: 0.8 } });
  await job("add sound to silent video", [silent, tone], "o.mp4", ({ names, infos }) => A.buildAddAudioArgs({ video: names[0], audio: names[1], output: "o.mp4", mode: "mix", volume: 1, loop: false, videoHasAudio: infos[0].hasAudio, duration: infos[0].duration }), { expect: { dMin: 0.8, dMax: 1.3 } });
  // ---- slideshow ----
  await job("slideshow cut", jpgs, "o.mp4", ({ names }) => A.buildSlideshowArgs({ frames: names, output: "o.mp4", seconds: 1, fade: 0, fps: 24, audio: null }), { probe: false, expect: { w: 320, h: 180, dMin: 2.8, dMax: 3.4 } });
  await job("slideshow fade", jpgs, "o.mp4", ({ names }) => A.buildSlideshowArgs({ frames: names, output: "o.mp4", seconds: 1, fade: 0.4, fps: 24, audio: null }), { probe: false, expect: { w: 320, h: 180, dMin: 1.8, dMax: 2.6 } });
  await job("slideshow + music", [...jpgs, tone], "o.mp4", ({ names }) => A.buildSlideshowArgs({ frames: names.slice(0, 3), output: "o.mp4", seconds: 1, fade: 0, fps: 24, audio: names[3] }), { probe: false, expect: { w: 320, h: 180, dMin: 0.8 } });
  await job("slideshow one picture", [jpgs[0]], "o.mp4", ({ names }) => A.buildSlideshowArgs({ frames: names, output: "o.mp4", seconds: 2, fade: 0.5, fps: 24, audio: null }), { probe: false, expect: { dMin: 1.8, dMax: 2.4 } });
}, ONLY, RESET);

console.log(failures === 0 ? "ALL OK" : `FAILED: ${failures}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
