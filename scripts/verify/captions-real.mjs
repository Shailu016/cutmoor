/**
 * Runs the REAL captions pipeline (real Whisper + Silero + onnxruntime) in Chrome on an audio/video file.
 *
 *   node scripts/verify/captions-real.mjs <base-url> <media-file> <model-dist-dir> [--headless=false]
 *
 * The model host is answered from a local folder built by scripts/models/build-manifest.mjs, so the exact
 * bytes the manifest pins are used (the page still verifies every SHA-256). Prints the finished captions.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { createFakeModelHost, headersFor, parseHeadersFile, MODEL_ORIGIN } from "./captions-lib.mjs";

const [baseArg, media, distList] = process.argv.slice(2);
const tierArg = (process.argv.find((a) => a.startsWith("--tier=")) ?? "--tier=fast").slice(7);
const BASE = baseArg.replace(/\/+$/, "");
const headless = !process.argv.includes("--headless=false");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const files = new Map();
for (const distDir of distList.split(",")) {
  const manifest = JSON.parse(await readFile(join(distDir, "manifest.json"), "utf8"));
  for (const f of manifest.files) files.set(f.url, new Uint8Array(await readFile(join(distDir, "m", new URL(f.url).pathname.split("/").pop()))));
}
const host = createFakeModelHost({ files, pageOrigin: new URL(BASE).origin });
const rules = parseHeadersFile(await readFile(here("../../public/_headers"), "utf8"));
// `--no-headers` is for a benchmark against the Vite dev server: its inline React preamble needs an inline script, which
// the production CSP in public/_headers blocks. Production-page checks (captions-network, captions-ui) keep the headers.
const applyHeaders = !process.argv.includes("--no-headers");

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless,
  userDataDir: (process.argv.find((a) => a.startsWith("--profile=")) ?? "").slice(10) || undefined,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
  protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const T0 = Date.now();
page.on("console", (m) => console.log(`[console.${m.type()} @${((Date.now() - T0) / 1000).toFixed(1)}s] ${m.text().slice(0, 400)}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 400)}`));
const vadArg = (process.argv.find((a) => a.startsWith("--vad=")) ?? "").slice(6);
if (vadArg) await page.evaluateOnNewDocument((json) => { window.__cutmoorVadOverrides = JSON.parse(json); }, vadArg);
const attentionOut = (process.argv.find((a) => a.startsWith("--attention-out=")) ?? "").slice(16);
if (attentionOut) await page.evaluateOnNewDocument(() => { window.__cutmoorAttentionSink = { names: ["cross_attentions.3", "cross_attentions.4", "cross_attentions.5"], steps: [] }; });
const ortArg = (process.argv.find((a) => a.startsWith("--ort=")) ?? "").slice(6);
if (ortArg) await page.evaluateOnNewDocument((json) => { window.__cutmoorOrtSessionOverrides = JSON.parse(json); }, ortArg);
// Song-mode PipelineTuning switches for an A/B run in a development build, e.g. --tuning='{"c2Time":false}'. The page
// only reads the global when import.meta.env.DEV is true; a built dist ignores it.
const tuningArg = (process.argv.find((a) => a.startsWith("--tuning=")) ?? "").slice(9);
if (tuningArg) await page.evaluateOnNewDocument((json) => { window.__cutmoorPipelineTuning = JSON.parse(json); }, tuningArg);
// Development build only: one console line per model read (window, token, kind, words kept, mean log-probability).
if (process.argv.includes("--debug-reads")) await page.evaluateOnNewDocument(() => { window.__cutmoorDebugReads = true; });
if (process.argv.includes("--nogpu")) await page.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }); } catch {} });
await page.setRequestInterception(true);
page.on("request", async (request) => {
  const url = request.url();
  const parsed = new URL(url);
  if (parsed.origin === MODEL_ORIGIN) {
    const r = host({ url, method: request.method(), headers: request.headers() });
    return request.respond({ status: r.status, headers: r.headers, body: r.body ? Buffer.from(r.body) : undefined });
  }
  if (request.isNavigationRequest() && parsed.origin === new URL(BASE).origin) {
    try {
      const res = await fetch(url);
      const extra = applyHeaders ? headersFor(parsed.pathname, rules) : {};
      const headers = Object.fromEntries(res.headers);
      delete headers["content-encoding"];
      delete headers["content-length"];
      return request.respond({ status: res.status, headers: { ...headers, ...extra }, body: Buffer.from(await res.arrayBuffer()) });
    } catch {
      /* fall through */
    }
  }
  return request.continue();
});

