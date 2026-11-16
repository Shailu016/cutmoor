import { describe, expect, it } from "vitest";
import { normalizeIntervals, packSpeech, toGlobalMs, toGlobalWord, windowSourceSpan } from "./packer";
import type { PackedWindow, Word } from "./types";

const word = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs, confidence: 1, index: 0, windowIndex: 0 });

describe("normalizeIntervals", () => {
  it("sorts, drops bad intervals and merges close neighbours", () => {
    const out = normalizeIntervals([
      { startMs: 5000, endMs: 6000 },
      { startMs: 0, endMs: 1000 },
      { startMs: 1200, endMs: 2000 }, // 200 ms after the previous one: merged
      { startMs: 3000, endMs: 3000 }, // empty
      { startMs: 4000, endMs: 3500 }, // backwards
      { startMs: Number.NaN, endMs: 9000 },
    ]);
    expect(out).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 5000, endMs: 6000 },
    ]);
  });

  it("merges overlapping intervals into one", () => {
    expect(normalizeIntervals([{ startMs: 0, endMs: 5000 }, { startMs: 3000, endMs: 4000 }])).toEqual([{ startMs: 0, endMs: 5000 }]);
  });
});

describe("packSpeech", () => {
  it("returns nothing for no speech", () => {
    expect(packSpeech([])).toEqual([]);
  });

  it("puts one short region at the start of a fixed 30 s window", () => {
    const [window] = packSpeech([{ startMs: 12_000, endMs: 15_000 }]);
    expect(window.lengthMs).toBe(30_000);
    expect(window.usedMs).toBe(3000);
    expect(window.regions).toEqual([{ sourceStartMs: 12_000, sourceEndMs: 15_000, packOffsetMs: 0 }]);
  });

  it("packs several regions into one window with the gap between them", () => {
    const [window, ...rest] = packSpeech([
      { startMs: 0, endMs: 4000 },
      { startMs: 10_000, endMs: 13_000 },
      { startMs: 60_000, endMs: 62_000 },
    ]);
    expect(rest).toHaveLength(0);
    expect(window.regions.map((r) => r.packOffsetMs)).toEqual([0, 4250, 7500]);
    expect(window.usedMs).toBe(9500);
  });

  it("starts a new window when the next region does not fit, and never splits a region that fits in one", () => {
    const windows = packSpeech([
      { startMs: 0, endMs: 20_000 },
      { startMs: 30_000, endMs: 42_000 }, // 20 000 + 250 + 12 000 > 30 000
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0].regions).toHaveLength(1);
    expect(windows[1].regions[0]).toEqual({ sourceStartMs: 30_000, sourceEndMs: 42_000, packOffsetMs: 0 });
    expect(windows.map((w) => w.index)).toEqual([0, 1]);
  });

  it("fits a region of exactly the window length", () => {
    const windows = packSpeech([{ startMs: 0, endMs: 30_000 }]);
    expect(windows).toHaveLength(1);
    expect(windows[0].usedMs).toBe(30_000);
  });

  it("cuts a region longer than a window into overlapping pieces that each fit", () => {
    const windows = packSpeech([{ startMs: 1000, endMs: 91_000 }]);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    const pieces = windows.flatMap((w) => w.regions);
    for (const piece of pieces) expect(piece.sourceEndMs - piece.sourceStartMs).toBeLessThanOrEqual(30_000);
    expect(pieces[0].sourceStartMs).toBe(1000);
    expect(pieces[pieces.length - 1].sourceEndMs).toBe(91_000);
    for (let i = 1; i < pieces.length; i += 1) {
      expect(pieces[i].sourceStartMs).toBeLessThan(pieces[i - 1].sourceEndMs); // they overlap...
      expect(pieces[i - 1].sourceEndMs - pieces[i].sourceStartMs).toBe(150); // ...by exactly the split overlap
    }
  });

  it("lets the caller choose a quiet cut point, within the allowed range", () => {
    const windows = packSpeech([{ startMs: 0, endMs: 50_000 }], { chooseCut: (earliest, latest) => Math.round((earliest + latest) / 2) });
    const first = windows[0].regions[0];
    expect(first.sourceEndMs).toBeGreaterThanOrEqual(15_150);
    expect(first.sourceEndMs).toBeLessThan(30_000);
    // A chooser that returns nonsense is clamped instead of believed.
    const clamped = packSpeech([{ startMs: 0, endMs: 50_000 }], { chooseCut: () => -5 });
    expect(clamped[0].regions[0].sourceEndMs).toBe(15_150); // half a window plus the overlap: every piece advances at least half a window
    const nan = packSpeech([{ startMs: 0, endMs: 50_000 }], { chooseCut: () => Number.NaN });
    expect(nan[0].regions[0].sourceEndMs).toBe(30_000);
  });

  it("rejects NaN and infinite options instead of silently producing NaN windows", () => {
    const one = [{ startMs: 0, endMs: 40_000 }];
    for (const bad of [{ splitOverlapMs: Number.NaN }, { gapMs: Number.NaN }, { mergeBelowMs: Number.NaN }, { windowMs: Number.POSITIVE_INFINITY }, { windowMs: Number.NaN }]) {
      expect(() => packSpeech(one, bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("cannot be made to produce a runaway number of windows", () => {
    // An overlap near half a window used to advance 1 ms per piece: 170 001 windows for 200 s of speech.
    expect(() => packSpeech([{ startMs: 0, endMs: 200_000 }], { splitOverlapMs: 14_999 })).toThrow();
    const windows = packSpeech([{ startMs: 0, endMs: 200_000 }], { splitOverlapMs: 7500, chooseCut: (earliest) => earliest });
    expect(windows.length).toBeLessThanOrEqual(Math.ceil(200_000 / 15_000) + 1);
  });

  it("never puts two pieces of one split region in the same window, even with no gap", () => {
    const windows = packSpeech([{ startMs: 0, endMs: 45_000 }], { gapMs: 0, chooseCut: (earliest) => earliest });
    for (const window of windows) expect(window.regions).toHaveLength(1);
    for (const window of windows) {
      let previous = -Infinity;
      for (let local = 0; local <= window.usedMs; local += 50) {
        const global = toGlobalMs(window, local);
        expect(global).toBeGreaterThanOrEqual(previous);
        previous = global;
      }
    }
  });

  it("does not leave a sliver for the last piece of a split region", () => {
    for (const end of [30_001, 30_300, 60_001, 60_301]) {
      const windows = packSpeech([{ startMs: 0, endMs: end }]);
      const last = windows[windows.length - 1];
      expect(last.usedMs).toBeGreaterThanOrEqual(2000);
      expect(windows.flatMap((w) => w.regions).at(-1)?.sourceEndMs).toBe(end);
    }
  });

  it("rejects options that cannot work", () => {
    expect(() => packSpeech([{ startMs: 0, endMs: 1000 }], { windowMs: 0 })).toThrow();
    expect(() => packSpeech([{ startMs: 0, endMs: 1000 }], { windowMs: 1000, splitOverlapMs: 600 })).toThrow();
    expect(() => packSpeech([{ startMs: 0, endMs: 1000 }], { gapMs: -1 })).toThrow();
  });

  it("keeps every invariant on random speech (seeded fuzz)", () => {
    let seed = 99;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let round = 0; round < 200; round += 1) {
      const intervals = [];
      let cursor = 0;
      for (let i = 0; i < 1 + Math.floor(next() * 12); i += 1) {
        cursor += Math.floor(next() * 5000);
        const length = 100 + Math.floor(next() * (next() < 0.1 ? 80_000 : 9000));
        intervals.push({ startMs: cursor, endMs: cursor + length });
        cursor += length;
      }
      const windows = packSpeech(intervals);
      let previousEnd = -1;
      for (const window of windows) {
        expect(window.lengthMs).toBe(30_000);
        expect(window.usedMs).toBeLessThanOrEqual(30_000);
        let local = -1;
        for (const region of window.regions) {
          expect(region.packOffsetMs).toBeGreaterThanOrEqual(local);
          expect(region.sourceEndMs).toBeGreaterThan(region.sourceStartMs);
          local = region.packOffsetMs + (region.sourceEndMs - region.sourceStartMs);
          expect(region.sourceStartMs).toBeGreaterThanOrEqual(previousEnd - 150); // in order, overlapping at most the split overlap
          previousEnd = region.sourceEndMs;
        }
        expect(window.usedMs).toBe(local);
      }
      // Every source millisecond of speech is inside some region.
      for (const interval of intervals) {
        const covered = windows.flatMap((w) => w.regions).filter((r) => r.sourceStartMs <= interval.startMs + 300 && r.sourceEndMs >= interval.endMs - 300 || (r.sourceStartMs >= interval.startMs && r.sourceEndMs <= interval.endMs));
        expect(covered.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("toGlobalMs and toGlobalWord", () => {
  const window: PackedWindow = {
    index: 3,
    lengthMs: 30_000,
    usedMs: 9500,
    regions: [
      { sourceStartMs: 1000, sourceEndMs: 5000, packOffsetMs: 0 },
      { sourceStartMs: 20_000, sourceEndMs: 23_000, packOffsetMs: 4250 },
      { sourceStartMs: 90_000, sourceEndMs: 92_000, packOffsetMs: 7500 },
    ],
  };

  it("maps local time inside a region onto the source", () => {
    expect(toGlobalMs(window, 0)).toBe(1000);
    expect(toGlobalMs(window, 2000)).toBe(3000);
    expect(toGlobalMs(window, 4250)).toBe(20_000);
    expect(toGlobalMs(window, 5000)).toBe(20_750);
    expect(toGlobalMs(window, 8000)).toBe(90_500);
  });

  it("snaps a time in the inserted silence to the nearer edge, and padding to the last edge", () => {
    expect(toGlobalMs(window, 4100)).toBe(5000); // nearer the end of region 0 (4000) than the start of region 1 (4250)
    expect(toGlobalMs(window, 4200)).toBe(20_000);
    expect(toGlobalMs(window, 9500)).toBe(92_000);
    expect(toGlobalMs(window, 29_000)).toBe(92_000);
    expect(toGlobalMs(window, -50)).toBe(1000);
  });

  it("maps a word and tags it with the window", () => {
    expect(toGlobalWord(word("namaste", 4300, 4900), window)).toMatchObject({ text: "namaste", startMs: 20_050, endMs: 20_650, windowIndex: 3 });
  });

  it("drops words the model placed in padding or in inserted silence", () => {
    expect(toGlobalWord(word("thanks", 9500, 10_000), window)).toBeNull();
    expect(toGlobalWord(word("ghost", 20_000, 21_000), window)).toBeNull();
    expect(toGlobalWord(word("gap", 4050, 4200), window)).toBeNull();
  });

  it("gives a word that spans two regions to the one it overlaps most, clamped to it", () => {
    // 3500-5000 overlaps region 0 (to 4000) by 500 ms and region 1 (from 4250) by 750 ms.
    expect(toGlobalWord(word("long", 3500, 5000), window)).toMatchObject({ startMs: 20_000, endMs: 20_750 });
    // Starting 1 ms before the end of region 0 must not leave a 1 ms stub.
    expect(toGlobalWord(word("x", 3999, 5000), window)).toMatchObject({ startMs: 20_000, endMs: 20_750 });
  });

  it("keeps a word that starts a little early, inside the inserted gap before a region", () => {
    expect(toGlobalWord(word("kal", 4200, 4500), window)).toMatchObject({ startMs: 20_000, endMs: 20_250 });
  });

  it("drops a word that barely touches a region", () => {
    expect(toGlobalWord(word("blip", 3950, 4400), window)).toBeNull(); // 50 ms in region 0, 150 in region 1: under 40% of 450
  });

  it("describes the part of the video a window covers", () => {
    expect(windowSourceSpan(window)).toEqual({ startMs: 1000, endMs: 92_000 });
  });

  it("is monotonic: later local times never map earlier", () => {
    let previous = -Infinity;
    for (let local = 0; local <= 12_000; local += 25) {
      const global = toGlobalMs(window, local);
      expect(global).toBeGreaterThanOrEqual(previous);
      previous = global;
    }
  });
});
