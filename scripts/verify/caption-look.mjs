/**
 * Browser proof of the custom caption look (font, size, outline, shadow, box, colours, capitals).
 *
 *   npm run build
 *   npx vite preview --port 4210 --strictPort     (in another terminal; serves dist)
 *   node scripts/verify/caption-look.mjs [base-url] [out-dir]
 *
 * What it does, in a real Chrome, on the PRODUCTION build (a small harness page is built into dist
 * with Vite, so its CSS and font files go through the same production pipeline as the site):
 *  1. Generates a 640x360 solid-black clip in the tab (no file download).
 *  2. Mounts the real KaraokePreview and burns the same three looks in with the real exporter.
 *  3. Measures each look's pixels in both: caption ink (difference from a clean reference frame),
 *     the look's key colour, and the ink centroid. Preview and export must agree on presence,
 *     horizontal centring and where the caption sits (within the documented tolerance).
 *  4. Checks the chosen bundled font faces are actually loaded, and that no request leaves the
 *     page origin.
 *  5. Renders LookControls at 375 px wide, checks every control has a label and nothing overflows,
 *     then tabs through it with the keyboard.
 *
 * Screenshots and exported frames are saved in OUT (default: caption-look-out).
 * Needs puppeteer-core (npm install --no-save puppeteer-core, or set PUPPETEER_NODE_MODULES).
 * Exits 1 on any failed check.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const args = process.argv.slice(2);
const BASE = (args.find((arg) => /^https?:\/\//.test(arg)) ?? "http://localhost:4210").replace(/\/+$/, "");
const positional = args.filter((arg) => !arg.startsWith("--"));
const OUT = resolve(positional[1] ?? join(process.cwd(), "caption-look-out"));
const PAGE_ORIGIN = new URL(BASE).origin;
const HERE = fileURLToPath(new URL(".", import.meta.url));
const HARNESS_ROUTE = "/__caption-look/";

async function loadPuppeteer() {
  try {
    return (await import("puppeteer-core")).default;
  } catch (error) {
    if (!process.env.PUPPETEER_NODE_MODULES) throw error;
    return createRequire(join(process.env.PUPPETEER_NODE_MODULES, "x.js"))("puppeteer-core");
  }
}

const failures = [];
const notes = [];
function check(ok, message) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
}
const section = (title) => console.log(`\n${title}`);

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- production build of the harness

section("Build");
const dist = join(process.cwd(), "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}
const harnessHtml = join(HERE, "caption-look-harness.html");
if (!existsSync(harnessHtml)) {
  console.error(`Missing ${harnessHtml}`);
  process.exit(1);
}
await build({
  configFile: false,
  root: process.cwd(),
  base: HARNESS_ROUTE,
  plugins: [react()],
  logLevel: "warn",
  build: {
    outDir: join(dist, "__caption-look"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: harnessHtml },
  },
});
const built = join(dist, "__caption-look", "index.html");
// Vite keeps the input's folder layout (scripts/verify/...); the page is served as index.html.
const nested = join(dist, "__caption-look", "scripts", "verify", "caption-look-harness.html");
if (!existsSync(built) && existsSync(nested)) renameSync(nested, built);
if (!existsSync(built)) {
  console.error("The harness build produced no index.html.");
  process.exit(1);
}
console.log(`  ok    harness built into dist/__caption-look (Vite production pipeline)`);

// ---------------------------------------------------------------- browser

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 600_000,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

const requests = [];
const pageErrors = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 800, deviceScaleFactor: 1 });
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  section("Harness");
  await page.goto(`${BASE}${HARNESS_ROUTE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.__captionLookHarness?.ready === true, { timeout: 180_000, polling: 100 });
  const initError = await page.evaluate(() => window.__captionLookHarness.error);
  check(initError === null, `the in-tab clip and preview start cleanly${initError ? ` (${initError})` : ""}`);
  if (initError !== null) throw new Error(initError);

  const looks = await page.evaluate(() => window.__captionLookHarness.looks.map((look) => ({ name: look.name, keyColor: look.keyColor, tolerance: look.tolerance })));

  const stage = await page.evaluate(() => window.__captionLookHarness.stageRect());
  const clip = { x: Math.round(stage.x), y: Math.round(stage.y), width: Math.round(stage.width), height: Math.round(stage.height) };
  check(clip.width === 640 && clip.height === 360, `the preview picture is 640x360 (measured ${clip.width}x${clip.height})`);

  section("Clean reference");
  await page.evaluate(async () => window.__captionLookHarness.setCaptions(false));
  const cleanShot = await page.screenshot({ encoding: "base64", clip });
  writeFileSync(join(OUT, "preview-clean.png"), Buffer.from(cleanShot, "base64"));
  console.log("  ok    preview screenshot without captions saved");

  section("Three looks: preview vs burned-in frame");
  for (let index = 0; index < looks.length; index++) {
    const look = looks[index];
    await page.evaluate(async (i) => {
      await window.__captionLookHarness.setLook(i);
      await window.__captionLookHarness.setCaptions(true);
    }, index);

    const previewShot = await page.screenshot({ encoding: "base64", clip });
    writeFileSync(join(OUT, `preview-${look.name}.png`), Buffer.from(previewShot, "base64"));

    const exported = await page.evaluate(async (i) => window.__captionLookHarness.exportLook(i), index);
    writeFileSync(join(OUT, `export-${look.name}.png`), Buffer.from(exported.png, "base64"));

    const preview = await page.evaluate(
      async (captions, clean, key, tolerance) => window.__captionLookHarness.analyzePair(captions, clean, key, tolerance),
      previewShot,
      cleanShot,
      look.keyColor,
      look.tolerance,
    );

    const dx = Math.abs(preview.inkX - exported.metrics.inkX);
    const dy = Math.abs(preview.inkY - exported.metrics.inkY);
    const keyRatio = preview.key === 0 ? Number.POSITIVE_INFINITY : exported.metrics.key / preview.key;
    const inkRatio = preview.ink === 0 ? Number.POSITIVE_INFINITY : exported.metrics.ink / preview.ink;
    console.log(
      `  ${look.name}: preview ink ${preview.ink} key ${preview.key} at (${preview.inkX.toFixed(3)}, ${preview.inkY.toFixed(3)}); ` +
        `export ink ${exported.metrics.ink} key ${exported.metrics.key} at (${exported.metrics.inkX.toFixed(3)}, ${exported.metrics.inkY.toFixed(3)}); ` +
        `${exported.bytes} bytes, ${exported.ms} ms`,
    );

    check(preview.ink > 500, `${look.name}: the preview draws a caption (${preview.ink} ink pixels)`);
    check(exported.metrics.ink > 500, `${look.name}: the exported frame draws a caption (${exported.metrics.ink} ink pixels)`);
    check(preview.key > 30, `${look.name}: the preview shows the look's colour (${preview.key} pixels)`);
    check(exported.metrics.key > 30, `${look.name}: the burned-in frame shows the look's colour (${exported.metrics.key} pixels)`);
    check(keyRatio > 0.2 && keyRatio < 5, `${look.name}: the colour area agrees (export/preview ${Number.isFinite(keyRatio) ? keyRatio.toFixed(2) : "inf"})`);
    check(inkRatio > 0.25 && inkRatio < 4, `${look.name}: the caption ink area agrees (export/preview ${Number.isFinite(inkRatio) ? inkRatio.toFixed(2) : "inf"})`);
    check(dx < 0.05, `${look.name}: horizontally centred in both (dx ${dx.toFixed(3)})`);
    check(dy < 0.12, `${look.name}: same vertical band (dy ${dy.toFixed(3)})`);
    notes.push(`${look.name}: ink ratio ${inkRatio.toFixed(2)}, key ratio ${keyRatio.toFixed(2)}, dx ${dx.toFixed(3)}, dy ${dy.toFixed(3)}`);
  }

  section("Fonts");
  const fontChecks = await page.evaluate(() => window.__captionLookHarness.fontChecks());
  for (const [family, loaded] of Object.entries(fontChecks)) {
    check(loaded, `${family} is loaded from the bundled package`);
  }
  const woff2 = requests.filter((url) => /\.woff2?(\?|$)/i.test(url));
  check(woff2.length > 0, `the chosen fonts were fetched as page assets (${woff2.length} font files, all same-origin)`);

  section("Privacy: request origins");
  const external = requests.filter((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    try {
      return new URL(url).origin !== PAGE_ORIGIN;
    } catch {
      return true;
    }
  });
  check(external.length === 0, `every request stayed on ${PAGE_ORIGIN} (${requests.length} requests)${external.length ? `; leaked: ${external.slice(0, 5).join(", ")}` : ""}`);

  section("LookControls at 375 px");
  await page.setViewport({ width: 375, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(async () => window.__captionLookHarness.showControls(true));
  const controls = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#controls input, #controls select")];
    const unlabeled = nodes
      .filter((node) => !(node instanceof HTMLInputElement || node instanceof HTMLSelectElement) || (!node.labels?.length && !node.getAttribute("aria-label")))
      .map((node) => node.outerHTML.slice(0, 80));
    const overflow = nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width === 0 || rect.left < -0.5 || rect.right > window.innerWidth + 0.5;
      })
      .map((node) => node.id);
    return {
      count: nodes.length,
      unlabeled,
      overflow,
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(controls.count >= 10, `all controls render at 375 px (${controls.count})`);
  check(controls.unlabeled.length === 0, `every control has a visible label (${controls.unlabeled.length} unlabeled)`);
  check(controls.overflow.length === 0, `no control overflows the 375 px viewport (${controls.overflow.join(", ") || "none"})`);
  check(!controls.documentOverflow, "the page has no horizontal scroll at 375 px");

  // Keyboard: native controls, so Tab must reach them all in order.
  await page.evaluate(() => document.querySelector("#controls select")?.focus());
  const focused = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    focused.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLInputElement || active instanceof HTMLSelectElement ? `${active.tagName.toLowerCase()}:${active.id}` : null;
      }),
    );
  }
  const reached = focused.filter((value) => value !== null);
  check(new Set(reached).size >= 4, `Tab reaches the look controls (${new Set(reached).size} distinct controls)`);
  await page.screenshot({ path: join(OUT, "controls-375.png") });

  section("Page errors");
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(" | ")}` : ""}`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error("\nVerification stopped:", error instanceof Error ? error.stack ?? error.message : error);
  console.error("page errors so far:", pageErrors.slice(0, 5), "first requests:", requests.filter((u) => !u.includes("/assets/")).slice(0, 8));
} finally {
  await browser.close();
}

section("Summary");
console.log(`  ${failures.length === 0 ? "PASS" : "FAIL"}  ${failures.length} failed check(s)`);
for (const note of notes) console.log(`  info  ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.log(`  screenshots: ${OUT}`);
process.exit(failures.length === 0 ? 0 : 1);
