import type { SpeechInterval, Word } from "../../lib/captioning/types";

/**
 * Pure editing operations on the transcript, used by the caption editor.
 *
 * Every operation takes the current word list and returns a NEW list plus the word that should
 * stay selected, or `null` when the request cannot be done (so the caller does nothing and does
 * not add an empty step to the undo history). Nothing here mutates its input.
 *
 * Rules that keep a well-formed transcript well-formed:
 *  - All times are integer milliseconds and every word lasts at least MIN_WORD_MS.
 *  - Words stay in order and never overlap. Moving a word into its neighbour trims the neighbour
 *    (like dragging a clip edge in a video editor) instead of crossing it, and a neighbour is
 *    never squeezed below MIN_WORD_MS: the move is cut short instead.
 *  - `index` is always the position in the list, so exports and the editor agree.
 */

/** Shortest a word may be. Below this a word is too brief to be seen highlighted. */
export const MIN_WORD_MS = 40;
/** How long a word typed in by hand lasts when there is room. */
export const NEW_WORD_MS = 400;

export interface EditResult {
  words: Word[];
  /** Index of the word that should be selected afterwards, or -1 for none. */
  selected: number;
}

function renumber(words: Word[]): Word[] {
  return words.map((word, index) => (word.index === index ? word : { ...word, index }));
}

function done(words: Word[], selected: number): EditResult {
  const list = renumber(words);
  return { words: list, selected: list.length === 0 ? -1 : Math.max(0, Math.min(selected, list.length - 1)) };
}

/** Number of characters as a person counts them (an emoji or a combined letter is one), used to share time by length. */
function weight(text: string): number {
  return Math.max(1, [...text].length);
}

/**
 * Cuts [start, end] into `lengths.length` consecutive, strictly increasing pieces whose sizes follow
 * the given weights. Returns the boundaries (length n + 1), or null if the span is too short to give
 * every piece at least 1 ms.
 */
export function splitSpan(startMs: number, endMs: number, lengths: number[]): number[] | null {
  const n = lengths.length;
  const span = endMs - startMs;
  if (n === 0 || span < n) return null;
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const bounds: number[] = [startMs];
  let acc = 0;
  for (let k = 0; k < n; k += 1) {
    acc += lengths[k];
    bounds.push(k === n - 1 ? endMs : startMs + Math.round((span * acc) / total));
  }
  // Rounding can make two boundaries equal. Push forward, then pull back from the end, so every piece is at least 1 ms.
  for (let k = 1; k < n; k += 1) bounds[k] = Math.max(bounds[k], bounds[k - 1] + 1);
  for (let k = n - 1; k >= 1; k -= 1) bounds[k] = Math.min(bounds[k], bounds[k + 1] - 1);
  return bounds;
}

/**
 * Sets the text of one word. A box left empty deletes the word. Text with spaces becomes several
 * words that share the original word's time in proportion to their length.
 */
export function setWordText(words: Word[], index: number, text: string): EditResult | null {
  const word = words[index];
  if (!word) return null;
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return deleteWord(words, index);
  if (tokens.length === 1) {
    if (tokens[0] === word.text) return null;
    const next = words.slice();
    next[index] = { ...word, text: tokens[0] };
    return done(next, index);
  }
  const bounds = splitSpan(word.startMs, word.endMs, tokens.map(weight));
  if (!bounds) return null;
  const pieces: Word[] = tokens.map((token, k) => ({ ...word, text: token, startMs: bounds[k], endMs: bounds[k + 1] }));
  return done([...words.slice(0, index), ...pieces, ...words.slice(index + 1)], index);
}

/** Splits a word in two at a character position (the text caret). Both halves must keep some text. */
export function splitWordAt(words: Word[], index: number, offset: number): EditResult | null {
  const word = words[index];
  if (!word) return null;
  let cut = Math.floor(offset);
  // Never cut a surrogate pair (an emoji) in the middle.
  const code = word.text.charCodeAt(cut);
  if (cut > 0 && code >= 0xdc00 && code <= 0xdfff) cut -= 1;
  const left = word.text.slice(0, cut).trim();
  const right = word.text.slice(cut).trim();
  if (!left || !right) return null;
  const bounds = splitSpan(word.startMs, word.endMs, [weight(left), weight(right)]);
  if (!bounds) return null;
  const first: Word = { ...word, text: left, startMs: bounds[0], endMs: bounds[1] };
  const second: Word = { ...word, text: right, startMs: bounds[1], endMs: bounds[2] };
  return done([...words.slice(0, index), first, second, ...words.slice(index + 1)], index);
}

