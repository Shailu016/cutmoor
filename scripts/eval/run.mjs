#!/usr/bin/env node
/**
 * Scores a hypothesis transcript against a clips manifest and enforces the quality thresholds.
 *
 * This file is deliberately thin: argument parsing, JSON file IO and the process exit code. Every
 * number comes from `src/lib/captioning/eval/report.ts`, which is pure and unit-tested, so the same
 * scoring can be used from tests or from the app without spawning Node.
 *
 * No model is run and no media is opened here: this tool only SCORES words that someone else
 * produced. It never touches the network.
 *
 * Usage: node scripts/eval/run.mjs --hypothesis hyp.json [--clips clips.json]
 *        [--thresholds thresholds.json] [--out eval-results.json] [--json]
 */

import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

/*
 * Node 24 strips TypeScript types by default, but the frozen `contracts.ts` uses a TypeScript
 * parameter property (`constructor(readonly code: ...)`), which strip-only mode refuses to run.
 * Re-exec once with the full transform so `node scripts/eval/run.mjs` needs no loader package and
 * no build step. The env marker prevents a re-exec loop even when NODE_OPTIONS also sets the flag.
 */
if (process.env.CUTMOOR_EVAL_TRANSFORM !== "1" && !process.execArgv.includes("--experimental-transform-types")) {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, CUTMOOR_EVAL_TRANSFORM: "1" } },
  );
  process.exit(child.status ?? 1);
}

register(new URL("./ts-hooks.mjs", import.meta.url));

const USAGE = `Cutmoor caption eval - score a hypothesis transcript against a clips manifest.

Usage:
  node scripts/eval/run.mjs --hypothesis <file> [options]

Options:
  --clips <file>       Clips manifest. Default: scripts/eval/clips.json
  --hypothesis <file>  Hypothesis JSON ({ [clipId]: { words: Word[] } }). Required.
  --thresholds <file>  Threshold file. Default: scripts/eval/thresholds.json
                       (missing default file means the built-in MVP limits are used)
  --out <file>         Where to write the full report. Default: eval-results.json
  --json               Print the JSON report instead of the text table
  --help, -h           Show this help

Exit codes: 0 = every clip passed, 1 = at least one threshold failed or clip is missing,
            2 = bad arguments or unreadable/invalid input files.

The input formats and the metric definitions are documented in scripts/eval/README.md.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = {
    clips: "scripts/eval/clips.json",
    hypothesis: null,
    thresholds: "scripts/eval/thresholds.json",
    out: "eval-results.json",
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
    if (name !== "clips" && name !== "hypothesis" && name !== "thresholds" && name !== "out") {
      throw new UsageError(`unknown option "--${name}"`);
    }
    const value = inline ?? argv[++index];
    if (value === undefined || value.length === 0) throw new UsageError(`--${name} needs a file path`);
    options[name] = value;
    if (name === "thresholds") options.thresholdsExplicit = true;
  }

  if (!options.help && options.hypothesis === null) {
    throw new UsageError("--hypothesis is required (there is nothing to score without it)");
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

  const { parseClipsManifest, parseHypothesisFile, parseThresholds, evaluateRun, reportToJson, renderTable } =
    await import("../../src/lib/captioning/eval/report.ts");

  const [rawClips, rawHypothesis] = await Promise.all([
    readJson(options.clips, "clips manifest"),
    readJson(options.hypothesis, "hypothesis file"),
  ]);

  let thresholds = null;
  if (existsSync(options.thresholds)) {
    thresholds = parseThresholds(await readJson(options.thresholds, "thresholds file"), options.thresholds);
  } else if (options.thresholdsExplicit) {
    throw new UsageError(`thresholds file "${options.thresholds}" does not exist`);
  } else {
    process.stderr.write(
      `warning: ${options.thresholds} not found, using built-in MVP limits ` +
        "(WER <= 0.18, timing MAE <= 120 ms, coverage >= 0.995)\n",
    );
  }

  const manifest = parseClipsManifest(rawClips, options.clips);
  const hypothesis = parseHypothesisFile(rawHypothesis, options.hypothesis);
  const report = evaluateRun(manifest, hypothesis, thresholds);

  const json = reportToJson(report);
  try {
    await writeFile(options.out, json, "utf8");
  } catch (error) {
    throw new UsageError(`cannot write report "${options.out}": ${error.message}`);
  }

  process.stdout.write(options.json ? json : renderTable(report));
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
      // CaptionError carries the useful message; anything else prints its stack to make a real bug
      // in the scorer diagnosable instead of hiding behind "invalid input".
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!(error && error.name === "CaptionError") && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    }
    process.exitCode = 2;
  },
);
