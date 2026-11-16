import { describe, expect, it } from "vitest";
import { auditCoverage, editDistance, mergeWindowWords, type WindowWords } from "./overlap-merge";
import type { Word } from "./types";

const w = (text: string, startMs: number, endMs: number, windowIndex: number, confidence = 1): Word => ({
  text,
  startMs,
  endMs,
  confidence,
  index: 0,
  windowIndex,
});

const texts = (words: Word[]) => words.map((word) => word.text);

describe("editDistance", () => {
  it("counts single edits and stops early past the cap", () => {
    expect(editDistance("kitten", "kitten")).toBe(0);
    expect(editDistance("nahi", "nahin")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
    expect(editDistance("a", "abcdefgh", 2)).toBe(3);
    expect(editDistance("", "ab", 5)).toBe(2);
    expect(editDistance("eeb", "bcabbe", 3)).toBeLessThanOrEqual(4); // it used to return 5 for a cap of 3
    for (const [a, b] of [["abcdefg", "xyzxyzx"], ["aaaa", "bbbbbb"], ["kitten", "sitting"]]) expect(editDistance(a, b, 2)).toBeLessThanOrEqual(3);
  });
});

describe("mergeWindowWords", () => {
  it("returns nothing for no windows and keeps a single window as it is", () => {
    expect(mergeWindowWords([])).toEqual([]);
    const only: WindowWords = { coverage: { startMs: 0, endMs: 5000 }, words: [w("hello", 0, 400, 0), w("duniya", 500, 1000, 0)] };
    const merged = mergeWindowWords([only]);
    expect(texts(merged)).toEqual(["hello", "duniya"]);
    expect(merged.map((word) => word.index)).toEqual([0, 1]);
  });

  it("concatenates windows that do not overlap", () => {
    const merged = mergeWindowWords([
      { coverage: { startMs: 0, endMs: 3000 }, words: [w("ek", 100, 400, 0)] },
      { coverage: { startMs: 5000, endMs: 8000 }, words: [w("do", 5100, 5400, 1)] },
    ]);
    expect(texts(merged)).toEqual(["ek", "do"]);
  });

  it("gives each overlap word to exactly one window by its midpoint", () => {
    // Overlap 10 000..12 000, so the boundary is 11 000.
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("aaj", 10_100, 10_500, 0), w("kal", 10_600, 10_900, 0), w("parson", 11_100, 11_600, 0)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("aaj", 10_110, 10_510, 1), w("kal", 10_620, 10_920, 1), w("parson", 11_090, 11_590, 1), w("phir", 11_800, 12_200, 1)] };
    const merged = mergeWindowWords([a, b]);
    expect(texts(merged)).toEqual(["aaj", "kal", "parson", "phir"]);
  });

  it("settles a word that each window timed on opposite sides of the boundary", () => {
    // Boundary 11 000. Window 0 puts the word's midpoint at 10 950 (its side), window 1 at 11 050 (its side).
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("zindagi", 10_700, 11_200, 0, 0.6)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("zindagi", 10_800, 11_300, 1, 0.9)] };
    const merged = mergeWindowWords([a, b]);
    expect(texts(merged)).toEqual(["zindagi"]);
    expect(merged[0].confidence).toBe(0.9); // the more confident copy wins
    expect(merged[0].startMs).toBe(10_700); // over the union of the two timings
    expect(merged[0].endMs).toBe(11_300);
  });

  it("does not lose a word that each window thinks the other owns", () => {
    // Boundary 11 000. Window 0 times the word just past it (so it drops it), window 1 just before it (so it drops it too).
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("sapna", 11_050, 11_450, 0)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("sapna", 10_880, 11_280, 1)] };
    expect(texts(mergeWindowWords([a, b]))).toEqual(["sapna"]);
  });

  it("keeps a word that is genuinely said twice in a row across the seam", () => {
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("bahut", 10_500, 10_900, 0)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("bahut", 11_100, 11_500, 1)] };
    expect(texts(mergeWindowWords([a, b]))).toEqual(["bahut", "bahut"]);
  });

  it("does not treat two different short words as one", () => {
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("ho", 10_800, 11_000, 0)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("to", 11_000, 11_200, 1)] };
    expect(texts(mergeWindowWords([a, b]))).toEqual(["ho", "to"]);
  });

  it("matches near-spellings of longer words, ignoring case and punctuation", () => {
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("Mohabbat,", 10_800, 11_300, 0, 0.5)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("mohabat", 10_850, 11_350, 1, 0.8)] };
    const merged = mergeWindowWords([a, b]);
    expect(texts(merged)).toEqual(["mohabat"]);
  });

  it("stitches a word one window heard only part of", () => {
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("namas", 10_800, 11_150, 0)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("namaste", 10_820, 11_400, 1)] };
    const merged = mergeWindowWords([a, b]);
    expect(texts(merged)).toEqual(["namaste"]);
    expect(merged[0].startMs).toBe(10_800);
    expect(merged[0].endMs).toBe(11_400);
  });

  it("drops words from a window that fall outside its own territory", () => {
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("early", 100, 500, 0), w("stray", 11_500, 11_900, 0)] };
    const b: WindowWords = { coverage: { startMs: 10_000, endMs: 20_000 }, words: [w("stray2", 10_200, 10_600, 1), w("late", 15_000, 15_400, 1)] };
    expect(texts(mergeWindowWords([a, b]))).toEqual(["early", "late"]);
  });

  it("returns words in order, without overlaps, with a clean running index", () => {
    const a: WindowWords = { coverage: { startMs: 0, endMs: 12_000 }, words: [w("ek", 1000, 1600, 0), w("do", 1500, 2000, 0)] };
    const merged = mergeWindowWords([a]);
    expect(merged[0].endMs).toBeLessThanOrEqual(merged[1].startMs);
    expect(merged.map((word) => word.index)).toEqual([0, 1]);
  });

  it("ignores zero-length words and windows given in any order", () => {
    const b: WindowWords = { coverage: { startMs: 5000, endMs: 8000 }, words: [w("baad", 5100, 5500, 1), w("empty", 6000, 6000, 1)] };
    const a: WindowWords = { coverage: { startMs: 0, endMs: 3000 }, words: [w("pehle", 100, 500, 0)] };
    expect(texts(mergeWindowWords([b, a]))).toEqual(["pehle", "baad"]);
  });

  it("never loses or doubles a word on random overlapping windows (seeded fuzz)", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let round = 0; round < 150; round += 1) {
      // A true transcript of distinct words, 400 ms apart.
      const count = 20 + Math.floor(next() * 30);
      const truth = Array.from({ length: count }, (_, i) => ({ text: `word${i}x`, startMs: i * 400, endMs: i * 400 + 300 }));
      const cut = 3000 + Math.floor(next() * (count * 400 - 6000));
      const overlap = 500 + Math.floor(next() * 2500);
      const jitter = () => Math.round((next() - 0.5) * 120);
      const windows: WindowWords[] = [
        { coverage: { startMs: 0, endMs: cut + overlap }, words: truth.filter((t) => t.endMs <= cut + overlap).map((t) => w(t.text, t.startMs + jitter(), t.endMs + jitter() + 40, 0)) },
        { coverage: { startMs: cut, endMs: count * 400 }, words: truth.filter((t) => t.startMs >= cut).map((t) => w(t.text, t.startMs + jitter(), t.endMs + jitter() + 40, 1)) },
      ];
      const merged = mergeWindowWords(windows);
      expect(texts(merged)).toEqual(truth.map((t) => t.text));
      for (let i = 1; i < merged.length; i += 1) expect(merged[i].startMs).toBeGreaterThanOrEqual(merged[i - 1].endMs);
    }
  });
});

