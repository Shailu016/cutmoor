import { describe, expect, it } from "vitest";
import type { PcmChunk } from "../contracts";
import type { Word } from "../types";
import { rng } from "./test-kit";
import { createRepeatTracker, transferRepeatedWords } from "./song-repeat";
import type { RepeatMatch, RepeatTracker } from "./song-repeat";

/**
 * Synthetic audio whose answer we know. A "pattern" is a block of white noise: broadband, so every one of the ten
 * vocal bands carries energy, and a copy of the same samples produces the same feature vector exactly. Two blocks
 * from different seeds share no structure, so they are the "unrelated" case.
 */
const SAMPLE_RATE = 16_000;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;

function noise(ms: number, seed: number, amplitude = 0.3): Float32Array {
  const random = rng(seed);
  const samples = new Float32Array(ms * SAMPLES_PER_MS);
  for (let i = 0; i < samples.length; i += 1) samples[i] = (random() * 2 - 1) * amplitude;
  return samples;
}

function tone(ms: number, hz: number, amplitude: number): Float32Array {
  const samples = new Float32Array(ms * SAMPLES_PER_MS);
  for (let i = 0; i < samples.length; i += 1) samples[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  return samples;
}

/** Feeds the clip the way the pipeline does: contiguous 1 s chunks, in order. */
function feed(tracker: RepeatTracker, samples: Float32Array, chunkMs = 1000): void {
  const size = chunkMs * SAMPLES_PER_MS;
  for (let start = 0; start < samples.length; start += size) {
    const chunk: PcmChunk = { startMs: start / SAMPLES_PER_MS, samples: samples.subarray(start, Math.min(start + size, samples.length)) };
    tracker.push(chunk);
  }
}

function word(text: string, startMs: number, endMs: number, windowIndex = 0): Word {
  return { text, startMs, endMs, confidence: 0.9, index: 0, windowIndex };
}

describe("repeat tracker", () => {
  it("finds an exact 30 s loop in 90 s of audio", () => {
    // A 20 s noise phrase at 0, 30 and 60 s, digital silence between. The phrase is longer than the 8 s block window
    // (a shorter one cannot form a block by design), and the silence ends the extension, so the reported block is
    // the whole 20 s phrase.
    const phrase = noise(20_000, 11);
    const clip = new Float32Array(90 * SAMPLE_RATE);
    for (const at of [0, 30, 60]) clip.set(phrase, at * SAMPLE_RATE);

    const tracker = createRepeatTracker();
    const started = performance.now();
    feed(tracker, clip);
    const match = tracker.find();
    const elapsedMs = performance.now() - started;

    expect(tracker.frames).toBe(1799);
    expect(match).not.toBeNull();
    const found = match as RepeatMatch;
    expect(found.lagMs).toBe(30_000);
    expect(found.similarity).toBeGreaterThan(0.99);
    expect(found.prominence).toBeGreaterThan(0.9);
    expect(found.blockStartMs).toBe(0);
    expect(found.blockEndMs).toBe(20_000);
    // The 90 s pass is far inside the 15 s budget for a 2 min song; this only catches an accidental O(n^3).
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("finds a 33.65 s loop when only that block of a 120 s song repeats", () => {
    // The Sajan shape: 120 s of other audio with one 33.65 s vocal body at 47.2-80.85 s and the same samples again
    // 33.65 s later (80.85-114.5 s). A whole-file mean is diluted to ~0.38; the block-local score must see the block.
    const clip = noise(120_000, 41);
    const body = noise(33_650, 31);
    clip.set(body, 47_200 * SAMPLES_PER_MS);
    clip.set(body, 80_850 * SAMPLES_PER_MS);

    const tracker = createRepeatTracker();
    feed(tracker, clip);
    const match = tracker.find();

    expect(match).not.toBeNull();
    const found = match as RepeatMatch;
    expect(found.lagMs).toBe(33_650);
    expect(found.similarity).toBeGreaterThanOrEqual(0.75);
    expect(found.prominence).toBeGreaterThanOrEqual(0.5);
    // The extension recovers the ~33 s body, not just the 8 s window that seeded it.
    expect(found.blockEndMs - found.blockStartMs).toBeGreaterThanOrEqual(25_000);
    expect(found.blockStartMs).toBeGreaterThanOrEqual(47_000);
    expect(found.blockStartMs).toBeLessThanOrEqual(47_600);
    expect(found.blockEndMs).toBeGreaterThanOrEqual(80_000);
    expect(found.blockEndMs).toBeLessThanOrEqual(81_200);
  });

  it("returns null for unrelated noise", () => {
    // The lag range is narrowed to keep the clip short. White-noise frames are independent, so the best 8 s window
    // at every lag sits near zero and neither gate can pass.
    const tracker = createRepeatTracker({ minLagMs: 500, maxLagMs: 5000 });
    feed(tracker, noise(12_000, 23));
    expect(tracker.find()).toBeNull();
  });

  it("does not accept a stationary 1 kHz tone as a repeat", () => {
    // A sustained tone is self-similar at EVERY lag: its feature vector is the same in every frame, so similarity is
    // ~1 everywhere and the baseline is also ~1. What rejects it is the prominence gate (best - baseline ~ 0), not
    // the similarity gate. The first assertion documents that, so the second one cannot pass for the wrong reason.
    const tracker = createRepeatTracker();
    feed(tracker, tone(40_000, 1000, 0.4));
    expect(tracker.similarityAt(0, 4000, 20_000)).toBeGreaterThan(0.99);
    expect(tracker.find()).toBeNull();
  });

  it("scores identical frames at a lag near 1 and unrelated frames near 0", () => {
    // 34 s: phrase A at 0 and 30 s, unrelated phrases B and C at 2 and 32 s.
    const clip = new Float32Array(34 * SAMPLE_RATE);
    const a = noise(2000, 11);
    const b = noise(2000, 99);
    const c = noise(2000, 137);
    clip.set(a, 0);
    clip.set(b, 2 * SAMPLE_RATE);
    clip.set(a, 30 * SAMPLE_RATE);
    clip.set(c, 32 * SAMPLE_RATE);

    const tracker = createRepeatTracker();
    feed(tracker, clip);

    expect(tracker.frames).toBe(679);
    expect(tracker.similarityAt(500, 1500, 30_000)).toBeGreaterThan(0.99);
    // Frames 2.5-2.9 s against their 32.5-32.9 s twin: different noise, same band statistics.
    expect(tracker.similarityAt(2500, 2900, 30_000)).toBeLessThan(0.35);
    // Nothing exists on the far side, and a zero-length span has no frames at all.
    expect(tracker.similarityAt(500, 1500, 120_000)).toBe(0);
    expect(tracker.similarityAt(2000, 2000, 30_000)).toBe(0);
  });
});

describe("word transfer", () => {
  const match: RepeatMatch = { lagMs: 30_000, similarity: 0.9, prominence: 0.8, blockStartMs: 0, blockEndMs: 5000 };
  const decoded: Word[] = [word("alpha", 1000, 1400), word("bravo", 1600, 2000), word("charlie", 2200, 2600)];
  decoded.forEach((item, i) => {
    item.index = 5 + i;
  });

  it("copies into an empty twin, marks the copies inferred and low-confidence, and re-indexes", () => {
    const result = transferRepeatedWords(decoded, match, { similarityAt: () => 0.9 });

    expect(result.inferred).toBe(3);
    expect(result.words).toHaveLength(6);
    expect(result.words.map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // Sorted by time, source words untouched.
    expect(result.words.map((item) => item.startMs)).toEqual([1000, 1600, 2200, 31_000, 31_600, 32_200]);
    const copies = result.words.filter((item) => item.inferred === true);
    expect(copies.map((item) => [item.text, item.startMs, item.endMs])).toEqual([
      ["alpha", 31_000, 31_400],
      ["bravo", 31_600, 32_000],
      ["charlie", 32_200, 32_600],
    ]);
    expect(copies.every((item) => item.confidence === 0.2)).toBe(true);
    // The input list is readonly and must not be re-indexed in place.
    expect(decoded.map((item) => item.index)).toEqual([5, 6, 7]);
  });

  it("needs per-word audio evidence: no probe means no copy", () => {
    const result = transferRepeatedWords(decoded, match);
    expect(result.inferred).toBe(0);
    expect(result.words).toHaveLength(3);
  });

  it("copies only words whose own audio matches the twin", () => {
    // The 10 s word belongs to a verse whose audio is unrelated to its twin (probe 0.2), so it must not be copied
    // even though its twin at 43.65 s is empty; the 50 s word is the measured repeat (probe 0.9) and moves.
    const blockMatch: RepeatMatch = { ...match, lagMs: 33_650, blockStartMs: 47_200, blockEndMs: 80_800 };
    const words: Word[] = [word("outside", 10_000, 10_400), word("inside", 50_000, 50_400)];
    const result = transferRepeatedWords(words, blockMatch, {
      similarityAt: (startMs) => (startMs >= 47_200 ? 0.9 : 0.2),
    });
    expect(result.inferred).toBe(1);
    const copies = result.words.filter((item) => item.inferred === true);
    expect(copies.map((item) => [item.text, item.startMs, item.endMs])).toEqual([["inside", 83_650, 84_050]]);
  });

  it("copies nothing into a twin that already has words", () => {
    // "already" sits at the first target; the other two targets are 200 ms and 800 ms away, inside the 1000 ms
    // collision window.
    const twin = [...decoded, word("already", 31_000, 31_400, 4)];
    // The original three words' audio matches their twins; "already" itself does not match the audio 30 s later.
    const result = transferRepeatedWords(twin, match, { similarityAt: (startMs) => (startMs < 5000 ? 0.9 : 0.2) });
    expect(result.inferred).toBe(0);
    expect(result.words).toHaveLength(4);
  });

  it("copies nothing when the local similarity probe is below the gate", () => {
    const calls: Array<[number, number, number]> = [];
    const result = transferRepeatedWords(decoded, match, {
      minSimilarity: 0.75,
      similarityAt: (startMs, endMs, lagMs) => {
        calls.push([startMs, endMs, lagMs]);
        return 0.5;
      },
    });
    expect(result.inferred).toBe(0);
    expect(result.words).toHaveLength(3);
    expect(calls[0]).toEqual([1000, 1400, 30_000]);
  });

  it("copies when the probe passes, and never past the end of the file", () => {
    const passing = transferRepeatedWords(decoded, match, { similarityAt: () => 0.9 });
    expect(passing.inferred).toBe(3);

    // The word's target (75 000 + 33 650) ends at 109 050 ms.
    const lateMatch: RepeatMatch = { ...match, lagMs: 33_650, blockStartMs: 70_000, blockEndMs: 80_000 };
    const late: Word[] = [word("late", 75_000, 75_400)];
    expect(transferRepeatedWords(late, lateMatch, { durationMs: 108_000, similarityAt: () => 0.9 }).inferred).toBe(0);
    expect(transferRepeatedWords(late, lateMatch, { durationMs: 110_000, similarityAt: () => 0.9 }).inferred).toBe(1);
  });
});
