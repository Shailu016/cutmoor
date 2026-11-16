/**
 * Forced alignment: the word of KNOWN text (the visitor's lyrics or script) placed on a window by ONE
 * teacher-forced decoder pass.
 *
 * The caller (the engine's `alignText`) feeds `prompt + one token per character` to the decoder once,
 * with an empty cache, and asks for `cross_attentions.<layer>` AND `logits` in the same run. This
 * module turns that single result into one `ForcedAlignWord` per whitespace-separated word of the
 * text:
 *
 *  - `startMs`/`endMs` come from `characterWordTimes` (char-align.ts), the same DTW over character
 *    attention the transcript path uses. That function already returns exactly one entry per word of
 *    the text, so the user-word mapping is free and there is no second DTW here.
 *  - `logProbability` is the mean, over the tokens that spell the word, of the temperature-1
 *    log-softmax of the row that predicts each token. The decoder is causal, so text token k is
 *    predicted by row `promptRows - 1 + k` (the same one-row shift char-align.ts documents). Missing
 *    or unusable logits degrade to 0 and the times are still returned.
 *  - `sharpness` is a concentration measure in 0..1 computed from the SAME head-normalised,
 *    median-filtered attention the DTW uses: for every character row, the share of the row's
 *    exponential weight that falls on its single strongest frame, linearly rescaled so a flat row is
 *    0 and one frame holding everything is 1; the word's value is the mean over its characters.
 *    It is NOT a calibrated probability and it deliberately avoids a second DTW — it is the cheap
 *    "max over frames" reading of the same attention, used to flag words the pipeline should treat as
 *    uncertain.
 *
 * Everything is pure and fixture-free: synthetic tensors drive the unit tests, and any doubtful input
 * returns `null` rather than throwing, so a forced-alignment failure can only cost the caller the
 * lyrics pass, never the transcript.
 */

import type { ForcedAlignWord } from "../contracts";
import { FAST_ALIGNMENT_HEADS, headNormalisedRows, type AlignmentHead, type AttentionMatrix } from "./attention";
import { characterWordTimes, type CharacterTokenRow } from "./char-align";

/** Decoder logits of one teacher-forced pass: dims [1, rows, vocab], row-major. */
export interface ForcedAlignLogits {
  dims: readonly number[];
  data: ArrayLike<number>;
}

export interface ForcedAlignInput {
  /** Cross-attention of the pass, keyed by output name ("cross_attentions.<layer>"). */
  tensors: Readonly<Record<string, AttentionMatrix>>;
  /** One entry per character of `text`, from `characterTokens`. */
  charRows: readonly CharacterTokenRow[];
  /** The exact text the pass fed (a leading space is normal for Whisper). */
  text: string;
  /** The text's token ids, in order, as fed after the prompt. */
  tokenIds: readonly number[];
  /** Audio actually used in this window; times never go past it. */
  usedMs: number;
  /** Logits of the same pass. Absent: every word gets `logProbability` 0 and keeps its times. */
  logits?: ForcedAlignLogits | null;
  /** Query rows at the front that belong to the prompt. Default 4. */
  promptRows?: number;
  /** Defaults to the model's alignment heads. */
  heads?: readonly AlignmentHead[];
  /** Whisper uses 7 (odd). 1 disables filtering. */
  medianFilterWidth?: number;
  /** Encoder frames per second. Stock Whisper is 50 (20 ms per frame). */
  framesPerSecond?: number;
}

const DEFAULT_PROMPT_ROWS = 4;
const DEFAULT_MEDIAN_WIDTH = 7;
const DEFAULT_FPS = 50;
/** Bounds the work; the engine never feeds more than 400 characters per call. */
const MAX_WORDS = 512;

/** The whitespace-separated words of `text`, punctuation included. Same rule as char-align.ts. */
function wordSpans(text: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  for (const match of text.matchAll(/\S+/gu)) {
    const from = match.index ?? 0;
    spans.push({ from, to: from + match[0].length });
  }
  return spans;
}

/**
 * The words of a visitor's pasted text, in order, with all runs of whitespace (and a pasted line
 * break) collapsed. The words themselves are untouched, so the caller can report the user's spelling.
 */
export function alignableWords(text: string): string[] {
  if (typeof text !== "string") return [];
  return text.split(/\s+/u).filter((word) => word.length > 0);
}

/** Which word each character of `text` belongs to, or -1 for whitespace between words. */
function wordOfCharacter(textLength: number, spans: readonly { from: number; to: number }[]): Int32Array {
  const owner = new Int32Array(textLength).fill(-1);
  spans.forEach((span, index) => {
    for (let c = span.from; c < span.to && c < textLength; c += 1) owner[c] = index;
  });
  return owner;
}

/**
 * Mean log-probability per word, or all zeros when the logits are missing or unusable. Never NaN and
 * never positive: a log-softmax value is <= 0 by construction, and the clamp only guards rounding.
 */
