import { describe, expect, it } from "vitest";
import type { PcmChunk } from "../contracts";
import { CHUNK_SAMPLES, PcmStreamBuilder } from "./pcm-stream";

const TONE_HZ = 440;

/** A tone defined by absolute time, so any block cut from it carries the right phase for its timestamp. */
function toneBlock(rate: number, startSeconds: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) out[i] = 0.5 * Math.sin(2 * Math.PI * TONE_HZ * (startSeconds + i / rate));
  return out;
}

/** Pushes a time range as consecutive blocks and returns every chunk including the flushed tail. */
function run(
  rate: number,
  ranges: Array<{ from: number; to: number }>,
  blockFrames = 1024,
): PcmChunk[] {
  const builder = new PcmStreamBuilder(rate);
  const chunks: PcmChunk[] = [];
  for (const { from, to } of ranges) {
    const total = Math.round((to - from) * rate);
    for (let at = 0; at < total; at += blockFrames) {
      const frames = Math.min(blockFrames, total - at);
      const t = from + at / rate;
      chunks.push(...builder.push(toneBlock(rate, t, frames), t));
    }
  }
  chunks.push(...builder.flush());
  return chunks;
}

/** Value of the stream at absolute 16 kHz sample number `n` (or undefined if no chunk holds it). */
function sampleAt(chunks: PcmChunk[], n: number): number | undefined {
  for (const chunk of chunks) {
    const first = Math.round((chunk.startMs * 16000) / 1000);
    if (n >= first && n < first + chunk.samples.length) return chunk.samples[n - first];
  }
  return undefined;
}

function totalSamples(chunks: PcmChunk[]): number {
  return chunks.reduce((n, c) => n + c.samples.length, 0);
}

