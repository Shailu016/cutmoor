import { CaptionError, type CaptionLanguage } from "../contracts";
import type { SpeechInterval, Word } from "../types";
import type { CoverageReport } from "../overlap-merge";
import { parseGoldThresholds, type GoldThresholds } from "./gold";
import { coverageOf, timingError, type TimedWordLike, type TimingMetrics } from "./timing";
import { tokenizeForWer, normalizeForWer, wordErrorRate, type WerResult } from "./wer";

/**
 * Scores a whole eval run and turns the numbers into a verdict.
 *
 * This module is pure: it never reads a file, never starts a model and never touches the network,
 * so the CLI, a unit test and (if the lead wants it) an in-app "self check" panel all score the same
 * way. The CLI in `scripts/eval/run.mjs` is only argument parsing and file IO around this file.
 *
 * The contract with the outside world is three JSON documents, documented in
 * `scripts/eval/README.md`:
 *  - clips manifest: what to score, the reference transcript, optional word times and speech
 *    intervals for the timing and coverage metrics,
 *  - hypothesis file: `{ [clipId]: { words: Word[] } }` produced by the pipeline under test,
 *  - thresholds: the pass/fail limits.
 *
 * A clip with no hypothesis is a failure, not a silent skip: an eval run whose clips disappear
 * would otherwise report a perfect score.
 */

// ---------------------------------------------------------------- thresholds

export interface EvalThresholds {
  /** Largest acceptable word error rate, inclusive. */
  werMax: number;
  /** Largest acceptable mean absolute boundary error in ms, inclusive. */
  timingMaeMsMax: number;
  /** Smallest acceptable share (0..1) of detected speech that has a word on it, inclusive. */
  coverageMin: number;
}

/**
 * MVP limits from the master brief: WER <= 0.18, timing MAE <= 120 ms, coverage >= 0.995.
 * A clips/thresholds file can tighten any of them.
 */
export const DEFAULT_THRESHOLDS: Readonly<EvalThresholds> = Object.freeze({
  werMax: 0.18,
  timingMaeMsMax: 120,
  coverageMin: 0.995,
});

/**
 * Partial overrides. Later sections win, so a single clip can be stricter than its language, which
 * can be stricter than the default. The order is: default, language, tags (in manifest order), clip.
 */
export interface ThresholdFile {
  default?: Partial<EvalThresholds>;
  byLanguage?: Partial<Record<CaptionLanguage, Partial<EvalThresholds>>>;
  byTag?: Record<string, Partial<EvalThresholds>>;
  byClip?: Record<string, Partial<EvalThresholds>>;
  /**
   * Limits for the real gold-set scorer (`scripts/eval/gold-score.mjs`). `evaluateRun` ignores this
   * section, so one thresholds file can serve the MVP example and the gold set without either
   * scorer rejecting the other's keys.
   */
  gold?: GoldThresholds;
}

const LANGUAGES: readonly CaptionLanguage[] = ["hinglish", "hindi", "english"];

function isLanguage(value: unknown): value is CaptionLanguage {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Input that cannot be scored. Uses the frozen error type so callers handle it like any caption error. */
function invalid(message: string): never {
  throw new CaptionError("unsupported-file", `invalid eval input: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${where} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${where} must be an array`);
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${where} must be a non-empty string`);
  return value;
}

function asFinite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${where} must be a finite number`);
  return value;
}

function asOptionalStringArray(value: unknown, where: string): string[] | undefined {
  if (value === undefined) return undefined;
  const tags = asArray(value, where).map((entry, index) => asString(entry, `${where}[${index}]`));
  return [...new Set(tags)];
}

// ---------------------------------------------------------------- manifest

export interface ReferenceWord extends TimedWordLike {
  text: string;
  startMs: number;
  endMs?: number;
}

