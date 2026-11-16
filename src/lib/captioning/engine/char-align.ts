/**
 * Word timing from a teacher-forced decoder pass over the transcript's CHARACTERS.
 *
 * Why this file exists: the word times we ship today come from the cross-attention of the tokens
 * the decoder GENERATED (attention.ts). The 2025 study "Whisper Has an Internal Word Aligner"
 * (arXiv 2509.09987) shows that running Whisper once more, teacher-forced, over the transcript's
 * characters and aligning the characters with DTW is 10-20 F1 points better at 50 ms, because a
 * character is a finer time unit than a wordpiece and the decoder reads the right text instead of
 * its own guess. It needs no new model: the session we already run returns
 * `cross_attentions.<layer>` for every query row, so one plain forward pass gives a
 * [character x frame] attention matrix.
 *
 * This module is pure and fixture-free: the engine hands it the captured attention, the mapping
 * from characters to token rows, and the text. It never throws: anything doubtful returns `null`
 * and the engine keeps the times it already had, so timing can never lose a word.
 *
 * TIME: one encoder frame is 20 ms at Whisper's 50 frames per second. Output is integer
 * milliseconds in window-local time.
 */

import {
  dtw,
  FAST_ALIGNMENT_HEADS,
  headNormalisedRows,
  type AlignmentHead,
  type AttentionMatrix,
} from "./attention";

/** Where one character's tokens live in the flattened token list the pass fed. */
export interface CharacterTokenRow {
  /** Index of the character's first token in `CharacterTokens.tokenIds`. */
  firstToken: number;
  /** How many tokens the character encodes to (1..n; a BPE merge can make one token cover several characters). */
  tokenCount: number;
}

export interface CharacterTokens {
  /** Every token id the teacher-forced pass feeds after the prompt, in order. */
  tokenIds: number[];
  /** One entry per UTF-16 code unit of the text, in the same order. */
  rows: CharacterTokenRow[];
}

/**
 * The only two tokenizer calls the character mapping needs. `WhisperTokenizer` satisfies this, and
 * tests can hand in a stub instead of a whole vocabulary.
 */
export interface CharacterTokenizer {
  encode(text: string): number[];
  decode(ids: readonly number[]): string;
}

export interface CharacterAlignmentInput {
  /**
   * Cross-attention of the teacher-forced pass, keyed by output name ("cross_attentions.<layer>"),
   * each with dims [1, heads, rows, frames] (rows = prompt rows + every character token).
   */
  tensors: Readonly<Record<string, AttentionMatrix>>;
  /** One entry per character of `text`, in order. */
  charRows: readonly CharacterTokenRow[];
  /** The exact text that was teacher-forced (a leading space is normal for Whisper). */
  text: string;
  /** Audio actually used in this window; times never go past it. */
  usedMs: number;
  /** Defaults to the model's alignment heads. */
  heads?: readonly AlignmentHead[];
  /**
   * Query rows at the front of the pass that belong to the prompt. The LAST of them predicts the
   * first character's first token, so the row before the first character is `promptRows - 1`.
   * Default 4 (<|startoftranscript|>, language, <|transcribe|>, <|notimestamps|>).
   */
  promptRows?: number;
  /** Encoder frames per second. Stock Whisper is 50 (20 ms per frame). */
  framesPerSecond?: number;
  /** Whisper uses 7 (odd). 1 disables filtering. */
  medianFilterWidth?: number;
}

export interface CharacterWordTime {
  text: string;
  startMs: number;
  endMs: number;
}

const DEFAULT_PROMPT_ROWS = 4;
const DEFAULT_MEDIAN_WIDTH = 7;
const DEFAULT_FPS = 50;
/** A wider filter is a caller mistake, not a tuning choice; refusing it also bounds the work. */
const MAX_MEDIAN_WIDTH = 101;
/**
 * Bound on the text this module accepts. The engine only calls it for transcripts of 400
 * characters or fewer; the extra slack covers the leading space and keeps DTW bounded even if a
 * caller forgets the limit.
 */
