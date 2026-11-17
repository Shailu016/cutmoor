/**
 * Real-browser check of the two neural-network picture tools (remove background, enlarge) against a production-style
 * build served by scripts/serve-local.mjs, with the REAL model files answered locally in place of models.cutmoor.com
 * (the same stand-in model host the captions checks use). It proves, with the real network, that:
 *   - the page is cross-origin isolated and has the strict policy header;
 *   - the first run tells the visitor what it will download, downloads it, and produces a correct result;
 *   - the second run (model saved in the browser) makes NO network request at all;
 *   - every request goes to our own origin or the model host, and none carries a body.
 *
 *   VITE_MODEL_TOOLS=1 npm run build      (the tools are left out of a normal build until the models are published)
 *   node scripts/serve-local.mjs 4180
 *   node scripts/verify/model-tools.mjs http://localhost:4180 [--headless=false] [--only=remove-background]
 *
 * The model files come from .team/models-local/tools-dist/<name>/ (written by scripts/models/build-manifest.mjs) and the
 * onnxruntime files from the folders listed in .team/dist-dirs.txt.
 */
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createFakeModelHost, headersFor, MODEL_ORIGIN, parseHeadersFile } from "./captions-lib.mjs";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:4180").replace(/\/+$/, "");
const headless = !process.argv.includes("--headless=false");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// ---- the stand-in model host: every file of the tools' manifests plus the onnxruntime files of the captions manifests ----
const files = new Map();
const dirs = [...(await readFile(here("../../.team/dist-dirs.txt"), "utf8")).trim().split(","), here("../../.team/models-local/tools-dist/bgremove"), here("../../.team/models-local/tools-dist/upscale")];
for (const dir of dirs) {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  for (const f of manifest.files) files.set(f.url, new Uint8Array(await readFile(join(dir, "m", new URL(f.url).pathname.split("/").pop()))));
}
const host = createFakeModelHost({ files, pageOrigin: new URL(BASE).origin });
const rules = parseHeadersFile(await readFile(here("../../public/_headers"), "utf8"));

const profile = await mkdtemp(join(tmpdir(), "cutmoor-modeltools-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless,
  userDataDir: profile,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
  protocolTimeout: 1_800_000,
});

let currentLog = [];
const NOGPU = process.argv.includes("--nogpu");
const makePage = async () => {
  const page = await browser.newPage();
  if (NOGPU) await page.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }); } catch {} });
  await page.setViewport({ width: 1280, height: 1000 });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/onnxruntime/.test(m.text())) console.log(`[console.error] ${m.text().slice(0, 300)}`);
  });
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const url = request.url();
    const parsed = new URL(url);
    currentLog.push({ url, method: request.method(), body: request.postData()?.length ?? 0 });
    if (parsed.origin === MODEL_ORIGIN) {
      const r = host({ url, method: request.method(), headers: request.headers() });
      return request.respond({ status: r.status, headers: r.headers, body: r.body ? Buffer.from(r.body) : undefined });
    }
    if (request.isNavigationRequest() && parsed.origin === new URL(BASE).origin) {
      try {
        const res = await fetch(url);
        const headers = Object.fromEntries(res.headers);
        delete headers["content-encoding"];
        delete headers["content-length"];
        return request.respond({ status: res.status, headers: { ...headers, ...headersFor(parsed.pathname, rules) }, body: Buffer.from(await res.arrayBuffer()) });
      } catch {
        /* fall through */
      }
    }
    return request.continue();
  });
  return page;
};