describe("mergeWindowWords: findings from the reviewer", () => {
  const cov = (startMs: number, endMs: number) => ({ startMs, endMs });
  const MERA = "\u092e\u0947\u0930\u093e";
  const MERI = "\u092e\u0947\u0930\u0940";

  it("removes a double even when a short word sits between the two copies", () => {
    const a: WindowWords = { coverage: cov(0, 12_000), words: [w("zindagi", 10_600, 11_100, 0), w("na", 10_700, 10_800, 0)] };
    const b: WindowWords = { coverage: cov(10_000, 20_000), words: [w("zindagi", 10_800, 11_300, 1)] };
    const merged = mergeWindowWords([a, b]);
    expect(texts(merged).filter((t) => t === "zindagi")).toHaveLength(1);
    expect(texts(merged)).toContain("na");
  });

  it("keeps words from both windows when one window is nested inside another", () => {
    const outer: WindowWords = { coverage: cov(0, 20_000), words: [w("ek", 1000, 1400, 0), w("do", 9000, 9400, 0), w("teen", 15_000, 15_400, 0)] };
    const inner: WindowWords = { coverage: cov(5000, 8000), words: [w("nested", 6000, 6400, 1)] };
    expect(texts(mergeWindowWords([outer, inner]))).toEqual(["ek", "nested", "do", "teen"]);
  });

  it("settles a moment covered by three windows in favour of the window with the most context", () => {
    const first: WindowWords = { coverage: cov(0, 12_000), words: [w("pehle", 5000, 5400, 0), w("aaj", 11_800, 12_200, 0)] };
    const middle: WindowWords = { coverage: cov(11_000, 13_000), words: [w("kal", 11_900, 12_300, 1)] };
    const last: WindowWords = { coverage: cov(12_000, 20_000), words: [w("baad", 15_000, 15_400, 2)] };
    // The middle window has the most audio around 12 s and heard "kal" there, so the first window's edge word "aaj" loses.
    expect(texts(mergeWindowWords([first, middle, last]))).toEqual(["pehle", "kal", "baad"]);
  });

  it("restores a word heard well inside its window when the owner heard nothing there", () => {
    const wide: WindowWords = { coverage: cov(0, 20_000), words: [] };
    const narrow: WindowWords = { coverage: cov(5000, 9000), words: [w("nested", 6800, 7200, 1)] };
    // "wide" owns 7 s (more margin) but heard nothing; "narrow" had 2 s of audio on each side, so its word stays.
    expect(texts(mergeWindowWords([wide, narrow]))).toEqual(["nested"]);
  });

  it("does not restore an edge-of-window word that nothing supports", () => {
    const first: WindowWords = { coverage: cov(0, 12_000), words: [w("pehle", 5000, 5400, 0), w("ghost", 11_700, 12_000, 0)] };
    const second: WindowWords = { coverage: cov(10_000, 20_000), words: [w("baad", 15_000, 15_400, 1)] };
    expect(texts(mergeWindowWords([first, second]))).not.toContain("ghost");
  });

  it("does not mistake different Devanagari words for one", () => {
    const a: WindowWords = { coverage: cov(0, 12_000), words: [w(MERA, 10_800, 11_200, 0)] };
    const different: WindowWords = { coverage: cov(10_000, 20_000), words: [w(MERI, 10_850, 11_250, 1)] };
    const merged = mergeWindowWords([a, different]);
    expect(merged).toHaveLength(1); // still one word at one moment...
    expect([MERA, MERI]).toContain(merged[0].text); // ...a real hearing, never a mangled mix
    const same: WindowWords = { coverage: cov(10_000, 20_000), words: [w(MERA, 10_850, 11_250, 1)] };
    expect(texts(mergeWindowWords([a, same]))).toEqual([MERA]);
  });

  it("splits two words that start together instead of crushing one to 1 ms", () => {
    const merged = mergeWindowWords([{ coverage: cov(0, 5000), words: [w("ek", 1000, 1600, 0), w("do", 1000, 2000, 0)] }]);
    expect(merged[0].endMs - merged[0].startMs).toBeGreaterThanOrEqual(100);
    expect(merged[1].startMs).toBe(merged[0].endMs);
  });

  it("breaks a confidence tie in favour of the earlier window, not the earlier start time", () => {
    // The seam is at 11 000. Window 0's copy has its midpoint at 10 990 and window 1's at 11 010, so each window keeps its own
    // copy. Window 1's copy starts earlier (10 700), so it is first in time, yet window 0 should win the tie.
    const a: WindowWords = { coverage: cov(0, 12_000), words: [w("sapna", 10_790, 11_190, 0, 0.8)] };
    const b: WindowWords = { coverage: cov(10_000, 20_000), words: [w("sapnaa", 10_700, 11_320, 1, 0.8)] };
    const merged = mergeWindowWords([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].windowIndex).toBe(0);
  });
});

