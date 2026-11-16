/**
 * Tiny array helpers shared by the DSP modules. They are deliberately boring:
 * callers pass audio around a lot, and a wrong length here silently shifts every
 * timestamp downstream.
 */

/** Audio samples. Float32 is what the decoder produces; Float64 is used in DSP math. */
export type SampleArray = Float32Array | Float64Array;

/**
 * Returns a new array of exactly `length` samples: the input truncated if it is too
 * long, zero-padded if it is too short. The input is never modified.
 */
export function padOrTrim(samples: Float32Array, length: number): Float32Array;
export function padOrTrim(samples: Float64Array, length: number): Float64Array;
export function padOrTrim(samples: SampleArray, length: number): SampleArray {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`padOrTrim: length must be a non-negative integer, got ${length}`);
  }
  const output =
    samples instanceof Float64Array ? new Float64Array(length) : new Float32Array(length);
  const copy = Math.min(samples.length, length);
  for (let i = 0; i < copy; i++) output[i] = samples[i];
  return output;
}

/**
 * Root-mean-square level. Non-finite samples count as zero so one corrupt decoded
 * sample cannot turn a whole-file statistic into NaN.
 */
export function rms(samples: SampleArray): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (Number.isFinite(value)) sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Largest absolute sample. Non-finite samples are ignored; an all-empty or all-NaN
 * input reports 0 rather than Infinity, because callers use this for gain checks.
 */
export function peak(samples: SampleArray): number {
  let maximum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]);
    if (Number.isFinite(value) && value > maximum) maximum = value;
  }
  return maximum;
}