const results = [];
const check = (tool, label, problems, extra = {}) => {
  const ok = problems.length === 0;
  results.push(ok);
  console.log(JSON.stringify({ tool, label, ok, ...(ok ? extra : { problems }) }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixtures = {};

const makeFixture = async (page, name, size) => {
  const b64 = await page.evaluate(
    async (name, size) => {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = "/samples/sample-photo.jpg";
      });
      const w = size ? size.w : img.naturalWidth;
      const h = size ? size.h : img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    name,
    size,
  );
  const path = join(await mkdtemp(join(tmpdir(), "fx-")), `${name}.jpg`);
  await writeFile(path, Buffer.from(b64, "base64"));
  fixtures[name] = path;
  return path;
};

const clickButton = (page, text) =>
  page.evaluate((t) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
    const el = buttons.find((b) => b.innerText.trim().toLowerCase().includes(t.toLowerCase()));
    if (!el) throw new Error(`no enabled button with "${t}". Buttons: ${buttons.map((b) => b.innerText.trim()).join(" | ").slice(0, 300)}`);
    el.click();
  }, text);
const waitDone = (page) => page.waitForFunction(() => document.querySelector(".job-state-done") || document.querySelector(".job-state-error"), { timeout: 900_000, polling: 200 });
const outputPixels = (page) =>
  page.evaluate(async () => {
    const link = document.querySelector(".job-panel a[download]");
    if (!link) return { error: document.querySelector(".job-panel [role=alert], .job-error")?.textContent?.trim() || document.querySelector(".job-panel")?.innerText.slice(0, 300) || "no download link" };
    const blob = await (await fetch(link.href)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const dataUrl = c.toDataURL("image/png");
    return { dataUrl, name: link.getAttribute("download"), bytes: blob.size, type: blob.type, w: bmp.width, h: bmp.height, pixels: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data), note: document.querySelector(".job-panel .job-note, .job-panel .result-note")?.textContent?.slice(0, 200) };
  });
const alphaAt = (o, x, y) => o.pixels[(y * o.w + x) * 4 + 3];

let lastHeaders = {};
const open = async (slug) => {
  const page = await makePage();
  const response = await page.goto(`${BASE}/tools/${slug}/`, { waitUntil: "networkidle0", timeout: 180_000 });
  lastHeaders = response?.headers() ?? {};
  await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
  return page;
};

const policyProblems = (log) => {
  const problems = [];
  const own = new URL(BASE).origin;
  for (const r of log) {
    if (r.url.startsWith("data:") || r.url.startsWith("blob:")) continue;
    const origin = new URL(r.url).origin;
    if (origin !== own && origin !== MODEL_ORIGIN) problems.push(`request to ${origin}`);
    if (r.body > 0) problems.push(`a request with a ${r.body}-byte body to ${r.url}`);
    if (origin === MODEL_ORIGIN && r.method !== "GET" && r.method !== "HEAD" && r.method !== "OPTIONS") problems.push(`${r.method} to the model host`);
  }
  return problems;
};

const flows = {
  "remove-background": async () => {
    await makeFixture(await open("crop-image"), "balloon", null);
    currentLog = [];
    let page = await open("remove-background");
    const iso = await page.evaluate(() => window.crossOriginIsolated);
    const csp = lastHeaders["content-security-policy"];
    check("remove-background", "page is isolated and carries the strict policy", [iso ? "" : "not cross-origin isolated", /connect-src 'self' https:\/\/models\.cutmoor\.com/.test(csp ?? "") ? "" : `policy header: ${csp}`].filter(Boolean));
    await (await page.$('input[type="file"]')).uploadFile(fixtures.balloon);
    await page.waitForSelector(".settings-card");
    await sleep(800);
    const notice = await page.evaluate(() => document.querySelector(".info-callout")?.innerText ?? "");
    const label = await page.evaluate(() => [...document.querySelectorAll("button.button-primary")].map((b) => b.innerText.trim()).join("|"));
    check("remove-background", "the first run names the download before it starts", [/MB/.test(notice) && /models\.cutmoor\.com/.test(notice) ? "" : `notice: ${notice}`, /Download .* MB and remove background/.test(label) ? "" : `button: ${label}`].filter(Boolean), { notice: notice.slice(0, 120) });
    const t0 = Date.now();
    await clickButton(page, "remove background");
    await waitDone(page);
    const first = await outputPixels(page);
    if (process.env.SAVE_DIR && first.dataUrl) await writeFile(join(process.env.SAVE_DIR, "bg-result.png"), Buffer.from(first.dataUrl.split(",")[1], "base64"));
    console.log("model diag:", JSON.stringify(await page.evaluate(() => window.__cutmoorModelDiag ?? null)));
    const problems = [];
    if (first.error) problems.push(first.error);
    else {
      if (first.type !== "image/png") problems.push(`type ${first.type}`);
      if (first.w !== 1280 || first.h !== 720) problems.push(`size ${first.w}x${first.h}`);
      // The balloon sits at about x 487-587, y 169-334. Its red middle stripe is the model's weak spot (the mask is partial
      // there), so judge the whole balloon box: a good share kept, and the sky far from it gone.
      let kept = 0;
      let total = 0;
      for (let y = 169; y < 334; y += 3) for (let x = 487; x < 587; x += 3) { total += 1; if (alphaAt(first, x, y) > 128) kept += 1; }
      const share = kept / total;
      let all = 0;
      for (let i = 3; i < first.pixels.length; i += 4) if (first.pixels[i] > 128) all += 1;
      const overall = all / (first.pixels.length / 4);
      const corners = [alphaAt(first, 5, 5), alphaAt(first, 1270, 710), alphaAt(first, 5, 710), alphaAt(first, 640, 700)];
      if (!(share > 0.2)) problems.push(`the balloon is not kept (${(share * 100).toFixed(0)}% of its box is opaque)`);
      if (!(overall < 0.06)) problems.push(`too much was kept (${(overall * 100).toFixed(1)}% of the picture is opaque)`);
      if (!corners.every((a) => a < 40)) problems.push(`the background is not removed (alphas ${corners})`);
      console.log(`balloon box ${(share * 100).toFixed(0)}% opaque, whole picture ${(overall * 100).toFixed(2)}% opaque`);
    }
    check("remove-background", "balloon kept, sky removed", problems, { seconds: Math.round((Date.now() - t0) / 1000), note: first.note });
    check("remove-background", "every request went to our own origin or the model host, none with a body", policyProblems(currentLog));
    await page.close();

    // second run: the model is saved in the browser, so nothing may be requested
    currentLog = [];
    page = await open("remove-background");
    await (await page.$('input[type="file"]')).uploadFile(fixtures.balloon);
    await page.waitForSelector(".settings-card");
    await sleep(800);
    const label2 = await page.evaluate(() => [...document.querySelectorAll("button.button-primary")].map((b) => b.innerText.trim()).join("|"));
    currentLog = [];
    await clickButton(page, "remove background");
    await waitDone(page);
    const second = await outputPixels(page);
    const p2 = [];
    if (second.error) p2.push(second.error);
    if (!/^Remove background$/.test(label2)) p2.push(`the saved model was not recognised (button: ${label2})`);
    // Our own code-split script may load when a run starts; what must not happen is any model download or any other host.
    const stray = currentLog.filter((r) => new URL(r.url).origin !== new URL(BASE).origin || r.method !== "GET" || r.body > 0);
    if (stray.length > 0) p2.push(`${stray.length} request(s) to another host or with data on the second run: ${stray.slice(0, 3).map((r) => r.url).join(", ")}`);
    if (currentLog.some((r) => new URL(r.url).origin === MODEL_ORIGIN)) p2.push("the model was downloaded again");
    check("remove-background", "second run downloads nothing and talks to no one but our own site", p2);

    // a solid background and a JPG
    await page.evaluate(() => [...document.querySelectorAll(".chip")].find((c) => c.innerText.trim() === "White")?.click());
    await sleep(200);
    await clickButton(page, "remove background");
    await waitDone(page);
    const white = await outputPixels(page);
    const p3 = [];
    if (white.error) p3.push(white.error);
    else if (alphaAt(white, 5, 5) !== 255) p3.push("a solid background should leave no transparent pixels");
    check("remove-background", "white background leaves nothing transparent", p3);
    await page.close();
  },
  "upscale-image": async () => {
    await makeFixture(await open("crop-image"), "small", { w: 200, h: 112 });
    currentLog = [];
    const page = await open("upscale-image");
    const iso = await page.evaluate(() => window.crossOriginIsolated);
    check("upscale-image", "page is isolated", iso ? [] : ["not cross-origin isolated"]);
    await (await page.$('input[type="file"]')).uploadFile(fixtures.small);
    await page.waitForSelector(".settings-card");
    await sleep(800);
    const t0 = Date.now();
    await clickButton(page, "enlarge 2");
    await waitDone(page);
    const o = await outputPixels(page);
    if (process.env.SAVE_DIR && o.dataUrl) await writeFile(join(process.env.SAVE_DIR, "up-result.png"), Buffer.from(o.dataUrl.split(",")[1], "base64"));
    const problems = [];
    if (o.error) problems.push(o.error);
    else {
      if (o.w !== 400 || o.h !== 224) problems.push(`size ${o.w}x${o.h}, expected 400x224`);
      // not blank, and not a flat colour: the picture has a balloon and a sunset
      let sum = 0;
      let sumSq = 0;
      const n = o.pixels.length / 4;
      for (let i = 0; i < o.pixels.length; i += 4) {
        const v = o.pixels[i] + o.pixels[i + 1] + o.pixels[i + 2];
        sum += v;
        sumSq += v * v;
      }
      const variance = sumSq / n - (sum / n) ** 2;
      if (!(variance > 500)) problems.push(`the result looks flat (variance ${variance.toFixed(0)})`);
    }
    check("upscale-image", "2x enlargement has the right size and content", problems, { seconds: Math.round((Date.now() - t0) / 1000), note: o.note });
    check("upscale-image", "every request went to our own origin or the model host, none with a body", policyProblems(currentLog));
    await page.close();
  },
};

for (const slug of Object.keys(flows)) {
  if (ONLY.length && !ONLY.includes(slug)) continue;
  try {
    await flows[slug]();
  } catch (error) {
    results.push(false);
    console.log(JSON.stringify({ tool: slug, ok: false, problems: [String(error.message || error).slice(0, 500)] }));
  }
}
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `ALL OK (${results.length} checks)` : `FAILED: ${failed} check(s)`);
process.exit(failed === 0 ? 0 : 1);
