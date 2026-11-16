// Real-browser check of the caption burn-in exporter (src/lib/captioning/burn-in).
//
//   npx vite --port 5191 --strictPort      (in another terminal)
//   node scripts/verify/burn-in.mjs [base-url] [out-dir]
//
// Exports the repo sample with captions and checks, on the OUTPUT file:
//   1. it decodes (every frame, in the browser's own decoder)
//   2. duration is within 50 ms of the source
//   3. frame count equals the source and every frame time matches
//   4. audio is present and copied (same codec, same packet count) when the source has audio
//   5. inside caption events the caption band differs from an uncaptioned export of the same clip;
//      outside every event it equals it (an uncaptioned export is the fair reference, because both
//      went through the same encoder)
//   6. aborting stops the export with a CaptionError "aborted"
// Needs puppeteer-core (npm install --no-save puppeteer-core, or set PUPPETEER_CORE to its folder).
// Exits 1 on any failed check, and says plainly if this Chrome has no usable video encoder.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = process.argv[2] ?? "http://localhost:5191";
const OUT = process.argv[3] ?? join(process.cwd(), "burn-in-out");
mkdirSync(OUT, { recursive: true });

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch {
    const dir = process.env.PUPPETEER_CORE;
    if (!dir) throw new Error("puppeteer-core not found. Run: npm install --no-save puppeteer-core (or set PUPPETEER_CORE to its folder).");
    const require = createRequire(pathToFileURL(join(dir, "x.js")));
    return require(dir);
  }
}

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 600_000,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const results = [];
let failed = false;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console error:", m.text());
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const run = await page.evaluate(async () => {
    const { createBurnInExporter } = await import("/src/lib/captioning/burn-in/exporter.ts");
    const { CAPTION_STYLES } = await import("/src/lib/captioning/burn-in/styles.ts");
    const { probeFile, frameAt, meanAbsDiff, framePng, buildShiftedVideoOnly, firstVideoTimestamp } = await import("/src/lib/captioning/burn-in/verify-helpers.ts");
    const { createBurnInExporter: _unused } = await import("/src/lib/captioning/burn-in/index.ts");
    void _unused;

    const exporter = createBurnInExporter();
    const out = { supported: await exporter.isSupported() };
    if (!out.supported) return out;

    const blob = await (await fetch("/samples/sample-clip.mp4")).blob();
    const file = new File([blob], "sample-clip.mp4", { type: "video/mp4" });
    const source = await probeFile(file);
    out.source = { duration: source.durationSeconds, video: { ...source.video, frames: source.video.frames.length }, audio: source.audio, decoded: source.decodedFrames };

    const durMs = source.durationSeconds * 1000;
    const word = (text, startMs, endMs, index) => ({ text, startMs, endMs, confidence: 1, index, windowIndex: 0 });
    const mk = (index, startMs, endMs, lines) => ({ index, startMs, endMs, lines });
    // Words are spread evenly over each event so the highlight moves across it.
    const spread = (texts, startMs, endMs, baseIndex) => {
      const step = (endMs - startMs) / texts.length;
      return texts.map((t, i) => word(t, Math.round(startMs + i * step), Math.round(startMs + (i + 1) * step), baseIndex + i));
    };
    const e1s = Math.round(durMs * 0.2);
    const e1e = Math.round(durMs * 0.45);
    const e2s = Math.round(durMs * 0.65);
    const e2e = Math.round(durMs * 0.9);
    const events = [
      mk(0, e1s, e1e, [spread(["Namaste", "doston,", "aaj", "hum"], e1s, e1e, 0).slice(0, 2), spread(["Namaste", "doston,", "aaj", "hum"], e1s, e1e, 0).slice(2)]),
      mk(1, e2s, e2e, [spread(["नमस्ते", "दोस्तों", "welcome", "back"], e2s, e2e, 4)]),
    ];
    out.events = events.map((e) => [e.startMs, e.endMs]);

    const style = CAPTION_STYLES.clean;
    const t0 = performance.now();
    let lastProgress = 0;
    let progressBackwards = false;
    const captioned = await exporter.export({
      file,
      events,
      style,
      onProgress: (f) => {
        if (f < lastProgress) progressBackwards = true;
        lastProgress = f;
      },
    });
    out.exportMs = Math.round(performance.now() - t0);
    out.progressBackwards = progressBackwards;
    out.lastProgress = lastProgress;
    out.captionedBytes = captioned.size;
    out.captionedType = captioned.type;
    const reference = await exporter.export({ file, events: [], style });

    const outProbe = await probeFile(captioned);
    out.output = { duration: outProbe.durationSeconds, video: { ...outProbe.video, frames: outProbe.video.frames.length }, audio: outProbe.audio, decoded: outProbe.decodedFrames };
    // Timeline comparison, frame by frame.
    let maxTs = 0;
    let maxDur = 0;
    const n = Math.min(source.video.frames.length, outProbe.video.frames.length);
    for (let i = 0; i < n; i++) {
      maxTs = Math.max(maxTs, Math.abs(source.video.frames[i].timestamp - outProbe.video.frames[i].timestamp));
      maxDur = Math.max(maxDur, Math.abs(source.video.frames[i].duration - outProbe.video.frames[i].duration));
    }
    out.timeline = { maxTs, maxDur };

    // Pixel checks. The caption sits in the bottom band; the top band is a control.
    const H = outProbe.video.height;
    const W = outProbe.video.width;
    const bottom = { x: 0, y: Math.floor(H * 0.7), width: W, height: Math.floor(H * 0.25) };
    const top = { x: 0, y: 0, width: W, height: Math.floor(H * 0.4) };
    const probeTimes = {
      beforeAll: e1s / 2000,
      insideE1: (e1s + (e1e - e1s) * 0.7) / 1000,
      insideE1Early: (e1s + 30) / 1000,
      betweenEvents: (e1e + (e2s - e1e) / 2) / 1000,
      insideE2: (e2s + (e2e - e2s) * 0.6) / 1000,
      afterAll: (e2e + (durMs - e2e) / 2) / 1000,
    };
    out.diffs = {};
    out.pngs = {};
    for (const [name, t] of Object.entries(probeTimes)) {
      const a = await frameAt(captioned, t);
      const b = await frameAt(reference, t);
      out.diffs[name] = { t, bottom: meanAbsDiff(a, b, bottom), top: meanAbsDiff(a, b, top) };
      if (name === "insideE1" || name === "insideE2") out.pngs[name] = await framePng(a.width, a.height, a.data);
    }

    // A source whose first timestamp is 1 s (video-only copy, packets shifted +1 s). Caption events are on
    // the source timeline: one from 1.0 s to 2.0 s of the source = the first second of the output.
    const shifted = await buildShiftedVideoOnly(file, 1);
    out.shifted = { firstTs: await firstVideoTimestamp(shifted), diffs: {} };
    const shiftedEvents = [mk(0, 1000, 2000, [spread(["Shifted", "caption", "check"], 1000, 2000, 0)])];
    const shiftedCaptioned = await exporter.export({ file: shifted, events: shiftedEvents, style });
    const shiftedReference = await exporter.export({ file: shifted, events: [], style });
    for (const [name, t] of Object.entries({ firstSecond: 0.5, afterEvent: 1.5, later: 3 })) {
      const a = await frameAt(shiftedCaptioned, t);
      const b = await frameAt(shiftedReference, t);
      out.shifted.diffs[name] = { t, bottom: meanAbsDiff(a, b, bottom) };
      if (name === "firstSecond") out.pngs.shiftedFirstSecond = await framePng(a.width, a.height, a.data);
    }

    // Abort test.
    const controller = new AbortController();
    const started = performance.now();
    const pending = exporter.export({ file, events, style, signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    try {
      await pending;
      out.abort = { rejected: false };
    } catch (error) {
      out.abort = { rejected: true, code: error && error.code, ms: Math.round(performance.now() - started) };
    }

    // Pre-aborted signal rejects immediately.
    const pre = new AbortController();
    pre.abort();
    try {
      await exporter.export({ file, events, style, signal: pre.signal });
      out.preAbort = { rejected: false };
    } catch (error) {
      out.preAbort = { rejected: true, code: error && error.code };
    }

    // A non-video file is refused with a CaptionError, not a crash.
    try {
      await exporter.export({ file: new File([new Uint8Array(2048)], "junk.mp4", { type: "video/mp4" }), events, style });
      out.junk = { rejected: false };
    } catch (error) {
      out.junk = { rejected: true, code: error && error.code, message: error && error.message };
    }

    // Hand the files back to Node for saving.
    const toB64 = async (b) => {
      const bytes = new Uint8Array(await b.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    out.files = { "captioned.mp4": await toB64(captioned), "reference.mp4": await toB64(reference) };
    return out;
  });

  if (!run.supported) {
    console.log("SKIP  this Chrome reports no usable video encoder (isSupported() === false). Nothing further can be verified here.");
    process.exitCode = 2;
  } else {
    for (const [name, b64] of Object.entries(run.files)) writeFileSync(join(OUT, name), Buffer.from(b64, "base64"));
    for (const [name, b64] of Object.entries(run.pngs)) writeFileSync(join(OUT, `${name}.png`), Buffer.from(b64, "base64"));
    console.log("source:", JSON.stringify(run.source));
    console.log("output:", JSON.stringify(run.output));
    console.log("events (ms):", JSON.stringify(run.events), "export took", run.exportMs, "ms,", run.captionedBytes, "bytes", run.captionedType);
    console.log("timeline diff:", JSON.stringify(run.timeline));
    console.log("pixel diffs (mean abs, 0-255):", JSON.stringify(run.diffs));

    check("output decodes: every frame decodes", run.output.decoded === run.output.video.frames, `decoded ${run.output.decoded} of ${run.output.video.frames} packets`);
    check("output is an MP4", run.captionedType === "video/mp4");
    check("duration within 50 ms of source", Math.abs(run.output.duration - run.source.duration) <= 0.05, `source ${run.source.duration.toFixed(4)} s, output ${run.output.duration.toFixed(4)} s`);
    check("frame count equals source", run.output.video.frames === run.source.video.frames, `${run.source.video.frames} -> ${run.output.video.frames}`);
    check("every frame time matches the source (max diff under 1 ms)", run.timeline.maxTs < 0.001, `max ${run.timeline.maxTs.toFixed(6)} s, durations ${run.timeline.maxDur.toFixed(6)} s`);
    check("output size equals source size (even-rounded)", Math.abs(run.output.video.width - run.source.video.width) <= 1 && Math.abs(run.output.video.height - run.source.video.height) <= 1, `${run.source.video.width}x${run.source.video.height} -> ${run.output.video.width}x${run.output.video.height}`);
    if (run.source.audio) {
      check("audio present with the same codec", run.output.audio?.codec === run.source.audio.codec, `${run.source.audio.codec} -> ${run.output.audio?.codec}`);
      check("audio packets copied one for one", run.output.audio?.packets === run.source.audio.packets, `${run.source.audio.packets} -> ${run.output.audio?.packets}`);
    } else {
      console.log("note: the sample has no audio track, so audio copy was not exercised.");
    }
    check("progress never went backwards and ended at 1", !run.progressBackwards && run.lastProgress === 1, `last ${run.lastProgress}`);
    const d = run.diffs;
    for (const name of ["insideE1", "insideE1Early", "insideE2"]) {
      check(`caption visible inside an event (${name})`, d[name].bottom > 3, `bottom band diff ${d[name].bottom.toFixed(2)}`);
    }
    for (const name of ["beforeAll", "betweenEvents", "afterAll"]) {
      check(`frame equals the uncaptioned export outside events (${name})`, d[name].bottom < 0.75, `bottom band diff ${d[name].bottom.toFixed(3)}`);
    }
    for (const name of Object.keys(d)) check(`picture outside the caption band is untouched (${name})`, d[name].top < 0.75, `top band diff ${d[name].top.toFixed(3)}`);
    check("shifted source really starts at 1 s", Math.abs(run.shifted.firstTs - 1) < 0.01, `first timestamp ${run.shifted.firstTs}`);
    const sd = run.shifted.diffs;
    console.log("shifted-source pixel diffs:", JSON.stringify(sd));
    check("first PTS > 0: caption shows when the source reaches the event (output 0.5 s = source 1.5 s)", sd.firstSecond.bottom > 3, `diff ${sd.firstSecond.bottom.toFixed(2)}`);
    check("first PTS > 0: caption gone after the event (output 1.5 s = source 2.5 s)", sd.afterEvent.bottom < 0.75, `diff ${sd.afterEvent.bottom.toFixed(3)}`);
    check("first PTS > 0: no caption later (output 3 s)", sd.later.bottom < 0.75, `diff ${sd.later.bottom.toFixed(3)}`);
    check("abort rejects with code aborted, promptly", run.abort.rejected && run.abort.code === "aborted" && run.abort.ms < 5000, JSON.stringify(run.abort));
    check("an already-aborted signal rejects with aborted", run.preAbort.rejected && run.preAbort.code === "aborted");
    check("a non-video file is refused with a CaptionError code", run.junk.rejected && ["unsupported-file", "export"].includes(run.junk.code), JSON.stringify(run.junk));
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT, "burn-in-results.json"), JSON.stringify(results, null, 2));
if (failed) {
  console.log("\nFAILED");
  process.exitCode = 1;
} else if (process.exitCode !== 2) {
  console.log("\nALL CHECKS PASSED. Output and frames saved in", OUT);
}
