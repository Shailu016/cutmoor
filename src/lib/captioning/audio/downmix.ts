/**
 * Mixing several audio channels down to one. A plain average: for speech that keeps a voice
 * panned to one side as loud as a centred one, and it never clips (the result cannot exceed the
 * loudest input channel).
 *
 * Broken decoders sometimes hand back NaN or Infinity; one such sample would poison every filter
 * stage after it, so non-finite values become silence here, at the door.
 */

export const MAX_CHANNELS = 8;

function checkChannelCount(channels: number): void {
  if (!Number.isInteger(channels) || channels < 1 || channels > MAX_CHANNELS) {
    throw new RangeError(`Unsupported channel count: ${channels} (1 to ${MAX_CHANNELS} are supported)`);
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Planar input: one array per channel, all the same length. */
export function downmixPlanar(planes: readonly Float32Array[]): Float32Array {
  checkChannelCount(planes.length);
  const length = planes[0].length;
  for (const plane of planes) {
    if (plane.length !== length) throw new RangeError("All channels must have the same length");
  }
  const out = new Float32Array(length);
  const count = planes.length;
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < count; c += 1) sum += finiteOrZero(planes[c][i]);
    out[i] = sum / count;
  }
  return out;
}

/** Interleaved input: frame 0 channel 0, frame 0 channel 1, ... */
export function downmixInterleaved(data: Float32Array, channels: number): Float32Array {
  checkChannelCount(channels);
  if (data.length % channels !== 0) throw new RangeError("Interleaved data length is not a multiple of the channel count");
  const frames = data.length / channels;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    const offset = i * channels;
    for (let c = 0; c < channels; c += 1) sum += finiteOrZero(data[offset + c]);
    out[i] = sum / channels;
  }
  return out;
}
