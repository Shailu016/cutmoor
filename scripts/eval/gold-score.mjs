#!/usr/bin/env node
/**
 * Scores a hypotheses file against a real gold-set manifest (task 0A).
 *
 * Thin on purpose: argument parsing, JSON file IO and the process exit code. Every number comes
 * from `src/lib/captioning/eval/gold.ts`, which is pure and unit-tested.
 *
 * No model is run, no media is opened and nothing is sent anywhere: this tool only scores words
 * that another process already produced.
 *
 * Usage: node scripts/eval/gold-score.mjs --gold gold.json --hypotheses hyp.json
 *        [--out results.json] [--md report.md] [--thresholds thresholds.json] [--json]
 */

import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

/*
 * Same Node 24 re-exec as run.mjs: the frozen contracts.ts uses a TypeScript parameter property,
 * which strip-only type removal refuses to run. Re-exec once with the full transform so plain
 * `node scripts/eval/gold-score.mjs` needs no loader package and no build step.
 */
if (process.env.CUTMOOR_GOLD_TRANSFORM !== "1" && !process.execArgv.includes("--experimental-transform-types")) {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, CUTMOOR_GOLD_TRANSFORM: "1" } },
  );
  process.exit(child.status ?? 1);
}

register(new URL("./ts-hooks.mjs", import.meta.url));

const USAGE = `Cutmoor gold-set scorer - multi-reference WER, hallucination and timing metrics.

Usage:
  node scripts/eval/gold-score.mjs --gold <file> --hypotheses <file> [options]

Options:
  --gold <file>        Gold manifest. Required.
  --hypotheses <file>  Hypotheses JSON ({ model, backend, device, clips }). Required.
  --out <file>         Where to write the JSON report. Default: gold-results.json
  --md <file>          Where to write the markdown report. Default: gold-report.md
  --thresholds <file>  Threshold file. Default: scripts/eval/thresholds.json
                       (a missing default file means the built-in gold limits are used)
  --json               Print the JSON report instead of the markdown report
  --help, -h           Show this help

Exit codes: 0 = every limit passed, 1 = at least one gold threshold failed,
            2 = bad arguments or unreadable/invalid input files.

The manifest format, the metrics and the report schema are documented in
scripts/eval/gold/README.md.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = {
    gold: null,
    hypotheses: null,
    out: "gold-results.json",
    md: "gold-report.md",
    thresholds: "scripts/eval/thresholds.json",
    json: false,
    help: false,
    thresholdsExplicit: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument "${arg}"`);
    const [name, inline] = arg.slice(2).split("=", 2);
    if (name === "json") {
      if (inline !== undefined) throw new UsageError("--json does not take a value");
      options.json = true;
      continue;
    }
    if (name !== "gold" && name !== "hypotheses" && name !== "out" && name !== "md" && name !== "thresholds") {
      throw new UsageError(`unknown option "--${name}"`);
    }
    const value = inline ?? argv[++index];
    if (value === undefined || value.length === 0) throw new UsageError(`--${name} needs a file path`);
    options[name] = value;
    if (name === "thresholds") options.thresholdsExplicit = true;
  }

  if (!options.help && options.gold === null) {
    throw new UsageError("--gold is required (there is nothing to score against without it)");
  }
  if (!options.help && options.hypotheses === null) {
    throw new UsageError("--hypotheses is required (there is nothing to score without it)");
  }
  return options;
}

async function readJson(file, label) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${label} "${file}": ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${label} "${file}" is not valid JSON: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const { parseThresholds } = await import("../../src/lib/captioning/eval/report.ts");
  const {
    DEFAULT_GOLD_THRESHOLDS,
    evaluateGoldRun,
    goldReportToJson,
    parseGoldHypothesisFile,
    parseGoldManifest,
    renderGoldMarkdown,
  } = await import("../../src/lib/captioning/eval/gold.ts");

  const [rawGold, rawHypotheses] = await Promise.all([
    readJson(options.gold, "gold manifest"),
    readJson(options.hypotheses, "hypotheses file"),
  ]);

  let thresholds = DEFAULT_GOLD_THRESHOLDS;
  if (existsSync(options.thresholds)) {
    const parsed = parseThresholds(await readJson(options.thresholds, "thresholds file"), options.thresholds);
    if (parsed.gold !== undefined) thresholds = parsed.gold;
  } else if (options.thresholdsExplicit) {
    throw new UsageError(`thresholds file "${options.thresholds}" does not exist`);
  } else {
    process.stderr.write(
      `warning: ${options.thresholds} not found, using built-in gold limits ` +
        "(mean WER <= 0.25, clip WER <= 0.5, timing MAE <= 120 ms, 0 hallucinated words)\n",
    );
  }

  const manifest = parseGoldManifest(rawGold, options.gold);
  const hypothesis = parseGoldHypothesisFile(rawHypotheses, options.hypotheses);
  const report = evaluateGoldRun(manifest, hypothesis, thresholds);

  const json = goldReportToJson(report);
  try {
    await Promise.all([
      writeFile(options.out, json, "utf8"),
      writeFile(options.md, renderGoldMarkdown(report), "utf8"),
    ]);
  } catch (error) {
    throw new UsageError(`cannot write report: ${error.message}`);
  }

  process.stdout.write(options.json ? json : renderGoldMarkdown(report));
  return report.pass ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`error: ${error.message}\n\n${USAGE}\n`);
    } else {
      // CaptionError carries the useful message; anything else prints its stack so a real bug in
      // the scorer is diagnosable instead of hiding behind "invalid input".
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!(error && error.name === "CaptionError") && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    }
    process.exitCode = 2;
  },
);