export interface EvalClip {
  /** Stable id, also the key in the hypothesis file. */
  id: string;
  language: CaptionLanguage;
  /** Path to the media, relative to the manifest. Informational: the scorer never opens media. */
  media: string;
  /** Reference transcript. Its tokens are the WER denominator. */
  reference: string;
  /** Optional hand-checked word times. Enables the timing metrics. */
  referenceWords?: ReferenceWord[];
  /** Optional voice-detector output. Enables the coverage metric. */
  speech?: SpeechInterval[];
  /** Free-form labels matched against thresholds.byTag. */
  tags?: string[];
}

export interface ClipsManifest {
  version?: number;
  clips: EvalClip[];
}

function parseInterval(value: unknown, where: string): SpeechInterval {
  const record = asRecord(value, where);
  const startMs = asFinite(record.startMs, `${where}.startMs`);
  const endMs = asFinite(record.endMs, `${where}.endMs`);
  if (startMs < 0) invalid(`${where}.startMs must not be negative`);
  if (endMs < startMs) invalid(`${where}.endMs must not be before startMs`);
  return { startMs, endMs };
}

function parseReferenceWord(value: unknown, where: string): ReferenceWord {
  const record = asRecord(value, where);
  const text = asString(record.text, `${where}.text`);
  const startMs = asFinite(record.startMs, `${where}.startMs`);
  if (startMs < 0) invalid(`${where}.startMs must not be negative`);
  if (record.endMs === undefined) return { text, startMs };
  const endMs = asFinite(record.endMs, `${where}.endMs`);
  if (endMs < startMs) invalid(`${where}.endMs must not be before startMs`);
  return { text, startMs, endMs };
}

function parseClip(value: unknown, where: string, seenIds: Set<string>): EvalClip {
  const record = asRecord(value, where);
  const id = asString(record.id, `${where}.id`);
  if (seenIds.has(id)) invalid(`${where}.id "${id}" is used twice`);
  seenIds.add(id);

  if (!isLanguage(record.language)) {
    invalid(`${where}.language must be one of ${LANGUAGES.join(", ")}`);
  }
  const language: CaptionLanguage = record.language;
  const media = asString(record.media, `${where}.media`);
  const reference = asString(record.reference, `${where}.reference`);
  const scoreableTokens = tokenizeForWer(reference).filter((token) => normalizeForWer(token).length > 0);
  if (scoreableTokens.length === 0) invalid(`${where}.reference has no words to score`);

  const clip: EvalClip = { id, language, media, reference };

  if (record.referenceWords !== undefined) {
    const words = asArray(record.referenceWords, `${where}.referenceWords`).map((entry, index) =>
      parseReferenceWord(entry, `${where}.referenceWords[${index}]`),
    );
    // A fixture that gives word times for a different sentence would silently score the wrong
    // timings. Compare through the same normaliser the scorer uses, so punctuation cannot fail it.
    const consistency = wordErrorRate(reference, words.map((word) => word.text));
    if (consistency.errors > 0 || consistency.refWords !== consistency.hypWords) {
      invalid(
        `${where}.referenceWords do not spell the reference transcript ` +
          `(${consistency.errors} edit(s) after normalisation)`,
      );
    }
    clip.referenceWords = words;
  }

  if (record.speech !== undefined) {
    clip.speech = asArray(record.speech, `${where}.speech`).map((entry, index) =>
      parseInterval(entry, `${where}.speech[${index}]`),
    );
  }

  const tags = asOptionalStringArray(record.tags, `${where}.tags`);
  if (tags !== undefined) clip.tags = tags;

  return clip;
}

export function parseClipsManifest(input: unknown, source = "clips manifest"): ClipsManifest {
  const record = asRecord(input, source);
  const version = record.version === undefined ? undefined : asFinite(record.version, `${source}.version`);
  const clips = asArray(record.clips, `${source}.clips`);
  if (clips.length === 0) invalid(`${source}.clips is empty; nothing would be measured`);
  const seenIds = new Set<string>();
  const parsed = clips.map((entry, index) => parseClip(entry, `${source}.clips[${index}]`, seenIds));
  return version === undefined ? { clips: parsed } : { version, clips: parsed };
}

// ---------------------------------------------------------------- hypothesis

/** The file format: one entry per clip id, mirroring `CaptionResult.words`. */
export type HypothesisFile = Record<string, { words: Word[] }>;