describe("auditCoverage", () => {
  it("is full coverage when there is no speech", () => {
    expect(auditCoverage([], [])).toEqual({ coverage: 1, gaps: [] });
  });

  it("reports the stretches of speech that have no word", () => {
    const words = [w("a", 0, 1000, 0), w("b", 5000, 6000, 0)];
    const report = auditCoverage(words, [{ startMs: 0, endMs: 6000 }]);
    expect(report.gaps).toEqual([{ startMs: 1000, endMs: 5000 }]);
    expect(report.coverage).toBeCloseTo(2000 / 6000, 5);
  });

  it("ignores gaps shorter than the minimum and words outside speech", () => {
    const words = [w("a", 0, 1000, 0), w("b", 1200, 2000, 0), w("noise", 9000, 9500, 0)];
    const report = auditCoverage(words, [{ startMs: 0, endMs: 2000 }]);
    expect(report.gaps).toEqual([]);
    expect(report.coverage).toBeCloseTo(1800 / 2000, 5);
  });

  it("does not count overlapping detector intervals twice", () => {
    const report = auditCoverage([w("a", 0, 1000, 0)], [{ startMs: 0, endMs: 2000 }, { startMs: 1000, endMs: 3000 }]);
    expect(report.coverage).toBeCloseTo(1000 / 3000, 5);
    expect(report.gaps).toEqual([{ startMs: 1000, endMs: 3000 }]);
  });

  it("finds a missing tail", () => {
    expect(auditCoverage([w("a", 0, 1000, 0)], [{ startMs: 0, endMs: 4000 }]).gaps).toEqual([{ startMs: 1000, endMs: 4000 }]);
  });
});
