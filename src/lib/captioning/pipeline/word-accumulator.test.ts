import { describe, expect, it } from "vitest";
import { mergeWindowWords } from "../overlap-merge";
import type { WindowWords } from "../overlap-merge";
import { windowSourceSpan } from "../packer";
import { packSpeech } from "../packer";
import type { Word } from "../types";
import { makeTimeline, rng } from "./test-kit";
import { WordAccumulator } from "./word-accumulator";

/** What a perfect model would return for each packed window of this timeline (global time). */
function perfectWindows(segments: { startMs: number; endMs: number }[], seed: number, jitter: (random: () => number) => number): { windows: WindowWords[]; truth: Word[] } {
  const { truth } = makeTimeline(segments, seed);
  const random = rng(seed + 99);
  const windows = packSpeech(segments).map((window): WindowWords => {
    const coverage = windowSourceSpan(window);
    const words = truth
      .filter((word) => window.regions.some((r) => (word.startMs + word.endMs) / 2 >= r.sourceStartMs && (word.startMs + word.endMs) / 2 < r.sourceEndMs))
      .map((word) => ({ ...word, startMs: word.startMs + jitter(random), endMs: word.endMs + jitter(random), windowIndex: window.index }))
      .filter((word) => word.endMs > word.startMs);
    return { coverage, words };
  });
  return { windows, truth };
}

describe("WordAccumulator", () => {
  it("equals merging every window at once (oracle), for random timelines with split regions", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const random = rng(seed);
      const segments = [];
      let at = 500;
      for (let i = 0; i < 6; i += 1) {
        const length = random() < 0.4 ? 40_000 + Math.floor(random() * 60_000) : 1000 + Math.floor(random() * 15_000);
        segments.push({ startMs: at, endMs: at + length });
        at += length + 500 + Math.floor(random() * 4000);
      }
      const { windows } = perfectWindows(segments, seed, (r) => Math.floor(r() * 60) - 30);
      const accumulator = new WordAccumulator();
      for (const window of windows) accumulator.add(window);
      expect(accumulator.words(), `seed ${seed}`).toEqual(mergeWindowWords(windows));
    }
  });

  it("does not double or lose seam words of a split long region", () => {
    const { windows, truth } = perfectWindows([{ startMs: 0, endMs: 100_000 }], 5, () => 0);
    expect(windows.length).toBeGreaterThan(3);
    const accumulator = new WordAccumulator();
    for (const window of windows) accumulator.add(window);
    expect(accumulator.words().map((w) => w.text)).toEqual(truth.map((w) => w.text));
  });

  it("numbers words 0.. across the whole transcript and keeps them in time order", () => {
    const { windows } = perfectWindows([{ startMs: 0, endMs: 5000 }, { startMs: 60_000, endMs: 70_000 }, { startMs: 200_000, endMs: 203_000 }], 3, () => 0);
    const accumulator = new WordAccumulator();
    for (const window of windows) accumulator.add(window);
    const words = accumulator.words();
    expect(words.map((w) => w.index)).toEqual(words.map((_, i) => i));
    for (let i = 1; i < words.length; i += 1) expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].endMs);
  });

  it("settledWords: every preview is a prefix of the next preview and of the final transcript (seeded fuzz, jittered timing)", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const random = rng(seed);
      const segments = [];
      let at = 500;
      for (let i = 0; i < 4; i += 1) {
        const length = random() < 0.6 ? 40_000 + Math.floor(random() * 60_000) : 1000 + Math.floor(random() * 15_000);
        segments.push({ startMs: at, endMs: at + length });
        at += length + 500 + Math.floor(random() * 4000);
      }
      const { windows } = perfectWindows(segments, seed, (r) => Math.floor(r() * 60) - 30);
      const accumulator = new WordAccumulator();
      const previews: Word[][] = [];
      for (const window of windows) {
        accumulator.add(window);
        previews.push(accumulator.settledWords(1150));
      }
      const final = accumulator.words();
      previews.forEach((preview, n) => {
        expect(preview, `seed ${seed} preview ${n}`).toEqual(final.slice(0, preview.length));
        if (n > 0) expect(preview.length, `seed ${seed} preview ${n} shrank`).toBeGreaterThanOrEqual(previews[n - 1].length);
      });
      expect(accumulator.settledWords(0), `seed ${seed}`).toEqual(final); // no guard: nothing held back
    }
  });

  it("settledWords holds back only the end of the newest run, and releases it once a later run starts", () => {
    const { windows } = perfectWindows([{ startMs: 0, endMs: 25_000 }, { startMs: 60_000, endMs: 85_000 }], 8, () => 0);
    const accumulator = new WordAccumulator();
    accumulator.add(windows[0]);
    expect(windows).toHaveLength(2);
    const held = accumulator.settledWords(1000);
    expect(held.length).toBeLessThan(accumulator.words().length);
    expect(held.every((w) => w.endMs <= 25_000 - 1000)).toBe(true);
    accumulator.add(windows[1]);
    const first = accumulator.words().filter((w) => w.endMs <= 25_000);
    expect(accumulator.settledWords(1000).slice(0, first.length)).toEqual(first);
  });

  it("is quick enough to call after every window of a 3 hour file", () => {
    const segments = Array.from({ length: 180 }, (_, i) => ({ startMs: i * 60_000, endMs: i * 60_000 + 20_000 }));
    const { windows } = perfectWindows(segments, 11, () => 0);
    const accumulator = new WordAccumulator();
    const began = performance.now();
    for (const window of windows) {
      accumulator.add(window);
      accumulator.words();
    }
    expect(performance.now() - began).toBeLessThan(5000);
    expect(accumulator.words().length).toBe(windows.reduce((sum, w) => sum + w.words.length, 0));
  });
});
