import { CaptionError } from "../contracts";
import type { Word } from "../types";
import { timingError, type ErrorStats } from "./timing";
import { normalizeForWer, tokenizeForWer, wordErrorRate } from "./wer";

/**
 * Scoring for the real Hinglish / Hindi / English gold set (task 0A).
 *
 * WHY a second scorer instead of extending the MVP one: the gold set has several human transcripts
 * per clip (spelling variants are accepted), clips that must stay silent, and hand-checked word
 * times. Taking the best reference changes the number enough that it must be reported separately
 * from the plain first-reference WER, otherwise a model looks worse only because the reference used
 * a spelling the human did not.
 *
 * Everything here is pure: no file is opened, no media is decoded, no clock is read. The CLI in
 * `scripts/eval/gold-score.mjs` is argument parsing and file IO around these functions, so tests,
 * CI and (later) an in-app quality panel share the exact same formulas.
 *
 * The report is deterministic on purpose: no timestamps, no absolute paths, no locale formatting,
 * so two runs on the same inputs diff cleanly and a test can assert on the exact numbers.
 */

// ---------------------------------------------------------------- vocabulary

/**
 * The only tags a gold clip may carry. A fixed list keeps aggregation charts honest: "noisey" and
 * "noisy" must not become two rows, and a typo in a tag would otherwise silently disable its
 * threshold. Order is the report order for tags.
 */
export const GOLD_TAGS = [
  "clean",
  "noisy",
  "child",
  "fast",
  "code-switch",
  "english-heavy",
  "hindi-heavy",
  "phone",
  "music",
  "silence",
  "long-pause",
] as const;

export type GoldTag = (typeof GOLD_TAGS)[number];

/** Fixed release gate from the v3 plan: "no clip > 50%". Not configurable by accident. */
export const HARD_CLIP_WER_LIMIT = 0.5;

/** Input that cannot be scored. Same frozen error type the rest of the eval track uses. */
function invalid(message: string): never {
  throw new CaptionError("unsupported-file", `invalid gold input: ${message}`);
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

function asMilliseconds(value: unknown, where: string): number {
  const parsed = asFinite(value, where);
  if (!Number.isInteger(parsed)) invalid(`${where} must be whole milliseconds`);
  if (parsed < 0) invalid(`${where} must not be negative`);
  return parsed;
}

function asNonNegative(value: unknown, where: string): number {
  const parsed = asFinite(value, where);
  if (parsed < 0) invalid(`${where} must not be negative`);
  return parsed;
}

function asCount(value: unknown, where: string): number {
  const parsed = asFinite(value, where);
  if (!Number.isInteger(parsed) || parsed < 0) invalid(`${where} must be a non-negative integer`);
  return parsed;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) invalid(`${where}.${key} is not a known field (${allowed.join(", ")})`);
  }
}

function isGoldTag(value: string): value is GoldTag {
  return (GOLD_TAGS as readonly string[]).includes(value);
}

function hasScoreableWords(text: string): boolean {
  return tokenizeForWer(text).some((token) => normalizeForWer(token).length > 0);
}

/** Words that carry letters/digits after normalisation. Punctuation-only emissions are not words. */
function scoreableWordCount(words: readonly { text: string }[]): number {
  let count = 0;
  for (const word of words) if (normalizeForWer(word.text).length > 0) count += 1;
  return count;
}

// ---------------------------------------------------------------- gold manifest

/** One hand-checked word time. All times are integer milliseconds, as the frozen types require. */
export interface GoldWordTime {
  text: string;
  startMs: number;
  endMs?: number;
}

export interface GoldClip {
  /** Stable id; also the key in the hypotheses file. */
  id: string;
  /** Local media path. Informational only: the scorer never opens media and this path must stay out of git. */
  path: string;
  tags: GoldTag[];
  /**
   * One or more acceptable transcripts. `references[0]` is the primary: plain WER uses it and
   * `wordTimes` must spell it. The score is the minimum WER over every reference.
   */
  references: string[];
  /** Optional hand-checked timings for `references[0]`. Enables the timing metrics. */
  wordTimes?: GoldWordTime[];
  /** True for silence/music clips: the only correct output is zero words. WER is not scored. */
  expectNoWords: boolean;
}

export interface GoldManifest {
  version?: number;
  /** Free text shown at the top of the report (for example "example data, not real audio"). */
  notes?: string;
  clips: GoldClip[];
}

const MANIFEST_KEYS = ["version", "notes", "clips"] as const;
const CLIP_KEYS = ["id", "path", "tags", "references", "wordTimes", "expectNoWords"] as const;
const WORD_TIME_KEYS = ["text", "startMs", "endMs"] as const;

