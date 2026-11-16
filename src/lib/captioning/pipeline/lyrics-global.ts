/**
 * Global, monotonic placement of pasted lyrics on a song (PLAN-R5 Track 1).
 *
 * WHY THIS FILE EXISTS
 * The R4 sliding aligner walked the audio windows in order with a cursor. One unreadable window (an
 * instrumental gap, a dense chorus) left the cursor stuck and every later line was refused: on Sajan it
 * placed 9 of 25 lines before the 30 s gap and then nothing. A cursor can get lost; a global map cannot.
 *
 * THE IDEA ("predict with structure, verify with the model")
 *  1. The free transcript already read some of the words, with times. A sound-alike DP (`findAnchors`)
 *     matches those heard words to the pasted words: those are ANCHORS and their timing is measured.
 *  2. The vocal-activity detector reports the stretches where a voice is present. Those are the only
 *     places a lyric word may live, so an instrumental gap is known, not guessed.
 *  3. Between two anchors (or before the first / after the last) the pasted words that have no anchor
 *     are distributed across the voiced time in order, proportional to their syllable count. A line can
 *     therefore never be placed inside a gap or after the singing ends.
 *  4. Repeated lyric blocks (a chorus typed twice) are mapped by the audio's measured loop lag, so both
 *     occurrences get the same internal timing.
 *
 * The result is a prediction per line and per word. The pipeline then verifies each line with the
 * teacher-forced aligner inside a padded window and keeps the model's timing where its confidence wins;
 * this module is pure and needs no model, so Draft (no aligner) can still place the words approximately.
 *
 * LIMITS
 *  - The plan is only as good as the anchors; a run with no anchors at all gets the structure timing
 *    (marked approximate) and the pipeline's wrong-lyrics guard decides whether to trust it.
 *  - Lines are kept whole: a line is distributed as one unit across the voiced time it is predicted in,
 *    so its internal word spacing is proportional, not measured.
 *  - 4000 pasted words are bounded by `parseLyrics`; the anchor DP is bounded by `findAnchors`.
 */
import type { ParsedLyrics } from "./lyrics";
import { findAnchors, lyricWordCore } from "./lyrics";

/** A timed word from the free transcript. */
export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** A stretch where a voice is present, in global ms, in order. */
export interface VoicedRegion {
  startMs: number;
  endMs: number;
}

/** How a predicted time was obtained. `anchor`: a heard word with that sound, measured. `repeat`: copied from a repeated lyric block by the audio's loop lag. `structure`: distributed across voiced time. */
export type LyricSupport = "anchor" | "repeat" | "structure";

export interface PlannedLyricWord {
  /** Index in `ParsedLyrics.words`. */
  wordIndex: number;
  /** Index in `ParsedLyrics.lines`. */
  lineIndex: number;
  /** Predicted global times. A zero-length interval means "no voiced audio was available". */
  startMs: number;
  endMs: number;
  support: LyricSupport;
  /** True unless the timing is measured (anchor) — structure and repeat are estimates. */
  approximate: boolean;
}

export interface PlannedLyricLine {
  lineIndex: number;
  /** First word index and word count in `ParsedLyrics.words`. */
  firstWord: number;
  wordCount: number;
  startMs: number;
  endMs: number;
  support: LyricSupport;
  /** Index in `GlobalLyricPlan.regions` the line's middle falls in, or -1 when it has no voiced audio. */
  regionIndex: number;
  /** Share (0..1) of the line's words that are anchors. */
  anchorShare: number;
}

export interface GlobalLyricPlan {
  words: PlannedLyricWord[];
  lines: PlannedLyricLine[];
  /** The regions actually used (clamped, sorted, merged). */
  regions: VoicedRegion[];
  /** Pasted words that matched a heard word (anchor). */
  matchedWords: number;
  /** Share of heard words that matched a pasted word (0..1); the wrong-lyrics signal. */
  heardCoverage: number;
  /** Longest run of adjacent anchor matches (a foreign paste has short runs). */
  longestAnchorRun: number;
  /** Lines with at least half their words anchored. */
  anchoredLines: number;
  /** The loop lag used for repeated blocks, or null. */
  repeatLagMs: number | null;
  /** Lines no voiced region could hold (zero-length prediction). */
  unplacedLines: number[];
}

export interface GlobalLyricOptions {
  /** Audio loop lag in ms (from the repeat tracker). Null/absent: no repeat mapping. */
  repeatLagMs?: number | null;
  /** Total audio length in ms; clamps regions. */
  durationMs?: number;
  /** A repeated lyric block is only mapped when its shift is this close to the measured lag. */
  maxRepeatShiftErrorMs?: number;
  /** Shortest word interval produced by distribution; keeps times ordered and non-empty. */
  minWordMs?: number;
  /**
   * The audio's measured repeated passage (earlier occurrence) and its lag. When a repeated lyric block
   * falls near it, the block is fitted to that passage exactly instead of to the syllable estimate: on
   * Sajan this is what moves the chorus from 59.3 s (a permissive voiced region that starts in the
   * instrumental intro) to 63.6 s (where the singing actually starts).
   */
  repeatExtent?: { startMs: number; endMs: number; lagMs: number } | null;
}

