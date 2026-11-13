/**
 * Quality gate on a Lighthouse report (mobile profile, throttled), e.g.
 *
 *   npx lighthouse http://localhost:4173/ --output=json --output-path=lh.json
 *   node scripts/check-lighthouse.mjs lh.json
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

const report = JSON.parse(await readFile(process.argv[2] ?? "lh.json", "utf8"));
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