function parseTags(value: unknown, where: string): GoldTag[] {
  const tags = asArray(value, where).map((entry, index) => {
    const tag = asString(entry, `${where}[${index}]`);
    if (!isGoldTag(tag)) invalid(`${where}[${index}] "${tag}" is not one of ${GOLD_TAGS.join(", ")}`);
    return tag;
  });
  // De-duplicate in first-seen order so writing "fast, clean, fast" does not double-count a clip.
  return [...new Set(tags)];
}

function parseReferences(value: unknown, where: string, expectNoWords: boolean): string[] {
  if (value === undefined) {
    if (expectNoWords) return [];
    invalid(`${where} is required (at least one acceptable transcript)`);
  }
  const references = asArray(value, where).map((entry, index) => asString(entry, `${where}[${index}]`));

  if (expectNoWords) {
    // A clip that must stay silent has nothing to transcribe. Accepting text here would hide a
    // copy-paste mistake and make the hallucination check meaningless.
    if (references.length > 0) invalid(`${where} must be empty when expectNoWords is true`);
    return [];
  }

  if (references.length === 0) invalid(`${where} must contain at least one transcript`);
  references.forEach((reference, index) => {
    if (!hasScoreableWords(reference)) invalid(`${where}[${index}] has no words to score`);
  });
  return references;
}

function parseWordTime(value: unknown, where: string): GoldWordTime {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, WORD_TIME_KEYS, where);
  const text = asString(record.text, `${where}.text`);
  const startMs = asMilliseconds(record.startMs, `${where}.startMs`);
  if (record.endMs === undefined) return { text, startMs };
  const endMs = asMilliseconds(record.endMs, `${where}.endMs`);
  if (endMs < startMs) invalid(`${where}.endMs must not be before startMs`);
  return { text, startMs, endMs };
}

function parseGoldClip(value: unknown, where: string, seenIds: Set<string>): GoldClip {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, CLIP_KEYS, where);

  const id = asString(record.id, `${where}.id`);
  if (seenIds.has(id)) invalid(`${where}.id "${id}" is used twice`);
  seenIds.add(id);

  const path = asString(record.path, `${where}.path`);
  const tags = parseTags(record.tags, `${where}.tags`);

  let expectNoWords = false;
  if (record.expectNoWords !== undefined) {
    if (typeof record.expectNoWords !== "boolean") invalid(`${where}.expectNoWords must be true or false`);
    expectNoWords = record.expectNoWords;
  }
  if (expectNoWords && !tags.some((tag) => tag === "silence" || tag === "music")) {
    invalid(`${where}.expectNoWords needs a "silence" or "music" tag, so a mislabelled speech clip is caught`);
  }

  const references = parseReferences(record.references, `${where}.references`, expectNoWords);
  const clip: GoldClip = { id, path, tags, references, expectNoWords };

  if (record.wordTimes !== undefined) {
    if (expectNoWords) invalid(`${where}.wordTimes makes no sense when expectNoWords is true`);
    const entries = asArray(record.wordTimes, `${where}.wordTimes`);
    if (entries.length === 0) invalid(`${where}.wordTimes is empty (remove it to skip timing)`);
    const wordTimes = entries.map((entry, index) => parseWordTime(entry, `${where}.wordTimes[${index}]`));

    // Word times belong to the primary reference. A fixture timed for a different sentence would
    // score the wrong timings silently, so reject it with the same normaliser used for scoring.
    const consistency = wordErrorRate(
      references[0],
      wordTimes.map((word) => word.text),
    );
    if (consistency.errors > 0 || consistency.refWords !== consistency.hypWords) {
      invalid(
        `${where}.wordTimes do not spell references[0] ` +
          `(${consistency.errors} edit(s) after normalisation)`,
      );
    }
    clip.wordTimes = wordTimes;
  }

  return clip;
}

export function parseGoldManifest(input: unknown, source = "gold manifest"): GoldManifest {
  const record = asRecord(input, source);
  rejectUnknownKeys(record, MANIFEST_KEYS, source);

  if (record.notes !== undefined && typeof record.notes !== "string") {
    invalid(`${source}.notes must be a string`);
  }
  const clips = asArray(record.clips, `${source}.clips`);
  if (clips.length === 0) invalid(`${source}.clips is empty; nothing would be measured`);

  const seenIds = new Set<string>();
  const parsed = clips.map((entry, index) => parseGoldClip(entry, `${source}.clips[${index}]`, seenIds));

  const manifest: GoldManifest = { clips: parsed };
  if (record.version !== undefined) manifest.version = asFinite(record.version, `${source}.version`);
  if (record.notes !== undefined) manifest.notes = record.notes as string;
  return manifest;
}

