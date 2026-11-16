/**
 * Browser smoke test for the Auto captions tool screen.
 *
 * It drives the REAL page against the development-only stand-in engine (`?captions-test`, see
 * src/components/captions/dev-runtime.ts), so it proves the screen, not the speech model: consent,
 * progress, first captions, the editor (mouse and keyboard, undo), the karaoke preview, style
 * switching, SRT/VTT/JSON downloads, the burn-in button, error states, size stability, mobile
 * overflow, accessibility (axe) and that nothing but the page's own files is requested.
 *
 *   node scripts/verify/captions-ui.mjs [base-url]      (default http://localhost:5192, run `npx vite --port 5192 --strictPort`)
 *
 * Screenshots land in SHOT_DIR (default: <tmp>/captions-ui-shots). Needs puppeteer-core, axe-core and Chrome (CHROME_PATH).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const BASE = (process.argv[2] || "http://localhost:5192").replace(/\/$/, "");
const SHOTS = process.env.SHOT_DIR || join(tmpdir(), "captions-ui-shots");
const VIDEO = join(process.cwd(), "public", "samples", "sample-clip.mp4");
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "  ok  " : " FAIL "} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: process.env.CI ? ["--no-sandbox"] : [],
  protocolTimeout: 300_000,
});

async function openPage(viewport, query = "?captions-test", { noEngine = false } = {}) {
  const page = await browser.newPage();
  // The site registers the real engine whenever its model list exists; to test the "not available" state, make those registrations no-ops.
  if (noEngine) {
    await page.evaluateOnNewDocument(() => {
      for (const name of ["__cutmoorCaptionPipelineFactory", "__cutmoorCaptionTiers"]) Object.defineProperty(window, name, { get: () => undefined, set: () => {}, configurable: true });
    });
  }
  await page.setViewport(viewport);
  // A cold Vite dev server transforms the whole module graph on the first request, which easily passes 30 s on this
  // machine; the default Puppeteer navigation timeout is too short for that first load only.
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 160)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 160)}`);
  });
  page.on("request", (request) => requests.push(request.url()));
  // "domcontentloaded", not "networkidle0"/"load": against a Vite dev server (the only place `?captions-test`
  // exists) the HMR websocket never lets the network go idle and a dev-only resource can hold "load" open; the file
  // input below is the real readiness signal.
  await page.goto(`${BASE}/tools/auto-captions/${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="file"]', { timeout: 180_000 });
  // The site scrolls smoothly; a test that scrolls and clicks straight away would hit a moving page.
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
  return { page, errors, requests };
}

const text = (page, selector) => page.$eval(selector, (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "").catch(() => "");
const clickButton = (page, label) =>
  page.evaluate((wanted) => {
    const el = [...document.querySelectorAll("button, a")].find((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase().includes(wanted.toLowerCase()) && !b.disabled);
    if (!el) throw new Error(`no enabled button "${wanted}"`);
    el.click();
  }, label);
const waitText = (page, selector, pattern, timeout = 30_000) =>
  page.waitForFunction((s, p) => new RegExp(p, "i").test(document.querySelector(s)?.textContent ?? ""), { timeout, polling: 100 }, selector, pattern);
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** Column/panel heights, the screen size and how far anything below the tool sits from the top of the page. */
const measure = (page) =>
  page.evaluate(() => {
    const h = (s) => {
      const el = document.querySelector(s);
      return el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null;
    };
    const lower = document.querySelector(".tool-lower")?.getBoundingClientRect();
    return {
      panel: h(".job-panel"),
      stage: h(".cap-stage-card"),
      screen: h(".job-screen"),
      bench: h(".tool-workbench"),
      lowerTop: lower ? Math.round(lower.top + window.scrollY) : null,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

async function runFlow(label, viewport) {
  console.log(`\n== ${label} (${viewport.width}px) ==`);
  const { page, errors, requests } = await openPage(viewport);
  const downloads = mkdtempSync(join(tmpdir(), "caps-dl-"));
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

  await shot(page, `${label}-1-empty`);
  check((await text(page, ".job-state")) === "Waiting", "panel says Waiting before a file is chosen");

  await (await page.$('input[type="file"]')).uploadFile(VIDEO);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? "")), { timeout: 20_000 });
  await sleep(600);
  const ready = await measure(page);
  await shot(page, `${label}-2-ready`);
  check((await text(page, ".job-state")) === "Ready", "panel says Ready once a file is chosen");

  // There is no language or audio-kind picker: the tool works those out by itself.
  check(!(await page.evaluate(() => /Spoken language|Song or music|Talking/.test(document.body.innerText))), "no language or audio-kind choice is shown");

  // ---- consent ----
  await clickButton(page, "Generate captions");
  await page.waitForFunction(() => /download the speech model\?/i.test(document.body.innerText), { timeout: 10_000 });
  const consent = await text(page, ".cap-stage-card");
  await shot(page, `${label}-3-consent`);
  check(/24\.0 MB/.test(consent), "consent card shows the download size (24.0 MB)");
  check(/models\.cutmoor\.com/.test(consent), "consent card names the host");
  check(/wi-?fi/i.test(consent), "consent card recommends Wi-Fi");
  check(/never leave|stay on this device/i.test(consent), "consent card says media stays on the device");
  check((await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Download and start"), "focus moves to the Download button");
  const consentSizes = await measure(page);

  // Not now returns to the settings, then ask again.
  await clickButton(page, "Not now");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? "")));
  await clickButton(page, "Generate captions");
  await page.waitForFunction(() => /download the speech model\?/i.test(document.body.innerText));
  await clickButton(page, "Download and start");

  // ---- running ----
  await waitText(page, ".job-state", "working");
  await page.waitForSelector('[role="progressbar"]');
  await page.waitForFunction(() => document.querySelectorAll(".cap-partial li:not(.cap-partial-empty)").length > 0, { timeout: 30_000 });
  const running = await measure(page);
  await shot(page, `${label}-4-running`);
  const pct = await page.$eval('[role="progressbar"]', (el) => Number(el.getAttribute("aria-valuenow")));
  check(pct >= 0 && pct <= 100, `progress bar has a real value (${pct}%)`);
  check((await text(page, ".cap-stage-card")).match(/First captions/), "first captions list is shown while running");
  const overlayWhileRunning = await page.$(".cap-overlay");
  notes.push(`overlay while running present: ${Boolean(overlayWhileRunning)}`);

  // Progress must never go backwards.
  let last = -1;
  let backwards = false;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const now = await page.$eval('[role="progressbar"]', (el) => Number(el.getAttribute("aria-valuenow"))).catch(() => null);
    if (now === null) break;
    if (now < last) backwards = true;
    last = now;
    await sleep(120);
  }
  check(!backwards, "progress never went backwards");

  // ---- done: editor ----
  await page.waitForSelector(".cap-editor", { timeout: 30_000 });
  await sleep(500);
  const done = await measure(page);
  await shot(page, `${label}-5-done`);
  check((await text(page, ".job-state")) === "Complete", "panel says Complete");
  // The captions card and panel are content-sized on purpose (src/captions.css overrides the generic fixed `.job-panel`:
  // "the card grows with its content; the page scrolls, never the card", no inner scrollbar). Different states therefore
  // have different heights by design; what must hold is that the preview keeps one size, results never shrink a column,
  // and no column hides part of itself behind a scroll box.
  check(ready.screen === done.screen && consentSizes.screen === done.screen, `preview screen keeps one size in every state (${done.screen})`);
  check(done.panel >= ready.panel && done.stage >= consentSizes.stage, `results grow the columns, never shrink them (panel ${done.panel}, card ${done.stage})`);
  const clipped = await page.evaluate(() => {
    const panel = document.querySelector(".job-panel");
    const body = document.querySelector(".job-panel .job-body");
    const last = [...document.querySelectorAll(".job-panel button, .job-panel a")].pop();
    return {
      panel: panel ? Math.round(panel.scrollHeight - panel.clientHeight) : null,
      body: body ? Math.round(body.scrollHeight - body.clientHeight) : null,
      last: last && panel ? Math.round(last.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom) : null,
    };
  });
  check(clipped.panel === 0 && clipped.body === 0 && clipped.last !== null && clipped.last <= 1, `the finished panel shows all of its content, with no inner scrollbar (${JSON.stringify(clipped)})`);
  check(done.overflowX <= 0, "no sideways scrolling");

  const wordCount = await page.$$eval(".cap-w", (els) => els.length);
  check(wordCount > 5, `editor lists the words (${wordCount})`);
  check((await page.$$eval(".cap-w.is-uncertain", (els) => els.length)) > 0, "uncertain words are marked");
  check((await page.$$(".cap-gap")).length === 1, "the uncovered stretch is flagged in the list");

  // ---- keyboard editing ----
  const first = await page.$('.cap-w[tabindex="0"]');
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const sel = await page.$eval(".cap-w.is-selected", (el) => Number(el.dataset.word));
  check(sel === 2, "arrow keys move the selection (word 3)");
  check((await page.evaluate(() => document.activeElement?.className ?? "")).includes("cap-w"), "focus follows the selection");

  const original = await page.$eval(".cap-w.is-selected", (el) => el.textContent);
  await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement?.tagName === "INPUT"), "Enter moves focus into the word's text box");
  await page.keyboard.type("EDITED");
  await page.keyboard.press("Enter");
  check((await page.$eval(".cap-w.is-selected", (el) => el.textContent)) === "EDITED", `typing replaces the word ("${original}" -> "EDITED")`);
  check(await page.evaluate(() => document.activeElement?.className.includes("cap-w")), "focus returns to the word after saving");

  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  check((await page.$eval(".cap-w.is-selected", (el) => el.textContent)) === original, "Ctrl+Z restores the word");
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("z");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  check((await page.$eval(".cap-w.is-selected", (el) => el.textContent)) === "EDITED", "Ctrl+Shift+Z redoes it");

  // Delete, then undo through the button.
  await page.keyboard.press("Delete");
  check((await page.$$eval(".cap-w", (els) => els.length)) === wordCount - 1, "Delete removes the word");
  // The page header is sticky, so check the real hit target: nothing may cover the Undo button.
  const covered = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Undo"]');
    button.scrollIntoView({ block: "center", behavior: "instant" });
    const r = button.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== button && !button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  check(!covered, "the Undo button is not covered by the sticky header");
  await page.click('button[aria-label="Undo"]');
  check((await page.$$eval(".cap-w", (els) => els.length)) === wordCount, "Undo button brings it back");

  // Split at the caret, then merge back.
  await clickButton(page, "Split");
  check((await page.$$eval(".cap-w", (els) => els.length)) === wordCount + 1, "Split makes two words");
  await clickButton(page, "Join next");
  check((await page.$$eval(".cap-w", (els) => els.length)) === wordCount, "Join next merges them again");

  // Timing nudge changes the readout.
  const before = await text(page, ".cap-range");
  await page.click('button[aria-label="End 50 milliseconds later"]');
  const after = await text(page, ".cap-range");
  check(before !== after, `nudging the end changes the time (${before} -> ${after})`);
  await page.click('button[aria-label="Undo"]');

  // ---- preview: karaoke highlight ----
  const target = await page.evaluate(() => {
    const video = document.querySelector("video");
    const selected = document.querySelector(".cap-w.is-selected");
    return { hasVideo: Boolean(video), text: selected?.textContent ?? "" };
  });
  check(target.hasVideo, "preview video is on the page");
  // Click a word: the video seeks there and that word is lit in the overlay.
  await page.evaluate(() => document.querySelectorAll(".cap-w")[5]?.click());
  await page.waitForFunction(() => document.querySelector(".cap-word[data-active]"), { timeout: 5000 }).catch(() => undefined);
  const lit = await page.evaluate(() => ({
    active: document.querySelector(".cap-word[data-active]")?.textContent ?? null,
    chosen: document.querySelector(".cap-w.is-selected")?.textContent ?? null,
    color: (() => {
      const el = document.querySelector(".cap-word[data-active]");
      return el ? getComputedStyle(el).color : null;
    })(),
    other: (() => {
      const el = [...document.querySelectorAll(".cap-word")].find((w) => !w.dataset.active);
      return el ? getComputedStyle(el).color : null;
    })(),
  }));
  await shot(page, `${label}-6-karaoke`);
  check(lit.active !== null && lit.active === lit.chosen, `clicking a word seeks the video and lights that word ("${lit.active}")`);
  check(lit.color !== lit.other, `the lit word is a different colour (${lit.color} vs ${lit.other})`);

  // Playing: the highlight must follow the clock without a seek.
  const follows = await page.evaluate(async () => {
    const video = document.querySelector("video");
    video.muted = true;
    video.currentTime = 0.2;
    await video.play().catch(() => undefined);
    const seen = new Set();
    const started = performance.now();
    while (performance.now() - started < 4000) {
      const el = document.querySelector(".cap-word[data-active]");
      if (el) seen.add(el.textContent);
      await new Promise((r) => requestAnimationFrame(r));
    }
    video.pause();
    return { seen: [...seen], played: video.currentTime };
  });
  check(follows.seen.length >= 3, `the highlight moves while playing (${follows.seen.length} different words in 4 s, played to ${follows.played.toFixed(1)} s)`);

  // ---- style ----
  await clickButton(page, "Bold");
  await sleep(150);
  check(await page.evaluate(() => Boolean(document.querySelector(".cap-block.cap-bg-pill") || !document.querySelector(".cap-block"))), "Bold style puts the caption on a pill");
  await clickButton(page, "Shorts");
  await clickButton(page, "Clean");

  // ---- downloads ----
  await clickButton(page, "SRT");
  await clickButton(page, "VTT");
  await clickButton(page, "Word JSON");
  const waitFile = async (ext) => {
    for (let i = 0; i < 60; i += 1) {
      const found = readdirSync(downloads).find((name) => name.endsWith(ext) && !name.endsWith(".crdownload"));
      if (found) return readFileSync(join(downloads, found), "utf8");
      await sleep(100);
    }
    return null;
  };
  const srt = await waitFile(".srt");
  const vtt = await waitFile(".vtt");
  const json = await waitFile(".json");
  check(srt !== null && /^1\r?\n\d\d:\d\d:\d\d,\d{3} --> /.test(srt), "SRT file downloads and starts with a valid cue");
  check(vtt !== null && vtt.startsWith("WEBVTT"), "VTT file downloads with a WEBVTT header");
  check(json !== null && JSON.parse(json).words.length === wordCount, "word JSON has every word");
  check(srt !== null && existsSync(downloads) && readdirSync(downloads).some((n) => n.includes("-captions.srt")), "download is named after the video");
  // A caption edit shows up in the export.
  await page.evaluate(() => document.querySelectorAll(".cap-w")[1]?.click());
  await page.focus(".cap-field input");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type("SENTINEL");
  await page.keyboard.press("Enter");
  await clickButton(page, "Word JSON");
  await sleep(600);
  const jsons = readdirSync(downloads).filter((n) => n.endsWith(".json"));
  const newest = jsons.map((n) => readFileSync(join(downloads, n), "utf8")).find((c) => c.includes("SENTINEL"));
  check(Boolean(newest), "an edited word appears in the exported file");

  // ---- burn-in ----
  await clickButton(page, "Make MP4 with captions");
  await page.waitForSelector('a[download$=".mp4"]', { timeout: 15_000 });
  check(true, "burn-in export finishes and offers an MP4 link");
  await shot(page, `${label}-7-exported`);
  await clickButton(page, "Clean");

  // ---- accessibility ----
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const axe = await page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector("main") ?? document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
  check(axe.length === 0, `axe finds no WCAG A/AA violations${axe.length ? `: ${JSON.stringify(axe)}` : ""}`);

  // ---- privacy: only the page's own files are requested ----
  const foreign = requests.filter((url) => !url.startsWith(BASE) && !url.startsWith("blob:") && !url.startsWith("data:") && !url.startsWith("about:"));
  check(foreign.length === 0, `no request left the dev server${foreign.length ? `: ${foreign.slice(0, 3).join(", ")}` : ""}`);
  const fetchesWithMedia = requests.filter((url) => /sample-clip/.test(url) && !url.startsWith("blob:"));
  check(fetchesWithMedia.length === 0, "the video file was never requested over the network (read from disk only)");
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

  // ---- start another ----
  await clickButton(page, "Start another file");
  await page.waitForSelector(".dropzone");
  check(true, "Start another file returns to the picker");
  await page.close();
}

