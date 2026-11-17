/**
 * Accessibility gate for the editing tools added after the first set: axe-core (WCAG 2.0 to 2.2 A and AA, plus best
 * practices) on each tool page when it is empty, and again once a real file is loaded (so the settings screen, the crop box,
 * the file list, and the preview are audited too), and on the open Tools menu.
 *
 *   node scripts/verify/more-tools-a11y.mjs http://localhost:4173 [phone]
 *
 * Needs puppeteer-core and axe-core (see a11y.mjs) and Chrome.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { serveCoreLocally } from "./local-core.mjs";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:4173").replace(/\/$/, "");
const phone = process.argv.includes("phone");
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CLIP = join(process.cwd(), "public", "samples", "sample-clip.mp4");
const PHOTO = join(process.cwd(), "public", "samples", "sample-photo.jpg");

const VIDEO = ["mute-video", "rotate-video", "video-speed", "reverse-video", "loop-video", "merge-videos", "watermark-video", "add-audio-to-video"];
const PICTURE = ["crop-image", "rotate-image", "remove-photo-metadata", "blur-image", "watermark-image", "webp-to-jpg", "png-to-jpg", "jpg-to-png", "svg-to-png", "avif-to-jpg"];
const EMPTY_ONLY = ["gif-to-mp4", "compress-gif", "resize-gif", "slideshow-maker"];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: process.env.CI ? ["--no-sandbox"] : [],
  protocolTimeout: 300_000,
});
const page = await browser.newPage();
await serveCoreLocally(page);
await page.setViewport(phone ? { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 } : { width: 1280, height: 900 });

let failures = 0;
async function audit(label) {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0].target.join(" ").slice(0, 90), html: v.nodes[0].html.slice(0, 120) }));
  });
  if (violations.length) failures += 1;
  console.log(`${violations.length ? "FAIL" : "PASS"}  ${label}${violations.length ? `  (${violations.length} rule${violations.length > 1 ? "s" : ""})` : ""}`);
  for (const v of violations) console.log(`      [${v.impact}] ${v.id} x${v.nodes}: ${v.help}\n        ${v.target}  ${v.html}`);
}
const open = async (slug) => {
  await page.goto(`${BASE}/tools/${slug}/`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
};
const withFile = async (slug, file) => {
  await (await page.$('input[type="file"]')).uploadFile(...(Array.isArray(file) ? file : [file]));
  await page.waitForSelector(".settings-card, .multi-list", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 900));
};

for (const slug of [...VIDEO, ...PICTURE, ...EMPTY_ONLY]) {
  await open(slug);
  await audit(`${slug} (empty)`);
}
for (const slug of VIDEO) {
  await open(slug);
  await withFile(slug, slug === "merge-videos" ? [CLIP, CLIP] : CLIP);
  await audit(`${slug} (video loaded)`);
}
for (const slug of PICTURE.filter((s) => !["webp-to-jpg", "svg-to-png", "avif-to-jpg"].includes(s))) {
  await open(slug);
  await withFile(slug, PHOTO);
  if (slug === "blur-image") {
    await page.evaluate(() => document.querySelector(".stage")?.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = await (await page.$(".stage")).boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.up();
  }
  await audit(`${slug} (picture loaded)`);
}
await open("slideshow-maker");
await withFile("slideshow-maker", [PHOTO, PHOTO]);
await audit("slideshow-maker (pictures loaded)");

// the open Tools menu, and the mobile menu
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
if (phone) {
  await page.click("button.menu-button");
  await new Promise((r) => setTimeout(r, 400));
  await audit("home with the mobile menu open");
} else {
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith("Tools"))?.click());
  await new Promise((r) => setTimeout(r, 400));
  await audit("home with the Tools menu open");
}
await browser.close();
console.log(failures === 0 ? "\nPASS: no accessibility violations." : `\nFAIL: ${failures} page state(s) with violations.`);
process.exit(failures === 0 ? 0 : 1);