const MAX_CHARACTERS = 512;

const REPLACEMENT_TAIL = /\uFFFD+$/u;

function isInt(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Turns `text` into the token ids one teacher-forced pass should feed, plus which tokens belong to
 * each character.
 *
 * The whole text is encoded in one go (so the model sees the same BPE tokens it would have
 * generated), then the token stream is split at character boundaries by decoding it prefix by
 * prefix. A prefix that cuts a multi-byte character ends in the replacement character; dropping it
 * gives the number of complete characters after that token. That makes a Devanagari letter (three
 * byte tokens) one character with three tokens, and a merged token such as "Ġhai" one token shared
 * by its four characters.
 *
 * Returns `null` when the token stream cannot reproduce the text exactly (a character the
 * vocabulary cannot spell, a special/timestamp id, empty input), because the character -> row map
 * would then be a guess.
 */
export function characterTokens(tok: CharacterTokenizer, text: string): CharacterTokens | null {
  if (!tok || typeof text !== "string" || text.length === 0 || text.length > MAX_CHARACTERS) return null;
  let tokenIds: number[];
  try {
    tokenIds = tok.encode(text);
  } catch {
    return null;
  }
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) return null;
  for (const id of tokenIds) if (!isInt(id, 0)) return null;
  if (tok.decode(tokenIds) !== text) return null;

  // ends[k] = number of complete characters after the first k + 1 tokens.
  const ends = new Array<number>(tokenIds.length);
  let previous = 0;
  for (let k = 0; k < tokenIds.length; k += 1) {
    const end = tok.decode(tokenIds.slice(0, k + 1)).replace(REPLACEMENT_TAIL, "").length;
    if (end < previous || end > text.length) return null;
    ends[k] = end;
    previous = end;
  }
  // Everything must be spelled by the tokens; otherwise a character has no row of its own.
  if (ends[ends.length - 1] !== text.length) return null;

  const rows: CharacterTokenRow[] = [];
  let completing = 0;
  let previousLast = -1;
  for (let c = 0; c < text.length; c += 1) {
    while (completing < ends.length && ends[completing] <= c) completing += 1;
    if (completing >= ends.length) return null;
    // The character starts at the token after the one that completed the character before it.
    // When the previous character's last token also covers this one (a BPE merge), both share it.
    let first = previousLast + 1;
    if (first > completing) first = completing;
    rows.push({ firstToken: first, tokenCount: completing - first + 1 });
    previousLast = completing;
  }
  return { tokenIds, rows };
}

/** The whitespace-separated words of `text`, as character spans. Punctuation stays inside its word. */
function wordSpans(text: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  for (const match of text.matchAll(/\S+/gu)) {
    const from = match.index ?? 0;
    spans.push({ from, to: from + match[0].length });
  }
  return spans;
}

/**
 * One `{ text, startMs, endMs }` per whitespace-separated word of `text`, or `null`.
 *
 * Pipeline, matching the published character-level recipe:
 *  1. Every character has a token row. The cross-attention row that belongs to a token describes
 *     the audio of the NEXT token (the decoder is causal), so character c is read from the row
 *     before its FIRST token: `promptRows - 1 + firstToken`. The row before the first character is
 *     therefore the last prompt row.
 *  2. Keep the first `usedMs * fps / 1000` frame columns.
 *  3. Per head: z-score every frame across the characters, median-filter every character row along
 *     time, then average the heads (all via `headNormalisedRows`, the same code the generated-token
 *     path uses).
 *  4. DTW over [character x frame] (Whisper's recipe; no peak refinement, so a character is not
 *     pulled off its DTW segment).
 *  5. Words are grouped by the ORIGINAL text, never by token text: a word is a run of non-space
 *     characters, so "hai," includes its comma and a word split across tokens still starts where
 *     its first character does.
 *  6. A word starts when its first character starts and ends where the next word's first character
 *     starts (the last word ends after its last character's DTW segment). Times are pushed to stay
 *     ordered and non-empty, and are clamped inside `usedMs`.
 *
 * `null` only when nothing can be timed: empty/blank text, a character map that does not match the
 * text, missing or mismatched tensors, or non-finite attention. A DTW walk that leaves character
 * rows uncovered, or a window whose tail words have no room left, no longer discards the whole
 * window: uncovered rows inherit the nearest previous covered frame, and a word that cannot be
 * timed inside `usedMs` ends the run, so the words already timed are returned as a prefix.
 */