// ---------------------------------------------------------------- hypotheses

export interface GoldHypothesisClip {
  words: Word[];
  /** Wall-clock seconds the pipeline took for this clip, if the caller measured it. */
  seconds: number | null;
}

export interface GoldHypothesis {
  model: string;
  backend: string;
  device: string;
  clips: Record<string, GoldHypothesisClip>;
}

const HYPOTHESIS_KEYS = ["model", "backend", "device", "clips"] as const;
const HYPOTHESIS_CLIP_KEYS = ["words", "seconds"] as const;
const HYPOTHESIS_WORD_KEYS = ["text", "startMs", "endMs", "confidence", "index", "windowIndex", "inferred"] as const;

function parseHypothesisWord(value: unknown, where: string, position: number): Word {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, HYPOTHESIS_WORD_KEYS, where);

  const text = asString(record.text, `${where}.text`);
  const startMs = asMilliseconds(record.startMs, `${where}.startMs`);
  const endMs = asMilliseconds(record.endMs, `${where}.endMs`);
  if (endMs < startMs) invalid(`${where}.endMs must not be before startMs`);

  let confidence = 1;
  if (record.confidence !== undefined) {
    confidence = asFinite(record.confidence, `${where}.confidence`);
    if (confidence < 0 || confidence > 1) invalid(`${where}.confidence must be between 0 and 1`);
  }
  let index = position;
  if (record.index !== undefined) index = asCount(record.index, `${where}.index`);
  let windowIndex = 0;
  if (record.windowIndex !== undefined) windowIndex = asCount(record.windowIndex, `${where}.windowIndex`);
  // Song mode may copy a word from a repeated section; the flag is optional in files written before that existed.
  let inferred: boolean | undefined;
  if (record.inferred !== undefined) {
    if (typeof record.inferred !== "boolean") invalid(`${where}.inferred must be true or false`);
    if (record.inferred) inferred = true;
  }

  return { text, startMs, endMs, confidence, index, windowIndex, ...(inferred === undefined ? {} : { inferred }) };
}

/**
 * Reads `{ model, backend, device, clips: { [id]: { words, seconds } } }`.
 *
 * The three identity strings are required: a WER number without the model, execution provider and
 * device it came from is not evidence, and the report promises all three.
 */
export function parseGoldHypothesisFile(input: unknown, source = "gold hypotheses file"): GoldHypothesis {
  const record = asRecord(input, source);
  rejectUnknownKeys(record, HYPOTHESIS_KEYS, source);

  const model = asString(record.model, `${source}.model`);
  const backend = asString(record.backend, `${source}.backend`);
  const device = asString(record.device, `${source}.device`);

  const rawClips = asRecord(record.clips, `${source}.clips`);
  // A null prototype means a clip id such as "constructor" or "__proto__" cannot read an inherited
  // property instead of the caller's entry.
  const clips: Record<string, GoldHypothesisClip> = Object.create(null) as Record<string, GoldHypothesisClip>;

  for (const [clipId, value] of Object.entries(rawClips)) {
    if (clipId.length === 0) invalid(`${source}.clips has an empty clip id`);
    const where = `${source}.clips["${clipId}"]`;
    const entry = asRecord(value, where);
    rejectUnknownKeys(entry, HYPOTHESIS_CLIP_KEYS, where);

    const words = asArray(entry.words, `${where}.words`).map((word, position) =>
      parseHypothesisWord(word, `${where}.words[${position}]`, position),
    );

    let seconds: number | null = null;
    if (entry.seconds !== undefined && entry.seconds !== null) {
      seconds = asNonNegative(entry.seconds, `${where}.seconds`);
    }
    clips[clipId] = { words, seconds };
  }

  return { model, backend, device, clips };
}

// ---------------------------------------------------------------- thresholds

export interface GoldTagThresholds {
  /** Largest acceptable mean OIWER for clips carrying this tag, inclusive. */
  meanWerMax: number;
}

export interface GoldThresholds {
  /** Largest acceptable unweighted mean OIWER across scored clips, inclusive. */
  meanWerMax: number;
  /** Largest acceptable single-clip OIWER, inclusive. Default is the fixed 0.5 release gate. */
  clipWerMax: number;
  /** Largest acceptable boundary MAE in ms for a clip with wordTimes, inclusive. */
  timingMaeMsMax: number;
  /** Largest number of words a single expectNoWords clip may produce, inclusive. */
  hallucinatedWordsMax: number;
  /** Optional tighter mean-WER limits per tag. Only tags that appear in the manifest are applied. */
  byTag: Readonly<Record<string, GoldTagThresholds>>;
}

