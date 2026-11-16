import { describe, expect, it } from "vitest";
import { resampleTo16k, StreamingResampler } from "./resampler";

/** Small seeded generator so "random" tests give the same numbers every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sine(rate: number, hz: number, seconds: number, amplitude = 1): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

/** Amplitude of a known-frequency sine in a signal, by least squares (ignores the first/last `skip` samples). */
function amplitudeAt(signal: Float32Array, rate: number, hz: number, skip: number): number {
  let sc = 0;
  let cc = 0;
  let nn = 0;
  let xc = 0;
  let xs = 0;
  for (let i = skip; i < signal.length - skip; i += 1) {
    const c = Math.cos((2 * Math.PI * hz * i) / rate);
    const s = Math.sin((2 * Math.PI * hz * i) / rate);
    cc += c * c;
    nn += s * s;
    sc += s * c;
    xc += signal[i] * c;
    xs += signal[i] * s;
  }
  // Solve [cc sc; sc nn] [a; b] = [xc; xs] for the cosine and sine coefficients.
  const det = cc * nn - sc * sc;
  const a = (xc * nn - xs * sc) / det;
  const b = (xs * cc - xc * sc) / det;
  return Math.hypot(a, b);
}

function rms(signal: Float32Array, skip: number): number {
  let sum = 0;
  for (let i = skip; i < signal.length - skip; i += 1) sum += signal[i] * signal[i];
  return Math.sqrt(sum / (signal.length - 2 * skip));
}

function feedInPieces(input: Float32Array, rate: number, pieceSizes: () => number): Float32Array {
  const r = new StreamingResampler(rate);
  const parts: Float32Array[] = [];
  let at = 0;
  while (at < input.length) {
    const size = Math.max(1, pieceSizes());
    parts.push(r.process(input.subarray(at, at + size)));
    at += size;
  }
  parts.push(r.flush());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("StreamingResampler: tones keep their amplitude and frequency", () => {
  it.each([
    [48_000, 200],
    [48_000, 1000],
    [48_000, 3000],
    [48_000, 6000],
    [44_100, 1000],
    [44_100, 5000],
    [22_050, 2000],
    [96_000, 4000],
  ])("%i Hz input, %i Hz tone passes at unity gain", (rate, hz) => {
    const out = resampleTo16k(sine(rate, hz, 1, 0.8), rate);
    expect(amplitudeAt(out, 16_000, hz, 300)).toBeCloseTo(0.8, 2); // within ~0.1 dB
    // And it is a pure tone: what is left after removing it is tiny.
    expect(rms(out, 300)).toBeCloseTo(0.8 / Math.SQRT2, 2);
  });

  it("is still nearly flat close to the 8 kHz edge (7 kHz within 0.5 dB)", () => {
    const out = resampleTo16k(sine(48_000, 7000, 1, 1), 48_000);
    const gainDb = 20 * Math.log10(amplitudeAt(out, 16_000, 7000, 300));
    expect(Math.abs(gainDb)).toBeLessThan(0.5);
  });

  it("upsampling 8 kHz audio keeps tones up to near its own Nyquist", () => {
    const out = resampleTo16k(sine(8000, 3000, 1, 0.5), 8000);
    expect(amplitudeAt(out, 16_000, 3000, 200)).toBeCloseTo(0.5, 2);
  });

  it("a constant (DC) level passes unchanged away from the edges", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const out = resampleTo16k(input, 48_000);
    for (let i = 200; i < out.length - 200; i += 50) expect(out[i]).toBeCloseTo(0.25, 5);
  });
});