export function characterWordTimes(input: CharacterAlignmentInput): CharacterWordTime[] | null {
  if (!isRecord(input)) return null;
  const { tensors, charRows, text, usedMs } = input;
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_CHARACTERS) return null;
  if (!Array.isArray(charRows) || charRows.length !== text.length) return null;
  if (!isRecord(tensors)) return null;
  if (!Number.isFinite(usedMs) || usedMs <= 0) return null;

  const heads = input.heads ?? FAST_ALIGNMENT_HEADS;
  if (!Array.isArray(heads) || heads.length === 0) return null;
  for (const head of heads) {
    if (!head || !isInt(head.layer, 0) || !isInt(head.head, 0)) return null;
  }

  const promptRows = input.promptRows ?? DEFAULT_PROMPT_ROWS;
  if (!isInt(promptRows, 1)) return null;

  const width = input.medianFilterWidth ?? DEFAULT_MEDIAN_WIDTH;
  if (!isInt(width, 1) || width % 2 === 0 || width > MAX_MEDIAN_WIDTH) return null;

  const fps = input.framesPerSecond ?? DEFAULT_FPS;
  if (!Number.isFinite(fps) || fps <= 0) return null;

  const words = wordSpans(text);
  if (words.length === 0) return null;

  // One cost row per character; the row index is the token row that predicts its first token.
  const charCount = charRows.length;
  const queryRow = new Array<number>(charCount);
  let totalTokens = 0;
  let previousFirst = -1;
  for (let c = 0; c < charCount; c += 1) {
    const row = charRows[c];
    if (!isRecord(row)) return null;
    const firstToken = row.firstToken;
    const tokenCount = row.tokenCount;
    if (!isInt(firstToken, 0) || !isInt(tokenCount, 1)) return null;
    if (firstToken < previousFirst) return null;
    previousFirst = firstToken;
    if (firstToken + tokenCount > totalTokens) totalTokens = firstToken + tokenCount;
    queryRow[c] = promptRows - 1 + firstToken;
  }

  // Validate every tensor once, and remember which one each layer refers to.
  const byLayer = new Map<number, AttentionMatrix>();
  let frames = Number.POSITIVE_INFINITY;
  for (const head of heads) {
    let matrix = byLayer.get(head.layer);
    if (!matrix) {
      const found = tensors[`cross_attentions.${head.layer}`];
      if (!isRecord(found)) return null;
      const dims = found.dims as readonly unknown[] | undefined;
      const data = found.data as ArrayLike<number> | undefined;
      if (!dims || !Array.isArray(dims) || dims.length !== 4) return null;
      if (!data || !isInt(data.length, 1)) return null;
      const [batch, headCount, queries, frameCount] = dims;
      if (batch !== 1 || !isInt(headCount, 1) || !isInt(queries, 1) || !isInt(frameCount, 1)) return null;
      if (queries < promptRows + totalTokens) return null;
      if (data.length < headCount * queries * frameCount) return null;
      matrix = { dims: [1, headCount, queries, frameCount], data };
      byLayer.set(head.layer, matrix);
    }
    if (head.head >= matrix.dims[1]) return null;
    if (matrix.dims[3] < frames) frames = matrix.dims[3];
  }
  if (!Number.isFinite(frames) || frames <= 0) return null;
  const requestedFrames = Math.max(1, Math.round((usedMs / 1000) * fps));
  const usedFrames = Math.min(requestedFrames, frames);
  if (usedFrames <= 0) return null;

  const sums = new Float64Array(charCount * usedFrames);
  const raw = new Float64Array(charCount * usedFrames);
  for (const head of heads) {
    const matrix = byLayer.get(head.layer) as AttentionMatrix;
    const [, , queries, frameCount] = matrix.dims;
    for (let c = 0; c < charCount; c += 1) {
      // [1, heads, queries, frames] row-major; the batch index is always 0.
      const base = (head.head * queries + queryRow[c]) * frameCount;
      for (let f = 0; f < usedFrames; f += 1) {
        const value = matrix.data[base + f];
        if (!Number.isFinite(value)) return null;
        raw[c * usedFrames + f] = value;
      }
    }
    const shaped = headNormalisedRows(raw, charCount, usedFrames, width);
    for (let i = 0; i < shaped.length; i += 1) sums[i] += shaped[i];
  }

  const cost: number[][] = [];
  for (let c = 0; c < charCount; c += 1) {
    const row = new Array<number>(usedFrames);
    for (let f = 0; f < usedFrames; f += 1) row[f] = -sums[c * usedFrames + f] / heads.length;
    cost.push(row);
  }

  const warped = dtw(cost);
  if (!warped || warped.path.length === 0) return null;
  const firstFrame = new Array<number>(charCount).fill(-1);
  const lastFrame = new Array<number>(charCount).fill(-1);
  let coveredRows = 0;
  for (const [character, frame] of warped.path) {
    if (character < 0 || character >= charCount) return null;
    if (firstFrame[character] < 0) {
      firstFrame[character] = frame;
      coveredRows += 1;
    }
    lastFrame[character] = frame;
  }
  // A defensive guard, not a behaviour change: `dtw`'s border rules make every cost row reachable,
  // so a valid finite path always covers every character. If a future change to the walk ever
  // leaves rows uncovered, one uncovered character must not throw the whole window away: give it
  // the nearest previous covered frame (or 0 when it is before the first covered row) and carry on.
  // Only a path that covers NO character at all is untimeable.
  if (coveredRows === 0) return null;
  let nearestFrame = 0;
  for (let c = 0; c < charCount; c += 1) {
    if (firstFrame[c] >= 0) {
      nearestFrame = lastFrame[c];
      continue;
    }
    firstFrame[c] = nearestFrame;
    lastFrame[c] = nearestFrame;
  }

  const msPerFrame = 1000 / fps;
  const toMs = (frame: number) => Math.round(Math.min(Math.max(frame, 0), usedFrames) * msPerFrame);

  const times: CharacterWordTime[] = [];
  let previousEnd = 0;
  for (let w = 0; w < words.length; w += 1) {
    const { from, to } = words[w];
    const next = words[w + 1];
    const startFrame = firstFrame[from];
    // The last word runs to the end of its last character's DTW segment; every other word ends
    // where the next word's first character starts.
    const endFrame = next ? firstFrame[next.from] : lastFrame[to - 1] + 1;
    let start = Math.min(Math.max(toMs(startFrame), 0), usedMs);
    let end = Math.min(Math.max(toMs(endFrame), 0), usedMs);
    if (start < previousEnd) start = previousEnd;
    if (end <= start) end = Math.min(usedMs, start + 1);
    // No room left inside the window for this word: keep the words already timed and return them
    // as a prefix. The old code returned `null` here, which threw away a whole window's alignment
    // because its tail word reached `usedMs` (a long instrumental gap leaves exactly that shape).
    // The caller accepts a shorter run; a window where the FIRST word cannot be timed is still null.
    if (end <= start) break;
    times.push({ text: text.slice(from, to), startMs: start, endMs: end });
    previousEnd = end;
  }
  return times.length === 0 ? null : times;
}
