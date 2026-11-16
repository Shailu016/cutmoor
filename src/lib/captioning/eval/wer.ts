import { normalizeToken } from "../normalize";

/**
 * Word error rate for Hinglish / Hindi / English transcripts.
 *
 * WHY the normalisation step exists: the same spoken word is written many ways ("nahin"/"nahi",
 * "bohot"/"bahut", "YouTube"/"youtube", "नहीं।"/"नहीं"). Scoring raw strings would report errors
 * that are cosmetic, so both sides go through the project's own `normalizeToken` (the same lexicon
 * the exporter uses) and then lose punctuation and case. Devanagari combining marks are KEPT: they
 * carry meaning ("है" and "हैं" are different words), and dropping them would understate errors.
 *
 * WHAT makes the alignment trustworthy: Hirschberg's linear-memory variant of Levenshtein. It
 * returns an exact minimum edit script with O(ref + hyp) memory, so an hour-long transcript does not
 * allocate a 100-million-cell matrix. The unit tests check its counts against a plain full-matrix
 * implementation on seeded random inputs, so a bug cannot hide behind "equal totals".
 *
 * Tie-breaking is deterministic but not byte-identical to a full-matrix backtrack (several minimum
 * scripts can exist). For scoring that is irrelevant: only the counts and the matched pairs are
 * used, and every returned script is minimal by construction.
 */

/** Punctuation, symbols, whitespace and format characters go; letters, digits and marks stay. */
const WORD_CORE = /[^\p{L}\p{N}\p{M}]+/gu;

export interface WerOptions {
  /**
   * Compare capitalisation. Off by default: "Delhi" and "delhi" are the same word for scoring, and
   * the lexicon's canonical spellings (YouTube, AI, OK) are unaffected either way.
   */
  strictCase?: boolean;
}

/**
 * Normalises one whitespace-free token for scoring. Returns "" for tokens that carry no word
 * (a lone dash, an ellipsis), which the caller drops.
 */
export function normalizeForWer(token: string, options: WerOptions = {}): string {
  // NFC first so a composed and a decomposed Devanagari word compare equal.
  const canonical = normalizeToken(token.normalize("NFC"));
  // Doc: punctuation is not a word. Combining marks (Devanagari matras, nukta, anusvara) are.
  const core = canonical.replace(WORD_CORE, "");
  return options.strictCase ? core : core.toLowerCase();
}

/** Splits text into whitespace-separated tokens. Punctuation stays attached; the normaliser decides. */
export function tokenizeForWer(text: string): string[] {
  return text.normalize("NFC").split(/\s+/u).filter((token) => token.length > 0);
}

export type EditOpType = "match" | "substitution" | "insertion" | "deletion";

/**
 * One step of the alignment, in reading order.
 *
 * `refIndex` / `hypIndex` are indices into the ORIGINAL token arrays passed in (before punctuation
 * tokens were dropped), so a caller with timed words can follow an op back to its word and time.
 * `refToken` / `hypToken` are the normalised strings that were actually compared.
 */
export interface EditOp {
  type: EditOpType;
  refIndex: number | null;
  hypIndex: number | null;
  refToken: string | null;
  hypToken: string | null;
}

export interface WerCounts {
  /** Number of aligned equal words. */
  correct: number;
  substitutions: number;
  insertions: number;
  /** Words in the reference that the hypothesis missed. */
  deletions: number;
  /** Reference words after normalisation (equivalently, correct + substitutions + deletions). */
  refWords: number;
  /** Hypothesis words after normalisation (correct + substitutions + insertions). */
  hypWords: number;
  /** substitutions + insertions + deletions. */
  errors: number;
}

export interface WerResult extends WerCounts {
  /**
   * errors / refWords. An empty reference with a non-empty hypothesis scores 1, because the ratio
   * is undefined there and "the model invented words" must not look perfect. 0/0 scores 0.
   */
  wer: number;
  /** The minimum edit script, in reading order. */
  ops: EditOp[];
  /** Normalised tokens that were scored (empty-punctuation tokens removed). */
  refTokens: string[];
  hypTokens: string[];
}

interface IndexedToken {
  /** Index in the caller's token array. */
  index: number;
  token: string;
}

/**
 * Keeps the caller's indices while dropping tokens that are pure punctuation. Without this, a
 * dashed pause in the reference would shift every later index and timing would attach to the wrong
 * word.
 */
function prepare(tokens: readonly string[], options: WerOptions): IndexedToken[] {
  const prepared: IndexedToken[] = [];
  tokens.forEach((token, index) => {
    const normalised = normalizeForWer(token, options);
    if (normalised.length > 0) prepared.push({ index, token: normalised });
  });
  return prepared;
}

/**
 * One row of the edit-distance table: cost of aligning a[aFrom..aFrom+i) with b[bFrom..bFrom+j).
 * When `reversed`, the same recurrence runs from the end, so row[j] is the cost of aligning the last
 * i reference tokens with the last j hypothesis tokens. Two Int32 rows, so memory is O(hypothesis).
 */
