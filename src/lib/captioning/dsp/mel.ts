/**
 * Whisper-compatible log-mel spectrogram.
 *
 * The model was trained on `openai/whisper`'s `log_mel_spectrogram` output, so this
 * file follows that function step for step:
 *   1. take exactly 30 s (480 000 samples at 16 kHz), zero-padding or trimming;
 *   2. reflect-pad by n_fft/2 on both sides (center=true STFT);
 *   3. periodic Hann window of length n_fft;
 *   4. power spectrum |STFT|^2, dropping the final frame (torch.stft yields 3001);
 *   5. Slaney mel filters over 0..8 kHz, transpose-multiply;
 *   6. log10(clip(mel, 1e-10));
 *   7. clamp to at most 8 decades below the global maximum;
 *   8. (value + 4) / 4.
 *
 * The DFT is exact at n_fft = 400. Zero-padding the frame to 512 for a radix-2 FFT
 * would change the frequency grid and the mel result by ~1e-1, not ~1e-4, so the
 * exact transform is not an optional nicety here.
 *
 * Output is row-major and mel-major: `output[mel * frames + frame]`. With the
 * defaults that is [nMels * 3000], exactly the tensor the engine expects.
 */

import { createRealDft } from "./fft";
import { createMelFilterbank } from "./mel-filters";
import { padOrTrim } from "./window";

export const DSP_SAMPLE_RATE = 16_000;
export const MEL_WINDOW_SAMPLES = 480_000;
/** 30 s at the default 160-sample hop. */
export const MEL_DEFAULT_FRAMES = 3000;

export interface LogMelOptions {
  nMels: 80 | 128;
  /** STFT frame/window length in samples. Whisper uses 400. */
  nFft?: number;
  /** STFT hop in samples. Whisper uses 160. */
  hop?: number;
  /**
   * CTranslate2 / faster-whisper convention for a window shorter than 30 s: compute the spectrogram on the used
   * samples and zero-pad the MEL FRAMES to 3000, instead of zero-padding the audio first. The two differ only in
   * the tail: audio padding leaves log-floor frames, frame padding leaves exact 0.0. Off by default, so every
   * existing call keeps today's byte-identical output.
   */
  padFrames?: boolean;
}

/**
 * Reflect-pad index. `index` may be negative (left padding) or past the end (right
 * padding); repeated reflection is handled by the modulo.
 */
function reflectIndex(index: number, length: number): number {
  if (length === 1) return 0;
  const period = 2 * (length - 1);
  let value = index % period;
  if (value < 0) value += period;
  return value < length ? value : period - value;
}