function parseHypothesisWord(value: unknown, where: string, position: number): Word {
  const record = asRecord(value, where);
  const text = asString(record.text, `${where}.text`);
  const startMs = asFinite(record.startMs, `${where}.startMs`);
  const endMs = asFinite(record.endMs, `${where}.endMs`);
  if (startMs < 0) invalid(`${where}.startMs must not be negative`);
  if (endMs < startMs) invalid(`${where}.endMs must not be before startMs`);

  let confidence = 1;
  if (record.confidence !== undefined) {
    confidence = asFinite(record.confidence, `${where}.confidence`);
    if (confidence < 0 || confidence > 1) invalid(`${where}.confidence must be between 0 and 1`);
  }
  let index = position;
  if (record.index !== undefined) {
    index = asFinite(record.index, `${where}.index`);
    if (!Number.isInteger(index) || index < 0) invalid(`${where}.index must be a non-negative integer`);
  }
  let windowIndex = 0;
  if (record.windowIndex !== undefined) {
    windowIndex = asFinite(record.windowIndex, `${where}.windowIndex`);
    if (!Number.isInteger(windowIndex) || windowIndex < 0) {
      invalid(`${where}.windowIndex must be a non-negative integer`);
    }
  }
  return { text, startMs, endMs, confidence, index, windowIndex };
}

/**
 * Reads the hypothesis document. Only `text`, `startMs` and `endMs` matter to the metrics; the rest
 * of `Word` is defaulted so the parsed value is still a real `Word[]` and can be fed to any
 * consumer of the pipeline output.
 */
export function parseHypothesisFile(input: unknown, source = "hypothesis file"): HypothesisFile {
  const record = asRecord(input, source);
  const result: HypothesisFile = {};
  for (const [clipId, value] of Object.entries(record)) {
    if (clipId.length === 0) invalid(`${source} has an empty clip id`);
    const entry = asRecord(value, `${source}["${clipId}"]`);
    const words = asArray(entry.words, `${source}["${clipId}"].words`).map((word, position) =>
      parseHypothesisWord(word, `${source}["${clipId}"].words[${position}]`, position),
    );
    result[clipId] = { words };
  }
  return result;
}

// ---------------------------------------------------------------- thresholds parsing

function parseThresholdValues(value: unknown, where: string): Partial<EvalThresholds> {
  const record = asRecord(value, where);
  const parsed: Partial<EvalThresholds> = {};
  for (const key of Object.keys(record)) {
    if (key !== "werMax" && key !== "timingMaeMsMax" && key !== "coverageMin") {
      invalid(`${where}.${key} is not a known threshold (werMax, timingMaeMsMax, coverageMin)`);
    }
  }
  if (record.werMax !== undefined) {
    const werMax = asFinite(record.werMax, `${where}.werMax`);
    if (werMax < 0) invalid(`${where}.werMax must not be negative`);
    parsed.werMax = werMax;
  }
  if (record.timingMaeMsMax !== undefined) {
    const timingMaeMsMax = asFinite(record.timingMaeMsMax, `${where}.timingMaeMsMax`);
    if (timingMaeMsMax < 0) invalid(`${where}.timingMaeMsMax must not be negative`);
    parsed.timingMaeMsMax = timingMaeMsMax;
  }
  if (record.coverageMin !== undefined) {
    const coverageMin = asFinite(record.coverageMin, `${where}.coverageMin`);
    if (coverageMin < 0 || coverageMin > 1) invalid(`${where}.coverageMin must be between 0 and 1`);
    parsed.coverageMin = coverageMin;
  }
  return parsed;
}

function parseThresholdMap(
  value: unknown,
  where: string,
  keyCheck: (key: string) => boolean,
): Record<string, Partial<EvalThresholds>> {
  const record = asRecord(value, where);
  const parsed: Record<string, Partial<EvalThresholds>> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!keyCheck(key)) invalid(`${where} has an unknown key "${key}"`);
    parsed[key] = parseThresholdValues(entry, `${where}["${key}"]`);
  }
  return parsed;
}

