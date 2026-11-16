import type { PackedRegion, PackedWindow, SpeechInterval, Word } from "./types";

/**
 * Packs the speech a voice-activity detector found into fixed-length windows for Whisper.
 *
 * Whisper's encoder sees exactly 30 s. Feeding it short, variable chunks costs quality and makes
 * the GPU recompile for every new shape, so instead we glue speech regions together (with a short
 * stretch of silence between them) until a window is full, and pad the rest. Afterwards
 * `toGlobalMs` / `toGlobalWord` map the model's window-local times back onto the video.
 *
 * Packing in timeline order with "start a new window when the next region does not fit" gives
 * the fewest windows possible. A dynamic program would only help if regions could be reordered,
 * which would scramble the transcript, so it is not used.
 */

export interface PackOptions {
  /** The model's fixed input length. 30 000 for stock Whisper. */
  windowMs?: number;
  /** Silence inserted between two regions in one window, so words do not run together. */
  gapMs?: number;
  /** Regions closer than this in the source are merged before packing. */
  mergeBelowMs?: number;
  /** A region longer than a window is cut into pieces that overlap by this much, so the merger can stitch them. */
  splitOverlapMs?: number;
  /**
   * Picks where to cut a too-long region. Receives the earliest and latest allowed cut (source ms)
   * and returns one inside that range, ideally the quietest moment. Defaults to the latest allowed cut.
   */
  chooseCut?: (earliestMs: number, latestMs: number) => number;
}

const DEFAULTS = { windowMs: 30_000, gapMs: 250, mergeBelowMs: 300, splitOverlapMs: 150 } as const;
/** The shortest last piece of a split region worth giving a whole window. */
const MIN_TAIL_MS = 2000;

/** Sorts, drops empty or invalid intervals, and merges neighbours closer than `mergeBelowMs`. */
export function normalizeIntervals(intervals: readonly SpeechInterval[], mergeBelowMs: number = DEFAULTS.mergeBelowMs): SpeechInterval[] {
  const valid = intervals
    .filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs > item.startMs)
    .map((item) => ({ startMs: Math.round(item.startMs), endMs: Math.round(item.endMs) }))
    .filter((item) => item.endMs > item.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: SpeechInterval[] = [];
  for (const item of valid) {
    const last = merged[merged.length - 1];
    if (last && item.startMs - last.endMs < mergeBelowMs) last.endMs = Math.max(last.endMs, item.endMs);
    else merged.push({ ...item });
  }
  return merged;
}

/** Cuts a region that is longer than `maxMs` into pieces no longer than `maxMs`, overlapping by `overlapMs`. */
function splitLongRegion(
  region: SpeechInterval,
  maxMs: number,
  overlapMs: number,
  chooseCut: (earliestMs: number, latestMs: number) => number,
): SpeechInterval[] {
  const pieces: SpeechInterval[] = [];
  let start = region.startMs;
  while (region.endMs - start > maxMs) {
    const latest = start + maxMs;
    // The next piece starts `overlapMs` before the cut, so cutting no earlier than half a window plus the
    // overlap guarantees every piece advances by at least half a window. Without that, a cut near the
    // earliest allowed point could advance 1 ms at a time and produce hundreds of thousands of pieces.
    const earliest = start + Math.floor(maxMs / 2) + overlapMs;
    const requested = Math.round(chooseCut(earliest, latest));
    let cut = Math.min(latest, Math.max(earliest, Number.isFinite(requested) ? requested : latest));
    // Do not leave a sliver for the last piece: a window with 150 ms of speech and 29.8 s of padding is
    // where Whisper invents text. Pull this cut earlier so the last piece is a usable length.
    const tailMs = region.endMs - (cut - overlapMs);
    const minTailMs = Math.min(MIN_TAIL_MS, Math.floor(maxMs / 4));
    if (tailMs <= maxMs && tailMs < minTailMs) cut = Math.max(earliest, cut - (minTailMs - tailMs));
    pieces.push({ startMs: start, endMs: cut });
    start = cut - overlapMs;
  }
  pieces.push({ startMs: start, endMs: region.endMs });
  return pieces;
}

