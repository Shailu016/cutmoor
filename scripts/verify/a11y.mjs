/**
 * Accessibility gate: runs axe-core (WCAG 2.0 to 2.2 A and AA, plus best
 * practices) on the main pages of a running build and exits non-zero if any
 * page has a violation. When the homepage has the live demo, it is also
 * checked while it is ready, working and finished.
 *
 *   node scripts/verify/a11y.mjs http://localhost:4173
 *
 * Needs `npm install --no-save puppeteer-core axe-core` and Chrome (CHROME_PATH).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";
import { serveCoreLocally } from "./local-core.mjs";

const BASE = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const PAGES = ["/", "/tools/", "/tools/compress/", "/tools/convert-image/", "/guides/", "/guides/compress-video-for-whatsapp/", "/privacy/", "/about/", "/contact/", "/nope"];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: process.env.CI ? ["--no-sandbox"] : [],
  protocolTimeout: 300_000,
});
const page = await browser.newPage();
await serveCoreLocally(page);
await page.setViewport({ width: 1280, height: 900 });

const findings = [];
async function audit(label) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      target: v.nodes[0].target.join(" ").slice(0, 90),
      html: v.nodes[0].html.slice(0, 120),
    }));
  });
  findings.push({ label, violations });
  console.log(`${violations.length ? "FAIL" : "PASS"}  ${label}${violations.length ? `  (${violations.length} rule${violations.length > 1 ? "s" : ""})` : ""}`);
  for (const v of violations) console.log(`      [${v.impact}] ${v.id} x${v.nodes}: ${v.help}\n        ${v.target}  ${v.html}`);
}

for (const path of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await audit(path);
}

// The homepage demo, if this build has one, in each of its live states.
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
if (await page.$(".demo")) {
  const click = (selector, text) =>
    page.evaluate(
      ({ s, t }) => [...document.querySelectorAll(s)].find((el) => !t || el.innerText.toLowerCase().includes(t)).click(),
      { s: selector, t: text },
    );
  const phase = (wanted) =>
    page.waitForFunction((p) => document.querySelector(".demo")?.dataset.phase === p, { timeout: 180_000, polling: 100 }, wanted);
  await click("#demo-tab-trim");
  await click(".demo-controls .button-primary", "try it live");
  await phase("ready");
  await audit("/ demo: ready");
  await click(".demo-controls .button-primary", "run");
  await phase("working");
  await audit("/ demo: working");
  await phase("done");
  await new Promise((resolve) => setTimeout(resolve, 400));
  await audit("/ demo: done");
}

await browser.close();
const failing = findings.filter((f) => f.violations.length);
console.log(`\n${findings.length - failing.length}/${findings.length} pages and states are free of violations.`);
process.exit(failing.length ? 1 : 0);