export function parseThresholds(input: unknown, source = "thresholds"): ThresholdFile {
  const record = asRecord(input, source);
  for (const key of Object.keys(record)) {
    if (!["default", "byLanguage", "byTag", "byClip", "gold"].includes(key)) {
      invalid(`${source}.${key} is not known (default, byLanguage, byTag, byClip, gold)`);
    }
  }
  const file: ThresholdFile = {};
  if (record.default !== undefined) file.default = parseThresholdValues(record.default, `${source}.default`);
  if (record.byLanguage !== undefined) {
    const raw = asRecord(record.byLanguage, `${source}.byLanguage`);
    const byLanguage: Partial<Record<CaptionLanguage, Partial<EvalThresholds>>> = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (!isLanguage(key)) invalid(`${source}.byLanguage has an unknown language "${key}"`);
      byLanguage[key] = parseThresholdValues(entry, `${source}.byLanguage["${key}"]`);
    }
    file.byLanguage = byLanguage;
  }
  if (record.byTag !== undefined) file.byTag = parseThresholdMap(record.byTag, `${source}.byTag`, () => true);
  if (record.byClip !== undefined) file.byClip = parseThresholdMap(record.byClip, `${source}.byClip`, () => true);
  // Only set the section when it exists, so callers can tell "not configured" from "explicitly
  // configured with the defaults".
  if (record.gold !== undefined) file.gold = parseGoldThresholds(record.gold, `${source}.gold`);
  return file;
}

/** Effective limits for one clip. Missing sections simply do not contribute. */
export function resolveThresholds(file: ThresholdFile | null | undefined, clip: EvalClip): EvalThresholds {
  const layers: Array<Partial<EvalThresholds> | undefined> = [file?.default, file?.byLanguage?.[clip.language]];
  for (const tag of clip.tags ?? []) layers.push(file?.byTag?.[tag]);
  layers.push(file?.byClip?.[clip.id]);

  const resolved: EvalThresholds = { ...DEFAULT_THRESHOLDS };
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.werMax !== undefined) resolved.werMax = layer.werMax;
    if (layer.timingMaeMsMax !== undefined) resolved.timingMaeMsMax = layer.timingMaeMsMax;
    if (layer.coverageMin !== undefined) resolved.coverageMin = layer.coverageMin;
  }
  return resolved;
}

// ---------------------------------------------------------------- scoring

export type ThresholdMetric = "wer" | "timingMae" | "coverage";

export interface ThresholdFailure {
  metric: ThresholdMetric;
  /** Measured value. Null only for a metric that could not be measured. */
  actual: number | null;
  limit: number;
  rule: "max" | "min";
}

export interface ClipMetrics {
  wer: WerResult;
  timing: TimingMetrics;
  /** Null when the manifest has no speech intervals: coverage would otherwise be a fake 1. */
  coverage: CoverageReport | null;
}

export interface ClipResult {
  id: string;
  language: CaptionLanguage;
  tags: string[];
  thresholds: EvalThresholds;
  /** False when there was no hypothesis for this clip. */
  scored: boolean;
  metrics: ClipMetrics | null;
  failures: ThresholdFailure[];
  /** Why a metric was skipped. Informational, never a failure on its own. */
  notes: string[];
  pass: boolean;
}

function compare(metric: ThresholdMetric, rule: "max" | "min", actual: number, limit: number): ThresholdFailure | null {
  const violated = rule === "max" ? actual > limit : actual < limit;
  return violated ? { metric, rule, actual, limit } : null;
}

