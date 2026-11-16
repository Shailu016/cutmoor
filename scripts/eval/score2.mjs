#!/usr/bin/env node
/**
 * Script-aware scorer for the real gold set (Phase 1, honest measurement).
 *
 * Thin on purpose: argument parsing, JSON file IO and the process exit code. Every number comes from
 * `src/lib/captioning/eval/score2.ts`, which is pure and unit-tested. No model is run, no media is
 * opened and nothing is sent anywhere.
 *
 * Usage: node scripts/eval/score2.mjs --gold gold.json --hypotheses hyp.json
 *        [--out results.json] [--md report.md] [--json]
 *        [--duration <clip>=<ms>] [--no-voice-span <clip>=<startMs>-<endMs>]
 */

import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

/*
 * Same Node 24 re-exec as gold-score.mjs: the frozen contracts.ts uses a TypeScript parameter
 * property, which strip-only type removal refuses to run. Re-exec once with the full transform so
 * plain `node scripts/eval/score2.mjs` needs no loader package and no build step.
 */
if (process.env.CUTMOOR_SCORE2_TRANSFORM !== "1" && !process.execArgv.includes("--experimental-transform-types")) {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, CUTMOOR_SCORE2_TRANSFORM: "1" } },
  );
  process.exit(child.status ?? 1);
}

register(new URL("./ts-hooks.mjs", import.meta.url));

const USAGE = `Cutmoor score2 - script-aware, transliteration-aware, multi-reference scoring.

Usage:
  node scripts/eval/score2.mjs --gold <file> --hypotheses <file> [options]

Options:
  --gold <file>            Gold manifest (gold.json shape plus optional durationMs/noVoiceSpans).
  --hypotheses <file>      Hypotheses JSON ({ model, backend, device, clips }). Required.
  --out <file>             Where to write the JSON report. Default: score2-results.json
  --md <file>              Where to write the markdown report. Default: score2-report.md
  --json                   Print the JSON report instead of the markdown report
  --duration <id>=<ms>     Clip length, for a clip whose manifest has no durationMs.
                           Repeat for several clips. Example: --duration silence=10000
  --no-voice-span <id>=<s>-<e>
                           Music-only span in ms; repeat to add several spans to one clip.
                           Example: --no-voice-span king=0-30000
  --help, -h               Show this help

Exit codes: 0 = every clip was scored, 1 = at least one clip has no hypothesis,
            2 = bad arguments or unreadable/invalid input files.

Metrics: raw and transliteration-aware OIWER, substitution/deletion/insertion split, words
per minute on silence and music-only spans, boundary/onset MAE and timing F1@50/100 ms.
The rule set, normalisation and F1 formula are documented in scripts/eval/README.md.`;

class UsageError extends Error {}

function optionValue(argv, index, inline, name) {
  const value = inline ?? argv[index + 1];
  if (value === undefined || value.length === 0) throw new UsageError(`--${name} needs a value`);
  return { value, next: inline === undefined ? index + 1 : index };
}

function parseArgs(argv) {
  const options = {
    gold: null,
    hypotheses: null,
    out: "score2-results.json",
    md: "score2-report.md",
    json: false,
    help: false,
    durations: [],
    spans: [],
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
    if (name !== "gold" && name !== "hypotheses" && name !== "out" && name !== "md" && name !== "duration" && name !== "no-voice-span") {
      throw new UsageError(`unknown option "--${name}"`);
    }
    const { value, next } = optionValue(argv, index, inline, name);
    index = next;
    if (name === "duration") options.durations.push(value);
    else if (name === "no-voice-span") options.spans.push(value);
    else options[name] = value;
  }

  if (!options.help && options.gold === null) {
    throw new UsageError("--gold is required (there is nothing to score against without it)");
  }
  if (!options.help && options.hypotheses === null) {
    throw new UsageError("--hypotheses is required (there is nothing to score without it)");
  }
  return options;
}

function parseMilliseconds(value, where) {
  if (!/^\d+$/u.test(value)) throw new UsageError(`${where} must be a whole number of milliseconds`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new UsageError(`${where} is out of range`);
  return parsed;
}

function parseDurationOverrides(entries) {
  const durations = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new UsageError(`--duration "${entry}" must look like <clip>=<ms>`);
    }
    const id = entry.slice(0, separator);
    if (Object.prototype.hasOwnProperty.call(durations, id)) {
      throw new UsageError(`--duration "${id}" was given twice`);
    }
    durations[id] = parseMilliseconds(entry.slice(separator + 1), `--duration ${id}`);
  }
  return durations;
}

function parseSpanOverrides(entries) {
  const spans = Object.create(null);
  for (const entry of entries) {
    const match = /^(.+)=(\d+)-(\d+)$/u.exec(entry);
    if (match === null) throw new UsageError(`--no-voice-span "${entry}" must look like <clip>=<startMs>-<endMs>`);
    const [, id, startText, endText] = match;
    const startMs = parseMilliseconds(startText, `--no-voice-span ${id} start`);
    const endMs = parseMilliseconds(endText, `--no-voice-span ${id} end`);
    if (endMs <= startMs) throw new UsageError(`--no-voice-span ${id} endMs must be after startMs`);
    if (spans[id] === undefined) spans[id] = [];
    spans[id].push({ startMs, endMs });
  }
  return spans;
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

  const {
    applyScore2Overrides,
    evaluateScore2,
    parseScore2Hypotheses,
    parseScore2Manifest,
    renderScore2Markdown,
    score2ReportToJson,
  } = await import("../../src/lib/captioning/eval/score2.ts");

  const [rawGold, rawHypotheses] = await Promise.all([
    readJson(options.gold, "gold manifest"),
    readJson(options.hypotheses, "hypotheses file"),
  ]);

  const manifest = applyScore2Overrides(parseScore2Manifest(rawGold, options.gold), {
    durations: parseDurationOverrides(options.durations),
    noVoiceSpans: parseSpanOverrides(options.spans),
  });
  const hypothesis = parseScore2Hypotheses(rawHypotheses, options.hypotheses);
  const report = evaluateScore2(manifest, hypothesis);

  try {
    await Promise.all([
      writeFile(options.out, score2ReportToJson(report), "utf8"),
      writeFile(options.md, renderScore2Markdown(report), "utf8"),
    ]);
  } catch (error) {
    throw new UsageError(`cannot write report: ${error.message}`);
  }

  const markdown = renderScore2Markdown(report);
  process.stdout.write(options.json ? score2ReportToJson(report) : markdown);
  return report.summary.missing === 0 && report.summary.scored === report.summary.clips ? 0 : 1;
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
