import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { logMelSpectrogram, MEL_DEFAULT_FRAMES, MEL_WINDOW_SAMPLES } from "./mel";

interface ToneSignal {
  kind: "tone";
  frequencyHz: number;
  amplitude: number;
}

interface NoiseSignal {
  kind: "lcg-noise";
  seed: number;
  amplitude: number;
}

interface ImpulseSignal {
  kind: "impulse";
  positions: Array<{ index: number; amplitude: number }>;
}

interface SilenceSignal {
  kind: "silence";
}

type SignalSpec = ToneSignal | NoiseSignal | ImpulseSignal | SilenceSignal;

interface FixtureCase {
  name: string;
  signal: SignalSpec;
  options: { nMels: 80 | 128; nFft: number; hop: number };
  frames: number;
  bins: number;
  firstFrameCount: number;
  /** frame-major: firstFrames[frame][mel] */
  firstFrames: number[][];
  stats: { min: number; max: number; mean: number };
}

interface FixtureDocument {
  tolerance: number;
  sampleRate: number;
  windowSamples: number;
  cases: FixtureCase[];
}

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mel-fixtures.json"), "utf8"),
) as FixtureDocument;

/** Rebuild the exact Float32 signal the Python oracle generated. */
function buildSignal(spec: SignalSpec): Float32Array {
  const output = new Float32Array(MEL_WINDOW_SAMPLES);
  switch (spec.kind) {
    case "tone": {
      for (let n = 0; n < output.length; n++) {
        output[n] =
          spec.amplitude * Math.sin((2 * Math.PI * spec.frequencyHz * n) / 16_000);
      }
      break;
    }
    case "lcg-noise": {
      let state = spec.seed >>> 0;
      for (let n = 0; n < output.length; n++) {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        output[n] = (state / 4294967296) * 2 * spec.amplitude - spec.amplitude;
      }
      break;
    }
    case "impulse": {
      for (const position of spec.positions) {
        output[position.index] = position.amplitude;
      }
      break;
    }
    case "silence": {
      break;
    }
  }
  return output;
}

function matrixStats(output: Float32Array): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < output.length; i++) {
    const value = output[i];
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, max, mean: sum / output.length };
}

function maxDifference(a: Float32Array, b: Float32Array): number {
  let maximum = 0;
  for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
  return maximum;
}

describe("logMelSpectrogram against the independent numpy oracle", () => {
  for (const testCase of fixtures.cases) {
    it(`matches Whisper for ${testCase.name}`, () => {
      const samples = buildSignal(testCase.signal);
      const output = logMelSpectrogram(samples, {
        nMels: testCase.options.nMels,
        nFft: testCase.options.nFft,
        hop: testCase.options.hop,
      });

      const frames = testCase.frames;
      expect(output.length).toBe(testCase.options.nMels * frames);

      for (let frame = 0; frame < testCase.firstFrameCount; frame++) {
        for (let mel = 0; mel < testCase.options.nMels; mel++) {
          const actual = output[mel * frames + frame];
          const expected = testCase.firstFrames[frame][mel];
          expect(
            Math.abs(actual - expected),
            `${testCase.name} frame ${frame} mel ${mel}: got ${actual}, expected ${expected}`,
          ).toBeLessThan(fixtures.tolerance);
        }
      }

      const actualStats = matrixStats(output);
      expect(Math.abs(actualStats.min - testCase.stats.min)).toBeLessThan(fixtures.tolerance);
      expect(Math.abs(actualStats.max - testCase.stats.max)).toBeLessThan(fixtures.tolerance);
      expect(Math.abs(actualStats.mean - testCase.stats.mean)).toBeLessThan(fixtures.tolerance);
    });
  }
});