/**
 * Defaults from the v3 plan: mean WER <= 0.25, no clip above the 0.5 release gate, karaoke timing
 * MAE <= 120 ms, and zero invented words on silence/music. A thresholds file can tighten them.
 */
export const DEFAULT_GOLD_THRESHOLDS: GoldThresholds = Object.freeze({
  meanWerMax: 0.25,
  clipWerMax: HARD_CLIP_WER_LIMIT,
  timingMaeMsMax: 120,
  hallucinatedWordsMax: 0,
  byTag: Object.freeze({} as Record<string, GoldTagThresholds>),
});

const GOLD_THRESHOLD_KEYS = [
  "meanWerMax",
  "clipWerMax",
  "timingMaeMsMax",
  "hallucinatedWordsMax",
  "byTag",
] as const;

/**
 * Parses the `gold` section of `scripts/eval/thresholds.json`. Absent sections fall back to the
 * documented defaults, so an older thresholds file (with no gold key) keeps working unchanged.
 */
export function parseGoldThresholds(input: unknown, source = "gold thresholds"): GoldThresholds {
  const meanWerMax = DEFAULT_GOLD_THRESHOLDS.meanWerMax;
  const clipWerMax = DEFAULT_GOLD_THRESHOLDS.clipWerMax;
  const timingMaeMsMax = DEFAULT_GOLD_THRESHOLDS.timingMaeMsMax;
  const hallucinatedWordsMax = DEFAULT_GOLD_THRESHOLDS.hallucinatedWordsMax;

  if (input === undefined) {
    return { meanWerMax, clipWerMax, timingMaeMsMax, hallucinatedWordsMax, byTag: {} };
  }

  const record = asRecord(input, source);
  rejectUnknownKeys(record, GOLD_THRESHOLD_KEYS, source);

  const parsed: GoldThresholds = {
    meanWerMax: record.meanWerMax === undefined ? meanWerMax : asNonNegative(record.meanWerMax, `${source}.meanWerMax`),
    clipWerMax: record.clipWerMax === undefined ? clipWerMax : asNonNegative(record.clipWerMax, `${source}.clipWerMax`),
    timingMaeMsMax:
      record.timingMaeMsMax === undefined ? timingMaeMsMax : asNonNegative(record.timingMaeMsMax, `${source}.timingMaeMsMax`),
    hallucinatedWordsMax:
      record.hallucinatedWordsMax === undefined
        ? hallucinatedWordsMax
        : asCount(record.hallucinatedWordsMax, `${source}.hallucinatedWordsMax`),
    byTag: {},
  };

  if (record.byTag !== undefined) {
    const byTag = asRecord(record.byTag, `${source}.byTag`);
    const parsedByTag: Record<string, GoldTagThresholds> = {};
    for (const [tag, entry] of Object.entries(byTag)) {
      if (!isGoldTag(tag)) invalid(`${source}.byTag has an unknown tag "${tag}"`);
      const where = `${source}.byTag["${tag}"]`;
      const limits = asRecord(entry, where);
      rejectUnknownKeys(limits, ["meanWerMax"], where);
      if (limits.meanWerMax === undefined) invalid(`${where}.meanWerMax is required`);
      parsedByTag[tag] = { meanWerMax: asNonNegative(limits.meanWerMax, `${where}.meanWerMax`) };
    }
    parsed.byTag = parsedByTag;
  }

  return parsed;
}

// ---------------------------------------------------------------- metrics

export interface GoldReferenceStats {
  refWords: number;
  hypWords: number;
  errors: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}

export interface GoldWerMetrics extends GoldReferenceStats {
  /** Oracle WER: the minimum WER over every accepted reference. */
  oiwer: number;
  /** Plain WER against `references[0]`, reported so a variant-heavy reference cannot hide errors. */
  plainWer: number;
  /** Index of the reference that produced `oiwer`; the first one wins a tie. */
  bestReference: number;
  /** WER against each reference, in manifest order. */
  referenceWers: number[];
}

export interface GoldHallucinationMetrics {
  expectNoWords: boolean;
  /** Words emitted by the hypothesis that contain letters or digits after normalisation. */
  wordsProduced: number;
  /** True whenever any word was produced: the gold contract for these clips is exactly zero. */
  hallucinated: boolean;
}

export interface GoldTimingMetrics {
  matched: number;
  unusable: number;
  boundary: ErrorStats;
  /** Mean |hypothesis start - reference start| in ms: the karaoke highlight switch error. */
  karaokeSwitchErrorMs: number | null;
  /** Reference words the WER aligner could not match to any hypothesis word (deletions). */
  neverMatchedWords: number;
  /** Hypothesis words with no reference word (insertions), useful next to neverMatchedWords. */
  extraWords: number;
  /** Signed onset bias in ms; positive means the hypothesis is late. */
  onsetBiasMs: number | null;
}