function costRow(
  a: readonly IndexedToken[],
  aFrom: number,
  aTo: number,
  b: readonly IndexedToken[],
  bFrom: number,
  bTo: number,
  reversed: boolean,
): Int32Array {
  const width = bTo - bFrom;
  let previous = new Int32Array(width + 1);
  let current = new Int32Array(width + 1);
  for (let j = 0; j <= width; j += 1) previous[j] = j;
  for (let i = 1; i <= aTo - aFrom; i += 1) {
    current[0] = i;
    const token = reversed ? a[aTo - i].token : a[aFrom + i - 1].token;
    for (let j = 1; j <= width; j += 1) {
      const other = reversed ? b[bTo - j].token : b[bFrom + j - 1].token;
      const diagonal = previous[j - 1] + (token === other ? 0 : 1);
      const remove = previous[j] + 1;
      const insert = current[j - 1] + 1;
      current[j] = diagonal < remove ? (diagonal < insert ? diagonal : insert) : remove < insert ? remove : insert;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous;
}

function pushInsertion(out: EditOp[], token: IndexedToken): void {
  out.push({ type: "insertion", refIndex: null, hypIndex: token.index, refToken: null, hypToken: token.token });
}

function pushDeletion(out: EditOp[], token: IndexedToken): void {
  out.push({ type: "deletion", refIndex: token.index, hypIndex: null, refToken: token.token, hypToken: null });
}

/**
 * Emits the minimum edit script for a[aFrom..aTo) versus b[bFrom..bTo).
 *
 * Splitting the reference in half and finding the cheapest split point in the hypothesis (using one
 * forward and one backward cost row) is Hirschberg. The split point with the smallest index wins
 * ties, which keeps repeated words aligned left to right.
 */
function alignRange(
  a: readonly IndexedToken[],
  aFrom: number,
  aTo: number,
  b: readonly IndexedToken[],
  bFrom: number,
  bTo: number,
  out: EditOp[],
): void {
  const refLength = aTo - aFrom;
  const hypLength = bTo - bFrom;

  if (refLength === 0) {
    for (let j = bFrom; j < bTo; j += 1) pushInsertion(out, b[j]);
    return;
  }
  if (hypLength === 0) {
    for (let i = aFrom; i < aTo; i += 1) pushDeletion(out, a[i]);
    return;
  }

  if (refLength === 1) {
    const ref = a[aFrom];
    let matchAt = -1;
    for (let j = bFrom; j < bTo; j += 1) {
      if (b[j].token === ref.token) {
        matchAt = j;
        break;
      }
    }
    if (matchAt === -1) {
      // No equal word to match: substituting the first hypothesis word is one edit, deleting the
      // reference word and inserting every hypothesis word is more. The rest are insertions.
      out.push({
        type: "substitution",
        refIndex: ref.index,
        hypIndex: b[bFrom].index,
        refToken: ref.token,
        hypToken: b[bFrom].token,
      });
      for (let j = bFrom + 1; j < bTo; j += 1) pushInsertion(out, b[j]);
      return;
    }
    for (let j = bFrom; j < matchAt; j += 1) pushInsertion(out, b[j]);
    out.push({
      type: "match",
      refIndex: ref.index,
      hypIndex: b[matchAt].index,
      refToken: ref.token,
      hypToken: b[matchAt].token,
    });
    for (let j = matchAt + 1; j < bTo; j += 1) pushInsertion(out, b[j]);
    return;
  }

  const middle = aFrom + (refLength >> 1);
  const left = costRow(a, aFrom, middle, b, bFrom, bTo, false);
  const right = costRow(a, middle, aTo, b, bFrom, bTo, true);
  let bestSplit = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let split = 0; split <= hypLength; split += 1) {
    const cost = left[split] + right[hypLength - split];
    if (cost < bestCost) {
      bestCost = cost;
      bestSplit = split;
    }
  }
  alignRange(a, aFrom, middle, b, bFrom, bFrom + bestSplit, out);
  alignRange(a, middle, aTo, b, bFrom + bestSplit, bTo, out);
}

function asTokens(input: string | readonly string[]): readonly string[] {
  return typeof input === "string" ? tokenizeForWer(input) : input;
}

/**
 * Scores a hypothesis transcript against a reference transcript.
 *
 * Both arguments may be a full text (split on whitespace) or an array of words (for example
 * `Word[].map(w => w.text)`). The reference is the denominator, so never swap them.
 */
export function wordErrorRate(
  reference: string | readonly string[],
  hypothesis: string | readonly string[],
  options: WerOptions = {},
): WerResult {
  const refTokens = prepare(asTokens(reference), options);
  const hypTokens = prepare(asTokens(hypothesis), options);

  const ops: EditOp[] = [];
  alignRange(refTokens, 0, refTokens.length, hypTokens, 0, hypTokens.length, ops);

  let correct = 0;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "match") correct += 1;
    else if (op.type === "substitution") substitutions += 1;
    else if (op.type === "insertion") insertions += 1;
    else deletions += 1;
  }

  const refWords = refTokens.length;
  const hypWords = hypTokens.length;
  const errors = substitutions + insertions + deletions;
  const wer = refWords === 0 ? (hypWords === 0 ? 0 : 1) : errors / refWords;

  return {
    correct,
    substitutions,
    insertions,
    deletions,
    refWords,
    hypWords,
    errors,
    wer,
    ops,
    refTokens: refTokens.map((token) => token.token),
    hypTokens: hypTokens.map((token) => token.token),
  };
}

/** Convenience: the minimum number of word edits, i.e. the Levenshtein distance after normalisation. */
export function wordEditDistance(
  reference: string | readonly string[],
  hypothesis: string | readonly string[],
  options: WerOptions = {},
): number {
  return wordErrorRate(reference, hypothesis, options).errors;
}

/** The `(refIndex, hypIndex)` pairs of words the aligner considered the same, in order. */
export function matchedWordPairs(result: WerResult): Array<{ refIndex: number; hypIndex: number }> {
  const pairs: Array<{ refIndex: number; hypIndex: number }> = [];
  for (const op of result.ops) {
    if (op.type === "match" && op.refIndex !== null && op.hypIndex !== null) {
      pairs.push({ refIndex: op.refIndex, hypIndex: op.hypIndex });
    }
  }
  return pairs;
}
