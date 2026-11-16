import type { CaptionEvent } from "../types";

/**
 * Time helpers for the burn-in. Frame times come from the decoder in seconds (floating point),
 * caption times are integer milliseconds (see types.ts), so every comparison goes through here.
 */

/** Seconds from the decoder to milliseconds. Kept fractional: rounding here could move a frame across an event edge. */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

export interface EventLookup {
  /** The event on screen at `timeMs` (start inclusive, end exclusive), or null. */
  at(timeMs: number): CaptionEvent | null;
}

/**
 * Builds a fast "which caption is showing now" lookup. Frames are asked in time order but the
 * lookup does not rely on it. Events are sorted by start; a running maximum of end times lets a
 * long event that started earlier still be found even if a shorter one begins inside it (the
 * later-starting one wins while both are active).
 */
export function createEventLookup(events: readonly CaptionEvent[]): EventLookup {
  const sorted = events
    .filter((e) => Number.isFinite(e.startMs) && Number.isFinite(e.endMs) && e.endMs > e.startMs)
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.startMs - b.event.startMs || a.order - b.order)
    .map((x) => x.event);
  const maxEndUpTo: number[] = [];
  let running = -Infinity;
  for (const event of sorted) {
    running = Math.max(running, event.endMs);
    maxEndUpTo.push(running);
  }
  return {
    at(timeMs: number): CaptionEvent | null {
      // Last event with startMs <= timeMs.
      let lo = 0;
      let hi = sorted.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].startMs <= timeMs) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      for (let i = found; i >= 0 && maxEndUpTo[i] > timeMs; i--) {
        if (sorted[i].endMs > timeMs) return sorted[i];
      }
      return null;
    },
  };
}

export interface FrameTime {
  timestamp: number;
  duration: number;
}

export interface TimelineComparison {
  sameCount: boolean;
  countA: number;
  countB: number;
  /** Largest absolute difference of presentation timestamps over the common prefix, in seconds. */
  maxTimestampDiffSeconds: number;
  /** Largest absolute difference of durations over the common prefix, in seconds. */
  maxDurationDiffSeconds: number;
}

/**
 * Compares two frame timelines (seconds). Used to prove the export kept the source timing: the
 * same number of frames, each at the same time. A different count means frames were dropped or
 * duplicated.
 */
export function compareTimelines(a: readonly FrameTime[], b: readonly FrameTime[]): TimelineComparison {
  const n = Math.min(a.length, b.length);
  let maxTs = 0;
  let maxDur = 0;
  for (let i = 0; i < n; i++) {
    maxTs = Math.max(maxTs, Math.abs(a[i].timestamp - b[i].timestamp));
    maxDur = Math.max(maxDur, Math.abs(a[i].duration - b[i].duration));
  }
  return {
    sameCount: a.length === b.length,
    countA: a.length,
    countB: b.length,
    maxTimestampDiffSeconds: maxTs,
    maxDurationDiffSeconds: maxDur,
  };
}