describe("StreamingResampler: aliasing rejection", () => {
  // Content above 8 kHz must not fold into the speech band. 60 dB is the bar; the design gives about 70.
  it.each([9000, 10000, 11000, 12000])("48k -> 16k: a %i Hz tone is at least 60 dB down", (hz) => {
    const input = sine(48_000, hz, 1, 1);
    const out = resampleTo16k(input, 48_000);
    const rejectionDb = 20 * Math.log10(rms(input, 0) / Math.max(rms(out, 300), 1e-12));
    expect(rejectionDb).toBeGreaterThanOrEqual(60);
  });

  it("44.1k -> 16k: tones from 8.5 kHz to 20 kHz are at least 60 dB down", () => {
    for (let hz = 8500; hz <= 20_000; hz += 750) {
      const input = sine(44_100, hz, 0.5, 1);
      const out = resampleTo16k(input, 44_100);
      const rejectionDb = 20 * Math.log10(rms(input, 0) / Math.max(rms(out, 300), 1e-12));
      expect(rejectionDb, `${hz} Hz`).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("StreamingResampler: frequency sweep against an analytic expectation", () => {
  // A chirp is the strictest check on timing: any delay or wrong phase shows up as error.
  function chirp(rate: number, f0: number, f1: number, seconds: number, sampleCount: number, startIndex = 0): Float32Array {
    const out = new Float32Array(sampleCount);
    const k = (f1 - f0) / seconds;
    for (let i = 0; i < sampleCount; i += 1) {
      const t = (startIndex + i) / rate;
      out[i] = Math.sin(2 * Math.PI * (f0 * t + 0.5 * k * t * t));
    }
    return out;
  }

  it.each([
    [48_000, 100, 6000],
    [44_100, 100, 6000],
    [32_000, 100, 6500],
    [8000, 100, 3000],
  ])("%i Hz input, sweep %i to %i Hz matches the ideal 16 kHz sweep", (rate, f0, f1) => {
    const seconds = 2;
    const input = chirp(rate, f0, f1, seconds, rate * seconds);
    const out = resampleTo16k(input, rate);
    const ideal = chirp(16_000, f0, f1, seconds, out.length);
    let worst = 0;
    for (let i = 400; i < out.length - 400; i += 1) worst = Math.max(worst, Math.abs(out[i] - ideal[i]));
    expect(worst).toBeLessThan(0.01);
  });

  it("a wrong time alignment would be caught: shifting the ideal by one output sample breaks the match", () => {
    const rate = 48_000;
    const input = chirp(rate, 100, 6000, 1, rate);
    const out = resampleTo16k(input, rate);
    const shifted = chirp(16_000, 100, 6000, 1, out.length, 1);
    let worst = 0;
    for (let i = 400; i < out.length - 400; i += 1) worst = Math.max(worst, Math.abs(out[i] - shifted[i]));
    expect(worst).toBeGreaterThan(0.1);
  });
});

describe("StreamingResampler: chunking does not change the result", () => {
  it.each([48_000, 44_100, 22_050, 11_025, 8000, 96_000, 37_800])("%i Hz: one piece vs 777-sample pieces agree to 1e-6", (rate) => {
    const next = rng(rate);
    const input = new Float32Array(Math.round(rate * 1.3));
    for (let i = 0; i < input.length; i += 1) input[i] = next() * 2 - 1;
    const whole = resampleTo16k(input, rate);
    const pieces = feedInPieces(input, rate, () => 777);
    expect(pieces.length).toBe(whole.length);
    let worst = 0;
    for (let i = 0; i < whole.length; i += 1) worst = Math.max(worst, Math.abs(whole[i] - pieces[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it("seeded fuzz: random piece sizes (including 1 and empty-ish) always match the single-piece result", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const next = rng(seed * 7919);
      const rate = [48_000, 44_100, 16_000, 24_000, 12_345][seed % 5];
      const input = new Float32Array(3000 + Math.floor(next() * 4000));
      for (let i = 0; i < input.length; i += 1) input[i] = next() * 2 - 1;
      const whole = resampleTo16k(input, rate);
      const pieces = feedInPieces(input, rate, () => 1 + Math.floor(next() * next() * 1500));
      expect(pieces.length).toBe(whole.length);
      for (let i = 0; i < whole.length; i += 1) expect(Math.abs(whole[i] - pieces[i])).toBeLessThan(1e-6);
    }
  });

  it("a click or step at a chunk seam does not appear: a steady tone has no seam artefact", () => {
    const rate = 48_000;
    const input = sine(rate, 440, 1, 0.5);
    const out = feedInPieces(input, rate, () => 1000);
    // Compare with the ideal sample by sample; a discontinuity would break this.
    let worst = 0;
    for (let i = 300; i < out.length - 300; i += 1) worst = Math.max(worst, Math.abs(out[i] - 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16_000)));
    expect(worst).toBeLessThan(0.002);
  });
});

describe("StreamingResampler: output length", () => {
  const rates = [8000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000, 192_000, 12_345, 47_999];
  it.each(rates)("%i Hz: length is round(n * 16000 / rate) within 1 sample", (rate) => {
    for (const n of [1, 2, 5, 100, 999, 4410, 48_000, 100_003]) {
      const out = resampleTo16k(new Float32Array(n), rate);
      expect(Math.abs(out.length - Math.round((n * 16_000) / rate)), `n=${n}`).toBeLessThanOrEqual(1);
    }
  });

  it("empty input gives empty output", () => {
    expect(resampleTo16k(new Float32Array(0), 48_000).length).toBe(0);
  });

  it("16 kHz input passes through bit for bit", () => {
    const input = Float32Array.from([0.1, -0.2, 0.3, 0.9, -1]);
    expect(Array.from(resampleTo16k(input, 16_000))).toEqual(Array.from(input));
  });

  it("an odd rate that needs more than 1024 phases still resamples a tone correctly", () => {
    const out = resampleTo16k(sine(47_999, 1500, 1, 0.7), 47_999);
    expect(amplitudeAt(out, 16_000, 1500, 300)).toBeCloseTo(0.7, 2);
  });
});

describe("StreamingResampler: lifecycle", () => {
  it("reset() makes the instance behave as new", () => {
    const input = sine(48_000, 500, 0.3);
    const r = new StreamingResampler(48_000);
    r.process(sine(48_000, 900, 0.2));
    r.flush();
    r.reset();
    const a = Float32Array.from([...r.process(input), ...r.flush()]);
    expect(Array.from(a)).toEqual(Array.from(resampleTo16k(input, 48_000)));
  });

  it("using it after flush without reset is an error, not silent garbage", () => {
    const r = new StreamingResampler(48_000);
    r.flush();
    expect(() => r.process(new Float32Array(10))).toThrow();
  });

  it("rejects absurd rates", () => {
    for (const rate of [0, -1, NaN, 500, 44_100.5, 5_000_000]) expect(() => new StreamingResampler(rate)).toThrow(RangeError);
  });

  it("the output stays finite even when asked to resample full-scale noise", () => {
    const next = rng(5);
    const input = new Float32Array(20_000);
    for (let i = 0; i < input.length; i += 1) input[i] = next() < 0.5 ? 1 : -1;
    for (const v of resampleTo16k(input, 44_100)) expect(Number.isFinite(v)).toBe(true);
  });
});
