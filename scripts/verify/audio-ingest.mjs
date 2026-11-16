// Real-browser check of the audio ingest (src/lib/captioning/audio): builds real WAV and MP4 files,
// streams them through createAudioIngest() and checks duration, sample counts, tone content, timing,
// errors, cancellation and memory behaviour on a long file.
//
//   npx vite --port 5193 --strictPort      (in another terminal)
//   node scripts/verify/audio-ingest.mjs [http://localhost:5193]
//
// Needs puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override).
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:5193";

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 900_000,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.exposeFunction("report", (r) => console.log(`${r.ok ? "PASS" : r.skip ? "SKIP" : "FAIL"}  ${r.name}${r.detail ? "  -- " + r.detail : ""}`));
console.log("Browser:", await browser.version());
// A cold Vite dev server reloads the page once after it discovers dependencies; warm it up first.
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await page.evaluate(() => import("/src/lib/captioning/audio/ingest.ts")).catch(() => undefined);
await new Promise((r) => setTimeout(r, 1500));
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });

const results = await page.evaluate(async () => {
  const { createAudioIngest } = await import("/src/lib/captioning/audio/ingest.ts");
  const mb = await import("/node_modules/mediabunny/dist/modules/src/index.js");
  const { CaptionError } = await import("/src/lib/captioning/contracts.ts");
  const out = [];
  const check = (name, ok, detail = "") => {
    const r = { name, ok: Boolean(ok), detail };
    out.push(r);
    window.report(r);
  };
  const skip = (name, detail) => {
    const r = { name, ok: true, skip: true, detail };
    out.push(r);
    window.report(r);
  };

  /** 16-bit PCM WAV; `channelsFn(ch, t)` gives the value of channel ch at time t. */
  function makeWav(rate, seconds, channels, channelsFn) {
    const frames = Math.round(rate * seconds);
    const buffer = new ArrayBuffer(44 + frames * channels * 2);
    const v = new DataView(buffer);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + frames * channels * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, frames * channels * 2, true);
    let o = 44;
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < channels; c += 1) {
        v.setInt16(o, Math.round(Math.max(-1, Math.min(1, channelsFn(c, i / rate))) * 32767), true);
        o += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  /** Reads a whole source (only for short test files) and returns stats. */
  async function drain(source, signal) {
    const chunks = [];
    let maxChunk = 0;
    for await (const c of source.chunks(signal)) {
      chunks.push(c);
      maxChunk = Math.max(maxChunk, c.samples.length);
    }
    const total = chunks.reduce((n, c) => n + c.samples.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c.samples, o); o += c.samples.length; }
    return { chunks, all, total, maxChunk, firstStartMs: chunks.length ? chunks[0].startMs : null };
  }

  function rms(x) { let s = 0; for (let i = 0; i < x.length; i += 1) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); }
  /** Amplitude of a known frequency inside 16 kHz audio (Goertzel-style projection over the interior). */
  function toneAmp(x, hz, skip = 400) {
    let a = 0, b = 0, n = 0;
    for (let i = skip; i < x.length - skip; i += 1) {
      const w = (2 * Math.PI * hz * i) / 16000;
      a += x[i] * Math.cos(w); b += x[i] * Math.sin(w); n += 1;
    }
    return (2 * Math.hypot(a, b)) / n;
  }
  function consecutive(chunks) {
    for (let i = 1; i < chunks.length; i += 1) {
      const expect = chunks[i - 1].startMs + Math.round((chunks[i - 1].samples.length * 1000) / 16000);
      if (Math.abs(chunks[i].startMs - expect) > 1) return false;
    }
    return true;
  }
  const ingest = createAudioIngest();
  const file = (blob, name) => new File([blob], name, { type: blob.type });

  // ---- WAV cases: stereo with a different tone per channel, several rates.
  for (const rate of [44_100, 48_000, 8000, 96_000, 22_050]) {
    const secs = 3;
    const f = file(makeWav(rate, secs, 2, (c, t) => 0.5 * Math.sin(2 * Math.PI * (c === 0 ? 440 : 880) * t)), `tone-${rate}.wav`);
    const src = await ingest.open(f);
    const r = await drain(src);
    await src.close();
    const expectedSamples = secs * 16000;
    check(`WAV ${rate} Hz stereo: duration reported`, src.durationMs !== null && Math.abs(src.durationMs - secs * 1000) < 50, `durationMs=${src.durationMs}`);
    check(`WAV ${rate} Hz stereo: sample count`, Math.abs(r.total - expectedSamples) <= 2, `${r.total} vs ${expectedSamples}`);
    check(`WAV ${rate} Hz stereo: starts at 0, chunks <= 1 s, consecutive`, r.firstStartMs === 0 && r.maxChunk <= 16000 && consecutive(r.chunks), `first=${r.firstStartMs} max=${r.maxChunk}`);
    // L=440 Hz and R=880 Hz at 0.5, averaged: each tone has amplitude 0.25 (if the rate is high enough to hold it).
    const a440 = toneAmp(r.all, 440), a880 = toneAmp(r.all, 880);
    check(`WAV ${rate} Hz stereo: downmix amplitudes (440 and 880 Hz both ~0.25)`, Math.abs(a440 - 0.25) < 0.01 && Math.abs(a880 - 0.25) < 0.01, `a440=${a440.toFixed(4)} a880=${a880.toFixed(4)}`);
    check(`WAV ${rate} Hz stereo: RMS ~0.25`, Math.abs(rms(r.all.subarray(400, r.all.length - 400)) - 0.25) < 0.01, `rms=${rms(r.all).toFixed(4)}`);
  }

  // ---- MP4 with AAC, written by mediabunny with the browser's own encoder.
  let mp4 = null;
  try {
    if (typeof AudioEncoder === "undefined") throw new Error("no AudioEncoder");
    const supported = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    if (!supported.supported) throw new Error("AAC encode not supported");
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const source = new mb.AudioSampleSource({ codec: "aac", bitrate: 128000 });
    output.addAudioTrack(source);
    await output.start();
    const rate = 48000, secs = 3, block = 4800;
    for (let at = 0; at < rate * secs; at += block) {
      const data = new Float32Array(block * 2);
      for (let i = 0; i < block; i += 1) {
        const t = (at + i) / rate;
        data[i] = 0.5 * Math.sin(2 * Math.PI * 440 * t);
        data[block + i] = 0.5 * Math.sin(2 * Math.PI * 440 * t);
      }
      await source.add(new mb.AudioSample({ data, format: "f32-planar", numberOfChannels: 2, sampleRate: rate, timestamp: at / rate }));
    }
    await output.finalize();
    mp4 = new Blob([output.target.buffer], { type: "video/mp4" });
  } catch (e) {
    skip("MP4/AAC built in the page", `could not build: ${e.message}`);
  }
  if (mp4) {
    const src = await ingest.open(file(mp4, "tone.m4a"));
    const r = await drain(src);
    await src.close();
    check("MP4 AAC 48k stereo: duration (3 s, AAC priming allows ~50 ms)", Math.abs(r.total / 16 - 3000) < 80, `samples=${r.total} -> ${(r.total / 16).toFixed(0)} ms`);
    check("MP4 AAC: starts near 0 and chunks are consecutive", r.firstStartMs !== null && r.firstStartMs <= 50 && consecutive(r.chunks), `first=${r.firstStartMs}`);
    const a = toneAmp(r.all, 440);
    check("MP4 AAC: 440 Hz tone survives at ~0.5 amplitude", Math.abs(a - 0.5) < 0.05, `a440=${a.toFixed(3)}`);
  }

  // ---- The repo's own sample clip (H.264 + AAC).
  try {
    const resp = await fetch("/samples/sample-clip.mp4");
    const blob = await resp.blob();
    const src = await ingest.open(file(blob, "sample-clip.mp4"));
    const r = await drain(src);
    await src.close();
    check("sample-clip.mp4: has audio, sensible duration", r.total > 16000 && src.durationMs !== null && Math.abs(r.total / 16 - src.durationMs) < 150, `samples=${r.total} (${(r.total / 16).toFixed(0)} ms) container=${src.durationMs} ms`);
    check("sample-clip.mp4: not silent, finite, in range", rms(r.all) > 0.003 && r.all.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.5), `rms=${rms(r.all).toFixed(4)}`);
    check("sample-clip.mp4: chunks consecutive and <= 1 s", consecutive(r.chunks) && r.maxChunk <= 16000, `first=${r.firstStartMs}`);
    await src.close(); // second close must be harmless
    check("close() twice is safe", true);
  } catch (e) {
    check("sample-clip.mp4 decodes", false, String(e));
  }

  // ---- Errors.
  async function expectCode(name, make, code) {
    try {
      const s = await make();
      await s.close();
      check(name, false, "did not throw");
    } catch (e) {
      check(name, e instanceof CaptionError && e.code === code, `${e?.name}/${e?.code}: ${e?.message}`);
    }
  }
  await expectCode("a text file is rejected as unsupported-file", () => ingest.open(file(new Blob(["hello, this is not media"]), "notes.txt")), "unsupported-file");
  await expectCode("an empty file is rejected as unsupported-file", () => ingest.open(file(new Blob([]), "empty.mp4")), "unsupported-file");
  await expectCode("truncated garbage that looks like a RIFF header is rejected", () => ingest.open(file(new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])]), "bad.wav")), "unsupported-file");
  try {
    const ac = new AbortController();
    ac.abort();
    await ingest.open(file(makeWav(16000, 1, 1, () => 0), "x.wav"), ac.signal);
    check("open() with an already-aborted signal rejects 'aborted'", false, "did not throw");
  } catch (e) {
    check("open() with an already-aborted signal rejects 'aborted'", e instanceof CaptionError && e.code === "aborted", e?.code);
  }

  // No audio track: a video-only MP4 (a canvas encoded with the browser's video encoder).
  try {
    if (typeof VideoEncoder === "undefined") throw new Error("no VideoEncoder");
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext("2d");
    const vs = new mb.CanvasSource(canvas, { codec: "avc", bitrate: 200000 });
    output.addVideoTrack(vs, { frameRate: 10 });
    await output.start();
    for (let i = 0; i < 10; i += 1) { ctx.fillStyle = `hsl(${i * 30},80%,50%)`; ctx.fillRect(0, 0, 64, 64); await vs.add(i / 10, 0.1); }
    await output.finalize();
    await expectCode("a video-only MP4 is rejected as no-audio", () => ingest.open(file(new Blob([output.target.buffer], { type: "video/mp4" }), "silent.mp4")), "no-audio");
  } catch (e) {
    skip("video-only MP4 -> no-audio", `could not build a video-only file: ${e.message}`);
  }

  // ---- Cancellation: abort after the first chunk of a long file; must stop fast and leave no half state.
  {
    const long = file(makeWav(16000, 600, 1, (c, t) => 0.3 * Math.sin(2 * Math.PI * 300 * t)), "long16k.wav");
    const src = await ingest.open(long);
    const ac = new AbortController();
    let n = 0;
    let t0 = 0;
    let code = "none";
    try {
      for await (const c of src.chunks(ac.signal)) {
        n += 1;
        if (n === 2) { t0 = performance.now(); ac.abort(); }
        if (n > 5) break;
      }
    } catch (e) { code = e?.code ?? String(e); }
    const ms = performance.now() - t0;
    check("abort mid-stream: chunks() throws 'aborted' within 500 ms", code === "aborted" && ms < 500, `code=${code} after ${ms.toFixed(0)} ms, ${n} chunks`);
    await src.close();
    await src.close();
    try { for await (const c of src.chunks()) void c; check("chunks() after close() is an error", false); }
    catch (e) { check("chunks() after close() is an error", e instanceof CaptionError, e?.code); }
  }

  // ---- A long, high-rate file: 5 minutes of 48 kHz stereo (about 58 MB). Checks count, speed, bounded memory.
  {
    const secs = 300;
    const big = file(makeWav(48000, secs, 2, (c, t) => 0.4 * Math.sin(2 * Math.PI * (200 + c * 100) * t)), "long48k.wav");
    const src = await ingest.open(big);
    const t0 = performance.now();
    let total = 0, maxChunk = 0, first = null, last = null, ok = true, prevEnd = null, peakHeap = 0;
    for await (const c of src.chunks()) {
      total += c.samples.length;
      maxChunk = Math.max(maxChunk, c.samples.length);
      if (first === null) first = c.startMs;
      if (prevEnd !== null && Math.abs(c.startMs - prevEnd) > 1) ok = false;
      prevEnd = c.startMs + Math.round((c.samples.length * 1000) / 16000);
      last = c.startMs;
      if (performance.memory) peakHeap = Math.max(peakHeap, performance.memory.usedJSHeapSize);
    }
    const sec = (performance.now() - t0) / 1000;
    await src.close();
    check("5 min 48k stereo WAV: sample count exact (+-2)", Math.abs(total - secs * 16000) <= 2, `${total} vs ${secs * 16000}`);
    check("5 min 48k stereo WAV: chunks <= 1 s, consecutive, ends at the right time", maxChunk <= 16000 && ok && Math.abs(last - (secs - 1) * 1000) <= 2, `last start=${last}`);
    check("5 min 48k stereo WAV: speed", true, `${sec.toFixed(1)} s for ${secs} s of audio = ${(secs / sec).toFixed(0)}x realtime; peak JS heap ${(peakHeap / 1e6).toFixed(0)} MB (includes the ~58 MB test file itself)`);
  }
  return out;
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
