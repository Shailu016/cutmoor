import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 3_000_000,
});
const page = await browser.newPage();
await page.exposeFunction("report", (r) => console.log(JSON.stringify(r)));
await page.goto("http://localhost:5174/tools/compress", { waitUntil: "networkidle0" });

await page.evaluate(async () => {
  const ff = await import("/src/lib/ffmpeg.ts");
  const { buildCompressArgs } = await import("/src/lib/compress.ts");
  const say = (r) => window.report(r);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms))]);
  const ext = (f) => f.name.split(".").pop();
  const run = async (file, out, args, ms = 120000) => {
    try {
      return await withTimeout(ff.runFFmpeg({ file, outputName: out, args: typeof args === "function" ? args : () => args }), ms);
    } catch (e) {
      ff.resetFFmpeg();
      throw e;
    }
  };
  const playable = async (blob, kind) => {
    const url = URL.createObjectURL(blob);
    try {
      const el = document.createElement(kind);
      el.muted = true;
      el.src = url;
      return await new Promise((resolve) => {
        el.onloadedmetadata = () => resolve({ ok: el.duration > 0, w: el.videoWidth, h: el.videoHeight, d: Number(el.duration.toFixed(2)) });
        el.onerror = () => resolve({ ok: false });
        setTimeout(() => resolve({ ok: false, err: "metadata timeout" }), 10000);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // ---- A. WebM inputs: a real VP9 file recorded by the browser, and a VP8 file from the encoder ----
  const sources = {};
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const g = canvas.getContext("2d");
    const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    let f = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${(f * 7) % 360},70%,50%)`;
      g.fillRect(0, 0, 320, 180);
      g.fillStyle = "#fff";
      g.fillRect((f * 6) % 300, 70, 40, 40);
      f += 1;
    }, 42);
    await new Promise((r) => setTimeout(r, 1500));
    recorder.stop();
    clearInterval(timer);
    await new Promise((r) => (recorder.onstop = r));
    sources["WebM (VP9, recorded by Chrome)"] = new File([new Blob(chunks, { type: "video/webm" })], "rec-vp9.webm", { type: "video/webm" });
  } catch (e) {
    say({ note: "could not record VP9 webm: " + String((e && e.message) || e).slice(0, 100) });
  }
  try {
    const lavfi = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1"];
    const blob = await run(new File([new Uint8Array(16)], "x.bin"), "vp8.webm", [...lavfi, "-c:v", "libvpx", "-b:v", "1M", "-c:a", "libopus", "-y", "vp8.webm"]);
    sources["WebM (VP8 + Opus)"] = new File([blob], "src-vp8.webm", { type: "video/webm" });
  } catch (e) {
    say({ note: "could not make VP8 webm: " + String((e && e.message) || e).slice(0, 100) });
  }

  for (const [label, file] of Object.entries(sources)) {
    const input = `input.${ext(file)}`;
    const tests = [
      ["compress", "mp4", "video", () => run(file, "o.mp4", buildCompressArgs({ input, output: "o.mp4", mode: "size", targetMb: 1, durationSeconds: 1.4, resolution: "original" }))],
      ["convert", "mp4", "video", () => run(file, "c.mp4", ["-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", "c.mp4"])],
      ["trim", "mp4", "video", () => run(file, "t.mp4", ["-ss", "0.2", "-i", input, "-t", "0.6", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", "t.mp4"])],
      ["frame", "png", "image", () => run(file, "f.png", ["-ss", "0.5", "-i", input, "-frames:v", "1", "-y", "f.png"])],
    ];
    for (const [tool, output, kind, fn] of tests) {
      const t = performance.now();
      try {
        const blob = await fn();
        const check = kind === "image" ? { ok: (await createImageBitmap(blob)).width > 0 } : await playable(blob, kind);
        say({ part: "webm-input", tool, input: label, output, ok: check.ok && blob.size > 0, bytes: blob.size, ms: Math.round(performance.now() - t) });
      } catch (e) {
        say({ part: "webm-input", tool, input: label, output, ok: false, error: String((e && e.message) || e).slice(0, 120) });
      }
    }
  }

  // ---- B. A large file: ~100 MB 1080p, compressed through the real Compress tool settings ----
  try {
    const t0 = performance.now();
    const big = await run(
      new File([new Uint8Array(16)], "x.bin"),
      "big.mp4",
      ["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-vf", "noise=alls=45:allf=t", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "42M", "-maxrate", "42M", "-bufsize", "84M", "-pix_fmt", "yuv420p", "-an", "-y", "big.mp4"],
      1_000_000,
    );
    say({ part: "big", step: "generated", bytes: big.size, seconds: Math.round((performance.now() - t0) / 1000) });
    const bigFile = new File([big], "big.mp4", { type: "video/mp4" });
    const t1 = performance.now();
    try {
      const out = await run(bigFile, "o.mp4", buildCompressArgs({ input: "input.mp4", output: "o.mp4", mode: "size", targetMb: 25, durationSeconds: 20, resolution: "original" }), 1_500_000);
      const check = await playable(out, "video");
      say({ part: "big", step: "compress", ok: check.ok, inBytes: big.size, outBytes: out.size, seconds: Math.round((performance.now() - t1) / 1000), w: check.w, h: check.h });
    } catch (e) {
      say({ part: "big", step: "compress", ok: false, inBytes: big.size, error: String((e && e.message) || e).slice(0, 160), seconds: Math.round((performance.now() - t1) / 1000) });
    }
  } catch (e) {
    say({ part: "big", step: "generate", ok: false, error: String((e && e.message) || e).slice(0, 160) });
  }
});
console.log("DONE");
await browser.close();