async function failureFlow(mode, expected, viewport = { width: 1366, height: 900 }) {
  console.log(`\n== failure: ${mode} ==`);
  const { page, errors } = await openPage(viewport, `?captions-test=${mode}`);
  await (await page.$('input[type="file"]')).uploadFile(VIDEO);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? "")));
  const base = await measure(page);
  await clickButton(page, "Generate captions");
  if (!mode.includes("cached")) {
    await page.waitForFunction(() => /download the speech model\?/i.test(document.body.innerText));
    await clickButton(page, "Download and start");
  }
  await page.waitForSelector('.cap-alert[role="alert"]', { timeout: 30_000 });
  const message = await text(page, ".cap-alert");
  check(expected.test(message), `${mode}: plain message shown ("${message.slice(0, 70)}...")`);
  check((await text(page, ".job-state")) === "Failed", `${mode}: panel says Failed`);
  const after = await measure(page);
  // The card is content-sized (src/captions.css), so a long message may add a few lines; the output panel must not
  // resize with it, and the message must stay fully inside the card instead of being clipped by it.
  check(after.panel === base.panel, `${mode}: the error does not resize the output panel (${after.panel})`);
  const alertFits = await page.evaluate(() => {
    const alert = document.querySelector(".cap-alert");
    const card = document.querySelector(".cap-stage-card");
    if (!alert || !card) return null;
    const a = alert.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return { below: Math.round(c.bottom - a.bottom), side: Math.round(c.right - a.right) };
  });
  check(alertFits !== null && alertFits.below >= 0 && alertFits.side >= 0, `${mode}: the error message is fully inside the card (${JSON.stringify(alertFits)})`);
  await shot(page, `failure-${mode}`);
  check(!/Error:|undefined|\[object/.test(message), `${mode}: no raw error text`);
  check(errors.length === 0, `${mode}: no console errors${errors.length ? errors[0] : ""}`);
  await page.close();
}