describe("logMelSpectrogram shape and framing", () => {
  it("returns exactly [nMels * 3000] with the defaults", () => {
    expect(MEL_DEFAULT_FRAMES).toBe(3000);
    expect(MEL_WINDOW_SAMPLES).toBe(480_000);
    expect(logMelSpectrogram(new Float32Array(0), { nMels: 80 }).length).toBe(80 * 3000);
    expect(logMelSpectrogram(new Float32Array(0), { nMels: 128 }).length).toBe(128 * 3000);
  });

  it("maps silence to a constant -1.5 (the log floor after normalisation)", () => {
    const output = logMelSpectrogram(new Float32Array(480_000), { nMels: 80 });
    let worst = 0;
    for (const value of output) worst = Math.max(worst, Math.abs(value + 1.5));
    expect(worst).toBeLessThan(1e-6);
  });

  it("pads a short signal with zeros exactly like an explicit 30 s buffer", () => {
    const short = new Float32Array(16_000);
    for (let i = 0; i < short.length; i++) {
      short[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16_000);
    }
    const explicit = new Float32Array(480_000);
    explicit.set(short);

    const fromShort = logMelSpectrogram(short, { nMels: 80 });
    const fromExplicit = logMelSpectrogram(explicit, { nMels: 80 });
    expect(fromShort.length).toBe(fromExplicit.length);
    expect(maxDifference(fromShort, fromExplicit)).toBe(0);
  });

  it("trims anything past 30 s", () => {
    const long = new Float32Array(500_000);
    for (let i = 0; i < long.length; i++) {
      long[i] = 0.2 * Math.sin((2 * Math.PI * 310 * i) / 16_000);
    }
    const prefix = long.slice(0, 480_000);

    const fromLong = logMelSpectrogram(long, { nMels: 80 });
    const fromPrefix = logMelSpectrogram(prefix, { nMels: 80 });
    expect(maxDifference(fromLong, fromPrefix)).toBe(0);
  });

  it("does not mutate its input and is deterministic", () => {
    const samples = buildSignal({ kind: "lcg-noise", seed: 7, amplitude: 0.2 });
    const copy = samples.slice();

    const first = logMelSpectrogram(samples, { nMels: 80 });
    const second = logMelSpectrogram(samples, { nMels: 80 });

    expect(maxDifference(samples, copy)).toBe(0);
    expect(maxDifference(first, second)).toBe(0);
  });
});

describe("logMelSpectrogram gain behaviour", () => {
  it("shifts every value by log10(2)/2 when the input is doubled", () => {
    // Whisper divides the log spectrum by 4, so a 4x power change (2x amplitude)
    // becomes log10(2)/2 in the output. All noise bands are well above the 1e-10
    // floor, so the shift must be uniform and exact apart from Float32 rounding.
    const quiet = buildSignal({ kind: "lcg-noise", seed: 99, amplitude: 0.05 });
    const loud = buildSignal({ kind: "lcg-noise", seed: 99, amplitude: 0.1 });

    const quietOutput = logMelSpectrogram(quiet, { nMels: 80 });
    const loudOutput = logMelSpectrogram(loud, { nMels: 80 });

    const shift = Math.log10(2) / 2;
    let worst = 0;
    for (let i = 0; i < quietOutput.length; i++) {
      worst = Math.max(worst, Math.abs(loudOutput[i] - quietOutput[i] - shift));
    }
    expect(worst).toBeLessThan(1e-5);
  });
});

