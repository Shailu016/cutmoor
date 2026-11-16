import { describe, expect, it } from "vitest";
import {
  createMelFilterbank,
  hzToMel,
  melFrequencies,
  melToHz,
  type MelFilterbank,
} from "./mel-filters";

function row(bank: MelFilterbank, m: number): Float64Array {
  return bank.weights.subarray(m * bank.bins, (m + 1) * bank.bins);
}

describe("Slaney mel scale", () => {
  it("has the documented fixed points", () => {
    expect(hzToMel(0)).toBe(0);
    expect(hzToMel(1000)).toBeCloseTo(15, 12);
    expect(melToHz(15)).toBeCloseTo(1000, 9);
    expect(melToHz(0)).toBe(0);
    // 200/3 Hz is one mel in the linear (below 1 kHz) region.
    expect(hzToMel(200 / 3)).toBeCloseTo(1, 12);
    expect(melToHz(1)).toBeCloseTo(200 / 3, 12);
  });

  it("round-trips Slaney and HTK values", () => {
    for (const hz of [0, 1, 50, 200 / 3, 440, 999, 1000, 2500, 8000]) {
      expect(melToHz(hzToMel(hz))).toBeCloseTo(hz, 8);
      expect(melToHz(hzToMel(hz, true), true)).toBeCloseTo(hz, 6);
    }
  });

  it("matches the HTK formula at a hand-checkable point", () => {
    // 2595 * log10(1 + 700/700) = 2595 * log10(2)
    expect(hzToMel(700, true)).toBeCloseTo(781.1728, 3);
  });

  it("is strictly increasing on both scales", () => {
    for (const htk of [false, true]) {
      let previous = -Infinity;
      for (let hz = 0; hz <= 8000; hz += 37) {
        const value = hzToMel(hz, htk);
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });

  it("rejects non-finite input", () => {
    expect(() => hzToMel(Number.NaN)).toThrow(/finite/);
    expect(() => melToHz(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("melFrequencies", () => {
  it("returns inclusive, monotonic, evenly spaced mel points", () => {
    const points = melFrequencies(82, 0, 8000);
    expect(points).toHaveLength(82);
    expect(points[0]).toBe(0);
    expect(points[81]).toBeCloseTo(8000, 9);
    const firstStep = hzToMel(points[1]) - hzToMel(points[0]);
    for (let i = 1; i < 81; i++) {
      expect(hzToMel(points[i + 1]) - hzToMel(points[i])).toBeCloseTo(firstStep, 10);
      expect(points[i + 1]).toBeGreaterThan(points[i]);
    }
  });

  it("handles n = 1 and rejects impossible ranges", () => {
    expect(Array.from(melFrequencies(1, 100, 200))).toEqual([100]);
    expect(() => melFrequencies(0, 0, 8000)).toThrow(/>= 1/);
    expect(() => melFrequencies(10, 8000, 8000)).toThrow(/fMin < fMax/);
  });
});

describe("createMelFilterbank", () => {
  it("builds the Whisper shapes (80 or 128 filters over 201 bins for n_fft=400)", () => {
    for (const nMels of [80, 128]) {
      const bank = createMelFilterbank({ nMels, fftSize: 400 });
      expect(bank.nMels).toBe(nMels);
      expect(bank.bins).toBe(201);
      expect(bank.weights).toHaveLength(nMels * 201);
    }
    expect(createMelFilterbank({ nMels: 80, fftSize: 512 }).bins).toBe(257);
  });

  it("produces non-negative, finite, contiguous triangular filters", () => {
    const bank = createMelFilterbank({ nMels: 80, fftSize: 400 });
    for (let m = 0; m < bank.nMels; m++) {
      const weights = row(bank, m);
      let first = -1;
      let last = -1;
      for (let k = 0; k < weights.length; k++) {
        const value = weights[k];
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        if (value > 0) {
          if (first < 0) first = k;
          last = k;
        }
      }
      expect(first).toBeGreaterThanOrEqual(0);
      expect(last).toBeGreaterThanOrEqual(first);
      // A triangle never has a gap between its first and last non-zero bin.
      for (let k = first; k <= last; k++) expect(weights[k]).toBeGreaterThan(0);
    }
  });

  it("overlaps at most two filters per FFT bin", () => {
    for (const nMels of [80, 128]) {
      const bank = createMelFilterbank({ nMels, fftSize: 400 });
      for (let k = 0; k < bank.bins; k++) {
        let active = 0;
        for (let m = 0; m < bank.nMels; m++) {
          if (bank.weights[m * bank.bins + k] > 0) active++;
        }
        expect(active).toBeLessThanOrEqual(2);
      }
    }
  });

  it("peaks near the mel centre frequency", () => {
    const bank = createMelFilterbank({ nMels: 80, fftSize: 400 });
    const centres = melFrequencies(82, 0, 8000);
    const binHz = 16000 / 400;
    for (let m = 1; m < bank.nMels - 1; m++) {
      const weights = row(bank, m);
      let peakBin = 0;
      for (let k = 1; k < weights.length; k++) {
        if (weights[k] > weights[peakBin]) peakBin = k;
      }
      const peakHz = peakBin * binHz;
      // With 40 Hz bins, the peak can only be within one bin of the ideal centre.
      expect(Math.abs(peakHz - centres[m + 1])).toBeLessThanOrEqual(binHz + 1e-9);
    }
  });

  it("applies Slaney area normalisation (unit area away from the edges)", () => {
    const bank = createMelFilterbank({ nMels: 80, fftSize: 400 });
    const binHz = 16000 / 400;
    for (let m = 20; m <= 60; m++) {
      let area = 0;
      for (const weight of row(bank, m)) area += weight * binHz;
      // Narrow low filters are under-sampled by the 40 Hz grid, so allow a band.
      expect(area).toBeGreaterThan(0.85);
      expect(area).toBeLessThan(1.15);
    }
  });

  it("scale factors between norm=slaney and norm=none match 2/(f[i+2]-f[i])", () => {
    const slaney = createMelFilterbank({ nMels: 80, fftSize: 400, norm: "slaney" });
    const raw = createMelFilterbank({ nMels: 80, fftSize: 400, norm: "none" });
    const points = melFrequencies(82, 0, 8000);
    for (let m = 0; m < 80; m++) {
      const expected = 2 / (points[m + 2] - points[m]);
      for (let k = 0; k < slaney.bins; k++) {
        expect(slaney.weights[m * slaney.bins + k]).toBeCloseTo(
          raw.weights[m * raw.bins + k] * expected,
          10,
        );
      }
    }
  });

  it("validates its options", () => {
    expect(() => createMelFilterbank({ nMels: 0, fftSize: 400 })).toThrow(/nMels/);
    expect(() => createMelFilterbank({ nMels: 80, fftSize: 1 })).toThrow(/fftSize/);
    expect(() => createMelFilterbank({ nMels: 80, fftSize: 400, sampleRate: 0 })).toThrow(
      /sampleRate/,
    );
    expect(() => createMelFilterbank({ nMels: 80, fftSize: 400, fMax: 9000 })).toThrow(/fMax/);
    expect(() =>
      createMelFilterbank({ nMels: 80, fftSize: 400, fMin: 100, fMax: 100 }),
    ).toThrow(/fMin < fMax/);
  });
});