const DEFAULT_MAX_REPEAT_ERROR_MS = 4000;
const DEFAULT_MIN_WORD_MS = 60;
/** A region shorter than this is a click, not singing. */
const MIN_REGION_MS = 120;
/** Voiced time shorter than this cannot hold words; the plan marks them unplaced rather than squashing them. */
const MIN_USABLE_MS = 200;
/** Longest repeated line block considered (the anchor side is bounded anyway). */
const MAX_REPEAT_BLOCK = 12;

/** Letters that make a syllable: a vowel group. Devanagari vowels and marks count as vowels. */
const VOWEL = /[aeiouyāīūēōæøɑɐɔəɜɛɪʊʌɤɨʉɯɵøœ\u0904-\u0914\u093e-\u094c\u0960-\u0963]/iu;

/**
 * Syllable weight of one word: the number of vowel groups, at least 1. A syllable is the unit a singer
 * stretches, so it is the right share of a time span (character count overweights consonant clusters).
 */
export function syllableWeight(text: string): number {
  const core = lyricWordCore(text);
  if (core.length === 0) return 1;
  let groups = 0;
  let inGroup = false;
  for (const char of core) {
    const vowel = VOWEL.test(char);
    if (vowel && !inGroup) groups += 1;
    inGroup = vowel;
  }
  return Math.max(1, groups);
}

/** Clamp, sort and merge voiced regions; drops empty/degenerate ones and anything past `durationMs`. */
export function normaliseRegions(regions: readonly VoicedRegion[], durationMs?: number): VoicedRegion[] {
  const limit = Number.isFinite(durationMs) && (durationMs as number) > 0 ? (durationMs as number) : Number.POSITIVE_INFINITY;
  const clean: VoicedRegion[] = [];
  for (const region of regions) {
    if (!region) continue;
    const start = Math.max(0, Number.isFinite(region.startMs) ? region.startMs : 0);
    const end = Math.min(limit, Number.isFinite(region.endMs) ? region.endMs : 0);
    if (end - start < MIN_REGION_MS) continue;
    clean.push({ startMs: start, endMs: end });
  }
  clean.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: VoicedRegion[] = [];
  for (const region of clean) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && region.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, region.endMs);
    } else {
      merged.push({ ...region });
    }
  }
  return merged;
}

/** The voiced pieces inside [startMs, endMs], in order. */
function intersectRegions(regions: readonly VoicedRegion[], startMs: number, endMs: number): VoicedRegion[] {
  const out: VoicedRegion[] = [];
  for (const region of regions) {
    const start = Math.max(startMs, region.startMs);
    const end = Math.min(endMs, region.endMs);
    if (end - start > 0) out.push({ startMs: start, endMs: end });
  }
  return out;
}

/** How far (ms) a time is from the nearest voiced region; 0 when inside one. */
function distanceToRegions(regions: readonly VoicedRegion[], atMs: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    if (atMs >= region.startMs && atMs <= region.endMs) return 0;
    best = Math.min(best, Math.abs(atMs - region.startMs), Math.abs(atMs - region.endMs));
  }
  return best;
}

/**
 * True when a word's interval is real voiced audio: its middle is inside a region, or at least 30 % of
 * its length overlaps one. A word the model dropped just past the end of a phrase (the 150 ms overlap
 * of Sajan's "Meri" at 30.3 s) therefore does not become an anchor.
 */
function wordInVoiced(regions: readonly VoicedRegion[], startMs: number, endMs: number): boolean {
  const middle = (startMs + endMs) / 2;
  if (distanceToRegions(regions, middle) === 0) return true;
  const length = Math.max(1, endMs - startMs);
  let overlap = 0;
  for (const region of regions) overlap += Math.max(0, Math.min(endMs, region.endMs) - Math.max(startMs, region.startMs));
  return overlap / length >= 0.3;
}

/** Voice gaps shorter than this do not split a phrase: pieces closer than this are one cluster. */
const CLUSTER_GAP_MS = 1500;
/** The margin left after a previous anchor and before the next one, so a line does not eat a neighbour's tail. */
const ANCHOR_PAD_MS = 300;
/** Longest believable time between two neighbouring words of one pasted line (a held sung note is a few seconds). */
const MAX_SAME_LINE_GAP_MS = 5000;