describe("logMelSpectrogram validation and cost", () => {
  it("rejects unsupported mel counts and bad frame geometry", () => {
    const samples = new Float32Array(100);
    expect(() => logMelSpectrogram(samples, { nMels: 64 as 80 })).toThrow(/80 or 128/);
    expect(() => logMelSpectrogram(samples, { nMels: 80, nFft: 1 })).toThrow(/nFft/);
    expect(() => logMelSpectrogram(samples, { nMels: 80, hop: 0 })).toThrow(/hop/);
    expect(() =>
      logMelSpectrogram(new Float64Array(10) as unknown as Float32Array, { nMels: 80 }),
    ).toThrow(/Float32Array/);
  });

  it("processes 30 s in a sensible time (recorded, not asserted)", () => {
    const samples = buildSignal({ kind: "lcg-noise", seed: 424242, amplitude: 0.2 });
    const started = performance.now();
    const output = logMelSpectrogram(samples, { nMels: 80 });
    const elapsedMs = performance.now() - started;

    // The track asks for a recorded number, not a build gate. Keep the log so a
    // regression is visible even though slow CI machines must not fail the suite.
    console.info(
      `[dsp] 480000-sample 80-mel spectrogram: ${elapsedMs.toFixed(1)} ms (target < 250 ms in Node)`,
    );
    expect(output.length).toBe(80 * 3000);
    let finite = true;
    for (const value of output) {
      if (!Number.isFinite(value)) finite = false;
    }
    expect(finite).toBe(true);
  });
});

describe("logMelSpectrogram: the CT2 frame-pad mode (wp-TS)", () => {
  /** A short window: 0.5 s of tone followed by nothing; the engine hands shorter-than-30 s audio here. */
  const shortSamples = () => {
    const samples = new Float32Array(8000);
    for (let n = 0; n < samples.length; n++) samples[n] = 0.3 * Math.sin((2 * Math.PI * 440 * n) / 16_000);
    return samples;
  };

  it("pads the mel frames to 3000 with exact 0.0 instead of padding the audio", () => {
    const samples = shortSamples();
    const padded = logMelSpectrogram(samples, { nMels: 80, padFrames: true });
    expect(padded.length).toBe(80 * MEL_DEFAULT_FRAMES);
    // 8000 samples / 160-sample hop = 50 real frames; every frame after them is zero in every mel row.
    const usedFrames = Math.floor(samples.length / 160);
    let tailNonZero = 0;
    for (let mel = 0; mel < 80; mel++) {
      for (let frame = usedFrames; frame < MEL_DEFAULT_FRAMES; frame++) {
        if (padded[mel * MEL_DEFAULT_FRAMES + frame] !== 0) tailNonZero += 1;
      }
    }
    expect(tailNonZero).toBe(0);
    expect(padded.some((value) => value !== 0)).toBe(true);
  });

  it("leaves the default (audio-pad) output byte-identical and only the tail different", () => {
    const samples = shortSamples();
    const normal = logMelSpectrogram(samples, { nMels: 80 });
    const padded = logMelSpectrogram(samples, { nMels: 80, padFrames: true });
    const usedFrames = Math.floor(samples.length / 160);
    // The last window of the short signal reflects the used samples in frame-pad mode and zeros in audio-pad mode, so
    // only the frames whose 400-sample window lies wholly inside the used audio are expected to match exactly.
    const cleanFrames = Math.max(0, usedFrames - 3);
    for (let mel = 0; mel < 80; mel++) {
      for (let frame = 0; frame < cleanFrames; frame++) {
        expect(padded[mel * MEL_DEFAULT_FRAMES + frame]).toBe(normal[mel * MEL_DEFAULT_FRAMES + frame]);
      }
    }
    // Today's tail is the log floor, not zero: the two conventions are genuinely different for a short window.
    expect(normal[80 * MEL_DEFAULT_FRAMES - 1]).not.toBe(0);
    expect(padded[80 * MEL_DEFAULT_FRAMES - 1]).toBe(0);
  });

  it("produces exactly today's tensor for a full 30 s window (both conventions agree)", () => {
    const samples = new Float32Array(MEL_WINDOW_SAMPLES);
    for (let n = 0; n < samples.length; n++) samples[n] = 0.1 * Math.sin((2 * Math.PI * 220 * n) / 16_000);
    const normal = logMelSpectrogram(samples, { nMels: 80 });
    const padded = logMelSpectrogram(samples, { nMels: 80, padFrames: true });
    expect(padded).toEqual(normal);
  }, 30_000);
});
