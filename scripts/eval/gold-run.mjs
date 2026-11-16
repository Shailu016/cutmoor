#!/usr/bin/env node
/**
 * Runs every clip of a gold manifest through the REAL pipeline in Chrome and writes the hypotheses file that
 * scripts/eval/gold-score.mjs scores. Needs a served build, puppeteer-core and the model files (see captions-real.mjs).
 *
 *   node scripts/eval/gold-run.mjs --gold gold.json --url http://localhost:4180 --dist "dirA,dirB" --tier fast|high --out hyp.json [--profile dir]
 *
 * One browser launch per clip (so a crash in one clip cannot hide the rest); a persistent --profile keeps the model cached between launches.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const goldPath = opt("gold");
const url = opt("url", "http://localhost:4180");
const dist = opt("dist");
const tier = opt("tier", "fast");
const out = opt("out", "hypotheses.json");
const profile = opt("profile", "");
// Optional segmenter overrides for sweeps, as JSON, e.g. '{"padMs":300,"startThreshold":0.3}' (see src/lib/captioning/vad/segmenter.ts).
const vad = opt("vad", "");
if (!goldPath || !dist) {
  console.error("usage: gold-run.mjs --gold gold.json --url <base> --dist <dirs> [--tier fast|high] [--out hyp.json] [--profile dir]");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const real = resolve(here, "../verify/captions-real.mjs");
const gold = JSON.parse(readFileSync(goldPath, "utf8"));
// Optional names per clip for the hint test: a file next to the gold manifest, { "<clip id>": "Name, Other name" }.
const glossaryFile = join(dirname(goldPath), "glossaries.json");
const glossaries = existsSync(glossaryFile) ? JSON.parse(readFileSync(glossaryFile, "utf8")) : {};
const work = mkdtempSync(join(tmpdir(), "gold-run-"));
const clips = {};
let backend = null;
for (const clip of gold.clips) {
  const json = join(work, `${clip.id}.json`);
  const mediaPath = resolve(dirname(goldPath), clip.path);
  if (!existsSync(mediaPath)) {
    console.log(`${clip.id}: MISSING MEDIA ${mediaPath}`);
    clips[clip.id] = { words: [], seconds: 0 };
    continue;
  }
  const run = spawnSync(process.execPath, [real, url, mediaPath, dist, `--tier=${tier}`, "--headless=false", `--json-out=${json}`, ...(profile ? [`--profile=${profile}`] : []), ...(glossaries[clip.id] ? [`--glossary=${glossaries[clip.id]}`] : []), ...(vad ? [`--vad=${vad}`] : [])], { encoding: "utf8", maxBuffer: 1 << 26 });
  try {
    const result = JSON.parse(readFileSync(json, "utf8")).results[0];
    backend = result.backend ?? backend;
    // The visitor sees the words after the names step (applied on the page), so score those texts, keeping the pipeline's timings.
    const pipeline = result.lastResult?.words ?? [];
    const shown = result.words ?? [];
    const words = pipeline.length > 0 && shown.length === pipeline.length ? pipeline.map((word, i) => ({ ...word, text: shown[i].text })) : pipeline;
    clips[clip.id] = { words, seconds: result.seconds };
    console.log(`${clip.id}: ${clips[clip.id].words.length} words in ${result.seconds.toFixed(1)} s (${result.backend})`);
  } catch {
    clips[clip.id] = { words: [], seconds: 0 };
    console.log(`${clip.id}: FAILED\n${(run.stdout ?? "").slice(-400)}`);
  }
}
writeFileSync(out, JSON.stringify({ model: `whisper-hinglish-${tier}`, backend: backend ?? "unknown", device: process.env.COMPUTERNAME ?? "local", clips }, null, 2));
console.log(`wrote ${out}`);
