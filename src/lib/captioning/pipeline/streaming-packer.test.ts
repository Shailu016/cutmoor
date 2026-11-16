import { describe, expect, it } from "vitest";
import { packSpeech } from "../packer";
import type { PackedWindow, SpeechInterval } from "../types";
import { rng } from "./test-kit";
import { StreamingPacker } from "./streaming-packer";

/** Feeds `intervals` in random batches, taking windows after each, and returns every window handed out. */
function stream(intervals: SpeechInterval[], random: () => number): PackedWindow[] {
  const packer = new StreamingPacker();
  const out: PackedWindow[] = [];
  let next = 0;
  while (next < intervals.length) {
    const batch = 1 + Math.floor(random() * 3);
    packer.add(intervals.slice(next, next + batch));
    next += batch;
    out.push(...packer.take(false));
  }
  out.push(...packer.take(true));
  return out;
}

function randomSpeech(random: () => number, count: number, longChance: number): SpeechInterval[] {
  const intervals: SpeechInterval[] = [];
  let at = Math.floor(random() * 2000);
  for (let i = 0; i < count; i += 1) {
    const long = random() < longChance;
    const length = long ? 20_000 + Math.floor(random() * 150_000) : 200 + Math.floor(random() * 12_000);
    intervals.push({ startMs: at, endMs: at + length });
    // Gaps straddle the 300 ms merge threshold on purpose, so merging across batches is exercised.
    at += length + (random() < 0.3 ? 100 + Math.floor(random() * 400) : 400 + Math.floor(random() * 8000));
  }
  return intervals;
}

describe("StreamingPacker", () => {
  it("hands out exactly the windows that packing everything at once would (seeded fuzz)", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = rng(seed);
      const intervals = randomSpeech(random, 1 + Math.floor(random() * 25), 0.25);
      const batch = packSpeech(intervals);
      const streamed = stream(intervals, rng(seed * 31));
      expect(streamed, `seed ${seed}`).toEqual(batch);
    }
  });

  it("holds back the last window while later speech could still change it", () => {
    const packer = new StreamingPacker();
    packer.add([{ startMs: 0, endMs: 20_000 }]);
    expect(packer.take(false)).toEqual([]);
    packer.add([{ startMs: 25_000, endMs: 45_000 }]);
    const first = packer.take(false);
    expect(first.map((w) => w.index)).toEqual([0]);
    expect(first[0].regions).toEqual([{ sourceStartMs: 0, sourceEndMs: 20_000, packOffsetMs: 0 }]);
  });

  it("merges an interval that arrives within the merge gap into the one still waiting", () => {
    const packer = new StreamingPacker();
    packer.add([{ startMs: 0, endMs: 10_000 }]);
    packer.add([{ startMs: 10_100, endMs: 20_000 }]);
    const [only] = packer.take(true);
    expect(only.regions).toEqual([{ sourceStartMs: 0, sourceEndMs: 20_000, packOffsetMs: 0 }]);
  });

  it("releases the early windows of one long unbroken region before it ends (no waiting for a pause)", () => {
    const packer = new StreamingPacker();
    // Contiguous 10 s segments, as a detector that caps segment length would emit.
    let released = 0;
    for (let t = 0; t < 300_000; t += 10_000) {
      packer.add([{ startMs: t, endMs: t + 10_000 }]);
      released += packer.take(false).length;
      // Never sits on more than a few windows' worth of speech.
      expect(packer.pendingWindowCount).toBeLessThanOrEqual(4);
    }
    expect(released).toBeGreaterThan(8);
    released += packer.take(true).length;
    expect(released).toBe(packSpeech([{ startMs: 0, endMs: 300_000 }]).length);
  });

  it("gives windows consecutive global indexes across calls", () => {
    const packer = new StreamingPacker();
    const indexes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      packer.add([{ startMs: i * 40_000, endMs: i * 40_000 + 25_000 }]);
      indexes.push(...packer.take(false).map((w) => w.index));
    }
    indexes.push(...packer.take(true).map((w) => w.index));
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("ignores a late interval that starts before audio already handed out", () => {
    const packer = new StreamingPacker();
    packer.add([{ startMs: 0, endMs: 25_000 }]);
    packer.add([{ startMs: 40_000, endMs: 65_000 }]);
    expect(packer.take(false)).toHaveLength(1);
    packer.add([{ startMs: 1000, endMs: 5000 }]); // stale
    const rest = packer.take(true);
    expect(rest).toHaveLength(1);
    expect(rest[0].regions[0].sourceStartMs).toBe(40_000);
  });
});