/** Group voiced pieces into clusters separated by real (instrumental) gaps. */
function clusterPieces(pieces: readonly VoicedRegion[], maxGapMs = CLUSTER_GAP_MS): VoicedRegion[][] {
  const clusters: VoicedRegion[][] = [];
  let current: VoicedRegion[] = [];
  for (const piece of pieces) {
    const previous = current[current.length - 1];
    if (previous !== undefined && piece.startMs - previous.endMs > maxGapMs) {
      clusters.push(current);
      current = [];
    }
    current.push(piece);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function clusterLength(cluster: readonly VoicedRegion[]): number {
  let total = 0;
  for (const piece of cluster) total += piece.endMs - piece.startMs;
  return total;
}

/**
 * Pick the one cluster the words are distributed across. Words between two anchors belong to the
 * voiced block NEAREST THE NEXT ANCHOR (a line does not start in the tail of the previous phrase);
 * leading words take the first block. A block too short to hold the words at a sung pace is not chosen
 * unless nothing else exists.
 */
function chooseCluster(clusters: readonly VoicedRegion[][], neededMs: number, prefer: "first" | "last"): VoicedRegion[] {
  if (clusters.length === 0) return [];
  const usable = clusters.filter((cluster) => clusterLength(cluster) >= Math.max(400, neededMs));
  if (usable.length > 0) return prefer === "first" ? usable[0] : usable[usable.length - 1];
  let best = clusters[0];
  for (const cluster of clusters) if (clusterLength(cluster) > clusterLength(best)) best = cluster;
  return best;
}

interface Piece {
  startMs: number;
  endMs: number;
  support: LyricSupport;
}

/**
 * Distribute the words `from..to` (inclusive-exclusive) across the voiced pieces in [startMs, endMs],
 * proportional to their syllable weight. A word never spans a gap: if the proportional interval would
 * cross one, it ends at the end of the piece it starts in. Word times are strictly ordered.
 */
function distributeWords(
  weights: readonly number[],
  from: number,
  to: number,
  pieces: readonly VoicedRegion[],
  minWordMs: number,
  fallbackAt: number,
  floorMs = 0,
): Piece[] {
  const count = Math.max(0, to - from);
  const out: Piece[] = [];
  if (count === 0) return out;
  if (pieces.length === 0) {
    // No voiced audio in this span: a zero-length prediction at the span's end, reported as unplaced.
    for (let i = 0; i < count; i += 1) out.push({ startMs: fallbackAt, endMs: fallbackAt, support: "structure" });
    return out;
  }
  let totalMs = 0;
  for (const piece of pieces) totalMs += piece.endMs - piece.startMs;
  if (totalMs < MIN_USABLE_MS) {
    for (let i = 0; i < count; i += 1) out.push({ startMs: pieces[0].startMs, endMs: pieces[0].startMs, support: "structure" });
    return out;
  }
  let totalWeight = 0;
  for (let i = 0; i < count; i += 1) totalWeight += Math.max(1, weights[from + i] ?? 1);
  // Walk the pieces once, converting a fraction of the total voiced time into a real time.
  const timeAt = (fraction: number): { ms: number; piece: number } => {
    let remaining = Math.max(0, Math.min(1, fraction)) * totalMs;
    for (let p = 0; p < pieces.length; p += 1) {
      const length = pieces[p].endMs - pieces[p].startMs;
      if (remaining <= length) return { ms: pieces[p].startMs + remaining, piece: p };
      remaining -= length;
    }
    const last = pieces.length - 1;
    return { ms: pieces[last].endMs, piece: last };
  };
  let consumed = 0;
  let previousEnd = Math.max(pieces[0].startMs, floorMs);
  for (let i = 0; i < count; i += 1) {
    const weight = Math.max(1, weights[from + i] ?? 1);
    const before = consumed / totalWeight;
    consumed += weight;
    const after = consumed / totalWeight;
    const startAt = timeAt(before);
    const endAt = timeAt(after);
    // Start no earlier than the previous word (and the caller's floor), and never before the span.
    let start = Math.max(startAt.ms, previousEnd);
    let piece = startAt.piece;
    while (piece + 1 < pieces.length && start >= pieces[piece].endMs) piece += 1;
    if (start >= pieces[piece].endMs) {
      // The voiced audio is used up: a zero-length word stays ordered and is reported as unplaced. It is
      // never pushed 1 ms past the last voiced frame (the old code drifted further with every word).
      const at = pieces[pieces.length - 1].endMs;
      out.push({ startMs: at, endMs: at, support: "structure" });
      previousEnd = at;
      continue;
    }
    start = Math.max(start, pieces[piece].startMs);
    let end = Math.max(endAt.ms, start + minWordMs);
    if (endAt.piece !== piece) end = pieces[piece].endMs;
    const pieceEnd = pieces[piece].endMs;
    end = Math.min(end, pieceEnd);
    if (end <= start) {
      // Not enough room for the minimum length: a zero-length slot at the piece end, never overlapping.
      out.push({ startMs: Math.round(pieceEnd), endMs: Math.round(pieceEnd), support: "structure" });
      previousEnd = pieceEnd;
      continue;
    }
    out.push({ startMs: Math.round(start), endMs: Math.round(end), support: "structure" });
    previousEnd = out[out.length - 1].endMs;
  }
  return out;
}

/** Canonical text of one line, for repeat detection. */
function canonicalLine(words: readonly string[]): string {
  return words.map(lyricWordCore).join(" ").trim();
}

interface LineRange {
  first: number;
  count: number;
  canonical: string;
}

function lineRanges(parsed: ParsedLyrics): LineRange[] {
  return parsed.lines.map((line, index) => ({
    first: line.firstWord,
    count: line.words.length,
    canonical: canonicalLine(line.words) || `__empty_${index}`,
  }));
}

/**
 * Predict the global timing of every pasted word.
 *
 * See the file header for the four steps. The function never throws and always returns one entry per
 * pasted word and line: a wrong paste still gets a plan (the pipeline's wrong-lyrics guard rejects it),
 * and a plan with no voiced regions marks every line unplaced instead of inventing audio.
 */
export function planGlobalLyrics(
  parsed: ParsedLyrics,
  heard: readonly TimedWord[],
  voiced: readonly VoicedRegion[],
  options: GlobalLyricOptions = {},
): GlobalLyricPlan {
  const minWordMs = Number.isFinite(options.minWordMs) && (options.minWordMs as number) > 0 ? (options.minWordMs as number) : DEFAULT_MIN_WORD_MS;
  const regions = normaliseRegions(voiced, options.durationMs);
  const fallbackRegions: VoicedRegion[] =
    regions.length > 0
      ? regions
      : heard.length > 0
        ? normaliseRegions([{ startMs: heard[0].startMs, endMs: heard[heard.length - 1].endMs }], options.durationMs)
        : [];
  const words = parsed.words;
  const total = words.length;
  const weights = words.map(syllableWeight);
  const times: (Piece | null)[] = new Array(total).fill(null);
  // minRun 1: every monotonic match is returned, but only a match inside a run of two or more is
  // STRONG evidence. An isolated exact match ("Ab" before "sajan") is still a useful single-word
  // anchor for timing; an isolated sound-alike is not (artists and names sound alike by accident).
  const anchorResult = findAnchors(words, heard.map((word) => word.text), { minRun: 1 });
  const strong = new Set<number>();
  for (const run of anchorResult.runs) if (run.length >= 2) for (const anchor of run) strong.add(anchor.lyricIndex);
  const anchorOf = new Map<number, number>();
  const heardCovered = new Set<number>();
  for (const anchor of anchorResult.anchors) {
    if (!anchorOf.has(anchor.lyricIndex)) anchorOf.set(anchor.lyricIndex, anchor.heardIndex);
  }
  let longestAnchorRun = 0;
  for (const run of anchorResult.runs) longestAnchorRun = Math.max(longestAnchorRun, run.length);
  for (const anchor of anchorResult.anchors) if (strong.has(anchor.lyricIndex)) heardCovered.add(anchor.heardIndex);

  for (const [lyricIndex, heardIndex] of anchorOf) {
    const heardWord = heard[heardIndex];
    if (!heardWord) continue;
    const start = Number.isFinite(heardWord.startMs) ? heardWord.startMs : 0;
    const end = Number.isFinite(heardWord.endMs) ? Math.max(heardWord.endMs, start + 1) : start + 1;
    // An anchor only counts when the word really sits in voiced audio: a word the model put in an
    // instrumental gap (Sajan's "Meri" at 30.3 s is the measured case) is not evidence of the lyric.
    // An isolated match must be exact (no sound-alike guessing); runs may use the sound-alike rule.
    const exact = lyricWordCore(words[lyricIndex]) === lyricWordCore(heardWord.text);
    if (!strong.has(lyricIndex) && !exact) continue;
    if (fallbackRegions.length > 0 && !wordInVoiced(fallbackRegions, start, end)) continue;
    times[lyricIndex] = { startMs: start, endMs: end, support: "anchor" };
  }

  // The anchor sequence in reading order, with valid finite times only.
  let anchorPoints: { wordIndex: number; atMs: number; weak: boolean }[] = [];
  for (let index = 0; index < total; index += 1) {
    const piece = times[index];
    if (piece !== null && piece.support === "anchor" && Number.isFinite(piece.startMs) && Number.isFinite(piece.endMs)) {
      anchorPoints.push({ wordIndex: index, atMs: (piece.startMs + piece.endMs) / 2, weak: !strong.has(index) });
    }
  }
  anchorPoints.sort((a, b) => a.wordIndex - b.wordIndex || a.atMs - b.atMs);
  /**
   * A single exact word with no run behind it is only trusted when the anchor sequence around it agrees.
   * Sajan's hallucinated "Meri" at 30.3 s (the model wrote one word into a 17 s instrumental passage) was
   * accepted as an isolated exact match and dragged line 10 back by 17 s. In a real sung line two adjacent
   * lyric words are never 17 s apart, so such an island is dropped and the word is placed from structure.
   */
  if (anchorPoints.length > 1) {
    // Which pasted line each word belongs to: two words of the SAME line are sung close together.
    const lineOf = new Array<number>(total).fill(-1);
    parsed.lines.forEach((line, lineIndex) => {
      const next = parsed.lines[lineIndex + 1];
      const end = next === undefined ? total : next.firstWord;
      for (let index = line.firstWord; index < end; index += 1) lineOf[index] = lineIndex;
    });
    /**
     * One line is sung in one go. An anchor far from the median time of its own line's other anchors is a
     * hallucinated copy, even inside a run: Sajan's model wrote "Meri" at 29.85 s, just before the 17 s
     * instrumental, and "zindagi mera..." at 47.6 s, so "Meri zindagi mera" looked like a 3-word run 18 s wide.
     * Only lines with at least 3 anchors are judged (two points have no majority).
     */
    const outlier = new Set<number>();
    const byLine = new Map<number, typeof anchorPoints>();
    for (const point of anchorPoints) {
      const line = lineOf[point.wordIndex];
      if (line === -1) continue;
      const list = byLine.get(line) ?? [];
      list.push(point);
      byLine.set(line, list);
    }
    for (const points of byLine.values()) {
      if (points.length < 3) continue;
      const sorted = [...points].sort((a, b) => a.atMs - b.atMs);
      const median = sorted[Math.floor(sorted.length / 2)];
      // Neighbouring anchors of one line (in word order) more than MAX_SAME_LINE_GAP_MS apart per word step: the one
      // farther from the line's median time is the stray copy. Repeat until no such pair is left.
      const ordered = [...points].sort((a, b) => a.wordIndex - b.wordIndex);
      for (let changed = true; changed; ) {
        changed = false;
        const alive = ordered.filter((point) => !outlier.has(point.wordIndex));
        for (let i = 1; i < alive.length; i += 1) {
          const a = alive[i - 1];
          const b = alive[i];
          const steps = Math.max(1, b.wordIndex - a.wordIndex);
          if (Math.abs(b.atMs - a.atMs) / steps > MAX_SAME_LINE_GAP_MS) {
            const worse = Math.abs(a.atMs - median.atMs) >= Math.abs(b.atMs - median.atMs) ? a : b;
            outlier.add(worse.wordIndex);
            changed = true;
            break;
          }
        }
      }
    }
    const keep = anchorPoints.map((point, index) => {
      if (outlier.has(point.wordIndex)) return false;
      if (!point.weak) return true;
      const before = anchorPoints[index - 1];
      const after = anchorPoints[index + 1];
      const nearest = Math.min(
        before === undefined ? Number.POSITIVE_INFINITY : Math.abs(point.atMs - before.atMs),
        after === undefined ? Number.POSITIVE_INFINITY : Math.abs(point.atMs - after.atMs),
      );
      return nearest <= 6000;
    });
    anchorPoints = anchorPoints.filter((_point, index) => keep[index]);
    // Whatever was dropped must not keep its anchor time.
    const kept = new Set(anchorPoints.map((point) => point.wordIndex));
    for (let index = 0; index < total; index += 1) {
      if (times[index]?.support === "anchor" && !kept.has(index)) times[index] = null;
    }
  }

  const regionStart = fallbackRegions.length > 0 ? fallbackRegions[0].startMs : 0;
  const regionEnd = fallbackRegions.length > 0 ? fallbackRegions[fallbackRegions.length - 1].endMs : 0;

  /** Highest end assigned so far: no later word may start before it (the plan is monotonic by contract). */
  let assignedEnd = 0;
  /** End of one already-placed anchor word, so words after it never start before it. */
  const anchorEnd = (index: number): number => {
    const piece = times[index];
    return piece === null || piece === undefined ? 0 : piece.endMs;
  };
  const fill = (from: number, to: number, startMs: number, endMs: number, prefer: "first" | "last", padStart: boolean, padEnd: boolean, floorMs = 0) => {
    if (from >= to) return;
    let low = padStart ? startMs + ANCHOR_PAD_MS : startMs;
    let high = padEnd ? endMs - ANCHOR_PAD_MS : endMs;
    if (!(high > low)) {
      // Two anchors closer together than the two pads: the pad would invert the span. Use the real span.
      low = startMs;
      high = endMs;
    }
    if (!(high > low)) {
      // Still nothing (two anchors at the same time): a zero-length slot, in order.
      for (let index = from; index < to; index += 1) times[index] = { startMs: Math.round(Math.max(low, assignedEnd)), endMs: Math.round(Math.max(low, assignedEnd)), support: "structure" };
      return;
    }
    const pieces = intersectRegions(fallbackRegions, low, high);
    const needed = (to - from) * 260;
    const chosen = chooseCluster(clusterPieces(pieces), needed, prefer);
    const predicted = distributeWords(weights, from, to, chosen, minWordMs, Number.isFinite(high) ? high : regionEnd, Math.max(assignedEnd, floorMs));
    for (let i = 0; i < predicted.length; i += 1) {
      times[from + i] = predicted[i];
      if (predicted[i].endMs > assignedEnd) assignedEnd = predicted[i].endMs;
    }
  };

  if (anchorPoints.length === 0) {
    fill(0, total, regionStart, regionEnd, "first", false, false);
  } else {
    // Before the first anchor: from the first voiced moment to the first anchor.
    fill(0, anchorPoints[0].wordIndex, regionStart, anchorPoints[0].atMs, "last", false, true);
    for (let a = 0; a < anchorPoints.length - 1; a += 1) {
      const left = anchorPoints[a];
      const right = anchorPoints[a + 1];
      if (right.wordIndex - left.wordIndex <= 1) continue;
      fill(left.wordIndex + 1, right.wordIndex, left.atMs, right.atMs, "last", true, true, anchorEnd(left.wordIndex));
    }
    const last = anchorPoints[anchorPoints.length - 1];
    fill(last.wordIndex + 1, total, last.atMs, regionEnd, "last", true, false, anchorEnd(last.wordIndex));
  }

  // Any word still without a time (e.g. an anchor time that was not finite) gets a zero-length slot.
  for (let index = 0; index < total; index += 1) {
    if (times[index] === null) times[index] = { startMs: regionEnd, endMs: regionEnd, support: "structure" };
  }

  // ---- line-level refinement: a line with measured anchors times its other words from them
  // (before the first anchor, between two anchors, after the last), instead of from the neighbouring
  // gap. Sajan's "Meri" at the start of line 18 was being squeezed into the tail of the chorus 1.3 s
  // before the measured "zindagi"; here it is placed just before that anchor instead.
  const lineRangesForRefinement = lineRanges(parsed);
  /** The voiced region that holds `atMs`, or the nearest one. */
  const regionAround = (atMs: number): VoicedRegion | null => {
    if (fallbackRegions.length === 0) return null;
    let best = fallbackRegions[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const region of fallbackRegions) {
      if (atMs >= region.startMs && atMs <= region.endMs) return region;
      const distance = Math.min(Math.abs(atMs - region.startMs), Math.abs(atMs - region.endMs));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = region;
      }
    }
    return best;
  };
  /** No refined word may start before the previous word of the plan. */
  let previousWordEnd = 0;
  for (const range of lineRangesForRefinement) {
    const anchoredHere: number[] = [];
    for (let w = 0; w < range.count; w += 1) {
      const index = range.first + w;
      if (times[index]?.support === "anchor") anchoredHere.push(index);
    }
    if (anchoredHere.length === 0) continue;
    // Average sung word length in this line (>= MIN_WORD) for the words with no evidence.
    let sum = 0;
    for (const index of anchoredHere) sum += (times[index] as Piece).endMs - (times[index] as Piece).startMs;
    const averageMs = Math.max(minWordMs, sum / anchoredHere.length);
    const placeBefore = (from: number, to: number, atMs: number) => {
      // Backwards from `atMs` so the last word ends where the first anchor starts, but never before the
      // previous word of the plan and never outside the anchor's voiced region.
      const region = regionAround(atMs);
      const floor = Math.max(previousWordEnd, region?.startMs ?? regionStart);
      let cursor = Math.max(atMs, floor);
      for (let index = to - 1; index >= from; index -= 1) {
        const weight = Math.max(1, weights[index] ?? 1);
        const length = Math.max(minWordMs, averageMs * (weight / Math.max(1, weights[to - 1] ?? 1)));
        const start = Math.max(floor, cursor - length);
        times[index] = { startMs: Math.round(start), endMs: Math.round(Math.max(cursor, start)), support: "structure" };
        cursor = start;
      }
    };
    const placeBetween = (from: number, to: number, startMs: number, endMs: number) => {
      if (from >= to) return;
      const low = Math.max(startMs, previousWordEnd);
      // Two anchors closer than the words need (or an inverted span) keep the distribution's own times.
      if (!(endMs > low)) return;
      const span = Math.max((to - from) * minWordMs, endMs - low);
      let totalWeight = 0;
      for (let index = from; index < to; index += 1) totalWeight += Math.max(1, weights[index] ?? 1);
      let consumed = 0;
      let cursor = low;
      for (let index = from; index < to; index += 1) {
        const weight = Math.max(1, weights[index] ?? 1);
        consumed += weight;
        const end = Math.min(endMs, low + (span * consumed) / totalWeight);
        times[index] = { startMs: Math.round(cursor), endMs: Math.round(Math.max(end, cursor)), support: "structure" };
        cursor = times[index]?.endMs ?? cursor;
      }
    };
    const placeAfter = (from: number, to: number, atMs: number) => {
      const region = regionAround(atMs);
      const limit = region?.endMs ?? regionEnd;
      let cursor = Math.max(atMs, previousWordEnd);
      for (let index = from; index < to; index += 1) {
        const weight = Math.max(1, weights[index] ?? 1);
        const length = Math.max(minWordMs, averageMs * (weight / Math.max(1, weights[from] ?? 1)));
        if (cursor >= limit) {
          // No voiced audio left after the anchor: a zero-length slot stays ordered and is reported unplaced.
          times[index] = { startMs: Math.round(cursor), endMs: Math.round(cursor), support: "structure" };
          continue;
        }
        const end = Math.min(limit, cursor + length);
        times[index] = { startMs: Math.round(cursor), endMs: Math.round(Math.max(end, cursor)), support: "structure" };
        cursor = times[index]?.endMs ?? cursor;
      }
    };
    const firstAnchor = anchoredHere[0];
    const lastAnchor = anchoredHere[anchoredHere.length - 1];
    if (firstAnchor > range.first) placeBefore(range.first, firstAnchor, (times[firstAnchor] as Piece).startMs);
    for (let a = 0; a < anchoredHere.length - 1; a += 1) {
      const left = anchoredHere[a];
      const right = anchoredHere[a + 1];
      if (right - left > 1) placeBetween(left + 1, right, (times[left] as Piece).endMs, (times[right] as Piece).startMs);
    }
    const lineEnd = range.first + range.count;
    if (lastAnchor + 1 < lineEnd) placeAfter(lastAnchor + 1, lineEnd, (times[lastAnchor] as Piece).endMs);
    for (let index = range.first; index < lineEnd; index += 1) {
      const piece = times[index];
      if (piece !== null && piece.endMs > previousWordEnd) previousWordEnd = piece.endMs;
    }
  }

  // ---- one monotonic pass: the contract is start(t) >= end of every earlier word. A measured anchor can
  // sit slightly before a structure word that was placed from the old gap, and a zero-length slot must stay
  // ordered rather than overlap. This never invents audio: a word that would run backwards is shortened.
  {
    let previousEnd = 0;
    for (let index = 0; index < total; index += 1) {
      const piece = times[index];
      if (piece === null) continue;
      if (piece.endMs <= piece.startMs) {
        const at = Math.max(piece.startMs, previousEnd);
        times[index] = { startMs: at, endMs: at, support: piece.support };
        previousEnd = at;
        continue;
      }
      const start = Math.max(piece.startMs, previousEnd);
      const end = Math.max(start, piece.endMs);
      times[index] = { startMs: start, endMs: end, support: piece.support };
      previousEnd = end;
    }
  }

  // ---- repeated lyric blocks: map the later copy by the audio's measured loop lag
  const lag = Number.isFinite(options.repeatLagMs) && (options.repeatLagMs as number) > 0 ? (options.repeatLagMs as number) : null;
  let usedLag: number | null = null;
  const lines = lineRanges(parsed);
  /** Line ranges already fitted to the measured audio extent (both occurrences of a repeated block). */
  const fittedLines: { from: number; to: number }[] = [];
  const insideFitted = (index: number): boolean => fittedLines.some((range) => index >= range.from && index < range.to);
  if (lag !== null && lines.length > 1 && total > 0) {
    const maxError = Number.isFinite(options.maxRepeatShiftErrorMs) && (options.maxRepeatShiftErrorMs as number) > 0 ? (options.maxRepeatShiftErrorMs as number) : DEFAULT_MAX_REPEAT_ERROR_MS;
    const lineStart = (index: number): number => {
      const first = lines[index].first;
      const piece = times[first];
      return piece === null ? Number.NaN : piece.startMs;
    };
    for (let a = 0; a < lines.length; a += 1) {
      for (let b = a + 1; b < lines.length; b += 1) {
        if (lines[a].canonical !== lines[b].canonical || lines[a].count !== lines[b].count || lines[a].canonical.startsWith("__empty_")) continue;
        // How many consecutive lines repeat?
        let block = 1;
        while (b + block < lines.length && a + block < b && lines[a + block].canonical === lines[b + block].canonical && lines[a + block].count === lines[b + block].count) block += 1;
        if (block < 2) continue;
        block = Math.min(block, MAX_REPEAT_BLOCK);
        if (insideFitted(a) || insideFitted(a + block - 1) || insideFitted(b) || insideFitted(b + block - 1)) continue;
        const firstStart = lineStart(a);
        const secondStart = lineStart(b);
        if (!Number.isFinite(firstStart)) continue;
        const shifted = firstStart + lag;
        const predicted = Number.isFinite(secondStart) ? secondStart : shifted;
        if (Math.abs(predicted - shifted) > maxError) continue;

        // The audio's own repeated passage wins over the syllable estimate. If the earlier lyric block's
        // prediction is near the measured extent, fit the block to the extent and copy that timing to the
        // second occurrence by the measured lag. Anchored source words are never moved.
        const extent = options.repeatExtent;
        // Sub-pairs of the same chorus (line 14-17 matches line 22-25 too) must not each be fitted to
        // the same extent: that restarts every line at the extent start. Only the maximal block is fitted.
        const overlapsFitted = insideFitted(a) || insideFitted(a + block - 1) || insideFitted(b) || insideFitted(b + block - 1);
        if (extent !== null && extent !== undefined && Math.abs(extent.lagMs - lag) <= 150 && block >= 2 && !overlapsFitted) {
          const extentValid = Number.isFinite(extent.startMs) && Number.isFinite(extent.endMs) && extent.endMs - extent.startMs >= 1000;
          const nearExtent = Math.abs(firstStart - extent.startMs) <= 6000 || (firstStart < extent.endMs && firstStart + 1000 > extent.startMs);
          let hasAnchor = false;
          for (let k = 0; k < block && !hasAnchor; k += 1) {
            const source = lines[a + k];
            for (let w = 0; w < source.count; w += 1) if (times[source.first + w]?.support === "anchor") { hasAnchor = true; break; }
          }
          if (extentValid && nearExtent && !hasAnchor) {
            const blockFirst = lines[a].first;
            const blockLast = lines[a + block - 1];
            const blockEndWord = blockLast.first + blockLast.count;
            const fitted = distributeWords(
              weights,
              blockFirst,
              blockEndWord,
              [{ startMs: extent.startMs, endMs: extent.endMs }],
              minWordMs,
              extent.endMs,
            );
            for (let i = 0; i < fitted.length; i += 1) {
              times[blockFirst + i] = { startMs: fitted[i].startMs, endMs: fitted[i].endMs, support: "repeat" };
            }
            for (let k = 0; k < block; k += 1) {
              const source = lines[a + k];
              const target = lines[b + k];
              for (let w = 0; w < source.count; w += 1) {
                const piece = times[source.first + w] as Piece;
                if (times[target.first + w]?.support === "anchor") continue;
                times[target.first + w] = { startMs: piece.startMs + lag, endMs: piece.endMs + lag, support: "repeat" };
              }
            }
            fittedLines.push({ from: a, to: a + block }, { from: b, to: b + block });
            usedLag = lag;
            continue;
          }
        }
        // Copy the block's word times, shifted by the lag, but only inside real voiced audio. A target
        // block that holds ANY measured anchor is already timed by the audio; the lag adds nothing.
        let ok = true;
        for (let k = 0; k < block && ok; k += 1) {
          const target = lines[b + k];
          for (let w = 0; w < target.count; w += 1) if ((times[target.first + w]?.support ?? "") === "anchor") { ok = false; break; }
        }
        if (!ok) continue;
        for (let k = 0; k < block && ok; k += 1) {
          const source = lines[a + k];
          const target = lines[b + k];
          for (let w = 0; w < source.count; w += 1) {
            const piece = times[source.first + w];
            if (piece === null) { ok = false; break; }
            const start = piece.startMs + lag;
            const end = piece.endMs + lag;
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { ok = false; break; }
            if (fallbackRegions.length > 0 && intersectRegions(fallbackRegions, start, Math.max(end, start + 1)).length === 0) { ok = false; break; }
            if (Number.isFinite(options.durationMs) && end > (options.durationMs as number) + 500) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (let k = 0; k < block; k += 1) {
          const source = lines[a + k];
          const target = lines[b + k];
          for (let w = 0; w < source.count; w += 1) {
            const piece = times[source.first + w] as Piece;
            // A measured anchor is better evidence than a loop lag: never overwrite it.
            if (times[target.first + w]?.support === "anchor") continue;
            times[target.first + w] = { startMs: piece.startMs + lag, endMs: piece.endMs + lag, support: "repeat" };
          }
        }
        usedLag = lag;
      }
    }
  }

  // ---- output
  const plannedWords: PlannedLyricWord[] = words.map((_word, index) => {
    const piece = times[index] as Piece;
    return {
      wordIndex: index,
      lineIndex: parsed.lineOfWord[index] ?? 0,
      startMs: piece.startMs,
      endMs: piece.endMs,
      support: piece.support,
      approximate: piece.support !== "anchor",
    };
  });

  const plannedLines: PlannedLyricLine[] = [];
  const unplacedLines: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const range = lines[index];
    let startMs = Number.POSITIVE_INFINITY;
    let endMs = Number.NEGATIVE_INFINITY;
    let anchored = 0;
    let hasAnchor = false;
    let hasRepeat = false;
    for (let w = 0; w < range.count; w += 1) {
      const word = plannedWords[range.first + w];
      if (!word) continue;
      if (word.endMs > word.startMs) {
        startMs = Math.min(startMs, word.startMs);
        endMs = Math.max(endMs, word.endMs);
      }
      if (strong.has(word.wordIndex)) anchored += 1;
      if (word.support === "anchor") hasAnchor = true;
      if (word.support === "repeat") hasRepeat = true;
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      startMs = 0;
      endMs = 0;
      unplacedLines.push(index);
    }
    const middle = (startMs + endMs) / 2;
    const regionIndex = fallbackRegions.findIndex((region) => middle >= region.startMs && middle <= region.endMs);
    const support: LyricSupport = hasAnchor ? "anchor" : hasRepeat ? "repeat" : "structure";
    plannedLines.push({
      lineIndex: index,
      firstWord: range.first,
      wordCount: range.count,
      startMs,
      endMs,
      support,
      regionIndex,
      anchorShare: range.count > 0 ? anchored / range.count : 0,
    });
  }

  return {
    words: plannedWords,
    lines: plannedLines,
    regions: fallbackRegions,
    matchedWords: anchorOf.size,
    heardCoverage: heard.length > 0 ? heardCovered.size / heard.length : 0,
    longestAnchorRun,
    anchoredLines: plannedLines.filter((line) => line.anchorShare >= 0.5).length,
    repeatLagMs: usedLag,
    unplacedLines,
  };
}

/**
 * The wrong-lyrics verdict. A paste is trusted when its anchors are structured (lines mostly anchored,
 * or a long adjacent run) — not when a handful of common words happen to coincide. Measured on Sajan:
 * the true Gemini lyrics give 15/25 lines anchored and a 13-word run; the KING script gives 0/29 and a
 * 2-word run. A paste with no anchors at all is never trusted.
 */
export function lyricPlanLooksRight(plan: GlobalLyricPlan, lineCount: number): boolean {
  // A handful of common words matching by accident is not evidence, so a normal paste needs 4 matched words. A paste
  // shorter than that (a visitor pasting one short line) is trusted only when every one of its words matched.
  const needed = plan.words.length > 0 ? Math.min(4, plan.words.length) : 4;
  if (plan.matchedWords < needed || plan.matchedWords === 0) return false;
  if (lineCount >= 8) return plan.anchoredLines >= Math.max(2, Math.ceil(lineCount * 0.2)) || plan.longestAnchorRun >= 6;
  return plan.longestAnchorRun >= 3 || plan.anchoredLines >= 1;
}

/** Preferred layout break word indices: the first word of every pasted line except the first. */
export function lyricBreakWords(parsed: ParsedLyrics): number[] {
  return parsed.lines.slice(1).map((line) => line.firstWord);
}
