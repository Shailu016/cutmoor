/**
 * Browser proof of the Auto captions privacy promise.
 *
 *   node scripts/verify/captions-network.mjs <base-url> [--route /tools/auto-captions/] [--allow-missing-page]
 *   (the build must already be served, e.g. `npx vite preview --port 5190 --strictPort`)
 *
 * What it does, in a real Chrome:
 *  1. Opens the captions page, answering the document request itself and adding the response
 *     headers that public/_headers would add on Cloudflare Pages (vite preview ignores that file),
 *     so the page runs under its real Content-Security-Policy and COOP/COEP.
 *  2. Plays a pretend https://models.cutmoor.com (nothing real is contacted) and runs the REAL
 *     model-loader inside the page against a small pretend manifest. Every request the page makes
 *     is recorded and judged by the REAL checkRequests (src/lib/captioning/network-policy.ts).
 *  3. Checks, in order:
 *       download   only GETs with Range to the model host, no cookies, no referrer, files verified
 *       revisit    after a page reload, zero model requests (served from the store)
 *       attacks    a host that sends wrong bytes or redirects elsewhere is refused (fail closed)
 *       offline    with the network switched off a load from the store makes ZERO requests
 *       tamper     a damaged stored file is thrown away and never used, even offline
 *       csp        the page cannot send data anywhere else (fetch, beacon, image, WebSocket, script)
 *  4. Fails (exit 1) on any problem.
 *
 * --allow-missing-page lets the checks run when the tool page is not built yet (the 404 page is
 * used as the host document). Never use it in CI once the page exists.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { buildManifest } from "../models/lib.mjs";
import { createFakeModelHost, headersFor, MODEL_ORIGIN, parseHeadersFile, seededBytes, sha256Hex } from "./captions-lib.mjs";

// puppeteer-core is not a project dependency (CI runs `npm install --no-save puppeteer-core`).
// Locally, PUPPETEER_NODE_MODULES may point at a node_modules folder that has it.
async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch (error) {
    if (!process.env.PUPPETEER_NODE_MODULES) throw error;
    return createRequire(join(process.env.PUPPETEER_NODE_MODULES, "x.js"))("puppeteer-core");
  }
}
const puppeteer = await loadPuppeteer();

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:5190").replace(/\/+$/, "");
const ROUTE = option("--route", "/tools/auto-captions/");
const ALLOW_MISSING = flag("--allow-missing-page");
const PAGE_ORIGIN = new URL(BASE).origin;
const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const notes = [];
function check(ok, message) {
  if (ok) console.log(`  ok   ${message}`);
  else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}
const section = (title) => console.log(`\n${title}`);

// ---------------------------------------------------------------- the pretend model files

const specs = [
  { name: "tiny-encoder.onnx", bytes: seededBytes(70_000, 11) },
  { name: "tiny-decoder.onnx", bytes: seededBytes(33_333, 22) },
  { name: "tokens.json", bytes: seededBytes(1_234, 33) },
];
const manifest = buildManifest({
  id: "network-test",
  version: "1",
  baseUrl: MODEL_ORIGIN,
  entries: specs.map((spec) => ({ name: spec.name, bytes: spec.bytes.length, sha256: sha256Hex(spec.bytes) })),
});
const served = new Map(manifest.files.map((file) => [file.url, specs.find((s) => s.name === file.name).bytes]));
const NAIVE_URL = manifest.files.find((f) => f.name === "tiny-decoder.onnx").url; // this one ignores Range
const DOWNLOAD = { allowedOrigins: [MODEL_ORIGIN], chunkBytes: 16 * 1024, attempts: 1 };

// ---------------------------------------------------------------- test-controlled network

const fakeHost = createFakeModelHost({ files: served, pageOrigin: PAGE_ORIGIN, ignoreRange: new Set([NAIVE_URL]) });
const mode = { network: "online", poison: new Set(), redirect: new Set() };
const hostLog = []; // what the pretend model host received
const reached = []; // every URL that got past the browser to the network layer (what a real network would see)
const headerRules = parseHeadersFile(await readFile(here("../../public/_headers"), "utf8"));

const bundle = await build({
  entryPoints: [here("./captions-harness.entry.mjs")],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  platform: "browser",
  logLevel: "silent",
});
// The REAL policy checker, compiled from the TypeScript source so the test cannot drift from it.
const policyBuild = await build({
  entryPoints: [here("../../src/lib/captioning/network-policy.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { checkRequests } = await import(`data:text/javascript;base64,${Buffer.from(policyBuild.outputFiles[0].text).toString("base64")}`);
const harnessSource = bundle.outputFiles[0].text;
const HARNESS_PATH = "/__captions-test-harness.js";

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage();
  const records = []; // RecordedRequest + bookkeeping
  const byId = new Map();
  let phaseStart = 0;
  const cspViolations = [];

  const client = await page.createCDPSession();
  await client.send("Network.enable");
  client.on("Network.requestWillBeSent", (event) => {
    const request = event.request;
    const entry = {
      id: event.requestId,
      url: request.url,
      method: request.method,
      bodyBytes: request.postData ? new TextEncoder().encode(request.postData).length : request.hasPostData ? 1 : 0,
      headers: Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
      blockedBy: null,
    };
    records.push(entry);
    byId.set(event.requestId, entry);
  });
  client.on("Network.requestWillBeSentExtraInfo", (event) => {
    const entry = byId.get(event.requestId);
    if (entry) for (const [k, v] of Object.entries(event.headers ?? {})) entry.headers[k.toLowerCase()] = String(v); // cookies show up here
  });
  client.on("Network.loadingFailed", (event) => {
    const entry = byId.get(event.requestId);
    if (entry && event.blockedReason) entry.blockedBy = event.blockedReason;
  });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} -> ${e.blockedURI}`));
  });

  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    const parsed = new URL(url);
    reached.push(`${request.method()} ${url}`);

    if (mode.network === "off") {
      // Belt and braces with setOfflineMode: nothing is answered, and the attempt is counted.
      await request.abort("internetdisconnected");
      return;
    }
    if (parsed.origin === MODEL_ORIGIN) {
      const headers = request.headers();
      let { status, headers: responseHeaders, body } = fakeHost({ url, method: request.method(), headers });
      hostLog.push({ method: request.method(), url, range: headers.range ?? null, cookie: headers.cookie ?? null, referer: headers.referer ?? null, authorization: headers.authorization ?? null, status });
      if (mode.redirect.has(url)) {
        await request.respond({ status: 302, headers: { location: "https://evil.example/steal.bin", "access-control-allow-origin": PAGE_ORIGIN }, body: "" });
        return;
      }
      if (mode.poison.has(url) && body && body.length > 0) {
        body = Uint8Array.from(body);
        body[0] ^= 0xff; // a server (or someone in the middle) sends wrong bytes
      }
      await request.respond({ status, headers: responseHeaders, body: body ? Buffer.from(body) : "" });
      return;
    }
    if (parsed.origin === PAGE_ORIGIN && parsed.pathname === HARNESS_PATH) {
      await request.respond({ status: 200, contentType: "text/javascript", body: harnessSource });
      return;
    }
    if (parsed.origin === PAGE_ORIGIN && request.resourceType() === "document" && request.isNavigationRequest() && parsed.pathname === ROUTE) {
      // Fetch the document ourselves so the response can carry the headers _headers would add.
      const real = await fetch(url, { redirect: "manual" });
      const extra = headersFor(parsed.pathname, headerRules);
      await request.respond({
        status: real.status,
        headers: { "content-type": real.headers.get("content-type") ?? "text/html; charset=utf-8", ...extra },
        body: Buffer.from(await real.arrayBuffer()),
      });
      return;
    }
    await request.continue();
  });

  const settle = () => sleep(400); // lets late CDP events arrive
  const since = () => records.slice(phaseStart);
  const startPhase = () => {
    phaseStart = records.length;
    hostLog.length = 0;
  };
  const leftTheDevice = (list) => list.filter((entry) => !entry.blockedBy); // CSP-blocked requests never reach a network
  const judge = (list, phase) => checkRequests(leftTheDevice(list), { modelOrigins: [MODEL_ORIGIN], pageOrigin: PAGE_ORIGIN, phase });
  const modelRequests = (list) => list.filter((entry) => new URL(entry.url).origin === MODEL_ORIGIN);
  const run = (options = DOWNLOAD) => page.evaluate((m, o) => window.__captionsHarness.download(m, o), manifest, options);
  const injectHarness = async () => {
    await page.evaluate((path) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = path;
      script.onload = resolve;
      script.onerror = () => reject(new Error("the test helper script was blocked"));
      document.head.append(script);
    }), HARNESS_PATH);
  };
  const expectedHashes = Object.fromEntries(specs.map((s) => [s.name, { sha256: sha256Hex(s.bytes), bytes: s.bytes.length }]));
  const sameHashes = (got) => Boolean(got) && JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(expectedHashes).sort());

  // ------------------------------------------------------------ page load
  section(`Opening ${BASE}${ROUTE}`);
  startPhase();
  const response = await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle2", timeout: 60_000 });
  await settle();
  const status = response?.status() ?? 0;
  if (status !== 200) {
    if (ALLOW_MISSING) {
      console.log(`  WARNING: ${ROUTE} answered HTTP ${status}. The tool page is not built yet; running the checks on the 404 page (--allow-missing-page).`);
      notes.push(`page ${ROUTE} was missing (HTTP ${status}); checks ran on the fallback document`);
    } else check(false, `${ROUTE} answers HTTP 200 (got ${status}). Build the tool page, or pass --allow-missing-page while developing.`);
  } else check(true, `${ROUTE} answers HTTP 200`);

  const responseHeaders = response?.headers() ?? {};
  check(responseHeaders["cross-origin-opener-policy"] === "same-origin", "page is served with Cross-Origin-Opener-Policy: same-origin");
  check(responseHeaders["cross-origin-embedder-policy"] === "credentialless", "page is served with Cross-Origin-Embedder-Policy: credentialless");
  check(Boolean(responseHeaders["content-security-policy"]), "page is served with a Content-Security-Policy");
  await injectHarness();
  check(await page.evaluate(() => window.__captionsHarness.crossOriginIsolated()), "page is cross-origin isolated (SharedArrayBuffer available)");

  const ads = await page.evaluate(() => ({
    scripts: [...document.querySelectorAll("script[src]")].map((s) => s.src).filter((src) => /googlesyndication|doubleclick|adsbygoogle|googletagmanager/i.test(src)),
    marked: document.querySelectorAll("[data-cutmoor-ads], ins.adsbygoogle, .ad-slot, .ad-inline").length,
  }));
  check(ads.scripts.length === 0 && ads.marked === 0, `page loads no ad scripts or ad slots${ads.scripts.length ? ` (found ${ads.scripts.join(", ")})` : ""}`);
  const loadViolations = await page.evaluate(() => window.__csp);
  check(loadViolations.length === 0, `page loads without breaking its own Content-Security-Policy${loadViolations.length ? ` (${loadViolations.join("; ")})` : ""}`);
  const loadVerdict = judge(since(), "download");
  check(loadVerdict.length === 0, `page load requests pass the download policy (${since().length} requests)${loadVerdict.length ? ": " + JSON.stringify(loadVerdict) : ""}`);

  // ------------------------------------------------------------ download
  section("Download phase: first visit");
  startPhase();
  const first = await run();
  await settle();
  check(first.ok, `download succeeds${first.ok ? "" : ` (${first.code}: ${first.message})`}`);
  check(sameHashes(first.hashes), "every downloaded file has the pinned size and SHA-256");
  const firstList = since();
  const firstModel = modelRequests(firstList);
  check(firstModel.length >= 7, `model host was contacted in ranges (${firstModel.length} requests for ${specs.length} files: 5 + 1 whole + 1)`);
  check(firstModel.every((entry) => entry.method === "GET"), "every model request is a GET");
  check(firstModel.every((entry) => entry.bodyBytes === 0), "no model request carries a body");
  check(hostLog.length === firstModel.length && hostLog.every((h) => h.range !== null), "every model request asked for a byte range");
  check(hostLog.every((h) => h.cookie === null && h.authorization === null), "no model request carries cookies or credentials");
  check(hostLog.every((h) => !h.referer), `no model request carries a referrer (saw ${JSON.stringify([...new Set(hostLog.map((h) => h.referer))])})`);
  check(hostLog.some((h) => h.url === NAIVE_URL && h.status === 200), "a host that ignores Range (answers 200) is handled");
  check(hostLog.some((h) => h.status === 206), "ranges are answered with 206");
  const firstVerdict = judge(firstList, "download");
  check(firstVerdict.length === 0, `checkRequests finds no violation in the download phase${firstVerdict.length ? ": " + JSON.stringify(firstVerdict) : ""}`);
  const stray = firstList.filter((e) => ![PAGE_ORIGIN, MODEL_ORIGIN].includes(new URL(e.url).origin) && !/^(data|blob):/.test(e.url));
  check(stray.length === 0, "no request went to any host except the page and the model host");

  // ------------------------------------------------------------ revisit
  section("Revisit: reload the page, model is already stored");
  startPhase();
  await page.reload({ waitUntil: "networkidle2", timeout: 60_000 });
  await injectHarness();
  const revisit = await run();
  await settle();
  check(revisit.ok && sameHashes(revisit.hashes), "model loads again with the same hashes");
  check(revisit.ok && revisit.cachedBefore.length === specs.length && revisit.alreadyDownloaded === true, "the page reports the model as already downloaded (no consent prompt needed)");
  check(modelRequests(since()).length === 0 && hostLog.length === 0, "zero requests to the model host on the second visit");
  check(judge(since(), "download").length === 0, "second visit also passes the download policy");

  // ------------------------------------------------------------ attacks
  section("Hostile model host (online): must fail closed");
  await page.evaluate(() => window.__captionsHarness.clearStore());
  const poisoned = manifest.files[2].url;
  mode.poison = new Set([poisoned]);
  startPhase();
  const wrongBytes = await run();
  mode.poison = new Set();
  check(!wrongBytes.ok && wrongBytes.code === "integrity", `wrong bytes are rejected (code ${wrongBytes.code})`);
  const afterWrong = await page.evaluate((m) => window.__captionsHarness.cachedNames(m), manifest);
  check(!afterWrong.includes("tokens.json"), "the rejected file was not stored");

  await page.evaluate(() => window.__captionsHarness.clearStore());
  mode.redirect = new Set([manifest.files[0].url]);
  startPhase();
  const redirected = await run();
  await settle();
  mode.redirect = new Set();
  check(!redirected.ok && redirected.code === "network", `a redirect to another host is refused (code ${redirected.code})`);
  check(!reached.some((line) => line.includes("evil.example")), "the redirect target was never contacted");

  // ------------------------------------------------------------ offline
  section("Offline phase: model stored, network switched off");
  await page.evaluate(() => window.__captionsHarness.clearStore());
  const refill = await run();
  check(refill.ok, "model re-downloaded cleanly for the offline test");
  await settle();
  await page.setOfflineMode(true);
  mode.network = "off";
  startPhase();
  const reachedBefore = reached.length;
  const offline = await run();
  await settle();
  check(offline.ok && sameHashes(offline.hashes), "model loads from the store while offline, hashes verified");
  check(since().length === 0, `zero network requests of any kind during the offline load (saw ${since().length})`);
  check(reached.length === reachedBefore, "the browser did not even try to reach the network");
  const offlineVerdict = judge(since(), "offline");
  check(offlineVerdict.length === 0, "checkRequests (offline phase) finds no violation");

  // ------------------------------------------------------------ tamper
  section("Tamper: a damaged stored file while offline");
  const damagedKey = `cutmoor-model/${manifest.files[0].sha256}`;
  check(await page.evaluate((key) => window.__captionsHarness.corrupt(key), damagedKey), "flipped one byte of a stored file");
  startPhase();
  const tampered = await run();
  await settle();
  check(!tampered.ok && tampered.code === "network", `the damaged file is not used; with no network the load fails (code ${tampered.code})`);
  const remaining = await page.evaluate((m) => window.__captionsHarness.cachedNames(m), manifest);
  check(!remaining.includes(manifest.files[0].name) && remaining.length === specs.length - 1, "the damaged file was deleted from the store, the others kept");
  const attempts = since();
  check(attempts.length > 0, "it tried to re-download the damaged file (proves the offline check above is not vacuous)");
  check(judge(attempts, "offline").length === attempts.length, "checkRequests flags those attempts when the phase is offline");

  // ------------------------------------------------------------ CSP
  section("Content-Security-Policy: the page cannot send data elsewhere");
  await page.setOfflineMode(false);
  mode.network = "online";
  startPhase();
  const reachedBeforeProbe = reached.length;
  const probe = await page.evaluate(() => window.__captionsHarness.probeForbidden("https://tracker.example/collect"));
  await settle();
  // sendBeacon answers "true" when it merely queues the request; the browser then refuses it, which the
  // violation report and the "nothing reached the network" checks below prove.
  for (const [attempt, outcome] of Object.entries(probe.outcome)) {
    if (attempt === "beacon") continue;
    check(outcome === "blocked", `${attempt} to https://tracker.example is blocked`);
  }
  check(probe.violations.filter((v) => v.startsWith("connect-src")).length >= 3, `fetch, beacon and WebSocket were each refused by connect-src (${probe.violations.filter((v) => v.startsWith("connect-src")).length} reports)`);
  check(probe.violations.length >= 4, `the browser reported ${probe.violations.length} policy violations`);
  check(!reached.slice(reachedBeforeProbe).some((line) => line.includes("tracker.example")), "no request to tracker.example reached the network layer");
  check(!reached.slice(reachedBeforeProbe).some((line) => !line.includes(PAGE_ORIGIN) && !line.includes(MODEL_ORIGIN)), "nothing at all left for any other host");
} catch (error) {
  failures.push(`The test itself crashed: ${error?.stack ?? error}`);
  console.error(error);
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${failures.length} problem(s).`);
for (const note of notes) console.log(`NOTE: ${note}`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