async function cancelFlow() {
  console.log("\n== cancel mid-run ==");
  const { page } = await openPage({ width: 1366, height: 900 }, "?captions-test=cached");
  await (await page.$('input[type="file"]')).uploadFile(VIDEO);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? "")));
  await clickButton(page, "Generate captions");
  await waitText(page, ".job-state", "working");
  await sleep(500);
  await clickButton(page, "Cancel");
  await page.waitForFunction(() => /stopped/i.test(document.body.innerText), { timeout: 5000 });
  check(true, "Cancel stops the job and says so");
  check(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? ""))), "the file is still loaded after cancelling");
  await sleep(2500); // a late result from the cancelled run must not appear
  check(!(await page.$(".cap-editor")), "a cancelled run never shows a result");
  await clickButton(page, "Generate captions");
  await page.waitForSelector(".cap-editor", { timeout: 30_000 });
  check(true, "running again after a cancel works");
  await page.close();
}

async function unavailableFlow() {
  console.log("\n== not available in this build ==");
  const { page } = await openPage({ width: 1366, height: 900 }, "", { noEngine: true });
  await (await page.$('input[type="file"]')).uploadFile(VIDEO);
  await page.waitForFunction(() => /not available in this build/i.test(document.body.innerText), { timeout: 5000 });
  check(true, "without an engine the page says it is not available in this build");
  await shot(page, "unavailable");
  await page.close();
}

try {
  await runFlow("desktop", { width: 1366, height: 900 });
  await runFlow("mobile", { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2, hasTouch: true });
  await failureFlow("no-audio", /no sound/i);
  await failureFlow("no-speech,cached", /no speech found/i);
  await failureFlow("download-fail", /did not download/i);
  await failureFlow("fail,cached", /failed on part of the audio/i);
  await cancelFlow();
  await unavailableFlow();
} catch (error) {
  failures.push(`script error: ${error.stack ?? error.message}`);
  console.log(error);
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (notes.length) console.log(notes.map((n) => `note: ${n}`).join("\n"));
console.log(failures.length ? `\nFAIL (${failures.length})\n${failures.map((f) => `  - ${f}`).join("\n")}` : "\nPASS");
process.exit(failures.length ? 1 : 0);