export function packSpeech(intervals: readonly SpeechInterval[], options: PackOptions = {}): PackedWindow[] {
  const windowMs = options.windowMs ?? DEFAULTS.windowMs;
  const gapMs = options.gapMs ?? DEFAULTS.gapMs;
  const overlapMs = options.splitOverlapMs ?? DEFAULTS.splitOverlapMs;
  const chooseCut = options.chooseCut ?? ((_earliest: number, latest: number) => latest);
  const mergeBelowMs = options.mergeBelowMs ?? DEFAULTS.mergeBelowMs;
  // Every number must be finite: NaN passes a "< 0" test and would silently poison every window.
  if (![windowMs, gapMs, overlapMs, mergeBelowMs].every(Number.isFinite) || windowMs <= 0 || gapMs < 0 || mergeBelowMs < 0 || overlapMs < 0 || overlapMs * 4 > windowMs) {
    throw new Error("Pack options are out of range: every value must be a finite number, the window positive, and the split overlap at most a quarter of it.");
  }

  // Pieces of one long region overlap, so they must never share a window (the model would hear the overlap twice
  // and the local-to-global time map would run backwards). Every piece after the first starts a fresh window.
  const regions = normalizeIntervals(intervals, mergeBelowMs).flatMap((region) => {
    if (region.endMs - region.startMs <= windowMs) return [{ ...region, continuation: false }];
    return splitLongRegion(region, windowMs, overlapMs, chooseCut).map((piece, i) => ({ ...piece, continuation: i > 0 }));
  });

  const windows: PackedWindow[] = [];
  let current: PackedRegion[] = [];
  let used = 0;
  const close = () => {
    if (current.length === 0) return;
    windows.push({ index: windows.length, lengthMs: windowMs, usedMs: used, regions: current });
    current = [];
    used = 0;
  };

  for (const region of regions) {
    const length = region.endMs - region.startMs;
    const offset = current.length === 0 ? 0 : used + gapMs;
    if (region.continuation || offset + length > windowMs) close();
    const placedAt = current.length === 0 ? 0 : used + gapMs;
    current.push({ sourceStartMs: region.startMs, sourceEndMs: region.endMs, packOffsetMs: placedAt });
    used = placedAt + length;
  }
  close();
  return windows;
}

/**
 * Maps a window-local time to a source-video time. A time in the inserted silence snaps to the
 * nearer edge of the speech around it; a time in the padding snaps to the end of the last region.
 */
export function toGlobalMs(window: PackedWindow, localMs: number): number {
  const regions = window.regions;
  if (regions.length === 0) return 0;
  if (localMs <= regions[0].packOffsetMs) return regions[0].sourceStartMs;

  // Binary search for the last region that starts at or before localMs.
  let low = 0;
  let high = regions.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (regions[middle].packOffsetMs <= localMs) low = middle;
    else high = middle - 1;
  }
  const region = regions[low];
  const length = region.sourceEndMs - region.sourceStartMs;
  const into = localMs - region.packOffsetMs;
  if (into <= length) return region.sourceStartMs + into;

  const next = regions[low + 1];
  if (!next) return region.sourceEndMs;
  const regionEndLocal = region.packOffsetMs + length;
  return localMs - regionEndLocal < next.packOffsetMs - localMs ? region.sourceEndMs : next.sourceStartMs;
}

/**
 * Converts a window-local word into a global one. The word is attributed to the region it overlaps
 * most (it must overlap at least 40% of its own length, or it is dropped as invented), then clamped to
 * that region: Whisper's word times often lead or lag the true speech by 50-250 ms, which is the whole
 * inserted gap, so a word that starts a little early in the gap before a region still belongs to it.
 * Words in the padding, or only in inserted silence, return null.
 */
export function toGlobalWord(word: Word, window: PackedWindow): Word | null {
  if (window.regions.length === 0 || word.startMs >= window.usedMs || !(word.endMs > word.startMs)) return null;
  let best = -1;
  let bestOverlap = 0;
  window.regions.forEach((region, index) => {
    const regionEnd = region.packOffsetMs + (region.sourceEndMs - region.sourceStartMs);
    const overlap = Math.min(word.endMs, regionEnd) - Math.max(word.startMs, region.packOffsetMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = index;
    }
  });
  if (best < 0 || bestOverlap < 0.4 * (word.endMs - word.startMs)) return null;
  const region = window.regions[best];
  const regionEnd = region.packOffsetMs + (region.sourceEndMs - region.sourceStartMs);
  const startMs = region.sourceStartMs + (Math.max(word.startMs, region.packOffsetMs) - region.packOffsetMs);
  const endMs = region.sourceStartMs + (Math.min(word.endMs, regionEnd) - region.packOffsetMs);
  if (endMs <= startMs) return null;
  return { ...word, startMs, endMs, windowIndex: window.index };
}

/** The part of the source video a window covers, from its first region's start to its last region's end. */
export function windowSourceSpan(window: PackedWindow): SpeechInterval {
  const first = window.regions[0];
  const last = window.regions[window.regions.length - 1];
  return { startMs: first?.sourceStartMs ?? 0, endMs: last?.sourceEndMs ?? 0 };
}