// A Vite dev server keeps a websocket open and transforms modules on first request, so it never reaches "networkidle0"
// quickly; wait for the DOM there instead. A built site keeps the stricter wait.
await page.goto(`${BASE}/tools/auto-captions/`, applyHeaders ? { waitUntil: "networkidle0" } : { waitUntil: "domcontentloaded", timeout: 180_000 });
if (!applyHeaders) await page.waitForSelector('input[type="file"]', { timeout: 180_000 });
console.log("crossOriginIsolated:", await page.evaluate(() => window.crossOriginIsolated), "webgpu:", await page.evaluate(() => "gpu" in navigator));
const click = (label) =>
  page.evaluate((wanted) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").toLowerCase().includes(wanted.toLowerCase()) && !b.disabled);
    el?.click();
    return Boolean(el);
  }, label);
console.log("GPU:", JSON.stringify(await page.evaluate(async () => { try { const a = await navigator.gpu.requestAdapter(); const i = a.info ?? (await a.requestAdapterInfo?.()); return { vendor: i?.vendor, architecture: i?.architecture, description: i?.description, f16: a.features.has("shader-f16"), maxBuf: a.limits.maxBufferSize }; } catch (e) { return String(e); } })));
const RUNS = Number((process.argv.find((a) => a.startsWith("--runs=")) ?? "--runs=1").slice(7));
const EXPECT_WEBGPU = process.argv.includes("--expect-webgpu");
const jsonOut = (process.argv.find((a) => a.startsWith("--json-out=")) ?? "").slice(11);
const results = [];
let failed = false;

async function runOnce(n) {
  await (await page.$('input[type="file"]')).uploadFile(media);
  if (tierArg === "high") {
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /high accuracy/i.test(b.textContent ?? "")), { timeout: 30_000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /high accuracy/i.test(b.textContent ?? "") && b.getAttribute("aria-pressed") !== "true")?.click());
    await new Promise((r) => setTimeout(r, 1500));
  }
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? "")), { timeout: 30_000 });
  const glossaryArg = (process.argv.find((a) => a.startsWith("--glossary=")) ?? "").slice(11);
  if (glossaryArg) {
    await page.evaluate(() => document.querySelector("details.cap-glossary")?.setAttribute("open", ""));
    const box = await page.$("details.cap-glossary textarea");
    await box.click({ clickCount: 3 });
    await box.type(glossaryArg);
  }
  await page.evaluate(() => { window.__cutmoorCaptionDiag = undefined; });
  await click("Generate captions");
  const t0 = Date.now();
  let last = "";
  for (;;) {
    const state = await page.evaluate(() => ({
      job: document.querySelector(".job-state")?.textContent?.trim(),
      pct: document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
      alert: document.querySelector('.cap-alert[role="alert"]')?.textContent?.replace(/\s+/g, " ").trim(),
      editor: Boolean(document.querySelector(".cap-editor")),
      consent: /download the speech model/i.test(document.body.innerText),
    }));
    if (state.consent) {
      console.log(`run ${n}: consent card shown (model not cached), approving`);
      await click("Download and start");
    }
    const line = `${state.job}|${state.pct}|${state.alert ?? ""}`;
    if (line !== last) console.log(`run ${n} +${((Date.now() - t0) / 1000).toFixed(1)}s`, line);
    last = line;
    if (state.alert) break;
    if (state.editor && /complete|done|finished/i.test(state.job ?? "")) break;
    if (Date.now() - t0 > 20 * 60_000) { console.log("TIMEOUT"); break; }
    await new Promise((r) => setTimeout(r, 400));
  }
  const seconds = (Date.now() - t0) / 1000;
  const diag = await page.evaluate(() => window.__cutmoorCaptionDiag ?? null);
  const words = await page.evaluate(() => [...document.querySelectorAll(".cap-w")].map((e) => ({ text: e.textContent.trim(), uncertain: e.classList.contains("is-uncertain") })));
  const backend = diag?.backend ?? diag?.timings?.find((t) => t.detail === "webgpu" || t.detail === "wasm")?.detail ?? null;
  console.log(`run ${n}: ${seconds.toFixed(1)} s, backend ${backend}, timings ${JSON.stringify(diag?.timings)}`);
  console.log(`run ${n}: ${words.map((w) => (w.uncertain ? "?" : "") + w.text).join(" ")}`);
  console.log(`run ${n}: EDITOR: ${await page.evaluate(() => (document.querySelector(".cap-editor")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 700))}`);
  if (process.env.PROBE_SCROLL) {
    console.log("PROBE_SCROLL", await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1 && e.tagName !== "HTML" && e.tagName !== "BODY"; }).map((e) => e.className + ":" + e.scrollHeight + ">" + e.clientHeight).join(" | ") || "none"));
  }
  if (process.env.PROBE_AUDIO) {
    console.log("PROBE_AUDIO", await page.evaluate(async () => {
      const v = document.querySelector("video");
      if (!v) return "no video";
      v.currentTime = 0;
      try { await v.play(); } catch (e) { return "play failed " + e.message; }
      await new Promise((r) => setTimeout(r, 3000));
      return JSON.stringify({ muted: v.muted, volume: v.volume, rs: v.readyState, t: v.currentTime, paused: v.paused, decoded: v.webkitAudioDecodedByteCount });
    }));
  }
  console.log(`run ${n}: FOOTER: ${await page.evaluate(() => [...document.querySelectorAll("p")].map((p) => p.innerText).find((t) => /parts? read|machine captions/i.test(t)) ?? "")}`);
  if (EXPECT_WEBGPU && backend !== "webgpu") { console.log(`FAIL: expected webgpu, got ${backend}`); failed = true; }
  const lastResult = await page.evaluate(() => window.__cutmoorCaptionDiag?.lastResult ?? null);
  results.push({ run: n, seconds, backend, lastResult, timings: diag?.timings ?? [], words });
}

