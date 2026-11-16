import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import type { WindowAudio, WindowTranscript } from "../contracts";
import type { PackedWindow } from "../types";
import { rng } from "./test-kit";
import { createUniformAligner, UNIFORM_CONFIDENCE, uniformAlign } from "./uniform-aligner";

const audioFor = (window: PackedWindow): WindowAudio => ({ window, samples: new Float32Array(0) });
const transcriptOf = (words: string[], windowIndex = 0): WindowTranscript => ({ windowIndex, words, tokenIds: [], noSpeechProbability: 0, averageLogProbability: 0 });

describe("uniformAlign", () => {
  const oneRegion: PackedWindow = { index: 2, lengthMs: 30_000, usedMs: 4000, regions: [{ sourceStartMs: 10_000, sourceEndMs: 14_000, packOffsetMs: 0 }] };

  it("spreads words over the region in proportion to their characters", () => {
    const words = uniformAlign(audioFor(oneRegion), transcriptOf(["ab", "cdef", "gh"]));
    // 2 + 4 + 2 = 8 characters over 4000 ms: 500 ms per character.
    expect(words.map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 1000],
      [1000, 3000],
      [3000, 4000],
    ]);
    expect(words.every((w) => w.confidence === UNIFORM_CONFIDENCE && w.windowIndex === 2)).toBe(true);
    expect(words.map((w) => w.index)).toEqual([0, 1, 2]);
  });

  it("returns one word per transcript word and nothing for an empty transcript", () => {
    expect(uniformAlign(audioFor(oneRegion), transcriptOf([]))).toEqual([]);
    expect(uniformAlign(audioFor(oneRegion), transcriptOf(["a", "b", "c", "d", "e"]))).toHaveLength(5);
  });

  it("never lets a word straddle the gap between two regions, and gives the gap no words", () => {
    const window: PackedWindow = {
      index: 0,
      lengthMs: 30_000,
      usedMs: 7250,
      regions: [
        { sourceStartMs: 0, sourceEndMs: 3000, packOffsetMs: 0 },
        { sourceStartMs: 50_000, sourceEndMs: 54_000, packOffsetMs: 3250 },
      ],
    };
    const words = uniformAlign(audioFor(window), transcriptOf(["aaaa", "bbbb", "cccc", "dddd", "eeee", "ffff", "gggg"]));
    for (const word of words) {
      const inFirst = word.startMs >= 0 && word.endMs <= 3000;
      const inSecond = word.startMs >= 3250 && word.endMs <= 7250;
      expect(inFirst || inSecond).toBe(true);
    }
    // 7 equal words over 7000 ms of speech: 3 land in the 3000 ms region, 4 in the 4000 ms one.
    expect(words.filter((w) => w.endMs <= 3000)).toHaveLength(3);
  });

  it("keeps every time integer, ordered, inside the used part of the window (seeded fuzz)", () => {
    const random = rng(21);
    for (let round = 0; round < 300; round += 1) {
      const regions = [];
      let offset = 0;
      for (let i = 0, n = 1 + Math.floor(random() * 5); i < n; i += 1) {
        const length = 300 + Math.floor(random() * 8000);
        regions.push({ sourceStartMs: i * 100_000, sourceEndMs: i * 100_000 + length, packOffsetMs: offset });
        offset += length + 250;
      }
      const window: PackedWindow = { index: round, lengthMs: 30_000, usedMs: offset - 250, regions };
      const count = 1 + Math.floor(random() * 40);
      const texts = Array.from({ length: count }, () => "x".repeat(1 + Math.floor(random() * 12)));
      const words = uniformAlign(audioFor(window), transcriptOf(texts));
      expect(words).toHaveLength(count);
      let previousEnd = 0;
      for (const word of words) {
        expect(Number.isInteger(word.startMs) && Number.isInteger(word.endMs)).toBe(true);
        expect(word.endMs).toBeGreaterThanOrEqual(word.startMs);
        expect(word.startMs).toBeGreaterThanOrEqual(previousEnd);
        expect(word.endMs).toBeLessThanOrEqual(window.usedMs);
        previousEnd = word.endMs;
      }
    }
  });

  it("copes with a window that has no regions", () => {
    const window: PackedWindow = { index: 0, lengthMs: 30_000, usedMs: 0, regions: [] };
    const words = uniformAlign(audioFor(window), transcriptOf(["a", "b"]));
    expect(words).toHaveLength(2);
    expect(words.every((w) => Number.isFinite(w.startMs) && w.endMs >= w.startMs)).toBe(true);
    // The contract: never past the part of the window that holds audio (here none).
    expect(words.every((w) => w.endMs <= window.usedMs)).toBe(true);
  });

  it("stays inside usedMs for a regionless window that has fewer milliseconds than words", () => {
    const window: PackedWindow = { index: 0, lengthMs: 30_000, usedMs: 3, regions: [] };
    const words = uniformAlign(audioFor(window), transcriptOf(["a", "b", "c", "d", "e"]));
    expect(words.every((w) => w.startMs >= 0 && w.endMs <= 3 && w.endMs >= w.startMs)).toBe(true);
  });
});

describe("createUniformAligner", () => {
  it("rejects with 'aborted' when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const aligner = createUniformAligner();
    await expect(aligner.align(audioFor({ index: 0, lengthMs: 30_000, usedMs: 0, regions: [] }), transcriptOf(["a"]), controller.signal)).rejects.toMatchObject({ code: "aborted" });
    expect(new CaptionError("aborted", "x").code).toBe("aborted");
  });
});
