import { describe, expect, it } from "vitest";
import { PcmStore } from "./pcm-store";
import { sampleValue } from "./test-kit";

const chunkAt = (startMs: number, ms: number) => {
  const samples = new Float32Array(ms * 16);
  for (let i = 0; i < samples.length; i += 1) samples[i] = sampleValue(startMs * 16 + i);
  return { startMs, samples };
};

describe("PcmStore", () => {
  it("reads back exactly the samples that were pushed, across chunk boundaries", () => {
    const store = new PcmStore();
    for (let t = 0; t < 5000; t += 700) store.push(chunkAt(t, Math.min(700, 5000 - t)));
    const out = store.read(1234, 3456);
    expect(out.length).toBe((3456 - 1234) * 16);
    for (let i = 0; i < out.length; i += 1) expect(out[i]).toBe(sampleValue(1234 * 16 + i));
  });

  it("returns silence for time that was never stored and keeps the requested length", () => {
    const store = new PcmStore();
    store.push(chunkAt(0, 100));
    const out = store.read(50, 200);
    expect(out.length).toBe(150 * 16);
    expect(out[0]).toBe(sampleValue(50 * 16));
    expect(out[49 * 16 + 15]).toBe(sampleValue(99 * 16 + 15));
    expect(out[50 * 16]).toBe(0);
    expect(out[out.length - 1]).toBe(0);
  });

  it("copies on push, so a decoder that reuses its buffer cannot rewrite stored audio", () => {
    const store = new PcmStore();
    const reused = new Float32Array(160).fill(0.5);
    store.push({ startMs: 0, samples: reused });
    reused.fill(-1);
    expect(store.read(0, 10)[0]).toBe(0.5);
  });

  it("discardBefore frees whole chunks that end before the limit and keeps a straddling chunk", () => {
    const store = new PcmStore();
    for (let t = 0; t < 10_000; t += 1000) store.push(chunkAt(t, 1000));
    expect(store.retainedMs).toBe(10_000);
    store.discardBefore(4500);
    expect(store.retainedMs).toBe(6000); // chunks 0-4000 gone, the one holding 4500 stays
    expect(store.read(4500, 4510)[0]).toBe(sampleValue(4500 * 16));
    store.discardBefore(1e9);
    expect(store.retainedMs).toBe(0);
  });

  it("reads discarded time as silence rather than throwing", () => {
    const store = new PcmStore();
    store.push(chunkAt(0, 1000));
    store.push(chunkAt(1000, 1000));
    store.discardBefore(1000);
    const out = store.read(500, 1500);
    expect(out[0]).toBe(0);
    expect(out[500 * 16]).toBe(sampleValue(1000 * 16));
  });

  it("ignores empty chunks and reports the end of the audio", () => {
    const store = new PcmStore();
    store.push({ startMs: 0, samples: new Float32Array(0) });
    expect(store.endMs).toBe(0);
    store.push(chunkAt(2000, 500));
    expect(store.endMs).toBe(2500);
  });
});
