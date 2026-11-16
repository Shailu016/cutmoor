/**
 * Slaney-style mel filterbank, generated from the formulas rather than a baked table.
 *
 * This is the filterbank Whisper gets from `librosa.filters.mel(sr=16000, n_fft=400,
 * n_mels=80|128)` with the defaults it uses: htk=False (Slaney's piecewise mel scale)
 * and norm="slaney" (each triangular filter is scaled so its area is one). Getting
 * these constants wrong shifts every mel band, so they are kept in one place and the
 * mel-spectrogram oracle fixture catches any drift.
 */

export interface MelFilterbankOptions {
  /** Number of filters. Whisper only ships 80 and 128. */
  nMels: number;
  /** FFT length whose half-spectrum bins the filters cover. Whisper uses 400. */
  fftSize: number;
  /** Defaults to 16000. */
  sampleRate?: number;
  /** Lowest frequency covered. Defaults to 0 Hz. */
  fMin?: number;
  /** Highest frequency covered. Defaults to sampleRate / 2. */
  fMax?: number;
  /** Use the HTK mel formula instead of Slaney's. Defaults to false. */
  htk?: boolean;
  /** "slaney" scales filters to constant area (the Whisper default); "none" leaves them raw. */
  norm?: "slaney" | "none";
}

export interface MelFilterbank {
  nMels: number;
  /** Frequency bins: floor(fftSize / 2) + 1. */
  bins: number;
  /** Row-major [nMels * bins], one triangular filter per row. */
  weights: Float64Array;
}

const SLANEY_F_SP = 200 / 3;
const SLANEY_MIN_LOG_HZ = 1000;
const SLANEY_MIN_LOG_MEL = SLANEY_MIN_LOG_HZ / SLANEY_F_SP;
const SLANEY_LOG_STEP = Math.log(6.4) / 27;

/** Convert Hz to the Slaney (default) or HTK mel scale. */
export function hzToMel(hz: number, htk = false): number {
  if (!Number.isFinite(hz)) {
    throw new Error(`hzToMel: frequency must be finite, got ${hz}`);
  }
  if (htk) return 2595 * Math.log10(1 + hz / 700);
  if (hz >= SLANEY_MIN_LOG_HZ) {
    return SLANEY_MIN_LOG_MEL + Math.log(hz / SLANEY_MIN_LOG_HZ) / SLANEY_LOG_STEP;
  }
  return hz / SLANEY_F_SP;
}

/** Convert Slaney (default) or HTK mel units back to Hz. */
export function melToHz(mel: number, htk = false): number {
  if (!Number.isFinite(mel)) {
    throw new Error(`melToHz: mel value must be finite, got ${mel}`);
  }
  if (htk) return 700 * (10 ** (mel / 2595) - 1);
  if (mel >= SLANEY_MIN_LOG_MEL) {
    return SLANEY_MIN_LOG_HZ * Math.exp(SLANEY_LOG_STEP * (mel - SLANEY_MIN_LOG_MEL));
  }
  return mel * SLANEY_F_SP;
}

/** `n` mel points evenly spaced between `fMin` and `fMax`, inclusive. */
export function melFrequencies(
  n: number,
  fMin: number,
  fMax: number,
  htk = false,
): Float64Array {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`melFrequencies: n must be an integer >= 1, got ${n}`);
  }
  if (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMin >= fMax) {
    throw new Error(`melFrequencies: need finite fMin < fMax, got ${fMin} and ${fMax}`);
  }
  const minMel = hzToMel(fMin, htk);
  const maxMel = hzToMel(fMax, htk);
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = fMin;
    return out;
  }
  for (let i = 0; i < n; i++) {
    out[i] = melToHz(minMel + ((maxMel - minMel) * i) / (n - 1), htk);
  }
  return out;
}

/**
 * Build the triangular filters. Each filter i spans mel points i..i+2 with its peak at
 * i+1; the peak is assigned weight 1 before Slaney area normalisation.
 */
export function createMelFilterbank(options: MelFilterbankOptions): MelFilterbank {
  const { nMels, fftSize } = options;
  const sampleRate = options.sampleRate ?? 16_000;
  const fMin = options.fMin ?? 0;
  const fMax = options.fMax ?? sampleRate / 2;
  const htk = options.htk ?? false;
  const norm = options.norm ?? "slaney";

  if (!Number.isInteger(nMels) || nMels < 1) {
    throw new Error(`createMelFilterbank: nMels must be an integer >= 1, got ${nMels}`);
  }
  if (!Number.isInteger(fftSize) || fftSize < 2) {
    throw new Error(`createMelFilterbank: fftSize must be an integer >= 2, got ${fftSize}`);
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`createMelFilterbank: sampleRate must be positive, got ${sampleRate}`);
  }
  if (
    !Number.isFinite(fMin) ||
    !Number.isFinite(fMax) ||
    fMin < 0 ||
    fMax > sampleRate / 2 ||
    fMin >= fMax
  ) {
    throw new Error(
      `createMelFilterbank: need 0 <= fMin < fMax <= ${sampleRate / 2}, got ${fMin} and ${fMax}`,
    );
  }
  if (norm !== "slaney" && norm !== "none") {
    throw new Error(`createMelFilterbank: norm must be "slaney" or "none", got ${String(norm)}`);
  }

  const bins = Math.floor(fftSize / 2) + 1;
  const weights = new Float64Array(nMels * bins);

  // librosa's fft_frequencies is np.fft.rfftfreq: bin k sits at k * sr / n_fft.
  const binHz = sampleRate / fftSize;
  const binFrequencies = new Float64Array(bins);
  for (let k = 0; k < bins; k++) binFrequencies[k] = k * binHz;

  // The triangles are linear in Hz, not in mel units: converting the bin
  // frequencies to mel and interpolating there would bend every slope.
  const melF = melFrequencies(nMels + 2, fMin, fMax, htk);
  const differences = new Float64Array(nMels + 1);
  for (let i = 0; i <= nMels; i++) differences[i] = melF[i + 1] - melF[i];

  for (let m = 0; m < nMels; m++) {
    const lowerWidth = differences[m];
    const upperWidth = differences[m + 1];
    const rowOffset = m * bins;
    // Slaney normalisation: a triangle of height 1 and width (melF[m+2]-melF[m])
    // has area width/2, so multiplying by 2/width gives unit area.
    const scale = norm === "slaney" ? 2 / (melF[m + 2] - melF[m]) : 1;

    for (let k = 0; k < bins; k++) {
      const frequency = binFrequencies[k];
      const lower = (frequency - melF[m]) / lowerWidth;
      const upper = (melF[m + 2] - frequency) / upperWidth;
      const value = Math.min(lower, upper);
      if (value > 0) weights[rowOffset + k] = value * scale;
    }
  }

  return { nMels, bins, weights };
}
