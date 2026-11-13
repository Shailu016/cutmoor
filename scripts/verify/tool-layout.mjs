/**
 * Checks that no tool page moves while a job runs.
 *
 * For every tool it loads the page, chooses a real sample file, runs the tool
 * and clears it again, measuring at each step: the output panel's height, the
 * workbench's height, where the content below the workbench starts, and the
 * browser's own layout-shift score. It fails if the output panel changes size,
 * or (on desktop) if anything below the workbench moves.
 *
 *   node scripts/verify/tool-layout.mjs <base-url> [desktop|laptop|mobile] [tool,tool]
 *
 * Needs `npm install --no-save puppeteer-core` and Chrome (CHROME_PATH).
 */
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { serveCoreLocally } from "./local-core.mjs";

const BASE = (process.argv[2] || "http://localhost:5174").replace(/\/$/, "");
const device = process.argv[3] || "desktop";
const only = process.argv[4]?.split(",");
const TOLERANCE = 0.6;
const CLS_LIMIT = 0.02;

const VIDEO = join(process.cwd(), "public", "samples", "sample-clip.mp4");
const PHOTO = join(process.cwd(), "public", "samples", "sample-photo.jpg");
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello from Cutmoor\n\n2\n00:00:04,000 --> 00:00:06,500\nNothing is uploaded\n";

