/**
 * Performance budget for the built site. Run after `npm run build`.
 *
 * Sizes are gzip, because that is what visitors download. The HEIC decoder is a
 * lazy chunk (fetched only when a HEIC file is opened) so it has its own limit
 * and is not counted in first-load JavaScript. Raise a limit deliberately, in a
 * pull request that says why, never by accident.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1024;
const BUDGET = {
  firstLoadJsGz: 230 * KB, // every JS file except the lazy HEIC chunk, together
  singleChunkGz: 100 * KB, // any one first-load JS file
  articleChunkGz: 15 * KB, // one guide article, loaded only on its own page
  cssGz: 24 * KB, // all CSS together
  lazyHeicGz: 850 * KB,
  walkthroughVideo: 450 * KB, // each demo recording
  walkthroughPoster: 60 * KB,
  samplesTotal: 5 * 1024 * KB,
};

const dist = join(process.cwd(), "dist");
const assets = join(dist, "assets");
const rows = [];
const failures = [];

const files = (await readdir(assets)).filter((name) => /\.(js|css)$/.test(name));
let firstLoadJs = 0;
let css = 0;
for (const name of files) {
  const bytes = await readFile(join(assets, name));
  const gz = gzipSync(bytes).length;
  const lazy = name.startsWith("heic-to");
  // Guide articles (guides/<slug>/body.ts) are separate chunks named body-<hash>.js.
  const article = /^body-/.test(name);
  const kind = name.endsWith(".css") ? "css" : lazy ? "lazy js" : article ? "article" : "js";
  rows.push({ file: name.replace(/-[A-Za-z0-9_]{8}\./, "."), kind, kb: (bytes.length / KB).toFixed(1), gz: (gz / KB).toFixed(1) });
  if (kind === "js") {
    firstLoadJs += gz;
    if (gz > BUDGET.singleChunkGz) failures.push(`${name}: ${(gz / KB).toFixed(1)} KB gzip is over the ${BUDGET.singleChunkGz / KB} KB single-chunk limit`);
  }
  if (kind === "css") css += gz;
  if (kind === "article" && gz > BUDGET.articleChunkGz) failures.push(`${name}: ${(gz / KB).toFixed(1)} KB gzip is over the ${BUDGET.articleChunkGz / KB} KB per-article limit`);
  if (lazy && gz > BUDGET.lazyHeicGz) failures.push(`${name}: ${(gz / KB).toFixed(1)} KB gzip is over the ${BUDGET.lazyHeicGz / KB} KB lazy-chunk limit`);
}
if (firstLoadJs > BUDGET.firstLoadJsGz) failures.push(`First-load JS is ${(firstLoadJs / KB).toFixed(1)} KB gzip, over the ${BUDGET.firstLoadJsGz / KB} KB budget`);
if (css > BUDGET.cssGz) failures.push(`CSS is ${(css / KB).toFixed(1)} KB gzip, over the ${BUDGET.cssGz / KB} KB budget`);

// Demo recordings and samples are lazy, but they are still bytes someone downloads.
async function sizesIn(folder, pattern) {
  try {
    const names = (await readdir(join(dist, folder))).filter((name) => pattern.test(name));
    return Promise.all(names.map(async (name) => ({ name, size: (await stat(join(dist, folder, name))).size })));
  } catch {
    return [];
  }
}
for (const clip of await sizesIn("walkthroughs", /\.mp4$/)) {
  rows.push({ file: `walkthroughs/${clip.name}`, kind: "video", kb: (clip.size / KB).toFixed(1), gz: "-" });
  if (clip.size > BUDGET.walkthroughVideo) failures.push(`walkthroughs/${clip.name}: ${(clip.size / KB).toFixed(0)} KB is over the ${BUDGET.walkthroughVideo / KB} KB clip limit`);
}
for (const poster of await sizesIn("walkthroughs", /\.(jpg|webp)$/)) {
  if (poster.size > BUDGET.walkthroughPoster) failures.push(`walkthroughs/${poster.name}: ${(poster.size / KB).toFixed(0)} KB is over the ${BUDGET.walkthroughPoster / KB} KB poster limit`);
}
const samples = await sizesIn("samples", /./);
const samplesTotal = samples.reduce((sum, item) => sum + item.size, 0);
if (samplesTotal > BUDGET.samplesTotal) failures.push(`samples/: ${(samplesTotal / KB).toFixed(0)} KB is over the ${BUDGET.samplesTotal / KB} KB limit`);

const lines = [
  "| File | Type | Size (KB) | Gzip (KB) |",
  "| --- | --- | ---: | ---: |",
  ...rows.sort((a, b) => Number(b.gz === "-" ? b.kb : b.gz) - Number(a.gz === "-" ? a.kb : a.gz)).map((r) => `| ${r.file} | ${r.kind} | ${r.kb} | ${r.gz} |`),
  "",
  `First-load JavaScript: **${(firstLoadJs / KB).toFixed(1)} KB** gzip (budget ${BUDGET.firstLoadJsGz / KB} KB). CSS: **${(css / KB).toFixed(1)} KB** (budget ${BUDGET.cssGz / KB} KB).`,
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Bundle sizes\n\n${lines.join("\n")}\n`);
}
if (failures.length) {
  console.error(`\nPerformance budget exceeded:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nWithin budget.");
