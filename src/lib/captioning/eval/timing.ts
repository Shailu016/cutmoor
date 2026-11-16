import { auditCoverage, type CoverageReport } from "../overlap-merge";
import type { SpeechInterval, Word } from "../types";
import { matchedWordPairs, wordErrorRate, type WerOptions } from "./wer";

/**
 * Word-timestamp accuracy for an aligned hypothesis.
 *
 * WHY align first: comparing word i of the hypothesis with word i of the reference would count one
 * missed word as a timing error on every word after it. Only words the WER aligner matched are
 * compared, which is also what the spec asks for ("only matched words count").
 *
 * Two families of numbers are reported because they fail differently in practice:
 *  - onset error: when the word starts (karaoke highlighting is visibly early/late),
 *  - offset error: when the word ends (the caption block lingers or cuts off),
 *  - boundary error: the per-word mean of the two, the headline MAE the MVP threshold uses.
 *
 * Reference words may omit `endMs` (a transcript with start times only, the common case). Then the
 * offset series is null and the boundary series falls back to onset, so nothing is invented.
 */

/** Anything with a start and (optionally) an end. `Word` and a manifest's reference words both fit. */
export interface TimedWordLike {
  text: string;
  startMs: number;
  endMs?: number;
}

export interface ErrorStats {
  /** Mean absolute error. Null when there is nothing to average. */
  maeMs: number | null;
  medianMs: number | null;
  /** 90th percentile, linearly interpolated. Null when empty. */
  p90Ms: number | null;
  maxMs: number | null;
}

export interface TimingMetrics {
  /** Matched words that had usable timings and fed the numbers. */
  matched: number;
  /** Matched words skipped because a timestamp was missing or not finite. */
  unusable: number;
  /** Per-word mean of |start error| and |end error| (start only when the reference has no end). */
  boundary: ErrorStats;
  onset: ErrorStats;
  offset: ErrorStats;
  /** Mean signed onset error in ms: positive means the hypothesis is late. Null when empty. */
  onsetBiasMs: number | null;
  /** Mean signed offset error in ms. Null when the reference has no end times. */
  offsetBiasMs: number | null;
}

export const EMPTY_ERROR_STATS: ErrorStats = { maeMs: null, medianMs: null, p90Ms: null, maxMs: null };

function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * Linear-interpolation percentile, the same definition numpy uses, so a reported p90 is the value a
 * data scientist would compute from the same list. `values` must be sorted ascending and non-empty.
 */
function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 1) return values[0];
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

/** Summarises a list of absolute errors. */
export function summariseErrors(errors: readonly number[]): ErrorStats {
  if (errors.length === 0) return EMPTY_ERROR_STATS;
  const sorted = [...errors].sort((a, b) => a - b);
  return {
    maeMs: mean(errors),
    medianMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    maxMs: sorted[sorted.length - 1],
  };
}

function isTime(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Compares the timings of the words the WER aligner matched.
 *
 * `hypothesis` is what the pipeline produced; `reference` is the hand-checked truth. Order matters
 * for more than the ratio: the reference is the anchor. Both sides may be normalised differently by
 * the aligner ("nahi" / "Nahin"), which is why the pairing comes from `wordErrorRate` rather than
 * from string equality here.
 */
export function timingError(
  hypothesis: readonly TimedWordLike[],
  reference: readonly TimedWordLike[],
  options: WerOptions = {},
): TimingMetrics {
  const alignment = wordErrorRate(
    reference.map((word) => word.text),
    hypothesis.map((word) => word.text),
    options,
  );

  const onsetErrors: number[] = [];
  const offsetErrors: number[] = [];
  const boundaryErrors: number[] = [];
  const onsetSigned: number[] = [];
  const offsetSigned: number[] = [];
  let unusable = 0;

  for (const pair of matchedWordPairs(alignment)) {
    const ref = reference[pair.refIndex];
    const hyp = hypothesis[pair.hypIndex];
    if (!isTime(ref.startMs) || !isTime(hyp.startMs)) {
      unusable += 1;
      continue;
    }
    const onset = hyp.startMs - ref.startMs;
    onsetErrors.push(Math.abs(onset));
    onsetSigned.push(onset);

    if (isTime(ref.endMs) && isTime(hyp.endMs)) {
      const offset = hyp.endMs - ref.endMs;
      offsetErrors.push(Math.abs(offset));
      offsetSigned.push(offset);
      boundaryErrors.push((Math.abs(onset) + Math.abs(offset)) / 2);
    } else {
      boundaryErrors.push(Math.abs(onset));
    }
  }

  return {
    matched: boundaryErrors.length,
    unusable,
    boundary: summariseErrors(boundaryErrors),
    onset: summariseErrors(onsetErrors),
    offset: summariseErrors(offsetErrors),
    onsetBiasMs: onsetSigned.length === 0 ? null : mean(onsetSigned),
    offsetBiasMs: offsetSigned.length === 0 ? null : mean(offsetSigned),
  };
}

/**
 * Share of the detected speech that has a word on it, using the same `auditCoverage` the pipeline
 * reports to the UI. `null` means "cannot be judged": without speech intervals there is no
 * denominator, and returning 1 would let a silent hypothesis pass a coverage threshold.
 */
export function coverageOf(
  hypothesis: readonly TimedWordLike[],
  speech: readonly SpeechInterval[],
  minGapMs = 500,
): CoverageReport | null {
  if (speech.length === 0) return null;
  // auditCoverage reads only start/end; the other Word fields are required by the frozen type.
  const words: Word[] = hypothesis.map((word, index) => ({
    text: word.text,
    startMs: word.startMs,
    endMs: isTime(word.endMs) ? word.endMs : word.startMs,
    confidence: 1,
    index,
    windowIndex: 0,
  }));
  return auditCoverage(words, speech, minGapMs);
}