/** Joins a word with the one after it ("ho" + "ga" becomes "hoga"). The merged word covers both, and any gap between them. */
export function mergeWithNext(words: Word[], index: number): EditResult | null {
  const a = words[index];
  const b = words[index + 1];
  if (!a || !b) return null;
  const merged: Word = {
    ...a,
    text: a.text + b.text,
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs),
    confidence: Math.min(a.confidence, b.confidence),
  };
  return done([...words.slice(0, index), merged, ...words.slice(index + 2)], index);
}

export function deleteWord(words: Word[], index: number): EditResult | null {
  if (!words[index]) return null;
  return done([...words.slice(0, index), ...words.slice(index + 1)], index);
}

/**
 * Adds a word after `index` (-1 puts it first). It takes the free time before the next word when
 * there is room; otherwise it takes the second half of the word it follows. Returns null if there
 * is no room anywhere, rather than inventing overlapping times.
 */
export function insertWordAfter(words: Word[], index: number, text: string): EditResult | null {
  const token = text.trim().split(/\s+/).filter(Boolean).join(" ");
  if (!token) return null;
  if (index < -1 || index >= words.length) return null;
  const prev = index >= 0 ? words[index] : null;
  const next = words[index + 1] ?? null;

  const gapEnd = next ? next.startMs : (prev ? prev.endMs : 0) + NEW_WORD_MS;
  const gapStart = prev ? prev.endMs : Math.max(0, gapEnd - NEW_WORD_MS);
  const gap = gapEnd - gapStart;

  const neighbour = prev ?? next;
  const windowIndex = neighbour ? neighbour.windowIndex : 0;
  const make = (startMs: number, endMs: number): Word => ({ text: token, startMs, endMs, confidence: 1, index: 0, windowIndex });

  let list: Word[];
  if (gap >= MIN_WORD_MS) {
    const created = make(gapStart, gapStart + Math.min(gap, NEW_WORD_MS));
    list = [...words.slice(0, index + 1), created, ...words.slice(index + 1)];
  } else if (prev && prev.endMs - prev.startMs >= 2 * MIN_WORD_MS) {
    const mid = prev.endMs - Math.floor((prev.endMs - prev.startMs) / 2);
    const shortened: Word = { ...prev, endMs: mid };
    const created = make(mid, prev.endMs);
    list = [...words.slice(0, index), shortened, created, ...words.slice(index + 1)];
  } else {
    return null;
  }
  return done(list, index + 1);
}

/** Longest a caption made by one click may span. A longer gap keeps the rest free for another caption. */
export const MAX_NEW_CAPTION_MS = 10_000;

/**
 * The parts of `span` that no word covers, in order. A stretch the pipeline reported as speech with
 * no words stays honest after the visitor adds captions there: the part still empty is what the
 * "no words found" notice and its next one-click caption use, never time that already has a word.
 */
export function freeSpansWithin(words: readonly Word[], span: SpeechInterval): SpeechInterval[] {
  if (!Number.isFinite(span.startMs) || !Number.isFinite(span.endMs)) return [];
  const start = Math.round(span.startMs);
  const end = Math.round(span.endMs);
  if (end <= start) return [];
  const parts: SpeechInterval[] = [];
  let cursor = start;
  for (const word of words) {
    if (word.endMs <= cursor) continue;
    if (word.startMs >= end) break;
    if (word.startMs > cursor) parts.push({ startMs: cursor, endMs: word.startMs });
    cursor = Math.max(cursor, word.endMs);
    if (cursor >= end) break;
  }
  if (cursor < end) parts.push({ startMs: cursor, endMs: end });
  return parts;
}

