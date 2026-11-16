import { describe, expect, it } from "vitest";
import { padOrTrim, peak, rms } from "./window";

describe("padOrTrim", () => {
  it("zero-pads a short input to the requested length", () => {
    const input = new Float32Array([1, -2, 3]);
    const output = padOrTrim(input, 6);
    expect(Array.from(output)).toEqual([1, -2, 3, 0, 0, 0]);
    expect(output.length).toBe(6);
  });

  it("trims a long input without touching the source", () => {
    const input = new Float32Array([1, 2, 3, 4, 5]);
    const output = padOrTrim(input, 2);
    expect(Array.from(output)).toEqual([1, 2]);
    expect(Array.from(input)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an independent array even for an exact-length input", () => {
    const input = new Float32Array([1, 2, 3]);
    const output = padOrTrim(input, 3);
    output[0] = 99;
    expect(input[0]).toBe(1);
    expect(output).not.toBe(input);
  });

  it("keeps the element type (Float64 in, Float64 out)", () => {
    const output = padOrTrim(new Float64Array([0.5]), 2);
    expect(output).toBeInstanceOf(Float64Array);
    expect(Array.from(output)).toEqual([0.5, 0]);
  });

  it("handles length zero and rejects invalid lengths", () => {
    expect(padOrTrim(new Float32Array([1, 2]), 0).length).toBe(0);
    expect(() => padOrTrim(new Float32Array(2), -1)).toThrow(/non-negative integer/);
    expect(() => padOrTrim(new Float32Array(2), 2.5)).toThrow(/non-negative integer/);
  });
});

describe("rms", () => {
  it("matches the analytic value for a full-scale sine", () => {
    const samples = new Float32Array(16_000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 100 * i) / 16_000);
    }
    // A sine of amplitude 1 has RMS 1/sqrt(2).
    expect(rms(samples)).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it("is zero for silence and empty input", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it("matches a brute-force sum-of-squares oracle", () => {
    const samples = new Float32Array(1000);
    let state = 1;
    for (let i = 0; i < samples.length; i++) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      samples[i] = (state / 4294967296) * 2 - 1;
    }
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    expect(rms(samples)).toBeCloseTo(Math.sqrt(sum / samples.length), 12);
  });

  it("treats non-finite samples as zero instead of poisoning the result", () => {
    const samples = new Float32Array([0.5, Number.NaN, -0.5, Number.POSITIVE_INFINITY]);
    expect(rms(samples)).toBeCloseTo(Math.sqrt(0.5 / 4), 12);
  });
});

describe("peak", () => {
  it("finds the largest absolute value", () => {
    expect(peak(new Float32Array([0.1, -0.9, 0.4]))).toBeCloseTo(0.9, 6);
    expect(peak(new Float32Array([-2, 0]))).toBe(2);
  });

  it("is zero for silence, empty input and non-finite-only input", () => {
    expect(peak(new Float32Array(10))).toBe(0);
    expect(peak(new Float32Array(0))).toBe(0);
    expect(peak(new Float32Array([Number.NaN, Number.NEGATIVE_INFINITY]))).toBe(0);
  });

  it("ignores non-finite samples mixed with real ones", () => {
    expect(peak(new Float32Array([0.3, Number.NaN, -0.7]))).toBeCloseTo(0.7, 6);
  });
});