describe("PcmStreamBuilder", () => {
  it("cuts a seamless stream into one-second chunks with consecutive start times and a short tail", () => {
    const chunks = run(48_000, [{ from: 0, to: 3.25 }]);
    expect(chunks.map((c) => c.startMs)).toEqual([0, 1000, 2000, 3000]);
    expect(chunks.slice(0, 3).every((c) => c.samples.length === CHUNK_SAMPLES)).toBe(true);
    expect(Math.abs(totalSamples(chunks) - 3.25 * 16_000)).toBeLessThanOrEqual(1);
  });

  it("the audio itself is right: every output sample matches the ideal tone at its time", () => {
    const chunks = run(44_100, [{ from: 0, to: 2.5 }], 1000);
    let worst = 0;
    for (let n = 300; n < 2.5 * 16_000 - 300; n += 7) {
      const v = sampleAt(chunks, n);
      expect(v).toBeDefined();
      worst = Math.max(worst, Math.abs((v as number) - 0.5 * Math.sin((2 * Math.PI * TONE_HZ * n) / 16_000)));
    }
    expect(worst).toBeLessThan(0.002);
  });

  it("audio that starts late keeps its true time (no padding in front)", () => {
    const chunks = run(48_000, [{ from: 0.5, to: 2 }]);
    expect(chunks[0].startMs).toBe(500);
    const v = sampleAt(chunks, 8000 + 4000);
    expect(Math.abs((v as number) - 0.5 * Math.sin((2 * Math.PI * TONE_HZ * 12_000) / 16_000))).toBeLessThan(0.002);
  });

  it("audio that starts before 0 is cut at 0 and stays aligned", () => {
    const chunks = run(48_000, [{ from: -0.1, to: 1.5 }]);
    expect(chunks[0].startMs).toBe(0);
    // Output sample n is at t = n/16000, so the tone there is sin(2 pi f n / 16000).
    for (const n of [1000, 5000, 20_000]) {
      expect(Math.abs((sampleAt(chunks, n) as number) - 0.5 * Math.sin((2 * Math.PI * TONE_HZ * n) / 16_000))).toBeLessThan(0.002);
    }
  });

  it("a block entirely before time 0 is ignored", () => {
    const builder = new PcmStreamBuilder(48_000);
    expect(builder.push(toneBlock(48_000, -1, 1024), -1)).toEqual([]);
    const chunks = [...builder.push(toneBlock(48_000, 0, 48_000), 0), ...builder.flush()];
    expect(chunks[0].startMs).toBe(0);
  });

  it("a small hole is filled with silence so later audio stays at its true time", () => {
    const chunks = run(48_000, [
      { from: 0, to: 1 },
      { from: 1.5, to: 3 },
    ]);
    expect(chunks.map((c) => c.startMs)).toEqual([0, 1000, 2000]); // still one continuous stream
    expect(Math.abs(totalSamples(chunks) - 3 * 16_000)).toBeLessThanOrEqual(1);
    for (let n = 16_000 + 400; n < 16_000 + 7600; n += 97) expect(Math.abs(sampleAt(chunks, n) as number)).toBeLessThan(0.01);
    const n = 30_000;
    expect(Math.abs((sampleAt(chunks, n) as number) - 0.5 * Math.sin((2 * Math.PI * TONE_HZ * n) / 16_000))).toBeLessThan(0.002);
  });

  it("a long hole is not filled: the next chunk starts at its true time", () => {
    const chunks = run(48_000, [
      { from: 0, to: 1 },
      { from: 30, to: 31.2 },
    ]);
    const starts = chunks.map((c) => c.startMs);
    expect(starts).toEqual([0, 30_000, 31_000]);
    expect(totalSamples(chunks)).toBeLessThan(2.3 * 16_000);
  });

  it("overlapping blocks are trimmed so chunks never overlap and the audio is not doubled", () => {
    const builder = new PcmStreamBuilder(48_000);
    const out: PcmChunk[] = [];
    out.push(...builder.push(toneBlock(48_000, 0, 48_000), 0));
    // The next block repeats the last 0.1 s and then carries on.
    out.push(...builder.push(toneBlock(48_000, 0.9, 72_000), 0.9));
    out.push(...builder.flush());
    expect(Math.abs(totalSamples(out) - 2.4 * 16_000)).toBeLessThanOrEqual(1);
    const ends = out.map((c) => c.startMs + (c.samples.length * 1000) / 16_000);
    for (let i = 1; i < out.length; i += 1) expect(out[i].startMs).toBeGreaterThanOrEqual(ends[i - 1] - 1);
  });

  it("tiny timestamp jitter (under 20 ms) is not treated as a gap or overlap", () => {
    const builder = new PcmStreamBuilder(48_000);
    const out: PcmChunk[] = [];
    let t = 0;
    for (let i = 0; i < 100; i += 1) {
      const jitter = i % 2 === 0 ? 0.004 : -0.004;
      out.push(...builder.push(toneBlock(48_000, t, 1024), t + jitter));
      t += 1024 / 48_000;
    }
    out.push(...builder.flush());
    expect(Math.abs(totalSamples(out) - Math.round((100 * 1024 * 16_000) / 48_000))).toBeLessThanOrEqual(2);
  });

  it("flush with nothing pushed returns nothing, and a second flush too", () => {
    const builder = new PcmStreamBuilder(44_100);
    expect(builder.flush()).toEqual([]);
    expect(builder.flush()).toEqual([]);
  });

  it("ignores empty blocks and non-finite timestamps instead of corrupting the stream", () => {
    const builder = new PcmStreamBuilder(48_000);
    expect(builder.push(new Float32Array(0), 0)).toEqual([]);
    expect(builder.push(toneBlock(48_000, 0, 100), Number.NaN)).toEqual([]);
    expect(builder.flush()).toEqual([]);
  });

  it("chunks never contain more than one second, so memory stays bounded", () => {
    const chunks = run(48_000, [{ from: 0, to: 20 }], 4096);
    expect(Math.max(...chunks.map((c) => c.samples.length))).toBeLessThanOrEqual(CHUNK_SAMPLES);
  });
});
