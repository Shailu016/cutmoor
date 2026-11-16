import { describe, expect, it } from "vitest";
import { downmixInterleaved, downmixPlanar } from "./downmix";

describe("downmixPlanar", () => {
  it("one channel is returned as a copy of the same values", () => {
    const input = Float32Array.from([0.5, -0.25, 1]);
    const out = downmixPlanar([input]);
    expect(Array.from(out)).toEqual([0.5, -0.25, 1]);
    expect(out).not.toBe(input);
  });

  it("averages stereo", () => {
    const out = downmixPlanar([Float32Array.from([1, 0, -1]), Float32Array.from([0, 0.5, -1])]);
    expect(Array.from(out)).toEqual([0.5, 0.25, -1]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("%i channels of value c average to the mean", (count) => {
    const planes = Array.from({ length: count }, (_, c) => new Float32Array(4).fill(c * 0.125));
    const expected = (0.125 * ((count - 1) * count)) / 2 / count;
    for (const v of downmixPlanar(planes)) expect(v).toBeCloseTo(expected, 6);
  });

  it("opposite-phase channels cancel (the plain average, by design)", () => {
    expect(Array.from(downmixPlanar([Float32Array.from([0.7]), Float32Array.from([-0.7])]))).toEqual([0]);
  });

  it("non-finite samples become silence in that channel only", () => {
    const out = downmixPlanar([Float32Array.from([NaN, Infinity, 0.5]), Float32Array.from([0.5, 0.5, -Infinity])]);
    expect(Array.from(out)).toEqual([0.25, 0.25, 0.25]);
  });

  it("rejects 0 or 9 channels and mismatched lengths", () => {
    expect(() => downmixPlanar([])).toThrow(RangeError);
    expect(() => downmixPlanar(Array.from({ length: 9 }, () => new Float32Array(2)))).toThrow(RangeError);
    expect(() => downmixPlanar([new Float32Array(2), new Float32Array(3)])).toThrow(RangeError);
  });

  it("handles empty channels", () => {
    expect(downmixPlanar([new Float32Array(0), new Float32Array(0)]).length).toBe(0);
  });
});

describe("downmixInterleaved", () => {
  it("averages interleaved stereo frames", () => {
    expect(Array.from(downmixInterleaved(Float32Array.from([1, 0, 0, 0.5, -1, -1]), 2))).toEqual([0.5, 0.25, -1]);
  });

  it("gives the same result as the planar version for 1..8 channels (seeded)", () => {
    let s = 12345;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296 - 0.5;
    };
    for (let channels = 1; channels <= 8; channels += 1) {
      const frames = 37;
      const planes = Array.from({ length: channels }, () => Float32Array.from({ length: frames }, next));
      const interleaved = new Float32Array(frames * channels);
      for (let f = 0; f < frames; f += 1) for (let c = 0; c < channels; c += 1) interleaved[f * channels + c] = planes[c][f];
      expect(Array.from(downmixInterleaved(interleaved, channels))).toEqual(Array.from(downmixPlanar(planes)));
    }
  });

  it("non-finite samples become 0", () => {
    expect(Array.from(downmixInterleaved(Float32Array.from([NaN, 1, -Infinity, 1]), 2))).toEqual([0.5, 0.5]);
  });

  it("rejects bad channel counts and ragged data", () => {
    expect(() => downmixInterleaved(new Float32Array(4), 0)).toThrow(RangeError);
    expect(() => downmixInterleaved(new Float32Array(9), 9)).toThrow(RangeError);
    expect(() => downmixInterleaved(new Float32Array(5), 2)).toThrow(RangeError);
    expect(() => downmixInterleaved(new Float32Array(4), 1.5)).toThrow(RangeError);
  });
});
