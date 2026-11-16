import { describe, expect, it } from "vitest";
import type { Word } from "../../lib/captioning/types";
import { toSrt } from "../../lib/captioning/export";
import { layoutCaptions } from "../../lib/captioning/layout";
import { commit, createHistory, redo, undo } from "./history";
import {
  deleteWord,
  freeSpansWithin,
  insertWordAfter,
  insertWordAt,
  isWellFormed,
  MAX_NEW_CAPTION_MS,
  MIN_WORD_MS,
  mergeWithNext,
  nudgeWord,
  setWordText,
  splitSpan,
  splitWordAt,
  type EditResult,
} from "./word-edit";

function w(index: number, text: string, startMs: number, endMs: number, confidence = 1): Word {
  return { text, startMs, endMs, confidence, index, windowIndex: 0 };
}

const SAMPLE: Word[] = [w(0, "Namaste", 0, 700), w(1, "dosto", 800, 1300), w(2, "aaj", 1300, 1600, 0.4), w(3, "kya", 2000, 2300)];

/** Small seeded generator so a failing fuzz run can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("splitSpan", () => {
  it("keeps the ends, stays increasing and follows the weights", () => {
    const bounds = splitSpan(1000, 2000, [1, 3])!;
    expect(bounds).toEqual([1000, 1250, 2000]);
  });

  it("gives every piece at least 1 ms when the weights are lopsided", () => {
    const bounds = splitSpan(0, 10, [1, 1000, 1, 1])!;
    expect(bounds[0]).toBe(0);
    expect(bounds[4]).toBe(10);
    for (let k = 1; k < bounds.length; k += 1) expect(bounds[k]).toBeGreaterThan(bounds[k - 1]);
  });

  it("refuses a span too short to share", () => {
    expect(splitSpan(0, 2, [1, 1, 1])).toBeNull();
    expect(splitSpan(0, 3, [1, 1, 1])).toEqual([0, 1, 2, 3]);
  });
});

describe("setWordText", () => {
  it("changes only the text and keeps timing, confidence and neighbours", () => {
    const result = setWordText(SAMPLE, 1, "doston")!;
    expect(result.words[1]).toEqual({ ...SAMPLE[1], text: "doston" });
    expect(result.words[0]).toBe(SAMPLE[0]);
    expect(result.words[2]).toBe(SAMPLE[2]);
    expect(result.selected).toBe(1);
  });

  it("is a no-op (null) when the text is unchanged, so no empty undo step is made", () => {
    expect(setWordText(SAMPLE, 0, "Namaste")).toBeNull();
    expect(setWordText(SAMPLE, 0, "  Namaste  ")).toBeNull();
  });

  it("deletes the word when the box is emptied", () => {
    const result = setWordText(SAMPLE, 2, "   ")!;
    expect(result.words.map((word) => word.text)).toEqual(["Namaste", "dosto", "kya"]);
    expect(result.words.map((word) => word.index)).toEqual([0, 1, 2]);
  });

  it("turns text with spaces into several words that share the original time by length", () => {
    const result = setWordText([w(0, "kyahaiyeh", 1000, 2000)], 0, "kya hai yeh")!;
    expect(result.words.map((word) => word.text)).toEqual(["kya", "hai", "yeh"]);
    expect(result.words[0].startMs).toBe(1000);
    expect(result.words[2].endMs).toBe(2000);
    // "kya"(3) "hai"(3) "yeh"(3): equal thirds, contiguous.
    expect(result.words.map((word) => [word.startMs, word.endMs])).toEqual([
      [1000, 1333],
      [1333, 1667],
      [1667, 2000],
    ]);
    expect(isWellFormed(result.words)).toBe(true);
  });

  it("splits Devanagari text by letters, not bytes", () => {
    const result = setWordText([w(0, "नमस्तेदोस्तों", 0, 1200)], 0, "नमस्ते दोस्तों")!;
    expect(result.words.map((word) => word.text)).toEqual(["नमस्ते", "दोस्तों"]);
    expect(result.words[0].endMs).toBe(result.words[1].startMs);
  });

  it("returns null for an index that does not exist", () => {
    expect(setWordText(SAMPLE, 9, "x")).toBeNull();
    expect(setWordText(SAMPLE, -1, "x")).toBeNull();
  });
});

describe("splitWordAt", () => {
  it("cuts the word and its time at the caret", () => {
    const result = splitWordAt([w(0, "kyahai", 0, 600)], 0, 3)!;
    expect(result.words.map((word) => [word.text, word.startMs, word.endMs])).toEqual([
      ["kya", 0, 300],
      ["hai", 300, 600],
    ]);
    expect(result.selected).toBe(0);
  });

  it("refuses a cut at either end, where one half would be empty", () => {
    expect(splitWordAt(SAMPLE, 0, 0)).toBeNull();
    expect(splitWordAt(SAMPLE, 0, 7)).toBeNull();
  });

  it("does not cut an emoji in half", () => {
    const result = splitWordAt([w(0, "ok😀go", 0, 600)], 0, 3)!; // offset 3 is inside the surrogate pair
    expect(result.words.map((word) => word.text)).toEqual(["ok", "😀go"]);
  });
});

describe("mergeWithNext", () => {
  it("joins text, covers both words and keeps the lower confidence", () => {
    const result = mergeWithNext(SAMPLE, 1)!;
    expect(result.words).toHaveLength(3);
    expect(result.words[1]).toMatchObject({ text: "dostoaaj", startMs: 800, endMs: 1600, confidence: 0.4 });
    expect(result.words.map((word) => word.index)).toEqual([0, 1, 2]);
  });

  it("covers a gap between the words", () => {
    const result = mergeWithNext(SAMPLE, 2)!;
    expect(result.words[2]).toMatchObject({ startMs: 1300, endMs: 2300 });
  });

  it("cannot merge the last word", () => {
    expect(mergeWithNext(SAMPLE, 3)).toBeNull();
  });
});

describe("deleteWord and insertWordAfter", () => {
  it("deletes and renumbers, selecting the word that took its place", () => {
    const result = deleteWord(SAMPLE, 1)!;
    expect(result.words.map((word) => word.text)).toEqual(["Namaste", "aaj", "kya"]);
    expect(result.selected).toBe(1);
    expect(deleteWord(SAMPLE.slice(0, 1), 0)!.selected).toBe(-1);
  });

  it("puts a new word into the free time after a word, never overlapping the next", () => {
    const result = insertWordAfter(SAMPLE, 2, "bhi")!; // gap 1600..2000
    expect(result.words[3]).toMatchObject({ text: "bhi", startMs: 1600, endMs: 2000, confidence: 1 });
    expect(isWellFormed(result.words)).toBe(true);
    expect(result.selected).toBe(3);
  });

  it("limits a new word to 400 ms when the gap is large", () => {
    const result = insertWordAfter([w(0, "a", 0, 100), w(1, "b", 5000, 5100)], 0, "x")!;
    expect(result.words[1]).toMatchObject({ startMs: 100, endMs: 500 });
  });

  it("takes the back half of the previous word when there is no gap", () => {
    const result = insertWordAfter([w(0, "lamba", 0, 1000), w(1, "b", 1000, 1100)], 0, "x")!;
    expect(result.words.map((word) => [word.text, word.startMs, word.endMs])).toEqual([
      ["lamba", 0, 500],
      ["x", 500, 1000],
      ["b", 1000, 1100],
    ]);
  });

  it("says no when there is no room at all", () => {
    expect(insertWordAfter([w(0, "a", 0, 50), w(1, "b", 50, 100)], 0, "x")).toBeNull();
  });

  it("can add a word before the first one, and rejects empty text", () => {
    const result = insertWordAfter([w(0, "a", 1000, 1500)], -1, "arre")!;
    expect(result.words.map((word) => [word.text, word.startMs, word.endMs])).toEqual([
      ["arre", 600, 1000],
      ["a", 1000, 1500],
    ]);
    expect(result.selected).toBe(0);
    expect(insertWordAfter(SAMPLE, 1, "   ")).toBeNull();
    expect(insertWordAfter(SAMPLE, 0, "x")).not.toBeNull();
    expect(insertWordAfter([w(0, "a", 0, 500)], -1, "x")).toBeNull(); // no room before a word at 0
  });
});

describe("insertWordAt (a caption at a known gap)", () => {
  it("puts a caption before the first word", () => {
    const result = insertWordAt([w(0, "a", 1000, 1500), w(1, "b", 2000, 2500)], 0, 1000, "shuru")!;
    expect(result.words.map((word) => [word.text, word.startMs, word.endMs])).toEqual([
      ["shuru", 0, 1000],
      ["a", 1000, 1500],
      ["b", 2000, 2500],
    ]);
    expect(result.selected).toBe(0);
    expect(isWellFormed(result.words)).toBe(true);
  });

  it("puts a caption in a gap in the middle and selects it", () => {
    const result = insertWordAt(SAMPLE, 1600, 2000, "bhi")!; // between "aaj" (ends 1600) and "kya" (starts 2000)
    expect(result.words[3]).toMatchObject({ text: "bhi", startMs: 1600, endMs: 2000, confidence: 1 });
    expect(result.selected).toBe(3);
    expect(result.words.map((word) => word.index)).toEqual([0, 1, 2, 3, 4]);
    expect(isWellFormed(result.words)).toBe(true);
  });

  it("puts a caption after the last word", () => {
    const result = insertWordAt(SAMPLE, 2300, 3000, "end")!;
    expect(result.words[4]).toMatchObject({ text: "end", startMs: 2300, endMs: 3000 });
    expect(result.selected).toBe(4);
    expect(isWellFormed(result.words)).toBe(true);
  });

  it("refuses a gap shorter than the minimum word length", () => {
    expect(insertWordAt([w(0, "a", 1000, 1500)], 1500, 1500 + MIN_WORD_MS - 1, "x")).toBeNull();
    expect(insertWordAt([w(0, "a", 0, 500), w(1, "b", 520, 900)], 500, 520, "x")).toBeNull();
    expect(insertWordAt(SAMPLE, 2000, 1000, "x")).toBeNull();
    expect(insertWordAt(SAMPLE, Number.NaN, 1000, "x")).toBeNull();
  });

  it("clamps into the free time instead of overlapping a neighbour", () => {
    const result = insertWordAt([w(0, "a", 0, 1000), w(1, "b", 3000, 4000)], 500, 3500, "x")!;
    expect(result.words.map((word) => [word.startMs, word.endMs])).toEqual([
      [0, 1000],
      [1000, 3000],
      [3000, 4000],
    ]);
    expect(isWellFormed(result.words)).toBe(true);
  });

  it("caps a very long gap at MAX_NEW_CAPTION_MS", () => {
    const result = insertWordAt([], 0, 60_000, "x")!;
    expect(result.words[0]).toMatchObject({ startMs: 0, endMs: MAX_NEW_CAPTION_MS });
  });

  it("keeps an empty caption in the list but never invents a word in the export", () => {
    const created = insertWordAt(SAMPLE, 1600, 2000, "")!;
    expect(created.words[3].text).toBe("");
    expect(layoutCaptions(created.words).flatMap((event) => event.lines.flat()).map((word) => word.text)).toContain("");
    // Empty text is dropped by the exporters, so an untouched caption produces no cue at all.
    expect(toSrt(layoutCaptions(created.words))).not.toMatch(/bhi|word/i);

    // Once the visitor types, the typed word is the one that renders and exports.
    const typed = setWordText(created.words, created.selected, "suno")!;
    const events = layoutCaptions(typed.words);
    expect(events.flatMap((event) => event.lines.flat()).map((word) => word.text)).toContain("suno");
    expect(toSrt(events)).toContain("suno");
    expect(isWellFormed(typed.words)).toBe(true);
  });

  it("can create the first caption in an empty transcript, with room to type", () => {
    const result = insertWordAt([], 12_000, 18_000, "")!;
    expect(result.words).toEqual([{ text: "", startMs: 12_000, endMs: 18_000, confidence: 1, index: 0, windowIndex: 0 }]);
    expect(result.selected).toBe(0);
  });
});

describe("freeSpansWithin (keep a no-words stretch honest after typing)", () => {
  const gap = { startMs: 1000, endMs: 3000 };

  it("returns the whole stretch when no word is on it", () => {
    expect(freeSpansWithin([w(0, "a", 0, 500), w(1, "b", 4000, 4500)], gap)).toEqual([gap]);
  });

  it("leaves out the part a word now covers", () => {
    expect(freeSpansWithin([w(0, "a", 1500, 2000)], gap)).toEqual([
      { startMs: 1000, endMs: 1500 },
      { startMs: 2000, endMs: 3000 },
    ]);
    expect(freeSpansWithin([w(0, "a", 1000, 1600)], gap)).toEqual([{ startMs: 1600, endMs: 3000 }]);
    expect(freeSpansWithin([w(0, "a", 2400, 3000)], gap)).toEqual([{ startMs: 1000, endMs: 2400 }]);
    expect(freeSpansWithin([w(0, "a", 900, 3100)], gap)).toEqual([]);
  });

  it("does not count the time before or after the stretch, and ignores bad input", () => {
    expect(freeSpansWithin([w(0, "a", 0, 1500), w(1, "b", 2500, 9000)], gap)).toEqual([{ startMs: 1500, endMs: 2500 }]);
    expect(freeSpansWithin([], { startMs: 2000, endMs: 2000 })).toEqual([]);
    expect(freeSpansWithin([], { startMs: Number.NaN, endMs: 2000 })).toEqual([]);
  });
});

describe("nudgeWord", () => {
  it("moves the end later and trims the neighbour it runs into", () => {
    const result = nudgeWord(SAMPLE, 1, "end", 200)!; // dosto 800-1300 -> end 1500; "aaj" starts 1300
    expect(result.words[1].endMs).toBe(1500);
    expect(result.words[2].startMs).toBe(1500);
    expect(isWellFormed(result.words)).toBe(true);
  });

  it("will not squeeze a neighbour below the minimum length", () => {
    const result = nudgeWord(SAMPLE, 1, "end", 5000)!;
    expect(result.words[2].endMs - result.words[2].startMs).toBeGreaterThanOrEqual(MIN_WORD_MS);
    expect(result.words[1].endMs).toBe(1600 - MIN_WORD_MS);
  });

  it("will not make a word shorter than the minimum", () => {
    const result = nudgeWord(SAMPLE, 0, "start", 5000)!;
    expect(result.words[0].endMs - result.words[0].startMs).toBe(MIN_WORD_MS);
  });

  it("cannot go before zero", () => {
    expect(nudgeWord(SAMPLE, 0, "both", -500)).toBeNull();
    expect(nudgeWord(SAMPLE, 0, "start", -50)).toBeNull();
  });

  it("shifts a whole word and keeps its length", () => {
    const result = nudgeWord(SAMPLE, 3, "both", 250)!;
    expect(result.words[3]).toMatchObject({ startMs: 2250, endMs: 2550 });
  });

  it("returns null when nothing changes", () => {
    expect(nudgeWord(SAMPLE, 1, "start", 0)).toBeNull();
    expect(nudgeWord(SAMPLE, 1, "start", Number.NaN)).toBeNull();
  });

  it("never pushes a word the wrong way, even when the input overlaps", () => {
    // The pipeline might hand over overlapping words. Moving earlier must never move later.
    const overlapping = [w(0, "a", 0, 1000), w(1, "b", 500, 900)];
    const result = nudgeWord(overlapping, 1, "start", -10)!;
    expect(result.words[1].startMs).toBe(490);
    expect(result.words[0].endMs).toBe(490); // the overlapped neighbour is trimmed back to the new edge
    // Shifting the whole of "a" earlier is blocked at 0, and shifting "b" earlier than "a" allows is clamped to a.start + min.
    const shifted = nudgeWord(overlapping, 1, "both", -5000)!;
    expect(shifted.words[1].startMs).toBe(MIN_WORD_MS);
  });
});

describe("editing keeps the transcript valid (seeded fuzz)", () => {
  function randomOp(words: Word[], next: () => number): EditResult | null {
    const i = Math.floor(next() * (words.length + 1)) - 0; // may be one past the end on purpose
    const pick = Math.floor(next() * 8);
    const delta = Math.round((next() - 0.5) * 800);
    switch (pick) {
      case 0:
        return setWordText(words, i, next() < 0.5 ? "naya" : "do shabd");
      case 1:
        return splitWordAt(words, i, 1 + Math.floor(next() * 4));
      case 2:
        return mergeWithNext(words, i);
      case 3:
        return deleteWord(words, i);
      case 4:
        return insertWordAfter(words, i - 1, "jodo");
      case 5:
        return insertWordAt(words, Math.round(next() * 6000), Math.round(next() * 6000), next() < 0.5 ? "" : "naya");
      case 6:
        return nudgeWord(words, i, "start", delta);
      default:
        return nudgeWord(words, i, next() < 0.5 ? "end" : "both", delta);
    }
  }

  it("every operation leaves ordered, non-overlapping words with correct indexes, and undo replays exactly", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const next = rng(seed);
      let words: Word[] = Array.from({ length: 12 }, (_, k) => w(k, `shabd${k}`, k * 500 + 100, k * 500 + 100 + 250 + Math.floor(next() * 150)));
      expect(isWellFormed(words)).toBe(true);
      const original = words;
      let history = createHistory(words);
      let steps = 0;
      for (let step = 0; step < 80; step += 1) {
        const result = randomOp(words, next);
        if (!result) continue;
        expect(isWellFormed(result.words), `seed ${seed} step ${step}`).toBe(true);
        expect(result.selected).toBeGreaterThanOrEqual(result.words.length === 0 ? -1 : 0);
        expect(result.selected).toBeLessThan(Math.max(1, result.words.length));
        words = result.words;
        history = commit(history, words);
        steps += 1;
        if (words.length < 3) break;
      }
      // Undo everything: must be the very first transcript, value for value.
      let back = history;
      for (let k = 0; k < steps; k += 1) back = undo(back);
      expect(back.present).toEqual(original);
      // And redo everything: the last transcript again.
      let forward = back;
      for (let k = 0; k < steps; k += 1) forward = redo(forward);
      expect(forward.present).toEqual(words);
    }
  });

  it("never mutates the list it was given", () => {
    const frozen = SAMPLE.map((word) => Object.freeze({ ...word })) as Word[];
    Object.freeze(frozen);
    expect(() => {
      setWordText(frozen, 1, "x y");
      splitWordAt(frozen, 1, 2);
      mergeWithNext(frozen, 0);
      deleteWord(frozen, 0);
      insertWordAfter(frozen, 2, "z");
      insertWordAt(frozen, 1700, 1900, "");
      nudgeWord(frozen, 1, "both", 100);
    }).not.toThrow();
  });
});