const TOOLS = [
  { slug: "compress", file: VIDEO },
  { slug: "resize", file: VIDEO },
  { slug: "trim", file: VIDEO },
  { slug: "convert", file: VIDEO },
  { slug: "audio", file: VIDEO },
  { slug: "frame", file: VIDEO },
  { slug: "compress-image", file: PHOTO },
  { slug: "resize-image", file: PHOTO },
  { slug: "convert-image", file: PHOTO },
  { slug: "heic-to-jpg", file: PHOTO },
  { slug: "captions", file: null },
].filter((tool) => !only || only.includes(tool.slug));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: process.env.CI ? ["--no-sandbox"] : [],
  protocolTimeout: 900_000,
});
const page = await browser.newPage();
await serveCoreLocally(page);
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  // A short laptop screen: the sticky output panel must still fit, Download included.
  laptop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
};
if (!VIEWPORTS[device]) throw new Error(`unknown device "${device}" (use ${Object.keys(VIEWPORTS).join(", ")})`);
await page.setViewport(VIEWPORTS[device]);
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 100)}`));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`console: ${message.text().slice(0, 100)} ${message.location().url?.slice(-30) ?? ""}`);
});
await page.evaluateOnNewDocument(() => {
  window.__shift = { all: 0, afterNoInput: 0 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__shift.all += entry.value;
      if (!entry.hadRecentInput) window.__shift.afterNoInput += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
});

const phaseText = () => page.evaluate(() => document.querySelector(".job-state")?.textContent?.trim().toLowerCase() ?? "");
const waitState = (pattern, timeout = 240_000) =>
  page.waitForFunction((p) => new RegExp(p).test(document.querySelector(".job-state")?.textContent?.toLowerCase() ?? ""), { timeout, polling: 100 }, pattern);
const clickText = (selector, texts) =>
  page.evaluate(
    ({ s, t }) => {
      const els = [...document.querySelectorAll(s)];
      const el = els.find((e) => t.some((x) => e.innerText.toLowerCase().includes(x))) ?? els.at(-1);
      if (!el) throw new Error(`nothing to click for ${s}`);
      el.click();
    },
    { s: selector, t: texts },
  );

const results = [];
for (const tool of TOOLS) {
  await page.goto(`${BASE}/tools/${tool.slug}/`, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.evaluate(() => {
    window.__shift = { all: 0, afterNoInput: 0 };
  });

  const snaps = [];
  const snap = async (label) => {
    const data = await page.evaluate((l) => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const panel = rect(".job-panel");
      const bench = rect(".tool-workbench");
      const lower = rect(".tool-lower") ?? rect(".faq-section");
      return {
        label: l,
        panel: panel ? Math.round(panel.height * 10) / 10 : null,
        bench: bench ? Math.round(bench.height * 10) / 10 : null,
        lowerTop: lower ? Math.round((lower.top + window.scrollY) * 10) / 10 : null,
        pageHeight: document.documentElement.scrollHeight,
        panelFits: panel ? panel.height <= window.innerHeight : true,
        downloadVisible: (() => {
          const link = document.querySelector(".job-panel a[download]");
          const body = document.querySelector(".job-panel .job-body");
          if (!link || !body) return null;
          const a = link.getBoundingClientRect();
          const b = body.getBoundingClientRect();
          return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
        })(),
        overflow: (() => {
          const lowerRegion = document.querySelector(".job-lower");
          return lowerRegion ? lowerRegion.scrollHeight > lowerRegion.clientHeight + 1 : false;
        })(),
      };
    }, label);
    snaps.push(data);
  };

  await snap("idle");
  let note = "";
  let steadyShift = null;
  try {
    if (tool.file) {
      await (await page.$('input[type="file"]')).uploadFile(tool.file);
      await waitState("ready", 60_000);
      await snap("ready");
      // Choosing a file swaps the picker for the file card and settings. That is the visitor's own
      // action, but the browser cannot tell (a file dialog is not "recent input"), so the unprompted
      // score starts counting here: from a loaded file onward, nothing may move.
      await page.evaluate(() => {
        window.__shift.afterNoInput = 0;
      });
      await clickText(".tool-input .button-primary", ["compress", "crop", "trim", "convert", "extract", "save", "resize", "run"]);
      await waitState("working", 30_000).catch(() => undefined);
      for (let i = 0; i < 3 && (await phaseText()) === "working"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await snap(`working ${i + 1}`);
      }
      await waitState("complete|failed");
      const finished = await phaseText();
      await snap(`done (${finished})`);
      if (finished !== "complete") {
        const message = await page.evaluate(() => document.querySelector(".job-error")?.textContent?.trim() ?? "");
        throw new Error(`job ${finished}: ${message}`.slice(0, 120));
      }
      // Clearing brings the picker back: also the visitor's own click, and the scripted click is
      // not "recent input" to the browser either. The unprompted score stops counting here.
      steadyShift = await page.evaluate(() => window.__shift.afterNoInput);
      await clickText(".job-panel .button-ghost", ["start another", "process another", "try another"]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await snap("cleared");
    } else {
      // Captions: no output panel, paste text and convert.
      await page.evaluate((text) => {
        const area = document.querySelector("textarea:not([readonly])");
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(area, text);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      }, SRT);
      await snap("pasted");
      await clickText("main .button-primary", ["convert"]);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await snap("converted");
    }
  } catch (error) {
    note = String(error.message).slice(0, 80);
  }

  const shift = await page.evaluate(() => window.__shift);
  // The settings column appears when a file is chosen and goes when it is cleared: both are the
  // visitor's own click. Everything between (ready, running, done) must not move anything.
  const spread = (key, steady = false) => {
    const values = snaps.filter((s) => !steady || !/^(idle|cleared|pasted)$/.test(s.label)).map((s) => s[key]).filter((v) => v !== null);
    return values.length ? Math.max(...values) - Math.min(...values) : 0;
  };
  results.push({
    tool: tool.slug,
    panel: [...new Set(snaps.map((s) => s.panel).filter((v) => v !== null))].join(" / ") || "-",
    panelSpread: spread("panel"),
    benchSpread: spread("bench", true),
    lowerSpread: spread("lowerTop", true),
    pageSpread: spread("pageHeight", true),
    overflow: snaps.some((s) => s.overflow),
    panelFits: snaps.every((s) => s.panelFits),
    downloadHidden: snaps.some((s) => s.downloadVisible === false),
    shiftAll: shift.all,
    shiftNoInput: steadyShift ?? shift.afterNoInput,
    note,
  });
}
await browser.close();

console.log(`\nDevice: ${device}\n`);
console.log("tool".padEnd(16) + "panel height(s)".padEnd(18) + "panel".padStart(7) + "bench".padStart(8) + "below".padStart(8) + "page".padStart(8) + "  CLS(all/no-input)");
for (const r of results) {
  console.log(
    r.tool.padEnd(16) + String(r.panel).padEnd(18) + r.panelSpread.toFixed(0).padStart(7) + r.benchSpread.toFixed(0).padStart(8) + r.lowerSpread.toFixed(0).padStart(8) + r.pageSpread.toFixed(0).padStart(8) +
      `  ${r.shiftAll.toFixed(3)} / ${r.shiftNoInput.toFixed(3)}${r.overflow ? "  [panel text overflows]" : ""}${r.note ? "  !" + r.note : ""}`,
  );
}

const desktop = device !== "mobile";
const failures = [];
for (const r of results) {
  if (r.panelSpread > TOLERANCE) failures.push(`${r.tool}: output panel changes height by ${r.panelSpread.toFixed(0)} px`);
  if (desktop && r.lowerSpread > TOLERANCE) failures.push(`${r.tool}: content below the tool moves by ${r.lowerSpread.toFixed(0)} px`);
  if (r.shiftNoInput > CLS_LIMIT) failures.push(`${r.tool}: layout-shift score ${r.shiftNoInput.toFixed(3)} (not caused by input)`);
  if (r.overflow) failures.push(`${r.tool}: output panel text overflows its area`);
  if (desktop && !r.panelFits) failures.push(`${r.tool}: output panel is taller than the window`);
  if (r.downloadHidden) failures.push(`${r.tool}: the Download button is not visible without scrolling the panel`);
  if (r.note) failures.push(`${r.tool}: ${r.note}`);
}
if (consoleErrors.length) failures.push(`console errors: ${[...new Set(consoleErrors)].slice(0, 3).join(" | ")}`);
console.log(failures.length ? `\nFAIL\n${failures.map((f) => `  - ${f}`).join("\n")}` : "\nPASS: no tool page moves.");
process.exit(failures.length ? 1 : 0);
