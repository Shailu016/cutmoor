import { describe, expect, it } from "vitest";
import { createComplexFft, createRealDft, createRealFft } from "./fft";

/** Straight O(N^2) DFT used only as a test oracle. */
function naiveRealDft(
  input: Float32Array | Float64Array,
  size: number,
): { re: Float64Array; im: Float64Array } {
  const bins = Math.floor(size / 2) + 1;
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let n = 0; n < size; n++) {
      const angle = (-2 * Math.PI * k * n) / size;
      sumRe += input[n] * Math.cos(angle);
      sumIm += input[n] * Math.sin(angle);
    }
    re[k] = sumRe;
    im[k] = sumIm;
  }
  return { re, im };
}

/** Deterministic pseudo-random samples in -1..1 (same LCG family as the fixtures). */
function noisySamples(size: number, seed = 7): Float64Array {
  const out = new Float64Array(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    out[i] = (state / 4294967296) * 2 - 1;
  }
  return out;
}

function maxDifference(a: Float64Array, b: Float64Array, length: number): number {
  let maximum = 0;
  for (let i = 0; i < length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
  return maximum;
}

describe("createComplexFft", () => {
  it("round-trips an impulse and a DC signal", () => {
    const plan = createComplexFft(8);
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    re[0] = 1;
    plan.transform(re, im);
    for (let k = 0; k < 8; k++) {
      expect(re[k]).toBeCloseTo(1, 12);
      expect(im[k]).toBeCloseTo(0, 12);
    }

    re.fill(1);
    im.fill(0);
    plan.transform(re, im);
    expect(re[0]).toBeCloseTo(8, 12);
    for (let k = 1; k < 8; k++) {
      expect(re[k]).toBeCloseTo(0, 12);
      expect(im[k]).toBeCloseTo(0, 12);
    }
  });

  it("inverse restores the input", () => {
    const size = 64;
    const plan = createComplexFft(size);
    const original = noisySamples(size, 11);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = original[i];
    plan.transform(re, im);
    plan.inverse(re, im);
    expect(maxDifference(re, original, size)).toBeLessThan(1e-12);
    expect(maxDifference(im, new Float64Array(size), size)).toBeLessThan(1e-12);
  });

  it("rejects non-power-of-two sizes and wrongly sized buffers", () => {
    expect(() => createComplexFft(12)).toThrow(/power of two/);
    expect(() => createComplexFft(0)).toThrow(/>= 2/);
    const plan = createComplexFft(8);
    expect(() => plan.transform(new Float64Array(7), new Float64Array(8))).toThrow(/exactly 8/);
  });
});

describe("createRealFft", () => {
  it("matches the naive DFT for n = 512 (the 400-sample frame zero-padded case)", () => {
    const size = 512;
    const input = noisySamples(size, 123);
    const plan = createRealFft(size);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);
    plan.transform(input, re, im);
    const expected = naiveRealDft(input, size);
    expect(plan.bins).toBe(257);
    expect(maxDifference(re, expected.re, plan.bins)).toBeLessThan(1e-9);
    expect(maxDifference(im, expected.im, plan.bins)).toBeLessThan(1e-9);
  });

  it("matches the naive DFT for small powers of two, including n = 2", () => {
    for (const size of [2, 4, 8, 32, 128]) {
      const input = noisySamples(size, size + 1);
      const plan = createRealFft(size);
      const re = new Float64Array(plan.bins);
      const im = new Float64Array(plan.bins);
      plan.transform(input, re, im);
      const expected = naiveRealDft(input, size);
      expect(maxDifference(re, expected.re, plan.bins)).toBeLessThan(1e-10);
      expect(maxDifference(im, expected.im, plan.bins)).toBeLessThan(1e-10);
    }
  });

  it("puts a full-scale sine's energy in the expected bin", () => {
    const size = 512;
    const bin = 5;
    const input = new Float64Array(size);
    for (let n = 0; n < size; n++) input[n] = Math.sin((2 * Math.PI * bin * n) / size);
    const plan = createRealFft(size);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);
    plan.transform(input, re, im);

    const magnitude = (k: number) => Math.hypot(re[k], im[k]);
    expect(magnitude(bin)).toBeCloseTo(size / 2, 9);
    // The real spectrum mirrors around N/2, and no other low bin should dominate.
    for (let k = 0; k < plan.bins; k++) {
      if (k !== bin) expect(magnitude(k)).toBeLessThan(1e-9);
    }
  });

  it("satisfies Parseval's theorem", () => {
    const size = 256;
    const input = noisySamples(size, 99);
    const plan = createRealFft(size);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);
    plan.transform(input, re, im);

    let spectrumEnergy = 0;
    for (let k = 0; k < plan.bins; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      // k=0 and k=N/2 represent themselves; every other bin represents a pair.
      spectrumEnergy += k === 0 || k === size / 2 ? power : 2 * power;
    }
    let timeEnergy = 0;
    for (let n = 0; n < size; n++) timeEnergy += input[n] * input[n];
    expect(spectrumEnergy / size).toBeCloseTo(timeEnergy, 10);
  });

  it("accepts Float32 input and produces the same spectrum as Float64", () => {
    const size = 512;
    const wide = noisySamples(size, 42);
    const narrow = new Float32Array(size);
    for (let i = 0; i < size; i++) narrow[i] = wide[i];
    const plan = createRealFft(size);
    const wideRe = new Float64Array(plan.bins);
    const wideIm = new Float64Array(plan.bins);
    const narrowRe = new Float64Array(plan.bins);
    const narrowIm = new Float64Array(plan.bins);
    plan.transform(wide, wideRe, wideIm);
    plan.transform(narrow, narrowRe, narrowIm);
    expect(maxDifference(wideRe, narrowRe, plan.bins)).toBeLessThan(1e-6);
    expect(maxDifference(wideIm, narrowIm, plan.bins)).toBeLessThan(1e-6);
  });

  it("rejects non-power-of-two sizes and short input/output buffers", () => {
    expect(() => createRealFft(500)).toThrow(/power of two/);
    const plan = createRealFft(16);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);
    expect(() => plan.transform(new Float64Array(15), re, im)).toThrow(/at least 16/);
    expect(() => plan.transform(new Float64Array(16), new Float64Array(2), im)).toThrow(
      /at least 9/,
    );
  });
});