for (let n = 1; n <= RUNS; n += 1) {
  await runOnce(n);
  if (n < RUNS) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /start another file/i.test(b.textContent ?? ""))?.click());
    await new Promise((r) => setTimeout(r, 800));
  }
}
if (attentionOut) {
  const dump = await page.evaluate(() => {
    const b64 = (f32) => { const u = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    return window.__cutmoorAttentionSink.steps.map((st) => ({ window: st.window, step: st.step, inputIds: st.inputIds, tensors: Object.fromEntries(Object.entries(st.tensors).map(([k, v]) => [k, { dims: v.dims, f32: b64(v.data) }])) }));
  });
  await (await import("node:fs/promises")).writeFile(attentionOut, JSON.stringify(dump));
  console.log(`attention: ${dump.length} steps -> ${attentionOut}`);
}
const shotOut = (process.argv.find((a) => a.startsWith("--shot=")) ?? "").slice(7);
if (shotOut) await page.screenshot({ path: shotOut, fullPage: false });
const burnOut = (process.argv.find((a) => a.startsWith("--burn-in=")) ?? "").slice(10);
if (burnOut) {
  await click("Make MP4");
  const t1 = Date.now();
  await page.waitForSelector('a[download$=".mp4"]', { timeout: 600_000 });
  console.log(`burn-in: finished in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  const info = await page.evaluate(async () => {
    const a = document.querySelector('a[download$=".mp4"]');
    const blob = await (await fetch(a.href)).blob();
    const video = document.createElement("video");
    video.muted = true;
    video.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error("cannot play the exported MP4")); });
    const shots = [];
    for (const t of [1.0, 4.0, 8.0]) {
      if (t >= video.duration) continue;
      video.currentTime = t;
      await new Promise((res) => { video.onseeked = res; });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      shots.push({ t, png: canvas.toDataURL("image/png") });
    }
    return { bytes: blob.size, type: blob.type, duration: video.duration, width: video.videoWidth, height: video.videoHeight, shots };
  });
  console.log(`burn-in: ${info.bytes} bytes, ${info.type}, ${info.duration.toFixed(2)} s, ${info.width}x${info.height}`);
  const fs = await import("node:fs/promises");
  for (const shot of info.shots) await fs.writeFile(`${burnOut}-${shot.t}s.png`, Buffer.from(shot.png.split(",")[1], "base64"));
}
if (jsonOut) await (await import("node:fs/promises")).writeFile(jsonOut, JSON.stringify({ tier: tierArg, media, results }, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
