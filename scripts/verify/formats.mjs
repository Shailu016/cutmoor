import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:5174";
const OUT = process.argv[3];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
const version = await browser.version();
await page.exposeFunction("report", (r) => console.log(JSON.stringify(r).slice(0, 230)));
await page.goto(`${BASE}/tools/compress`, { waitUntil: "networkidle0" });

const results = await page.evaluate(async () => {
  const ff = await import("/src/lib/ffmpeg.ts");
  const { buildCompressArgs } = await import("/src/lib/compress.ts");
  const img = await import("/src/lib/image.ts");

  const mk = (group) => { const a = []; const orig = a.push.bind(a); a.push = (...e) => { e.forEach((x) => window.report({ group, ...x })); return orig(...e); }; return a; };
  const out = { video: mk("video"), image: mk("image"), notes: mk("note") };
  const dummy = new File([new Uint8Array(16)], "x.bin");
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

  async function ffRun(file, outputName, args) {
    try {
      return await Promise.race([
        ff.runFFmpeg({ file, outputName, args: typeof args === "function" ? args : () => args }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 75 s")), 75000)),
      ]);
    } catch (error) {
      ff.resetFFmpeg();
      throw error;
    }
  }

  async function probe(blob, kind) {
    const url = URL.createObjectURL(blob);
    try {
      if (kind === "video" || kind === "audio") {
        const el = document.createElement(kind === "video" ? "video" : "audio");
        el.muted = true;
        el.preload = "metadata";
        el.src = url;
        await Promise.race([
          new Promise((resolve, reject) => {
            el.onloadedmetadata = resolve;
            el.onerror = () => reject(new Error(el.error ? `media error ${el.error.code}` : "media error"));
          }),
          timeout(8000),
        ]);
        return { ok: el.duration > 0 && (kind === "audio" || el.videoWidth > 0), w: el.videoWidth || undefined, h: el.videoHeight || undefined, d: Number(el.duration.toFixed(2)) };
      }
      const bitmap = await createImageBitmap(blob);
      return { ok: bitmap.width > 0, w: bitmap.width, h: bitmap.height };
    } catch (error) {
      return { ok: false, err: String(error.message || error) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Which streams does a file contain? Parsed from the encoder's own log.
  async function streams(blob, name) {
    const lines = [];
    const off = ff.onFFmpegLog((message) => lines.push(message));
    try {
      await ffRun(new File([blob], name), "probe.null", ["-i", `input.${name.split(".").pop()}`, "-f", "null", "-"]).catch(() => undefined);
    } finally {
      off();
    }
    const text = lines.join("\n");
    return {
      video: /Stream #0:\d+.*Video:/.test(text),
      audio: /Stream #0:\d+.*Audio:/.test(text),
      audioCodec: (text.match(/Audio: ([a-z0-9_]+)/) || [])[1],
      videoCodec: (text.match(/Video: ([a-z0-9_]+)/) || [])[1],
      text,
    };
  }

  async function record(group, tool, input, output, fn, kind) {
    const started = performance.now();
    try {
      const blob = await fn();
      const check = await probe(blob, kind);
      out[group].push({ tool, input, output, ok: check.ok && blob.size > 0, bytes: blob.size, ms: Math.round(performance.now() - started), ...check });
      return blob;
    } catch (error) {
      out[group].push({ tool, input, output, ok: false, error: String((error && error.message) || error).slice(0, 160), ms: Math.round(performance.now() - started) });
      return null;
    }
  }

  try {
  // ---- 1. Make real source files in each container ----
  const lavfi = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"];
  const make = (name, codecArgs, extra = []) => ffRun(dummy, name, [...lavfi, "-t", "1", ...codecArgs, ...extra, "-y", name]);
  const sourceSpecs = {
    "mp4": ["src.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]],
    "mov": ["src.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]],
    "webm": ["src.webm", ["-c:v", "libvpx-vp9", "-c:a", "libopus"]],
    "mkv": ["src.mkv", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]],
    "avi": ["src.avi", ["-c:v", "mpeg4", "-c:a", "libmp3lame"]],
    "mp4 (HEVC)": ["src-hevc.mp4", ["-c:v", "libx265", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-c:a", "aac"]],
    "mp4 (no audio)": ["src-silent.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"]],
    "mov (ProRes)": ["src-prores.mov", ["-c:v", "prores_ks", "-profile:v", "0", "-c:a", "pcm_s16le"]],
    "webm (AV1)": ["src-av1.webm", ["-c:v", "libaom-av1", "-cpu-used", "8", "-c:a", "libopus"]],
  };
  const sources = {};
  for (const [label, [name, args]] of Object.entries(sourceSpecs)) {
    try {
      const blob = await make(name, args);
      sources[label] = new File([blob], name, { type: blob.type });
    } catch (error) {
      out.notes.push(`could not create ${label} source: ${String((error && error.message) || error).slice(0, 100)}`);
      ff.resetFFmpeg();
    }
  }
  out.sourcesCreated = Object.keys(sources);

  // ---- 2. Video tools ----
  for (const [label, file] of Object.entries(sources)) {
    await record("video", "compress", label, "mp4", () => ffRun(file, "o.mp4", buildCompressArgs({ input: `input.${file.name.split(".").pop()}`, output: "o.mp4", mode: "size", targetMb: 1, durationSeconds: 1, resolution: "original" })), "video");
    await record("video", "frame", label, "png", () => ffRun(file, "f.png", ["-ss", "0.5", "-i", `input.${file.name.split(".").pop()}`, "-frames:v", "1", "-y", "f.png"]), "image");
    await record("video", "frame", label, "jpg", () => ffRun(file, "f.jpg", ["-ss", "0.5", "-i", `input.${file.name.split(".").pop()}`, "-frames:v", "1", "-q:v", "2", "-y", "f.jpg"]), "image");
    for (const [fmt, codec, ext] of [["wav", ["-c:a", "pcm_s16le"], "wav"], ["m4a", ["-c:a", "aac", "-b:a", "192k"], "m4a"], ["mp3", ["-c:a", "libmp3lame", "-b:a", "192k"], "mp3"]]) {
      await record("video", "audio", label, fmt, () => ffRun(file, `a.${ext}`, ["-i", `input.${file.name.split(".").pop()}`, "-vn", ...codec, "-y", `a.${ext}`]), "audio");
    }
  }

  const mp4 = sources["mp4"];
  const inName = "input.mp4";
  await record("video", "convert", "mp4", "mp4", () => ffRun(mp4, "c.mp4", ["-i", inName, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", "c.mp4"]), "video");
  await record("video", "convert", "mp4", "webm", () => ffRun(mp4, "c.webm", ["-i", inName, "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k", "-y", "c.webm"]), "video");
  await record("video", "convert", "mp4", "gif", () => ffRun(mp4, "c.gif", ["-i", inName, "-vf", "fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer", "-loop", "0", "-y", "c.gif"]), "image");
  for (const label of ["mov", "webm", "mkv", "avi", "mp4 (HEVC)", "mov (ProRes)", "webm (AV1)"]) {
    if (!sources[label]) continue;
    const f = sources[label];
    await record("video", "convert", label, "mp4", () => ffRun(f, "c.mp4", ["-i", `input.${f.name.split(".").pop()}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", "c.mp4"]), "video");
  }
  for (const label of ["mp4", "webm", "mov"]) {
    const f = sources[label];
    await record("video", "trim", label, "mp4", () => ffRun(f, "t.mp4", ["-ss", "0.2", "-i", `input.${f.name.split(".").pop()}`, "-t", "0.6", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", "t.mp4"]), "video");
  }
  const cropFilter = "scale=270:480:force_original_aspect_ratio=increase,crop=270:480,setsar=1";
  await record("video", "resize", "mp4", "mp4 9:16", () => ffRun(mp4, "r.mp4", ["-i", inName, "-vf", cropFilter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", "r.mp4"]), "video");

  // ---- 3. Audio and metadata behaviour of Compress ----
  const withMeta = await ffRun(dummy, "m.mp4", [...lavfi, "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "title=CutmoorMetaTest", "-metadata", "comment=GPSLikeTag", "-y", "m.mp4"]);
  const metaFile = new File([withMeta], "m.mp4");
  const metaIn = await streams(withMeta, "m.mp4");
  const compressedMeta = await ffRun(metaFile, "o.mp4", buildCompressArgs({ input: "input.mp4", output: "o.mp4", mode: "size", targetMb: 1, durationSeconds: 1, resolution: "original" }));
  const metaOut = await streams(compressedMeta, "o.mp4");
  out.behaviour = {
    compressKeepsAudio: metaOut.audio,
    compressAudioCodec: metaOut.audioCodec,
    compressVideoCodec: metaOut.videoCodec,
    inputHadMetadataTitle: /CutmoorMetaTest/.test(metaIn.text),
    outputKeepsMetadataTitle: /CutmoorMetaTest/.test(metaOut.text),
  };
  // Silent input through compress: does the tool still produce a valid file? (covered in matrix above)

  // ---- 4. Images ----
  const encodeCanvas = (w, h, draw, type, q) => new Promise((resolve) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    c.toBlob(resolve, type, q);
  });
  const draw = (g, w, h) => { g.clearRect(0, 0, w, h); const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#2d4bf0"); grad.addColorStop(1, "#ff6a3d"); g.fillStyle = grad; g.beginPath(); g.arc(w / 2, h / 2, h / 2 - 4, 0, Math.PI * 2); g.fill(); };
  const imgSources = {};
  imgSources["PNG (transparent)"] = new File([await encodeCanvas(240, 160, draw, "image/png")], "a.png", { type: "image/png" });
  imgSources["JPG"] = new File([await encodeCanvas(240, 160, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); draw(g, w, h); }, "image/jpeg", 0.9)], "a.jpg", { type: "image/jpeg" });
  const webpBlob = await encodeCanvas(240, 160, draw, "image/webp", 0.9);
  if (webpBlob && webpBlob.type === "image/webp") imgSources["WebP"] = new File([webpBlob], "a.webp", { type: "image/webp" });
  imgSources["SVG"] = new File([new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#2d4bf0"/><circle cx="120" cy="80" r="50" fill="#ff6a3d"/></svg>`], { type: "image/svg+xml" })], "a.svg", { type: "image/svg+xml" });
  const pngFrame = (extName, args) => ffRun(new File([imgSources["PNG (transparent)"]], "in.png"), `x.${extName}`, ["-i", "input.png", ...args, "-y", `x.${extName}`]);
  for (const [label, ext, args] of [["GIF", "gif", ["-frames:v", "1"]], ["BMP", "bmp", ["-frames:v", "1"]], ["AVIF", "avif", ["-frames:v", "1", "-c:v", "libaom-av1", "-still-picture", "1"]]]) {
    try { const b = await pngFrame(ext, args); imgSources[label] = new File([b], `a.${ext}`, { type: label === "BMP" ? "image/bmp" : `image/${ext}` }); }
    catch (error) { out.notes.push(`could not create ${label} source: ${String((error && error.message) || error).slice(0, 80)}`); }
  }
  out.imageSourcesCreated = Object.keys(imgSources);

  const support = await img.getEncoderSupport();
  out.encoderSupport = support;

  const alphaAt = async (blob) => {
    const bmp = await createImageBitmap(blob); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    return g.getImageData(2, 2, 1, 1).data[3];
  };

  for (const [label, file] of Object.entries(imgSources)) {
    let loaded;
    try { loaded = await img.loadImage(file); }
    catch (error) { out.image.push({ tool: "load", input: label, ok: false, error: String((error && error.message) || error).slice(0, 120) }); continue; }
    out.image.push({ tool: "load", input: label, output: "decode", ok: loaded.width > 0, w: loaded.width, h: loaded.height, kind: loaded.kind, alphaDetected: img.detectAlpha(loaded) });
    for (const format of ["jpeg", "png", "webp"]) {
      const started = performance.now();
      try {
        const blob = await img.renderImage(loaded, { width: 120, height: 80, fit: "crop", format, quality: 0.85, background: "#ffffff" });
        const actualType = blob.type;
        const entry = { tool: "convert/resize", input: label, output: format, ok: blob.size > 0, bytes: blob.size, ms: Math.round(performance.now() - started), type: actualType, honoured: actualType === `image/${format}` };
        if (format === "png" && label === "PNG (transparent)") entry.alphaKept = (await alphaAt(blob)) === 0;
        out.image.push(entry);
      } catch (error) {
        out.image.push({ tool: "convert/resize", input: label, output: format, ok: false, error: String((error && error.message) || error).slice(0, 120) });
      }
    }
    if (label === "JPG" || label === "PNG (transparent)") {
      const started = performance.now();
      try {
        const res = await img.compressToTarget(loaded, { targetBytes: 6000, format: "jpeg", allowDownscale: true });
        out.image.push({ tool: "compress", input: label, output: "jpeg ≤6 KB", ok: res.blob.size > 0, bytes: res.blob.size, hitTarget: res.blob.size <= 6000, ms: Math.round(performance.now() - started) });
      } catch (error) {
        out.image.push({ tool: "compress", input: label, output: "jpeg ≤6 KB", ok: false, error: String((error && error.message) || error).slice(0, 120) });
      }
    }
    loaded.release();
  }

  } catch (error) {
    out.fatal = String((error && error.message) || error);
  }
  out.limits = { MAX_CANVAS_PIXELS: img.MAX_CANVAS_PIXELS, MAX_CANVAS_EDGE: img.MAX_CANVAS_EDGE };
  return out;
});

results.browser = version;
writeFileSync(OUT, JSON.stringify(results, null, 2));

const rows = (group) => results[group].map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.tool.padEnd(14)} ${String(r.input).padEnd(18)} -> ${String(r.output).padEnd(10)} ${r.bytes ?? ""} ${r.error ? "| " + r.error : ""}${r.honoured === false ? " | NOT HONOURED " + r.type : ""}${r.alphaKept !== undefined ? " | alphaKept=" + r.alphaKept : ""}`);
console.log("BROWSER:", version);
console.log("VIDEO SOURCES:", results.sourcesCreated.join(", "));
if (results.fatal) console.log("FATAL:", results.fatal);
console.log(rows("video").join("\n"));
console.log("\nIMAGE SOURCES:", results.imageSourcesCreated.join(", "), "| encoder support:", JSON.stringify(results.encoderSupport));
console.log(rows("image").join("\n"));
console.log("\nBEHAVIOUR:", JSON.stringify(results.behaviour));
console.log("NOTES:", JSON.stringify(results.notes));
await browser.close();
