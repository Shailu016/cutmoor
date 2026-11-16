/**
 * A streaming polyphase FIR resampler: any input rate (8 kHz to 192 kHz and beyond) to 16 kHz.
 *
 * WHY a hand-written one: the speech model wants 16 kHz mono, and a cheap resample (linear
 * interpolation, or just dropping samples) folds everything above 8 kHz back down into the
 * speech band as hiss and false "sounds". This one uses a Kaiser-windowed sinc low-pass with
 * 70 dB of stopband rejection, so 48 kHz video audio is cleaned before it is thinned out.
 *
 * WHY streaming: a long video is decoded packet by packet and never held whole. The filter
 * memory (a few hundred input samples) is carried between `process` calls, so feeding the same
 * audio in one piece or in 777-sample pieces produces the very same output.
 *
 * Alignment: the filter is centred (zero delay). Output sample k describes the signal at input
 * position k * inputRate / 16000, so output sample 0 lines up with input sample 0. Before the
 * start and after the end the signal is treated as silence.
 */

export const TARGET_RATE = 16_000;

/** Stopband rejection the filter is designed for, in dB. */
const STOPBAND_DB = 70;
/**
 * More phases than this are not worth a bigger table: instead each output picks the nearest of
 * this many fractional positions. The timing error is at most 1/2048 of an input sample.
 */
