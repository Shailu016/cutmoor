import { describe, expect, it } from "vitest";
import { WINDOW_SAMPLES } from "../contracts";
import { packSpeech, toGlobalMs } from "../packer";
import type { PackedWindow } from "../types";
import { assembleWindowAudio } from "./assemble";
import { PcmStore } from "./pcm-store";
import { rng, sampleValue } from "./test-kit";

function storeOf(totalMs: number): PcmStore {
  const store = new PcmStore();
  for (let t = 0; t < totalMs; t += 1000) {
    const ms = Math.min(1000, totalMs - t);
    const samples = new Float32Array(ms * 16);
    for (let i = 0; i < samples.length; i += 1) samples[i] = sampleValue(t * 16 + i);
    store.push({ startMs: t, samples });
  }
  return store;
}

describe("assembleWindowAudio", () => {
  it("always returns exactly one window of samples", () => {
    const window: PackedWindow = { index: 0, lengthMs: 30_000, usedMs: 1000, regions: [{ sourceStartMs: 0, sourceEndMs: 1000, packOffsetMs: 0 }] };
    expect(assembleWindowAudio(window, storeOf(2000)).samples.length).toBe(WINDOW_SAMPLES);
  });

  it("puts every region at its pack offset, silence in the gaps and zero padding at the end", () => {
    const window: PackedWindow = {
      index: 3,
      lengthMs: 30_000,
      usedMs: 2750,
      regions: [
        { sourceStartMs: 5000, sourceEndMs: 6000, packOffsetMs: 0 },
        { sourceStartMs: 9000, sourceEndMs: 10_500, packOffsetMs: 1250 },
      ],
    };
    const { samples } = assembleWindowAudio(window, storeOf(12_000));
    expect(samples[0]).toBe(sampleValue(5000 * 16));
    expect(samples[1000 * 16 - 1]).toBe(sampleValue(6000 * 16 - 1));
    expect(samples.subarray(1000 * 16, 1250 * 16).every((v) => v === 0)).toBe(true); // the inserted gap
    expect(samples[1250 * 16]).toBe(sampleValue(9000 * 16));
    expect(samples[2750 * 16 - 1]).toBe(sampleValue(10_500 * 16 - 1));
    expect(samples.subarray(2750 * 16).every((v) => v === 0)).toBe(true); // padding
  });

  it("agrees with toGlobalMs on every sample, for random packings (oracle)", () => {
    const random = rng(7);
    for (let round = 0; round < 25; round += 1) {
      const intervals = [];
      let at = 0;
      for (let i = 0; i < 12; i += 1) {
        at += 400 + Math.floor(random() * 5000);
        const length = 200 + Math.floor(random() * 9000);
        intervals.push({ startMs: at, endMs: at + length });
        at += length;
      }
      const store = storeOf(at + 1000);
      for (const window of packSpeech(intervals)) {
        const { samples } = assembleWindowAudio(window, store);
        // Spot-check 200 random local positions inside speech: the sample there must be the source sample at toGlobalMs.
        for (let k = 0; k < 200; k += 1) {
          const region = window.regions[Math.floor(random() * window.regions.length)];
          const local = region.packOffsetMs + Math.floor(random() * (region.sourceEndMs - region.sourceStartMs));
          expect(samples[local * 16]).toBe(sampleValue(toGlobalMs(window, local) * 16));
        }
      }
    }
  });

  it("cuts a region that would run off the end of the window instead of writing out of bounds", () => {
    const window: PackedWindow = { index: 0, lengthMs: 1000, usedMs: 1000, regions: [{ sourceStartMs: 0, sourceEndMs: 5000, packOffsetMs: 500 }] };
    const { samples } = assembleWindowAudio(window, storeOf(6000));
    expect(samples.length).toBe(16_000);
    expect(samples[500 * 16]).toBe(sampleValue(0));
    expect(samples[16_000 - 1]).toBe(sampleValue(500 * 16 - 1));
  });
});