/**
 * Creates a caption at a time span the editor already knows, such as a "no words found" stretch.
 * The word is placed in chronological order and clamped into the free time between its neighbours,
 * so it can never overlap; the request is refused when less than MIN_WORD_MS of free time is left.
 *
 * `text` may be empty. That is how a just-created caption starts: an empty word is kept by layout
 * but has no visible line in SRT/VTT (export.ts drops empty words there; the word-level JSON keeps
 * it as data with empty text), so no word is invented in a rendered export, while the editor can
 * show the slot and the visitor can type the word they hear. Typing then goes through `setWordText`,
 * which also splits several typed words over the span.
 */
export function insertWordAt(words: Word[], startMs: number, endMs: number, text: string): EditResult | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const requestedStart = Math.max(0, Math.round(startMs));
  const requestedEnd = Math.round(endMs);
  if (requestedEnd - requestedStart < MIN_WORD_MS) return null;

  // Chronological position: before the first word that starts at or after the requested start.
  let index = words.length;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].startMs >= requestedStart) {
      index = i;
      break;
    }
  }
  const prev = index > 0 ? words[index - 1] : null;
  const next = words[index] ?? null;
  const start = Math.max(requestedStart, prev ? prev.endMs : 0);
  const end = Math.min(requestedEnd, next ? next.startMs : Number.POSITIVE_INFINITY);
  if (end - start < MIN_WORD_MS) return null;

  const token = text.trim().split(/\s+/).filter(Boolean).join(" ");
  const created: Word = {
    text: token,
    startMs: start,
    endMs: Math.min(end, start + MAX_NEW_CAPTION_MS),
    confidence: 1,
    index: 0,
    windowIndex: (prev ?? next)?.windowIndex ?? 0,
  };
  return done([...words.slice(0, index), created, ...words.slice(index)], index);
}

export type NudgeEdge = "start" | "end" | "both";

/**
 * Moves a word's start, its end, or the whole word by `deltaMs` (negative is earlier). The move is
 * cut short where it would make the word shorter than MIN_WORD_MS, push a neighbour below
 * MIN_WORD_MS, or go before 0. A neighbour that is overlapped is trimmed back to the new edge.
 * Returns null when nothing would change.
 */
export function nudgeWord(words: Word[], index: number, edge: NudgeEdge, deltaMs: number): EditResult | null {
  const word = words[index];
  if (!word || !Number.isFinite(deltaMs)) return null;
  const delta = Math.round(deltaMs);
  if (delta === 0) return null;
  const prev = words[index - 1] ?? null;
  const next = words[index + 1] ?? null;

  const lowStart = prev ? prev.startMs + MIN_WORD_MS : 0; // earliest the start may go
  const highEnd = next ? next.endMs - MIN_WORD_MS : Number.POSITIVE_INFINITY; // latest the end may go

  // Moves `current` by `delta` but only ever in the asked direction, so a transcript that was
  // already out of bounds is never pushed the other way by a clamp.
  const move = (current: number, change: number, lo: number, hi: number) =>
    change < 0 ? Math.min(current, Math.max(current + change, lo)) : Math.max(current, Math.min(current + change, hi));

  let start = word.startMs;
  let end = word.endMs;
  if (edge === "start") {
    start = move(start, delta, lowStart, end - MIN_WORD_MS);
  } else if (edge === "end") {
    end = move(end, delta, start + MIN_WORD_MS, highEnd);
  } else {
    const shift = delta < 0 ? move(0, delta, lowStart - start, 0) : move(0, delta, 0, highEnd - end);
    start += shift;
    end += shift;
  }
  if (start === word.startMs && end === word.endMs) return null;

  const out = words.slice();
  out[index] = { ...word, startMs: start, endMs: end };
  if (prev && prev.endMs > start) out[index - 1] = { ...prev, endMs: Math.max(start, prev.startMs + MIN_WORD_MS) };
  if (next && next.startMs < end) out[index + 1] = { ...next, startMs: Math.min(end, next.endMs - MIN_WORD_MS) };
  return done(out, index);
}

/** True when words are in order, each lasts at least 1 ms, and none overlap. Used by tests and as a safety check. */
export function isWellFormed(words: readonly Word[]): boolean {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!(word.endMs > word.startMs) || word.index !== i) return false;
    if (i > 0 && word.startMs < words[i - 1].endMs) return false;
  }
  return true;
}