const MAX_PHASES = 1024;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Zeroth-order modified Bessel function of the first kind (series; converges fast for the betas used here). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 200; k += 1) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** Kaiser beta for a wanted stopband attenuation in dB (Kaiser's empirical formula). */
function kaiserBeta(attenuationDb: number): number {
  if (attenuationDb > 50) return 0.1102 * (attenuationDb - 8.7);
  if (attenuationDb >= 21) return 0.5842 * (attenuationDb - 21) ** 0.4 + 0.07886 * (attenuationDb - 21);
  return 0;
}

interface FilterBank {
  /** Number of fractional positions. */
  phases: number;
  /** Taps per phase (= 2 * halfWidth). */
  taps: number;
  /** How many input samples the filter reaches on each side. */
  halfWidth: number;
  /** phases * taps coefficients; each phase sums to 1 so a constant signal passes unchanged. */
  table: Float64Array;
}

function designFilterBank(inputRate: number): FilterBank {
  const reduced = TARGET_RATE / gcd(inputRate, TARGET_RATE);
  const phases = Math.min(reduced, MAX_PHASES);

  // The low-pass must stop below the lower of the two Nyquist frequencies. The transition band
  // is 12.5% of that, i.e. 7-8 kHz for the usual 48 kHz -> 16 kHz case.
  const stopEdgeHz = Math.min(inputRate, TARGET_RATE) / 2;
  const transitionHz = stopEdgeHz * 0.125;
  const centreHz = stopEdgeHz - transitionHz / 2;
  const cutoff = centreHz / inputRate; // cycles per input sample
  const transition = transitionHz / inputRate; // cycles per input sample

  const beta = kaiserBeta(STOPBAND_DB);
  const lengthInSamples = (STOPBAND_DB - 7.95) / (2.285 * 2 * Math.PI * transition);
  const halfWidth = Math.ceil(lengthInSamples / 2) + 1;
  const taps = halfWidth * 2;
  const besselBeta = besselI0(beta);

  const table = new Float64Array(phases * taps);
  for (let p = 0; p < phases; p += 1) {
    let sum = 0;
    const row = p * taps;
    for (let j = 0; j < taps; j += 1) {
      // Distance (in input samples) from the output instant to the input sample this tap multiplies.
      const tau = halfWidth - 1 - j + p / phases;
      const x = 2 * Math.PI * cutoff * tau;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
      const r = tau / halfWidth;
      const window = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / besselBeta;
      const value = 2 * cutoff * sinc * window;
      table[row + j] = value;
      sum += value;
    }
    for (let j = 0; j < taps; j += 1) table[row + j] /= sum;
  }
  return { phases, taps, halfWidth, table };
}

export class StreamingResampler {
  readonly inputRate: number;
  private readonly bank: FilterBank;

  /** Input samples not yet fully consumed. Starts with `halfWidth` zeros (the silence before time 0). */
  private pending: Float32Array;
  /** Index (in the whole stream) of pending[0]. Starts negative because of the leading zeros. */
  private pendingStart: number;
  /** Next output sample number to produce. */
  private nextOutput = 0;
  /** Total real input samples received. */
  private inputCount = 0;
  private finished = false;

  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < 1000 || inputRate > 1_000_000 || !Number.isInteger(inputRate)) {
      throw new RangeError(`Unsupported sample rate: ${inputRate}`);
    }
    this.inputRate = inputRate;
    this.bank = inputRate === TARGET_RATE ? { phases: 1, taps: 0, halfWidth: 0, table: new Float64Array(0) } : designFilterBank(inputRate);
    this.pending = new Float32Array(this.bank.halfWidth);
    this.pendingStart = -this.bank.halfWidth;
  }

  /** Total real input samples received so far. */
  get consumedInputSamples(): number {
    return this.inputCount;
  }

  /** Feeds more input and returns every output sample that is now final. */
  process(input: Float32Array): Float32Array {
    if (this.finished) throw new Error("The resampler was flushed; call reset() before reusing it.");
    this.inputCount += input.length;
    if (this.inputRate === TARGET_RATE) return Float32Array.from(input);
    this.append(input);
    return this.produce(Number.POSITIVE_INFINITY);
  }

  /** Ends the stream: returns the last outputs (the filter tail, computed against silence). */
  flush(): Float32Array {
    if (this.finished) return new Float32Array(0);
    this.finished = true;
    if (this.inputRate === TARGET_RATE) return new Float32Array(0);
    // One extra zero: rounding to the nearest phase can push the last output's centre one sample forward.
    this.append(new Float32Array(this.bank.halfWidth + 1));
    // Exactly the outputs whose instant falls inside the real input: k * rate < n * 16000.
    const total = Math.ceil((this.inputCount * TARGET_RATE) / this.inputRate);
    return this.produce(total);
  }

  /** Forgets everything so the instance can start a new stream. */
  reset(): void {
    this.pending = new Float32Array(this.bank.halfWidth);
    this.pendingStart = -this.bank.halfWidth;
    this.nextOutput = 0;
    this.inputCount = 0;
    this.finished = false;
  }

  private append(input: Float32Array): void {
    const joined = new Float32Array(this.pending.length + input.length);
    joined.set(this.pending, 0);
    joined.set(input, this.pending.length);
    this.pending = joined;
  }

  private produce(outputLimit: number): Float32Array {
    const { phases, taps, halfWidth, table } = this.bank;
    const pending = this.pending;
    const lastIndex = this.pendingStart + pending.length - 1; // newest sample we hold
    const out: number[] = [];
    let k = this.nextOutput;
    while (k < outputLimit) {
      // Output k sits at input position k * rate / 16000; integer maths keeps long streams exact.
      const numerator = k * this.inputRate;
      const base = Math.floor(numerator / TARGET_RATE);
      const remainder = numerator - base * TARGET_RATE;
      let phase = Math.round((remainder * phases) / TARGET_RATE);
      let centre = base;
      if (phase >= phases) {
        phase = 0;
        centre += 1;
      }
      if (centre + halfWidth > lastIndex) break; // needs input that has not arrived yet
      const first = centre - halfWidth + 1 - this.pendingStart;
      const row = phase * taps;
      let acc = 0;
      for (let j = 0; j < taps; j += 1) acc += pending[first + j] * table[row + j];
      out.push(acc);
      k += 1;
    }
    this.nextOutput = k;
    // Keep only what later outputs can still reach.
    const nextCentre = Math.floor((k * this.inputRate) / TARGET_RATE);
    const keepFrom = Math.max(this.pendingStart, nextCentre - halfWidth + 1 - 1);
    if (keepFrom > this.pendingStart) {
      this.pending = pending.slice(keepFrom - this.pendingStart);
      this.pendingStart = keepFrom;
    }
    return Float32Array.from(out);
  }
}

/** Convenience for whole buffers (tests, short clips): resample in one go. */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  const resampler = new StreamingResampler(inputRate);
  const body = resampler.process(input);
  const tail = resampler.flush();
  const joined = new Float32Array(body.length + tail.length);
  joined.set(body, 0);
  joined.set(tail, body.length);
  return joined;
}