export function logMelSpectrogram(samples: Float32Array, options: LogMelOptions): Float32Array {
  if (options.nMels !== 80 && options.nMels !== 128) {
    throw new Error(`logMelSpectrogram: nMels must be 80 or 128, got ${String(options.nMels)}`);
  }
  const nMels = options.nMels;
  const nFft = options.nFft ?? 400;
  const hop = options.hop ?? 160;

  if (!Number.isInteger(nFft) || nFft < 2) {
    throw new Error(`logMelSpectrogram: nFft must be an integer >= 2, got ${nFft}`);
  }
  if (!Number.isInteger(hop) || hop < 1) {
    throw new Error(`logMelSpectrogram: hop must be an integer >= 1, got ${hop}`);
  }
  if (!(samples instanceof Float32Array)) {
    throw new Error("logMelSpectrogram: samples must be a Float32Array");
  }

  // Step 1: exactly 30 s. The engine pads the window itself; doing it here too keeps
  // this function safe to call with a short final chunk. In padFrames mode the audio is NOT padded: the spectrogram
  // is computed on the used samples and the mel frames are padded to 3000 with 0.0 afterwards (CT2 convention).
  const trimmed = padOrTrim(samples, MEL_WINDOW_SAMPLES);
  const used = options.padFrames ? samples.subarray(0, Math.min(samples.length, MEL_WINDOW_SAMPLES)) : trimmed;
  const signalLength = used.length;
  const pad = nFft >> 1;
  const paddedLength = signalLength + 2 * pad;
  if (paddedLength < nFft) {
    throw new Error(
      `logMelSpectrogram: nFft ${nFft} is longer than the padded 30 s signal (${paddedLength})`,
    );
  }

  // Step 2: torch.stft(center=True, pad_mode="reflect") pads n_fft//2 on both sides.
  const padded = new Float64Array(paddedLength);
  for (let i = 0; i < paddedLength; i++) {
    padded[i] = used[reflectIndex(i - pad, signalLength)];
  }

  // Step 4: torch drops the last STFT frame that centre padding would add.
  const frames = Math.floor((paddedLength - nFft) / hop);
  if (frames < 1) {
    throw new Error(
      `logMelSpectrogram: nFft ${nFft} and hop ${hop} produce no frames for ${signalLength} samples`,
    );
  }

  // Step 3: periodic Hann. 0.5 - 0.5*cos(2*pi*n/N), not the symmetric N-1 form.
  const window = new Float64Array(nFft);
  for (let n = 0; n < nFft; n++) {
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / nFft);
  }

  // Step 5: filters and an exact real DFT of the frame length.
  const filterbank = createMelFilterbank({
    nMels,
    fftSize: nFft,
    sampleRate: DSP_SAMPLE_RATE,
  });
  const dft = createRealDft(nFft);
  if (filterbank.bins !== dft.bins) {
    throw new Error(
      `logMelSpectrogram: internal mismatch, ${filterbank.bins} filter bins vs ${dft.bins} DFT bins`,
    );
  }
  const bins = dft.bins;

  // Most bins feed one or two filters. Store only the non-zero pairs so the hot loop
  // touches ~2*bins weights per frame instead of nMels*bins.
  const binStart = new Int32Array(bins + 1);
  for (let k = 0; k < bins; k++) {
    let count = 0;
    for (let m = 0; m < nMels; m++) {
      if (filterbank.weights[m * bins + k] !== 0) count++;
    }
    binStart[k + 1] = binStart[k] + count;
  }
  const entryCount = binStart[bins];
  const entryMel = new Int32Array(entryCount);
  const entryWeight = new Float64Array(entryCount);
  let cursor = 0;
  for (let k = 0; k < bins; k++) {
    for (let m = 0; m < nMels; m++) {
      const weight = filterbank.weights[m * bins + k];
      if (weight !== 0) {
        entryMel[cursor] = m;
        entryWeight[cursor] = weight;
        cursor++;
      }
    }
  }

  const frameSamples = new Float64Array(nFft);
  const spectrumRe = new Float64Array(bins);
  const spectrumIm = new Float64Array(bins);
  const mel = new Float64Array(nMels * frames);

  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * hop;
    for (let n = 0; n < nFft; n++) frameSamples[n] = padded[offset + n] * window[n];

    dft.transform(frameSamples, spectrumRe, spectrumIm);

    for (let k = 0; k < bins; k++) {
      const re = spectrumRe[k];
      const im = spectrumIm[k];
      const power = re * re + im * im;
      for (let entry = binStart[k]; entry < binStart[k + 1]; entry++) {
        mel[entryMel[entry] * frames + frame] += entryWeight[entry] * power;
      }
    }
  }

  // Steps 6-8. The maximum is global across every mel and frame, as in Whisper.
  const logEnergy = new Float64Array(mel.length);
  let maximumLog = -Infinity;
  for (let i = 0; i < mel.length; i++) {
    const value = mel[i] > 1e-10 ? mel[i] : 1e-10;
    const log = Math.log10(value);
    logEnergy[i] = log;
    if (log > maximumLog) maximumLog = log;
  }
  const floor = maximumLog - 8;

  const output = new Float32Array(mel.length);
  for (let i = 0; i < mel.length; i++) {
    const value = logEnergy[i] > floor ? logEnergy[i] : floor;
    output[i] = (value + 4) / 4;
  }
  if (!options.padFrames) return output;

  // CT2 convention: the frames past the used audio are exact 0.0, one row per mel. The values on the used frames are
  // unchanged, so a full 30 s window produces exactly the same tensor either way (frames === 3000).
  const paddedOutput = new Float32Array(nMels * MEL_DEFAULT_FRAMES);
  const copiedFrames = Math.min(frames, MEL_DEFAULT_FRAMES);
  for (let melIndex = 0; melIndex < nMels; melIndex++) {
    paddedOutput.set(output.subarray(melIndex * frames, melIndex * frames + copiedFrames), melIndex * MEL_DEFAULT_FRAMES);
  }
  return paddedOutput;
}