export function evaluateClip(
  clip: EvalClip,
  hypothesis: { words: readonly Word[] } | undefined,
  thresholds: EvalThresholds,
): ClipResult {
  const tags = clip.tags ?? [];
  const base: Omit<ClipResult, "scored" | "metrics" | "failures" | "notes" | "pass"> = {
    id: clip.id,
    language: clip.language,
    tags,
    thresholds,
  };

  if (hypothesis === undefined) {
    return {
      ...base,
      scored: false,
      metrics: null,
      failures: [],
      notes: ["no hypothesis for this clip"],
      pass: false,
    };
  }

  const words = hypothesis.words;
  const wer = wordErrorRate(
    clip.reference,
    words.map((word) => word.text),
  );
  const referenceWords = clip.referenceWords ?? [];
  const timing = timingError(words, referenceWords);
  const coverage = coverageOf(words, clip.speech ?? []);

  const notes: string[] = [];
  if (referenceWords.length === 0) {
    notes.push("timing skipped: manifest has no referenceWords");
  } else if (timing.matched === 0) {
    notes.push("timing skipped: no words matched the reference");
  } else if (timing.offset.maeMs === null) {
    notes.push("offset skipped: reference words have no endMs");
  }
  if (coverage === null) notes.push("coverage skipped: manifest has no speech intervals");

  const failures: ThresholdFailure[] = [];
  const werFailure = compare("wer", "max", wer.wer, thresholds.werMax);
  if (werFailure) failures.push(werFailure);

  const mae = timing.boundary.maeMs;
  if (mae !== null) {
    const timingFailure = compare("timingMae", "max", mae, thresholds.timingMaeMsMax);
    if (timingFailure) failures.push(timingFailure);
  }
  if (coverage !== null) {
    const coverageFailure = compare("coverage", "min", coverage.coverage, thresholds.coverageMin);
    if (coverageFailure) failures.push(coverageFailure);
  }

  return {
    ...base,
    scored: true,
    metrics: { wer, timing, coverage },
    failures,
    notes,
    pass: failures.length === 0,
  };
}

export interface LanguageSummary {
  language: CaptionLanguage;
  /** Scored clips with this language. */
  clips: number;
  /** Pooled reference words: summing matters, averaging clip WERs would weight a one-word clip like a paragraph. */
  refWords: number;
  errors: number;
  wer: number;
  /** Unweighted mean of the clips that could measure timing. */
  meanTimingMaeMs: number | null;
  /** Unweighted mean of the clips that could measure coverage. */
  meanCoverage: number | null;
}

export interface RunReport {
  schemaVersion: 1;
  pass: boolean;
  clips: ClipResult[];
  /** Clip ids present in the manifest but absent from the hypothesis file. Each one fails its clip. */
  missingClips: string[];
  /** Hypothesis ids the manifest does not know. Ignored for scoring, reported so typos are visible. */
  unknownClips: string[];
  summary: {
    clips: number;
    scored: number;
    passed: number;
    failed: number;
    missing: number;
  };
  byLanguage: LanguageSummary[];
}

function summariseLanguages(clips: readonly ClipResult[]): LanguageSummary[] {
  const summaries: LanguageSummary[] = [];
  for (const language of LANGUAGES) {
    const scored = clips.filter((clip) => clip.scored && clip.language === language);
    if (scored.length === 0) continue;

    let refWords = 0;
    let errors = 0;
    const maes: number[] = [];
    const coverages: number[] = [];
    for (const clip of scored) {
      if (!clip.metrics) continue;
      refWords += clip.metrics.wer.refWords;
      errors += clip.metrics.wer.errors;
      if (clip.metrics.timing.boundary.maeMs !== null) maes.push(clip.metrics.timing.boundary.maeMs);
      if (clip.metrics.coverage !== null) coverages.push(clip.metrics.coverage.coverage);
    }
    summaries.push({
      language,
      clips: scored.length,
      refWords,
      errors,
      wer: refWords === 0 ? (errors === 0 ? 0 : 1) : errors / refWords,
      meanTimingMaeMs: maes.length === 0 ? null : maes.reduce((sum, value) => sum + value, 0) / maes.length,
      meanCoverage: coverages.length === 0 ? null : coverages.reduce((sum, value) => sum + value, 0) / coverages.length,
    });
  }
  return summaries;
}