describe("createRealDft", () => {
  it("matches the naive DFT for n = 400, the length Whisper actually uses", () => {
    const size = 400;
    const input = noisySamples(size, 2024);
    const plan = createRealDft(size);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);
    plan.transform(input, re, im);
    const expected = naiveRealDft(input, size);
    expect(plan.bins).toBe(201);
    expect(maxDifference(re, expected.re, plan.bins)).toBeLessThan(1e-9);
    expect(maxDifference(im, expected.im, plan.bins)).toBeLessThan(1e-9);
  });

  it("matches the naive DFT for other non-power-of-two lengths, even and odd", () => {
    for (const size of [3, 5, 9, 100, 257, 1000]) {
      const input = noisySamples(size, size * 3 + 1);
      const plan = createRealDft(size);
      const re = new Float64Array(plan.bins);
      const im = new Float64Array(plan.bins);
      plan.transform(input, re, im);
      const expected = naiveRealDft(input, size);
      expect(plan.bins).toBe(Math.floor(size / 2) + 1);
      expect(maxDifference(re, expected.re, plan.bins)).toBeLessThan(1e-8);
      expect(maxDifference(im, expected.im, plan.bins)).toBeLessThan(1e-8);
    }
  });

  it("delegates power-of-two lengths to the radix-2 path and still matches", () => {
    const size = 512;
    const input = noisySamples(size, 17);
    const plan = createRealDft(size);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);
    plan.transform(input, re, im);
    const expected = naiveRealDft(input, size);
    expect(maxDifference(re, expected.re, plan.bins)).toBeLessThan(1e-9);
  });

  it("is reusable: the scratch buffers do not leak between calls", () => {
    const plan = createRealDft(400);
    const first = noisySamples(400, 5);
    const second = noisySamples(400, 6);
    const re = new Float64Array(plan.bins);
    const im = new Float64Array(plan.bins);

    plan.transform(first, re, im);
    const firstRe = re.slice();
    const firstIm = im.slice();

    plan.transform(second, re, im);
    const secondExpected = naiveRealDft(second, 400);
    expect(maxDifference(re, secondExpected.re, plan.bins)).toBeLessThan(1e-9);

    plan.transform(first, re, im);
    expect(maxDifference(re, firstRe, plan.bins)).toBeLessThan(1e-12);
    expect(maxDifference(im, firstIm, plan.bins)).toBeLessThan(1e-12);
  });
});