export type GoldMetric = "missing" | "meanWer" | "clipWer" | "tagWer" | "timingMae" | "hallucinatedWords";

export interface GoldFailure {
  metric: GoldMetric;
  scope: "run" | "clip" | "tag";
  /** Clip id for scope "clip", tag for scope "tag", null for a run-wide limit. */
  target: string | null;
  /** Measured value; null for a missing hypothesis because nothing was measured. */
  actual: number | null;
  /** Inclusive limit; null only for the non-numeric "missing" failure. */
  limit: number | null;
  rule: "max";
}

export interface GoldClipResult {
  id: string;
  path: string;
  tags: GoldTag[];
  expectNoWords: boolean;
  scored: boolean;
  wer: GoldWerMetrics | null;
  hallucination: GoldHallucinationMetrics | null;
  timing: GoldTimingMetrics | null;
  seconds: number | null;
  /** Fixed release-gate flag: OIWER > 0.5, independent of the configurable clipWerMax limit. */
  hard: boolean;
  failures: GoldFailure[];
  notes: string[];
  pass: boolean;
}

export interface GoldTagSummary {
  tag: GoldTag;
  /** Scored clips carrying this tag, including expectNoWords clips. */
  clips: number;
  /** Scored clips carrying this tag that have a WER (all except expectNoWords clips). */
  werClips: number;
  meanWer: number | null;
  medianWer: number | null;
  p90Wer: number | null;
  /** Clips above the fixed 0.5 hard flag. */
  hardFailures: number;
}

export interface GoldSummary {
  clips: number;
  scored: number;
  missing: number;
  expectNoWords: number;
  /** Scored clips with a WER. */
  werClips: number;
  /** Unweighted mean of per-clip OIWER. */
  meanWer: number | null;
  medianWer: number | null;
  p90Wer: number | null;
  maxWer: number | null;
  /** Unweighted mean of per-clip WER against references[0]. */
  plainMeanWer: number | null;
  hardFailures: number;
  hallucinatedClips: number;
  hallucinatedWords: number;
  /** Sum of caller-provided `seconds`, or null when nobody measured them. */
  totalSeconds: number | null;
  meanSeconds: number | null;
}

export interface GoldReport {
  schemaVersion: 1;
  /** Identity supplied by whoever ran the pipeline; a number without these is not evidence. */
  model: string;
  backend: string;
  device: string;
  manifestNotes: string | null;
  pass: boolean;
  thresholds: GoldThresholds;
  summary: GoldSummary;
  clips: GoldClipResult[];
  byTag: GoldTagSummary[];
  /** Every clip above the fixed 0.5 gate, in manifest order. */
  hardFailures: Array<{ id: string; wer: number }>;
  missingClips: string[];
  /** Hypothesis ids the manifest does not know. Never scored; reported so a typo is visible. */
  unknownClips: string[];
  /** All failures: run-wide first, then tags in report order, then clips in manifest order. */
  failures: GoldFailure[];
}

