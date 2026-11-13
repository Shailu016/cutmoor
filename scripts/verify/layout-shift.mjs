/**
 * Checks that the homepage demo never moves the page.
 *
 * Steps through every tab and every state (recording, loading, ready, working,
 * done, before/after, reset), measuring the demo's size, the headline's
 * position and the browser's own layout-shift score at each step.
 *
 *   node scripts/verify/layout-shift.mjs <base-url> [desktop|mobile]
 *
 * Exits non-zero if the demo changes height, the headline moves, a control row
 * overflows, or the layout-shift score is above the limit.
 */
import puppeteer from "puppeteer-core";
import { serveCoreLocally } from "./local-core.mjs";

const BASE = process.argv[2] || "http://localhost:5174";
const device = process.argv[3] || "desktop";
const CLS_LIMIT = 0.02;
const TOLERANCE_PX = 0.6;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: process.env.CI ? ["--no-sandbox"] : [],
  protocolTimeout: 900_000,
});
const page = await browser.newPage();
await serveCoreLocally(page);
await page.setViewport(device === "mobile" ? { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 } : { width: 1280, height: 900 });

const consoleErrors = [];
let currentStep = "page load";
page.on("pageerror", (error) => consoleErrors.push(`[${currentStep}] pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`[${currentStep}] ${message.text().slice(0, 90)} ${message.location().url?.slice(0, 80) ?? ""}`);
});

await page.evaluateOnNewDocument(() => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
});

await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
// Let fonts and the first paint settle, then forget the page-load shifts: this checks the demo.
await new Promise((resolve) => setTimeout(resolve, 1500));
await page.evaluate(() => {
  window.__cls = 0;
});

const snaps = [];
const snap = async (label) => {
  currentStep = `after ${label}`;
  const data = await page.evaluate((labelText) => {
    const demo = document.querySelector(".demo");
    const rect = demo.getBoundingClientRect();
    const controls = demo.querySelector(".demo-controls");
    const screen = demo.querySelector(".demo-screen");
    const rows = [...controls.children];
    return {
      label: labelText,
      demoHeight: Math.round(rect.height * 10) / 10,
      demoWidth: Math.round(rect.width * 10) / 10,
      screenHeight: Math.round(screen.getBoundingClientRect().height * 10) / 10,
      headlineTop: Math.round((document.querySelector(".hero h1").getBoundingClientRect().top + window.scrollY) * 10) / 10,
      demoTop: Math.round((rect.top + window.scrollY) * 10) / 10,
      pageHeight: document.documentElement.scrollHeight,
      overflowing: rows.filter((row) => row.scrollWidth > row.clientWidth + 1 && getComputedStyle(row).overflowX === "visible").length + (controls.scrollHeight > controls.clientHeight + 1 ? 1 : 0),
      phase: demo.dataset.phase,
      mode: demo.dataset.mode,
    };
  }, label);
  snaps.push(data);
  return data;
};

const click = (selector, text) =>
  page.evaluate(
    ({ selectorText, labelText }) => {
      const els = [...document.querySelectorAll(selectorText)];
      const el = labelText ? els.find((e) => e.innerText.trim().toLowerCase().includes(labelText.toLowerCase())) : els[0];
      if (!el) throw new Error(`nothing to click: ${selectorText} ${labelText ?? ""}`);
      el.click();
    },
    { selectorText: selector, labelText: text },
  );
const waitPhase = (phase, timeout = 300_000) =>
  page.waitForFunction((p) => document.querySelector(".demo")?.dataset.phase === p, { timeout }, phase);

const tabs = await page.evaluate(() => [...document.querySelectorAll(".demo-tab")].map((t) => t.id.replace("demo-tab-", "")));
await snap("initial (recording, compress)");

const summary = [];
for (const id of tabs) {
  await click(`#demo-tab-${id}`);
  await snap(`${id}: tab (recording)`);
  await click(".demo-controls .button-primary", "Try it live");
  await page.waitForFunction(() => ["ready", "error"].includes(document.querySelector(".demo")?.dataset.phase), { timeout: 60_000 });
  await snap(`${id}: ready`);
  await click(".demo-controls .button-primary", "Run");
  await page.waitForFunction(() => document.querySelector(".demo")?.dataset.phase === "working", { timeout: 30_000 });
  const t0 = Date.now();
  // Sample the working state a few times: progress, elapsed time and percentages all change here.
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const phase = await page.evaluate(() => document.querySelector(".demo")?.dataset.phase);
    if (phase !== "working") break;
    await snap(`${id}: working #${i + 1}`);
  }
  await page.waitForFunction(() => ["done", "error"].includes(document.querySelector(".demo")?.dataset.phase), { timeout: 300_000 });
  const done = await snap(`${id}: done`);
  const text = await page.evaluate(() => document.querySelector(".demo-info")?.innerText.replace(/\s+/g, " ").trim() ?? "");
  summary.push({ id, phase: done.phase, seconds: Math.round((Date.now() - t0) / 100) / 10, result: text.slice(0, 120) });
  if (done.phase === "done") {
    await click(".demo-switch button", "Before");
    await snap(`${id}: before`);
    await click(".demo-switch button", "After");
    await snap(`${id}: after`);
    // Change the option and run again: a second result must not move anything either.
    await page.evaluate(() => {
      const chips = [...document.querySelectorAll(".demo .chip")];
      (chips.find((c) => c.getAttribute("aria-pressed") === "false") ?? chips[0]).click();
    });
    await snap(`${id}: option changed`);
  }
  await click(".demo-controls .button-ghost", "Reset");
  await snap(`${id}: reset (recording)`);
}

const cls = await page.evaluate(() => window.__cls);
const heights = [...new Set(snaps.map((s) => s.demoHeight))];
const spread = (key) => Math.max(...snaps.map((s) => s[key])) - Math.min(...snaps.map((s) => s[key]));
const checks = [
  ["demo height never changed", spread("demoHeight") <= TOLERANCE_PX, `${heights.join(", ")} px`],
  ["demo width never changed", spread("demoWidth") <= TOLERANCE_PX, `spread ${spread("demoWidth").toFixed(1)} px`],
  ["screen height never changed", spread("screenHeight") <= TOLERANCE_PX, `spread ${spread("screenHeight").toFixed(1)} px`],
  ["headline never moved", spread("headlineTop") <= TOLERANCE_PX, `spread ${spread("headlineTop").toFixed(1)} px`],
  ["demo never moved", spread("demoTop") <= TOLERANCE_PX, `spread ${spread("demoTop").toFixed(1)} px`],
  ["page height never changed", spread("pageHeight") <= 1, `spread ${spread("pageHeight")} px`],
  ["no control row overflowed", snaps.every((s) => s.overflowing === 0), `${snaps.filter((s) => s.overflowing).map((s) => s.label).join("; ") || "none"}`],
  [`layout-shift score under ${CLS_LIMIT}`, cls < CLS_LIMIT, cls.toFixed(4)],
  ["every tab finished a real run", summary.every((s) => s.phase === "done"), summary.map((s) => `${s.id}:${s.phase}`).join(" ")],
  ["no console errors", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 200) || "none"],
];

console.log(`\nDevice: ${device}, ${snaps.length} measurements across ${tabs.length} tabs\n`);
for (const row of summary) console.log(`  ${row.id.padEnd(9)} ${row.phase.padEnd(6)} ${String(row.seconds).padStart(5)} s  ${row.result}`);
console.log("");
let failed = 0;
for (const [name, pass, detail] of checks) {
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (${detail})`);
}
await browser.close();
process.exit(failed ? 1 : 0);
