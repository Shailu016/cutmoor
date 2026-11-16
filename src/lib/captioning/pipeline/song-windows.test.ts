import { describe, expect, it } from "vitest";
import { WINDOW_MS } from "../contracts";
import {
  isHardSongWindow,
  planSongRetryWindows,
  SONG_HARD_MIN_REAL_WORDS,
  SONG_RETRY_HOP_MS,
  SONG_RETRY_MIN_MS,
  SONG_RETRY_WINDOW_MS,
} from "./song-windows";

describe("isHardSongWindow", () => {
  it("calls a window with fewer than the minimum real words hard", () => {
    expect(isHardSongWindow(0)).toBe(true);
    expect(isHardSongWindow(2)).toBe(true);
    expect(isHardSongWindow(SONG_HARD_MIN_REAL_WORDS - 0.1)).toBe(true);
  });

  it("does not call a window at or above the minimum hard", () => {
    expect(isHardSongWindow(SONG_HARD_MIN_REAL_WORDS)).toBe(false);
    expect(isHardSongWindow(41)).toBe(false);
  });

  it("treats an unmeasurable count as hard rather than trusting it", () => {
    expect(isHardSongWindow(Number.NaN)).toBe(true);
    expect(isHardSongWindow(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("uses the measured 3-word threshold", () => {
    expect(SONG_HARD_MIN_REAL_WORDS).toBe(3);
    expect(SONG_RETRY_WINDOW_MS).toBe(20_000);
    expect(SONG_RETRY_HOP_MS).toBe(10_000);
    expect(SONG_RETRY_MIN_MS).toBe(5_000);
  });
});

describe("planSongRetryWindows", () => {
  it("plans two 20 s windows on a 10 s hop for a 30 s span", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: WINDOW_MS })).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 10_000, endMs: 30_000 },
    ]);
  });

  it("shifts the same plan onto a measured 59.7-89.7 s span", () => {
    expect(planSongRetryWindows({ startMs: 59_700, endMs: 89_700 })).toEqual([
      { startMs: 59_700, endMs: 79_700 },
      { startMs: 69_700, endMs: 89_700 },
    ]);
  });

  it("clamps the second window to a 31 s span end and keeps the 21 s window", () => {
    const windows = planSongRetryWindows({ startMs: 0, endMs: 31_000 });
    expect(windows).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 10_000, endMs: 31_000 },
    ]);
    expect(windows[1].endMs - windows[1].startMs).toBe(21_000);
  });

  it("plans one clipped window for a 12 s span: the 2 s tail is below the minimum", () => {
    // Rule check: the +10 s offset would only cover 2 s of a 12 s span, so it is dropped, not padded.
    expect(planSongRetryWindows({ startMs: 59_700, endMs: 71_700 })).toEqual([{ startMs: 59_700, endMs: 71_700 }]);
  });

  it("plans two windows for a 20 s span (20 s at +0 and the 10 s tail at +10 s)", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 20_000 })).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 10_000, endMs: 20_000 },
    ]);
  });

  it("returns nothing for a span shorter than the shortest useful retry", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 4_000 })).toEqual([]);
    expect(planSongRetryWindows({ startMs: 0, endMs: SONG_RETRY_MIN_MS - 1 })).toEqual([]);
  });

  it("keeps a span exactly as long as the minimum", () => {
    expect(planSongRetryWindows({ startMs: 1_000, endMs: 6_000 })).toEqual([{ startMs: 1_000, endMs: 6_000 }]);
  });

  it("returns nothing for an empty, reversed or invalid span", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 0 })).toEqual([]);
    expect(planSongRetryWindows({ startMs: 30_000, endMs: 0 })).toEqual([]);
    expect(planSongRetryWindows({ startMs: 5_000, endMs: 5_000 })).toEqual([]);
    expect(planSongRetryWindows({ startMs: Number.NaN, endMs: 30_000 })).toEqual([]);
    expect(planSongRetryWindows({ startMs: 0, endMs: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  it("honours a custom window and hop", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 30_000 }, { windowMs: 8_000, hopMs: 8_000, maxWindows: 3 })).toEqual([
      { startMs: 0, endMs: 8_000 },
      { startMs: 8_000, endMs: 16_000 },
      { startMs: 16_000, endMs: 24_000 },
    ]);
  });

  it("honours a custom minimum", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 7_000 }, { minMs: 10_000 })).toEqual([]);
    expect(planSongRetryWindows({ startMs: 0, endMs: 12_000 }, { minMs: 10_000 })).toEqual([
      { startMs: 0, endMs: 12_000 },
    ]);
  });

  it("never returns more than maxWindows, and accepts 1 or 0", () => {
    const span = { startMs: 0, endMs: 120_000 };
    expect(planSongRetryWindows(span)).toHaveLength(2);
    expect(planSongRetryWindows(span, { maxWindows: 1 })).toEqual([{ startMs: 0, endMs: 20_000 }]);
    expect(planSongRetryWindows(span, { maxWindows: 0 })).toEqual([]);
    expect(planSongRetryWindows(span, { maxWindows: 2.9 })).toHaveLength(2);
  });

  it("falls back to the measured defaults for non-positive or non-finite options", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 30_000 }, { windowMs: Number.NaN, hopMs: -1 })).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 10_000, endMs: 30_000 },
    ]);
  });

  it("rounds a fractional span inward so no window leaves the span", () => {
    const span = { startMs: 1_000.4, endMs: 30_999.6 };
    const windows = planSongRetryWindows(span);
    expect(windows).toEqual([
      { startMs: 1_001, endMs: 21_001 },
      { startMs: 11_001, endMs: 30_999 },
    ]);
    for (const window of windows) {
      expect(window.startMs).toBeGreaterThanOrEqual(span.startMs);
      expect(window.endMs).toBeLessThanOrEqual(span.endMs);
      expect(Number.isInteger(window.startMs) && Number.isInteger(window.endMs)).toBe(true);
    }
  });

  it("does not stretch a capped plan into a giant last window on a long span", () => {
    expect(planSongRetryWindows({ startMs: 0, endMs: 60_000 })).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 10_000, endMs: 30_000 },
    ]);
  });

  it("returns ascending windows deterministically", () => {
    const span = { startMs: 47_200, endMs: 77_200 };
    const first = planSongRetryWindows(span);
    expect(planSongRetryWindows(span)).toEqual(first);
    for (let i = 1; i < first.length; i += 1) expect(first[i].startMs).toBeGreaterThan(first[i - 1].startMs);
    for (const window of first) expect(window.endMs).toBeGreaterThan(window.startMs);
  });
});
