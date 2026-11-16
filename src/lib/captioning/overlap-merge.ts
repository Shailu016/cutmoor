import { normalizeIntervals } from "./packer";
import type { SpeechInterval, Word } from "./types";

/**
 * Joins the words from several windows into one transcript, removing the doubles that appear
 * where windows cover the same stretch of video (the overlap the packer leaves when it cuts a
 * region longer than a window).
 *
 * All times here are GLOBAL milliseconds (see types.ts).
 *
 * How a moment of the video is settled:
 *  1. OWNERSHIP. At any time `t`, the window that owns it is the one with the most audio on both
 *     sides of `t` (its "margin": the distance to the nearer edge of its coverage). A window's
 *     audio is least reliable at its edges, so the window with the most context wins. For two
 *     overlapping windows this is the midpoint of the overlap; unlike a seam between neighbours it
 *     also handles windows nested in each other, and three windows covering one moment.
 *     A word is kept by the window that owns its midpoint.
 *  2. DUPLICATES. The same spoken word is rarely timed identically by two windows, so one copy can
 *     land on each side of a seam. Words from different windows that spell nearly the same and
 *     overlap in time are one word, and the better copy is kept. A word that is merely repeated
 *     ("bahut bahut") touches but does not overlap, so it is kept twice.
 *  3. LOST WORDS. Ownership decides who is trusted, not whether a word exists. A word the owner did
 *     not hear is restored when nothing kept covers the same moment, and either (a) it is close to
 *     a point where ownership switches (timing jitter decides which side it falls on), or (b) its own
 *     window had real context there (`minContextMs` from its edges). An edge-of-window word with no
 *     support stays dropped: edges are where Whisper invents text.
 *  4. CUT WORDS. A window cut mid-word hears only part of it. If one text is the start or end of
 *     the other and they overlap in time, the longer text wins and the interval is the union.
 */

export interface WindowWords {
  /** The part of the video this window covers (see `windowSourceSpan`). */
  coverage: SpeechInterval;
  /** Words in global time. */
  words: Word[];
}

export interface MergeOptions {
  /**
   * How much two same-spelling words from different windows must overlap, as a share of the shorter
   * one, to count as the same spoken word. Default 0.3.
   */
  minOverlapRatio?: number;
  /** How close to an ownership switch (ms) a dropped word may be and still be restored. Default 400. */
  seamSlackMs?: number;
  /** How far inside its own window (ms) a dropped word must be to be restored on its own merit. Default 1000. */
  minContextMs?: number;
}

/**
 * Edit distance, capped: returns `cap + 1` whenever the true distance exceeds `cap`, so the result
 * is always in 0..cap+1.
 */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return Math.min(previous[b.length], cap + 1);
}

/** Letters, digits and combining marks only. Marks must stay: dropping them turns Hindi "mera" and "meri" into the same word. */
export const cleanWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

function overlapMs(a: Word, b: Word): number {
  return Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
}

/** True when two words from different windows are the same spoken word. */
function sameWord(a: Word, b: Word, minOverlapRatio: number): boolean {
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  if (shorter <= 0 || overlapMs(a, b) / shorter < minOverlapRatio) return false;
  const left = cleanWord(a.text);
  const right = cleanWord(b.text);
  if (!left || !right) return false;
  // Short words must match exactly: "ho" and "to" are different words one letter apart.
  const allowed = Math.min(left.length, right.length) >= 6 ? 2 : Math.min(left.length, right.length) >= 4 ? 1 : 0;
  return editDistance(left, right, allowed) <= allowed;
}

/** True when one word is the start or end of the other and they overlap in time: a word cut by a window edge. */
function fragmentOf(a: Word, b: Word): boolean {
  if (overlapMs(a, b) <= 0) return false;
  const left = cleanWord(a.text);
  const right = cleanWord(b.text);
  if (left.length < 2 || right.length < 2 || left === right) return false;
  const [short, long] = left.length < right.length ? [left, right] : [right, left];
  return long.startsWith(short) || long.endsWith(short);
}

/** Prefer the more confident copy; on a tie keep the one from the earlier window. */
function pickBetter(a: Word, b: Word): Word {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return a.windowIndex <= b.windowIndex ? a : b;
}

/** Distance from `t` to the nearer edge of the coverage. Negative when `t` is outside it. */
const marginAt = (t: number, coverage: SpeechInterval) => Math.min(t - coverage.startMs, coverage.endMs - t);