function wordLogProbabilities(input: ForcedAlignInput, spans: readonly { from: number; to: number }[], promptRows: number): number[] {
  const zeros = spans.map(() => 0);
  const logits = input.logits;
  if (!logits || !Array.isArray(logits.dims) || logits.dims.length !== 3) return zeros;
  const [batch, rows, vocab] = logits.dims;
  if (batch !== 1 || !Number.isInteger(rows) || rows < 1 || !Number.isInteger(vocab) || vocab < 2) return zeros;
  if (!logits.data || logits.data.length < rows * vocab) return zeros;
  const tokenIds = input.tokenIds;
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) return zeros;
  const charRows = input.charRows;
  if (!Array.isArray(charRows) || charRows.length !== input.text.length) return zeros;

  // One log-probability per text token, worked out once even when a merged token serves two words.
  const perToken = new Float64Array(tokenIds.length).fill(Number.NaN);
  const logProbability = (token: number): number => {
    if (!Number.isFinite(perToken[token])) {
      perToken[token] = Number.NaN; // stays "no usable value" unless the row is good
      const row = promptRows - 1 + token;
      const target = tokenIds[token];
      if (row >= 0 && row < rows && Number.isInteger(target) && target >= 0 && target < vocab) {
        const base = row * vocab;
        let max = -Infinity;
        for (let id = 0; id < vocab; id += 1) {
          const value = logits.data[base + id];
          if (value > max) max = value;
        }
        if (Number.isFinite(max)) {
          let sum = 0;
          for (let id = 0; id < vocab; id += 1) sum += Math.exp(logits.data[base + id] - max);
          const logZ = max + Math.log(sum);
          if (Number.isFinite(logZ)) perToken[token] = Math.min(0, logits.data[base + target] - logZ);
        }
      }
    }
    return perToken[token];
  };

  return spans.map((span, index) => {
    const tokens = new Set<number>();
    for (let c = span.from; c < span.to && c < charRows.length; c += 1) {
      const row = charRows[c];
      if (!row || !Number.isInteger(row.firstToken) || row.firstToken < 0 || !Number.isInteger(row.tokenCount)) continue;
      for (let t = row.firstToken; t < row.firstToken + row.tokenCount && t < tokenIds.length; t += 1) tokens.add(t);
    }
    let sum = 0;
    let count = 0;
    for (const token of tokens) {
      const value = logProbability(token);
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    // No token of this word has a usable score: say "unknown" (0) rather than "surely wrong".
    return count === 0 ? 0 : Math.min(0, sum / count);
  });
}

/**
 * Concentration of each word's character attention, 0..1. A flat attention row scores 0 (all frames
 * share the weight equally), a row with all its weight on one frame scores 1. Non-finite attention
 * scores 0 for every word: this function never returns NaN, and `characterWordTimes` has already
 * refused such tensors anyway when it is called first.
 */
