/**
 * Quality gate on a Lighthouse report (mobile profile, throttled), e.g.
 *
 *   npx lighthouse http://localhost:4173/ --output=json --output-path=lh.json
 *   node scripts/check-lighthouse.mjs lh.json
 *
 * Give it several reports (lh-1.json lh-2.json lh-3.json) and each number is the MEDIAN of the runs. One run on a shared
 * runner swings by 100 ms of blocking time and a few points of score for no reason in the code, which failed a deploy
 * that had passed on the pull request. The limits below are unchanged; only the noise is.
 *
 * The build under test has no ad scripts, so this measures the site itself.
 * (With AdSense on, the same page scores about 15 points lower and its largest
 * paint is 1.5 to 2.5 s slower: that cost belongs to the ads, not the code.)
 * The limits leave margin for runner-to-runner variation. Tighten them as the
 * site improves; never loosen them without saying why in the pull request.
 */
import { appendFile, readFile } from "node:fs/promises";

const LIMITS = {
  scores: { performance: 85, accessibility: 95, "best-practices": 95, seo: 95 },
  metrics: [
    { id: "largest-contentful-paint", label: "Largest contentful paint", maxMs: 4000 },
    { id: "total-blocking-time", label: "Total blocking time", maxMs: 200 },
    { id: "cumulative-layout-shift", label: "Cumulative layout shift", max: 0.05 },
  ],
};

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["lh.json"];
const reports = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));

/** The middle value (the mean of the two middle values for an even count). */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One report that holds the median of every score and metric across the runs. */
function merge(all) {
  const first = all[0];
  const categories = {};
  for (const id of Object.keys(first.categories)) {
    const scores = all.map((r) => r.categories[id]?.score).filter((s) => s != null);
    categories[id] = { title: first.categories[id].title, score: scores.length ? median(scores) : null };
  }
  const audits = {};
  for (const metric of LIMITS.metrics) {
    const values = all.map((r) => r.audits[metric.id]?.numericValue).filter((v) => v != null);
    const value = median(values);
    const unit = metric.maxMs ? `${(value / 1000).toFixed(1)} s` : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    const tbt = metric.id === "total-blocking-time" ? `${Math.round(value)} ms` : unit;
    audits[metric.id] = { numericValue: value, displayValue: all.length > 1 ? `${tbt} (median of ${all.length})` : tbt };
  }
  return { categories, audits };
}

const report = reports.length > 1 ? merge(reports) : reports[0];
const failures = [];
const lines = ["| Check | Result | Limit |", "| --- | ---: | ---: |"];

for (const [category, minimum] of Object.entries(LIMITS.scores)) {
  if (report.categories[category]?.score == null) {
    failures.push(`${category} was not measured: run Lighthouse with all four categories`);
    continue;
  }
  const score = Math.round(report.categories[category].score * 100);
  if (score < minimum) failures.push(`${category} score ${score} is below ${minimum}`);
  lines.push(`| ${report.categories[category]?.title ?? category} | ${score} | ≥ ${minimum} |`);
}
for (const metric of LIMITS.metrics) {
  const audit = report.audits[metric.id];
  const value = audit.numericValue;
  const limit = metric.maxMs ?? metric.max;
  if (value > limit) failures.push(`${metric.label} ${audit.displayValue} is over the limit`);
  lines.push(`| ${metric.label} | ${audit.displayValue} | ≤ ${metric.maxMs ? `${metric.maxMs / 1000} s` : metric.max} |`);
}

console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Lighthouse (mobile, throttled)\n\n${lines.join("\n")}\n`);
}
if (failures.length) {
  console.error(`\nLighthouse gate failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nLighthouse gate passed.");