// ---------------------------------------------------------------- statistics

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Linear-interpolation percentile (numpy's default), so a reported p90 matches a spreadsheet. */
function percentileOf(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function maxOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let maximum = values[0];
  for (const value of values) if (value > maximum) maximum = value;
  return maximum;
}

function clipFailure(metric: GoldMetric, target: string, actual: number, limit: number): GoldFailure {
  return { metric, scope: "clip", target, actual, limit, rule: "max" };
}

function missingFailure(target: string): GoldFailure {
  return { metric: "missing", scope: "clip", target, actual: null, limit: null, rule: "max" };
}

// ---------------------------------------------------------------- scoring

function scoreClipClipWers(clip: GoldClip, words: readonly Word[]): GoldWerMetrics {
  const hypTexts = words.map((word) => word.text);
  const results = clip.references.map((reference) => wordErrorRate(reference, hypTexts));

  let best = 0;
  for (let index = 1; index < results.length; index += 1) {
    // Strict "<" keeps the first reference on a tie, which keeps reports stable.
    if (results[index].wer < results[best].wer) best = index;
  }
  const chosen = results[best];
  return {
    oiwer: chosen.wer,
    plainWer: results[0].wer,
    bestReference: best,
    referenceWers: results.map((result) => result.wer),
    refWords: chosen.refWords,
    hypWords: chosen.hypWords,
    errors: chosen.errors,
    substitutions: chosen.substitutions,
    deletions: chosen.deletions,
    insertions: chosen.insertions,
  };
}

function scoreClipTiming(clip: GoldClip, words: readonly Word[]): GoldTimingMetrics {
  const reference = clip.wordTimes ?? [];
  const timing = timingError(words, reference);
  // timingError compares the same way internally; this second alignment is only to expose the
  // never-matched / extra word counts the plan asks for next to the timestamps.
  const alignment = wordErrorRate(
    reference.map((word) => word.text),
    words.map((word) => word.text),
  );
  return {
    matched: timing.matched,
    unusable: timing.unusable,
    boundary: timing.boundary,
    karaokeSwitchErrorMs: timing.onset.maeMs,
    neverMatchedWords: alignment.deletions,
    extraWords: alignment.insertions,
    onsetBiasMs: timing.onsetBiasMs,
  };
}

function scoreClip(clip: GoldClip, hypothesis: GoldHypothesisClip | undefined, thresholds: GoldThresholds): GoldClipResult {
  const base = {
    id: clip.id,
    path: clip.path,
    tags: clip.tags,
    expectNoWords: clip.expectNoWords,
  };

  // The parser guarantees this, but evaluateGoldRun is also a public pure API and a hand-built
  // clip without references would otherwise crash with an unhelpful undefined access.
  if (!clip.expectNoWords && clip.references.length === 0) {
    invalid(`clip "${clip.id}" has no reference transcripts`);
  }

  if (hypothesis === undefined) {
    return {
      ...base,
      scored: false,
      wer: null,
      hallucination: null,
      timing: null,
      seconds: null,
      hard: false,
      failures: [missingFailure(clip.id)],
      notes: ["no hypothesis for this clip"],
      pass: false,
    };
  }

  const failures: GoldFailure[] = [];
  const notes: string[] = [];

  if (clip.expectNoWords) {
    const wordsProduced = scoreableWordCount(hypothesis.words);
    const hallucination: GoldHallucinationMetrics = {
      expectNoWords: true,
      wordsProduced,
      hallucinated: wordsProduced > 0,
    };
    if (wordsProduced > thresholds.hallucinatedWordsMax) {
      failures.push(clipFailure("hallucinatedWords", clip.id, wordsProduced, thresholds.hallucinatedWordsMax));
    }
    notes.push("WER skipped: clip is marked expectNoWords");
    return {
      ...base,
      scored: true,
      wer: null,
      hallucination,
      timing: null,
      seconds: hypothesis.seconds,
      hard: false,
      failures,
      notes,
      pass: failures.length === 0,
    };
  }

  const wer = scoreClipClipWers(clip, hypothesis.words);
  if (hypothesis.words.length === 0) {
    notes.push("empty hypothesis: every reference word counts as a deletion");
  }
  if (wer.oiwer > thresholds.clipWerMax) {
    failures.push(clipFailure("clipWer", clip.id, wer.oiwer, thresholds.clipWerMax));
  }

  let timing: GoldTimingMetrics | null = null;
  if (clip.wordTimes === undefined) {
    notes.push("timing skipped: no wordTimes in the gold manifest");
  } else {
    timing = scoreClipTiming(clip, hypothesis.words);
    if (timing.matched === 0) notes.push("timing skipped: no hypothesis word matched the wordTimes");
    const mae = timing.boundary.maeMs;
    if (mae !== null && mae > thresholds.timingMaeMsMax) {
      failures.push(clipFailure("timingMae", clip.id, mae, thresholds.timingMaeMsMax));
    }
  }

  return {
    ...base,
    scored: true,
    wer,
    hallucination: null,
    timing,
    seconds: hypothesis.seconds,
    hard: wer.oiwer > HARD_CLIP_WER_LIMIT,
    failures,
    notes,
    pass: failures.length === 0,
  };
}

function summariseTags(
  manifest: GoldManifest,
  clips: readonly GoldClipResult[],
  thresholds: GoldThresholds,
): { summaries: GoldTagSummary[]; failures: GoldFailure[] } {
  const summaries: GoldTagSummary[] = [];
  const failures: GoldFailure[] = [];

  // Include a tag that appears anywhere in the manifest, even if all its clips are missing: a zero
  // clip count is information, not a reason to hide the tag.
  const tagsInManifest = GOLD_TAGS.filter((tag) => manifest.clips.some((clip) => clip.tags.includes(tag)));

  for (const tag of tagsInManifest) {
    const tagged = clips.filter((clip) => clip.scored && clip.tags.includes(tag));
    const werValues = tagged.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.oiwer]));
    const summary: GoldTagSummary = {
      tag,
      clips: tagged.length,
      werClips: werValues.length,
      meanWer: meanOf(werValues),
      medianWer: percentileOf(werValues, 0.5),
      p90Wer: percentileOf(werValues, 0.9),
      hardFailures: tagged.filter((clip) => clip.hard).length,
    };
    summaries.push(summary);

    const limit = thresholds.byTag[tag];
    if (limit && summary.meanWer !== null && summary.meanWer > limit.meanWerMax) {
      failures.push({
        metric: "tagWer",
        scope: "tag",
        target: tag,
        actual: summary.meanWer,
        limit: limit.meanWerMax,
        rule: "max",
      });
    }
  }

  return { summaries, failures };
}