export function evaluateRun(
  manifest: ClipsManifest,
  hypothesis: HypothesisFile,
  thresholds: ThresholdFile | null = null,
): RunReport {
  const clips = manifest.clips.map((clip) =>
    evaluateClip(clip, hypothesis[clip.id], resolveThresholds(thresholds, clip)),
  );
  const manifestIds = new Set(manifest.clips.map((clip) => clip.id));
  const missingClips = clips.filter((clip) => !clip.scored).map((clip) => clip.id);
  const unknownClips = Object.keys(hypothesis)
    .filter((id) => !manifestIds.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const scored = clips.filter((clip) => clip.scored).length;
  const passed = clips.filter((clip) => clip.pass).length;

  return {
    schemaVersion: 1,
    pass: clips.length > 0 && passed === clips.length,
    clips,
    missingClips,
    unknownClips,
    summary: {
      clips: clips.length,
      scored,
      passed,
      failed: clips.length - passed,
      missing: missingClips.length,
    },
    byLanguage: summariseLanguages(clips),
  };
}

// ---------------------------------------------------------------- presentation

function padCell(value: string, width: number): string {
  if (value.length > width) return `${value.slice(0, width - 1)}~`;
  return value.padEnd(width, " ");
}

function numberCell(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

/**
 * Fixed-width text table for the CLI. Deterministic: no clock, no colour, no locale formatting, so
 * a test can assert on it and a CI log diffs cleanly.
 */
export function renderTable(report: RunReport): string {
  const lines: string[] = [];
  lines.push(
    [
      padCell("clip", 26),
      padCell("lang", 9),
      padCell("ref", 5),
      padCell("hyp", 5),
      padCell("wer", 6),
      padCell("S/D/I", 9),
      padCell("mae", 8),
      padCell("p90", 8),
      padCell("cov", 6),
      "result",
    ].join(" "),
  );
  lines.push("-".repeat(26 + 9 + 5 + 5 + 6 + 9 + 8 + 8 + 6 + 6 + 9));

  for (const clip of report.clips) {
    const metrics = clip.metrics;
    lines.push(
      [
        padCell(clip.id, 26),
        padCell(clip.language, 9),
        padCell(metrics ? String(metrics.wer.refWords) : "-", 5),
        padCell(metrics ? String(metrics.wer.hypWords) : "-", 5),
        padCell(metrics ? numberCell(metrics.wer.wer, 3) : "-", 6),
        padCell(
          metrics ? `${metrics.wer.substitutions}/${metrics.wer.deletions}/${metrics.wer.insertions}` : "-",
          9,
        ),
        padCell(metrics ? numberCell(metrics.timing.boundary.maeMs, 1) : "-", 8),
        padCell(metrics ? numberCell(metrics.timing.boundary.p90Ms, 1) : "-", 8),
        padCell(metrics?.coverage ? numberCell(metrics.coverage.coverage, 3) : "-", 6),
        clip.pass ? "PASS" : "FAIL",
      ].join(" "),
    );
  }

  lines.push("");
  const { summary } = report;
  lines.push(
    `clips ${summary.clips} | scored ${summary.scored} | passed ${summary.passed} | failed ${summary.failed} | missing ${summary.missing}`,
  );
  for (const language of report.byLanguage) {
    lines.push(
      `  ${padCell(language.language, 8)} clips ${language.clips}  pooled WER ${numberCell(language.wer, 3)}` +
        `  MAE ${numberCell(language.meanTimingMaeMs, 1)} ms  coverage ${numberCell(language.meanCoverage, 3)}`,
    );
  }
  if (report.unknownClips.length > 0) {
    lines.push(`  unknown hypothesis clips: ${report.unknownClips.join(", ")}`);
  }
  for (const clip of report.clips) {
    for (const note of clip.notes) lines.push(`  note ${clip.id}: ${note}`);
    for (const failure of clip.failures) {
      const rule = failure.rule === "max" ? "<=" : ">=";
      lines.push(
        `  fail ${clip.id}: ${failure.metric} ${numberCell(failure.actual, 3)} (limit ${rule} ${failure.limit})`,
      );
    }
  }
  return `${lines.map((line) => line.trimEnd()).join("\n")}\n`;
}

/** JSON for `eval-results.json`. No undefined, NaN or Infinity can appear in the report, so this is valid JSON. */
export function reportToJson(report: RunReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
