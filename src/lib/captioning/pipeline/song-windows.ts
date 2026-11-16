/**
 * Song-mode window plan: keep the stock 30 s window for the first read, and retry only a "hard" window with
 * shorter, independent windows.
 *
 * Measured on Sajan with Apex fp32 (`.team/auto/r2-gemini-gap.md` §4.1 rows 3-5): 15 s and 18 s caps collapse
 * (3 and 0 real words), while independent 20 s windows on a 10 s hop read 11/60 words in the 59-114 s block
 * where the 30 s plan read 0. Previous-text conditioning is worse (21 words vs 38 independent), so the retry
 * windows are standalone: each one is packed from the source span and read without context.
 *
 * Pure functions only. The caller decides what "hard" means from the chosen reading's real-word count and
 * enqueues the plan; nothing here touches audio, the engine or the clock.
 */

/** Song mode: the retry window length and hop measured to work (20 s on a 10 s hop). */
export const SONG_RETRY_WINDOW_MS = 20_000;
export const SONG_RETRY_HOP_MS = 10_000;
/** A song window below this many real Latin words is "hard" and gets the retry windows. */
export const SONG_HARD_MIN_REAL_WORDS = 3;
/** Shortest retry window worth a model call. */
export const SONG_RETRY_MIN_MS = 5_000;

/** At most two retries per hard 30 s window: the 20 s window at +0 s and the one at +10 s. */
const SONG_RETRY_MAX_WINDOWS = 2;

/**
 * Whether a song window is worth retrying. A window with fewer than `SONG_HARD_MIN_REAL_WORDS` real Latin
 * words has effectively failed; a non-finite count (a caller bug or an unmeasured reading) is treated as hard
 * rather than trusted.
 */
export function isHardSongWindow(realWords: number): boolean {
  if (!Number.isFinite(realWords)) return true;
  return realWords < SONG_HARD_MIN_REAL_WORDS;
}

export interface SongRetrySpan {
  startMs: number;
  endMs: number;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function maxWindowsOr(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return 0;
  return Math.floor(value);
}

/**
 * Independent retry windows for a hard 30 s window's source span.
 * - 30 s span -> two 20 s windows: [start, start+20s] and [start+10s, start+30s].
 * - shorter span -> as many whole/partial 20 s windows as fit on the 10 s hop, clipped to the span,
 *   dropping any piece shorter than SONG_RETRY_MIN_MS; never more than two.
 * - a leftover tail too short to be its own window (< minMs) is absorbed by the last window instead of being
 *   dropped, which is why a 31 s span retries with a 20 s and a 21 s window; the absorb stops there, so a
 *   window never grows past windowMs + hopMs (30 s with the measured defaults).
 * - zero/negative/invalid span -> [].
 * - windows are rounded to integer ms, ascending, and never extend past the span.
 *
 * The span is rounded inward (start up, end down) so a fractional source span never produces a window that
 * reaches outside it. Options are the knobs the plan uses today, exposed so callers and tests can pin them;
 * a non-positive or non-finite value falls back to the measured default.
 */
export function planSongRetryWindows(
  span: SongRetrySpan,
  options: { windowMs?: number; hopMs?: number; minMs?: number; maxWindows?: number } = {},
): SongRetrySpan[] {
  if (!Number.isFinite(span.startMs) || !Number.isFinite(span.endMs)) return [];
  const spanStartMs = Math.ceil(span.startMs);
  const spanEndMs = Math.floor(span.endMs);
  if (spanEndMs <= spanStartMs) return [];

  const windowMs = Math.round(positiveOr(options.windowMs, SONG_RETRY_WINDOW_MS));
  const hopMs = Math.round(positiveOr(options.hopMs, SONG_RETRY_HOP_MS));
  const minMs = Math.round(positiveOr(options.minMs, SONG_RETRY_MIN_MS));
  const maxWindows = maxWindowsOr(options.maxWindows, SONG_RETRY_MAX_WINDOWS);
  if (maxWindows === 0) return [];

  const windows: SongRetrySpan[] = [];
  for (let offset = spanStartMs; offset < spanEndMs && windows.length < maxWindows; offset += hopMs) {
    const endMs = Math.min(offset + windowMs, spanEndMs);
    if (endMs - offset < minMs) continue;
    windows.push({ startMs: offset, endMs });
  }

  // A sliver of span after the last window cannot stand as a retry window of its own, so extend the last
  // window over it (31 s span -> 20 s + 21 s). The length guard keeps a capped plan on a long span honest.
  const last = windows[windows.length - 1];
  const remainderMs = last ? spanEndMs - last.endMs : 0;
  if (last && remainderMs > 0 && remainderMs < minMs && spanEndMs - last.startMs <= windowMs + hopMs) {
    last.endMs = spanEndMs;
  }
  return windows;
}
