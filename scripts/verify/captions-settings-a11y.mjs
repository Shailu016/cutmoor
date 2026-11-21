/**
 * Accessibility and phone-layout check of the Auto captions SETTINGS screen as a visitor sees it with the real
 * engine registered (model picker, names field open). No model is downloaded.
 *   node scripts/verify/captions-settings-a11y.mjs <base-url> <media-file>
 * Needs puppeteer-core and axe-core (see captions-ui.mjs) and a build that has the model lists.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const [base, media] = process.argv.slice(2);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: process.env.CI ? ["--no-sandbox"] : [] });
let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${message}`);
  if (!ok) failed = true;
};
for (const [label, width, height] of [["desktop", 1366, 900], ["phone", 375, 812]]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.setBypassCSP(true); // only so the test can inject axe; the page itself is judged as served
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base.replace(/\/$/, "")}/tools/auto-captions/`, { waitUntil: "networkidle0" });
  await (await page.$('input[type="file"]')).uploadFile(media);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /generate captions/i.test(b.textContent ?? "")), { timeout: 20_000 });
  const picker = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Speech model"] button')].map((b) => b.textContent.trim()));
  check(picker.join("|") === "Standard|High accuracy", `${label}: model picker shows Standard and High accuracy (${picker.join(", ")})`);
  const before = await page.evaluate(() => document.querySelector(".cap-stage-card")?.getBoundingClientRect().height);
  await page.evaluate(() => document.querySelector("details.cap-glossary")?.setAttribute("open", ""));
  await new Promise((r) => setTimeout(r, 300));
  check(await page.evaluate(() => Boolean(document.querySelector("details.cap-glossary textarea"))), `${label}: names field exists`);
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((v) => `${v.id}: ${v.nodes.length} node(s) ${v.nodes[0]?.target?.join(" ")}`));
  check(results.length === 0, `${label}: no accessibility violations${results.length ? ` (${results.join("; ")})` : ""}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: no sideways scroll (${overflow}px)`);
  check(errors.length === 0, `${label}: no page errors${errors.length ? ` (${errors[0]})` : ""}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