/**
 * Scores every clip, aggregates by tag, and applies the gold thresholds. Pure and deterministic.
 */
export function evaluateGoldRun(
  manifest: GoldManifest,
  hypothesis: GoldHypothesis,
  thresholds: Readonly<GoldThresholds> = DEFAULT_GOLD_THRESHOLDS,
): GoldReport {
  const clips = manifest.clips.map((clip) => scoreClip(clip, hypothesis.clips[clip.id], thresholds));
  const manifestIds = new Set(manifest.clips.map((clip) => clip.id));
  const unknownClips = Object.keys(hypothesis.clips)
    .filter((id) => !manifestIds.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const missingClips = clips.filter((clip) => !clip.scored).map((clip) => clip.id);

  const werValues = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.oiwer]));
  const plainWerValues = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.plainWer]));
  const secondsValues = clips.flatMap((clip) => (clip.seconds === null ? [] : [clip.seconds]));
  const hallucinationClips = clips.flatMap((clip) => (clip.hallucination === null ? [] : [clip.hallucination]));

  const summary: GoldSummary = {
    clips: clips.length,
    scored: clips.filter((clip) => clip.scored).length,
    missing: missingClips.length,
    expectNoWords: manifest.clips.filter((clip) => clip.expectNoWords).length,
    werClips: werValues.length,
    meanWer: meanOf(werValues),
    medianWer: percentileOf(werValues, 0.5),
    p90Wer: percentileOf(werValues, 0.9),
    maxWer: maxOf(werValues),
    plainMeanWer: meanOf(plainWerValues),
    hardFailures: clips.filter((clip) => clip.hard).length,
    hallucinatedClips: hallucinationClips.filter((entry) => entry.hallucinated).length,
    hallucinatedWords: hallucinationClips.reduce((total, entry) => total + entry.wordsProduced, 0),
    totalSeconds: meanOf(secondsValues) === null ? null : secondsValues.reduce((total, value) => total + value, 0),
    meanSeconds: meanOf(secondsValues),
  };

  const runFailures: GoldFailure[] = [];
  if (summary.meanWer !== null && summary.meanWer > thresholds.meanWerMax) {
    runFailures.push({
      metric: "meanWer",
      scope: "run",
      target: null,
      actual: summary.meanWer,
      limit: thresholds.meanWerMax,
      rule: "max",
    });
  }

  const tags = summariseTags(manifest, clips, thresholds);
  const failures = [...runFailures, ...tags.failures, ...clips.flatMap((clip) => clip.failures)];

  return {
    schemaVersion: 1,
    model: hypothesis.model,
    backend: hypothesis.backend,
    device: hypothesis.device,
    manifestNotes: manifest.notes ?? null,
    pass: manifest.clips.length > 0 && failures.length === 0,
    thresholds: {
      meanWerMax: thresholds.meanWerMax,
      clipWerMax: thresholds.clipWerMax,
      timingMaeMsMax: thresholds.timingMaeMsMax,
      hallucinatedWordsMax: thresholds.hallucinatedWordsMax,
      byTag: { ...thresholds.byTag },
    },
    summary,
    clips,
    byTag: tags.summaries,
    hardFailures: clips.flatMap((clip) =>
      clip.hard && clip.wer !== null ? [{ id: clip.id, wer: clip.wer.oiwer }] : [],
    ),
    missingClips,
    unknownClips,
    failures,
  };
}

// ---------------------------------------------------------------- presentation