function wordSharpness(input: ForcedAlignInput, spans: readonly { from: number; to: number }[], promptRows: number): number[] {
  const zeros = spans.map(() => 0);
  const heads = input.heads ?? FAST_ALIGNMENT_HEADS;
  const width = input.medianFilterWidth ?? DEFAULT_MEDIAN_WIDTH;
  const fps = input.framesPerSecond ?? DEFAULT_FPS;
  const charRows = input.charRows;
  const charCount = Array.isArray(charRows) ? charRows.length : 0;
  if (charCount === 0 || charCount !== input.text.length) return zeros;
  if (!Array.isArray(heads) || heads.length === 0) return zeros;
  if (!Number.isFinite(input.usedMs) || input.usedMs <= 0) return zeros;
  if (!Number.isFinite(fps) || fps <= 0) return zeros;
  if (!Number.isInteger(width) || width < 1 || width % 2 === 0) return zeros;

  // Validate every tensor once, exactly as char-align.ts does, and remember which one each layer refers to.
  const byLayer = new Map<number, AttentionMatrix>();
  let frames = Number.POSITIVE_INFINITY;
  for (const head of heads) {
    if (!head || !Number.isInteger(head.layer) || !Number.isInteger(head.head) || head.layer < 0 || head.head < 0) return zeros;
    let matrix = byLayer.get(head.layer);
    if (!matrix) {
      const found = input.tensors?.[`cross_attentions.${head.layer}`];
      if (!found || !Array.isArray(found.dims) || found.dims.length !== 4) return zeros;
      const [batch, headCount, queries, frameCount] = found.dims;
      if (batch !== 1 || !Number.isInteger(headCount) || !Number.isInteger(queries) || !Number.isInteger(frameCount)) return zeros;
      if (headCount < 1 || queries < 1 || frameCount < 1) return zeros;
      if (!found.data || found.data.length < headCount * queries * frameCount) return zeros;
      matrix = found;
      byLayer.set(head.layer, matrix);
    }
    if (head.head >= matrix.dims[1]) return zeros;
    if (matrix.dims[3] < frames) frames = matrix.dims[3];
  }
  if (!Number.isFinite(frames) || frames <= 0) return zeros;
  const requested = Math.max(1, Math.round((input.usedMs / 1000) * fps));
  const usedFrames = Math.min(requested, frames);
  if (usedFrames <= 0) return zeros;

  // The row before a character's first token predicts it (see char-align.ts).
  const queryRow = new Array<number>(charCount);
  for (let c = 0; c < charCount; c += 1) {
    const row = charRows[c];
    if (!row || !Number.isInteger(row.firstToken) || row.firstToken < 0) return zeros;
    queryRow[c] = promptRows - 1 + row.firstToken;
  }

  const sums = new Float64Array(charCount * usedFrames);
  const raw = new Float64Array(charCount * usedFrames);
  for (const head of heads) {
    const matrix = byLayer.get(head.layer) as AttentionMatrix;
    const [, , queries, frameCount] = matrix.dims;
    for (let c = 0; c < charCount; c += 1) {
      const row = queryRow[c];
      if (row < 0 || row >= queries) return zeros;
      const base = (head.head * queries + row) * frameCount;
      for (let f = 0; f < usedFrames; f += 1) {
        const value = matrix.data[base + f];
        if (!Number.isFinite(value)) return zeros;
        raw[c * usedFrames + f] = value;
      }
    }
    // Whisper's normalisation: z-score each frame across the characters, then median-filter along time.
    const shaped = headNormalisedRows(raw, charCount, usedFrames, width);
    for (let i = 0; i < shaped.length; i += 1) sums[i] += shaped[i];
  }

  const perCharacter = new Float64Array(charCount);
  // A row whose weight is spread over every frame has a max share of 1/F; subtract that floor and
  // rescale so the range is exactly 0..1.
  const floor = 1 / usedFrames;
  const spread = 1 - floor;
  for (let c = 0; c < charCount; c += 1) {
    const base = c * usedFrames;
    let max = -Infinity;
    for (let f = 0; f < usedFrames; f += 1) {
      const value = sums[base + f] / heads.length;
      if (value > max) max = value;
    }
    let total = 0;
    for (let f = 0; f < usedFrames; f += 1) total += Math.exp(sums[base + f] / heads.length - max);
    const share = Number.isFinite(total) && total > 0 ? 1 / total : floor;
    const sharp = spread > 0 ? (share - floor) / spread : 1;
    perCharacter[c] = Number.isFinite(sharp) ? Math.min(1, Math.max(0, sharp)) : 0;
  }

  const owner = wordOfCharacter(input.text.length, spans);
  const totals = new Array<number>(spans.length).fill(0);
  const counts = new Array<number>(spans.length).fill(0);
  for (let c = 0; c < charCount; c += 1) {
    const word = owner[c];
    if (word < 0) continue;
    const value = perCharacter[c];
    if (!Number.isFinite(value)) continue;
    totals[word] += value;
    counts[word] += 1;
  }
  return spans.map((_, index) => (counts[index] === 0 ? 0 : Math.min(1, Math.max(0, totals[index] / counts[index]))));
}

/**
 * One `ForcedAlignWord` per whitespace-separated word of `text`, or `null` when the pass cannot be
 * turned into one time per word (missing/mismatched attention, a word count that disagrees with the
 * text, times that cannot be made monotonic inside the window).
 *
 * `logProbability` is 0 when the logits are missing or unusable, and `sharpness` is 0 when the
 * attention cannot be scored; both cases still return the times.
 */
export function forcedAlignWords(input: ForcedAlignInput): ForcedAlignWord[] | null {
  if (!input || typeof input !== "object") return null;
  const { text } = input;
  if (typeof text !== "string" || text.length === 0) return null;
  const spans = wordSpans(text);
  if (spans.length === 0 || spans.length > MAX_WORDS) return null;
  if (!Array.isArray(input.tokenIds) || !Array.isArray(input.charRows)) return null;

  const promptRows = input.promptRows ?? DEFAULT_PROMPT_ROWS;
  if (!Number.isInteger(promptRows) || promptRows < 1) return null;

  // Times (and the DTW) come from the shared character aligner; it validates the tensors in depth.
  const times = characterWordTimes({
    tensors: input.tensors,
    charRows: input.charRows,
    text,
    usedMs: input.usedMs,
    heads: input.heads,
    promptRows,
    medianFilterWidth: input.medianFilterWidth,
    framesPerSecond: input.framesPerSecond,
  });
  // The character aligner returns a PREFIX when the last word cannot be timed inside the window (its clamped
  // start reaches `usedMs`). A prefix is a real result: the caller places those words and retries the rest in the
  // next window. Only a missing or longer-than-the-text result is a failure.
  if (!times || times.length === 0 || times.length > spans.length) return null;

  let probabilities: number[];
  let sharpness: number[];
  try {
    probabilities = wordLogProbabilities(input, spans, promptRows);
    sharpness = wordSharpness(input, spans, promptRows);
  } catch {
    // A scoring bug must never cost the times.
    probabilities = spans.map(() => 0);
    sharpness = spans.map(() => 0);
  }

  return spans.slice(0, times.length).map((span, index) => ({
    text: text.slice(span.from, span.to),
    startMs: times[index].startMs,
    endMs: times[index].endMs,
    logProbability: Number.isFinite(probabilities[index]) ? Math.min(0, probabilities[index]) : 0,
    sharpness: Number.isFinite(sharpness[index]) ? Math.min(1, Math.max(0, sharpness[index])) : 0,
  }));
}