export function mergeWindowWords(windows: readonly WindowWords[], options: MergeOptions = {}): Word[] {
  const minOverlapRatio = options.minOverlapRatio ?? 0.3;
  const seamSlackMs = options.seamSlackMs ?? 400;
  const minContextMs = options.minContextMs ?? 1000;
  const ordered = [...windows]
    .filter((window) => window.coverage.endMs > window.coverage.startMs)
    .sort((a, b) => a.coverage.startMs - b.coverage.startMs || a.coverage.endMs - b.coverage.endMs);
  if (ordered.length === 0) return [];

  /** Index of the window that owns time `t`: most margin, the earliest window on a tie. A time outside every window goes to the nearest one. */
  const ownerOf = (t: number): number => {
    let best = 0;
    let bestMargin = -Infinity;
    ordered.forEach((window, index) => {
      const margin = marginAt(t, window.coverage);
      if (margin > bestMargin) {
        bestMargin = margin;
        best = index;
      }
    });
    return best;
  };

  const kept: Word[] = [];
  const dropped: Word[] = [];
  ordered.forEach((window, k) => {
    for (const word of window.words) {
      if (!(word.endMs > word.startMs)) continue;
      const midpoint = (word.startMs + word.endMs) / 2;
      if (ownerOf(midpoint) === k) {
        kept.push({ ...word });
        continue;
      }
      const nearSwitch = ownerOf(midpoint - seamSlackMs) === k || ownerOf(midpoint + seamSlackMs) === k;
      if (nearSwitch || marginAt(midpoint, window.coverage) >= minContextMs) dropped.push({ ...word });
    }
  });

  const byTime = (a: Word, b: Word) => a.startMs - b.startMs || a.endMs - b.endMs;
  kept.sort(byTime);

  // Restore dropped words that nothing kept covers.
  dropped.sort(byTime);
  for (const candidate of dropped) {
    const covered = kept.some((other) => {
      const shorter = Math.min(candidate.endMs - candidate.startMs, other.endMs - other.startMs);
      return overlapMs(candidate, other) > 0 && overlapMs(candidate, other) / shorter >= minOverlapRatio;
    });
    if (!covered) {
      kept.push(candidate);
      kept.sort(byTime);
    }
  }

  // Settle doubles and cut words, comparing every word with every later word it overlaps in time
  // (not only its neighbour: a short word between two copies must not hide them from each other).
  let changed = true;
  while (changed) {
    changed = false;
    search: for (let i = 0; i < kept.length; i += 1) {
      for (let j = i + 1; j < kept.length && kept[j].startMs < kept[i].endMs; j += 1) {
        const a = kept[i];
        const b = kept[j];
        if (a.windowIndex === b.windowIndex) continue;
        let winner: Word | null = null;
        if (sameWord(a, b, minOverlapRatio)) winner = pickBetter(a, b);
        else if (fragmentOf(a, b)) winner = cleanWord(a.text).length >= cleanWord(b.text).length ? a : b;
        if (winner) {
          kept[i] = { ...winner, startMs: Math.min(a.startMs, b.startMs), endMs: Math.max(a.endMs, b.endMs) };
          kept.splice(j, 1);
          changed = true;
          break search;
        }
      }
    }
  }

  // Words must run in order without overlapping. Trim a word that runs into the next one; when
  // two start together, give the first half of its own time instead of crushing it to 1 ms.
  for (let i = 0; i + 1 < kept.length; i += 1) {
    const current = kept[i];
    const next = kept[i + 1];
    if (current.endMs <= next.startMs) continue;
    const cut = next.startMs > current.startMs + 1 ? next.startMs : current.startMs + Math.max(1, Math.floor((current.endMs - current.startMs) / 2));
    kept[i] = { ...current, endMs: Math.min(current.endMs, cut) };
    if (next.startMs < kept[i].endMs) kept[i + 1] = { ...next, startMs: kept[i].endMs, endMs: Math.max(next.endMs, kept[i].endMs + 1) };
  }

  return kept.map((word, index) => ({ ...word, index }));
}

export interface CoverageReport {
  /** Fraction (0 to 1) of the speech time that has a word on it. */
  coverage: number;
  /** Stretches of detected speech, at least `minGapMs` long, with no word at all. */
  gaps: SpeechInterval[];
}

/**
 * Compares the transcript with where the voice detector heard speech, to find stretches that were
 * silently dropped. Raw detector output can overlap, so it is merged first: no time is counted twice.
 */
export function auditCoverage(words: readonly Word[], speech: readonly SpeechInterval[], minGapMs = 500): CoverageReport {
  const sorted = [...words].sort((a, b) => a.startMs - b.startMs);
  const gaps: SpeechInterval[] = [];
  let speechTotal = 0;
  let covered = 0;
  for (const interval of normalizeIntervals(speech, 0)) {
    speechTotal += interval.endMs - interval.startMs;
    let cursor = interval.startMs;
    for (const word of sorted) {
      if (word.endMs <= cursor) continue;
      if (word.startMs >= interval.endMs) break;
      if (word.startMs > cursor && word.startMs - cursor >= minGapMs) gaps.push({ startMs: cursor, endMs: word.startMs });
      covered += Math.min(word.endMs, interval.endMs) - Math.max(word.startMs, cursor);
      cursor = Math.min(Math.max(cursor, word.endMs), interval.endMs);
    }
    if (interval.endMs - cursor >= minGapMs) gaps.push({ startMs: cursor, endMs: interval.endMs });
  }
  return { coverage: speechTotal === 0 ? 1 : covered / speechTotal, gaps };
}