function markdownNumber(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

/** Escapes text that would otherwise break a markdown table cell. */
function markdownText(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function resultCell(pass: boolean): string {
  return pass ? "PASS" : "FAIL";
}

function failureLine(failure: GoldFailure): string {
  const where =
    failure.scope === "run" ? "run" : `${failure.scope} \`${markdownText(failure.target ?? "")}\``;
  if (failure.metric === "missing") return `- ${where}: missing (no hypothesis)`;
  const unit = failure.metric === "timingMae" ? " ms" : "";
  return `- ${where}: ${failure.metric} ${markdownNumber(failure.actual, 3)}${unit} (limit <= ${
    failure.limit === null ? "-" : `${failure.limit}${unit}`
  })`;
}

/**
 * Human-readable report. Deterministic (no clock, no environment) so it can be archived and diffed.
 * The JSON report is the machine-readable contract; this is the same information for a reviewer.
 */
export function renderGoldMarkdown(report: GoldReport): string {
  const { summary } = report;
  const lines: string[] = [];

  lines.push("# Caption gold-set report", "");
  lines.push(`- Model: \`${markdownText(report.model)}\``);
  lines.push(`- Backend: \`${markdownText(report.backend)}\``);
  lines.push(`- Device: \`${markdownText(report.device)}\``);
  lines.push(
    `- Clips: ${summary.clips} total, ${summary.scored} scored, ${summary.missing} missing`,
  );
  lines.push(`- Verdict: **${report.pass ? "PASS" : "FAIL"}**`);
  lines.push("");

  if (report.manifestNotes !== null) {
    lines.push(`> ${markdownText(report.manifestNotes)}`, "");
  }

  lines.push("## Summary", "");
  lines.push("| metric | value |");
  lines.push("| --- | --- |");
  lines.push(`| mean OIWER (best reference) | ${markdownNumber(summary.meanWer, 3)} |`);
  lines.push(`| median OIWER | ${markdownNumber(summary.medianWer, 3)} |`);
  lines.push(`| p90 OIWER | ${markdownNumber(summary.p90Wer, 3)} |`);
  lines.push(`| max OIWER | ${markdownNumber(summary.maxWer, 3)} |`);
  lines.push(`| mean WER vs references[0] | ${markdownNumber(summary.plainMeanWer, 3)} |`);
  lines.push(`| clips with WER | ${summary.werClips} |`);
  lines.push(`| hard failures (OIWER > ${HARD_CLIP_WER_LIMIT}) | ${summary.hardFailures} |`);
  lines.push(`| hallucinated clips | ${summary.hallucinatedClips} |`);
  lines.push(`| hallucinated words | ${summary.hallucinatedWords} |`);
  lines.push(`| total audio scored (s) | ${markdownNumber(summary.totalSeconds, 1)} |`);
  lines.push("");

  lines.push("## Clips", "");
  lines.push(
    "| clip | tags | refs | OIWER | plain WER | boundary MAE | p90 | karaoke | never matched | words | hard | result |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const clip of report.clips) {
    const wer = clip.wer;
    const timing = clip.timing;
    const words = clip.hallucination?.wordsProduced ?? wer?.hypWords ?? null;
    lines.push(
      [
        `| ${markdownText(clip.id)}`,
        markdownText(clip.tags.join(", ")),
        wer === null ? "0" : String(wer.referenceWers.length),
        wer === null ? "-" : markdownNumber(wer.oiwer, 3),
        wer === null ? "-" : markdownNumber(wer.plainWer, 3),
        timing === null ? "-" : markdownNumber(timing.boundary.maeMs, 1),
        timing === null ? "-" : markdownNumber(timing.boundary.p90Ms, 1),
        timing === null ? "-" : markdownNumber(timing.karaokeSwitchErrorMs, 1),
        timing === null ? "-" : String(timing.neverMatchedWords),
        words === null ? "-" : String(words),
        clip.hard ? "yes" : "no",
        `${resultCell(clip.pass)} |`,
      ].join(" | "),
    );
  }
  lines.push("");

  lines.push("## By tag", "");
  lines.push("| tag | clips | clips with WER | mean WER | median WER | p90 WER | hard failures |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const tag of report.byTag) {
    lines.push(
      [
        `| ${markdownText(tag.tag)}`,
        String(tag.clips),
        String(tag.werClips),
        markdownNumber(tag.meanWer, 3),
        markdownNumber(tag.medianWer, 3),
        markdownNumber(tag.p90Wer, 3),
        `${String(tag.hardFailures)} |`,
      ].join(" | "),
    );
  }
  lines.push("");

  lines.push("## Failures", "");
  if (report.failures.length === 0) {
    lines.push("_None._");
  } else {
    for (const failure of report.failures) lines.push(failureLine(failure));
  }
  lines.push("");

  const notes: string[] = [];
  for (const clip of report.clips) for (const note of clip.notes) notes.push(`- \`${markdownText(clip.id)}\`: ${markdownText(note)}`);
  if (report.unknownClips.length > 0) {
    notes.push(`- unknown hypothesis clips: ${report.unknownClips.map(markdownText).join(", ")}`);
  }
  if (notes.length > 0) {
    lines.push("## Notes", "");
    lines.push(...notes);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/** JSON for the `--out` file. The report contains no undefined/NaN/Infinity, so it is valid JSON. */
export function goldReportToJson(report: GoldReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
