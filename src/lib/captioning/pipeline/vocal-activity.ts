import { CaptionError, SAMPLE_RATE } from "../contracts";
import type { PcmChunk, VoiceDetector } from "../contracts";
import type { SpeechInterval } from "../types";
import { SILENCE_RMS } from "./everything-detector";

/**
 * Vocal-activity detection for songs, on the mixed audio (no source separation).
 *
 * WHY THIS EXISTS
 * A stock speech detector misses singing (it is trained on talking) and the "everything" detector, which reads
 * every moment, sends long instrumental stretches to the model. Whisper then writes `nan` for them, and `nan`
 * is not a caption. Reading only the stretches where a voice is present removes that at the source, instead of
 * letting a junk word reach the hallucination gate.
 *
 * THE RULE (non-negotiable, because the same detector runs on speech clips: `detection: "everything"` is the
 * product default). Audio is EXCLUDED (not sent to the model) only when it is:
 *   (a) loud  — frame RMS at or above `loudRms`, and
 *   (b) without voicing evidence in the vocal band — the normalised autocorrelation has no peak in the 80-400 Hz
 *       pitch range, or the 200-4000 Hz spectrum is as flat as noise, or almost none of the frame's energy is in
 *       that band at all.
 * Plus one exception the old detector already had: near-digital silence (RMS < SILENCE_RMS) is never vocal.
 * Everything else — every quiet stretch, and every stretch with harmonic content in the voice band — is KEPT.
 * Keeping is always safe: the hallucination gate still runs on it. Excluding wrongly is what would drop a spoken
 * word, so the rule is deliberately one-sided.
 *
 * WHAT IT CANNOT DO
 * A musical instrument with strong harmonics in the voice band (a sustained synth, a violin, a bass line inside
 * 80-400 Hz) looks voiced and is kept; those stretches still go to the model and must be caught by the gate. A
 * `nan` inside a sung phrase is also untouched: the whole phrase is vocal, so no boundary separates it.
 * On the one real song available (KING Tu Mil Jaaye) the instrumental sections are tonal, so at these conservative
 * thresholds the detector skips almost none of them; what it does drop is silence, bass-only drops and noise-like
 * stretches. The measurement and the rejected, more aggressive settings are in `.team/auto/wp-f.md`.
 *
 * The output is a normal `VoiceDetector`: the CLOSED vocal intervals. The instrumental stretches it skipped are
 * available separately from `instrumentalSpans()` so the pipeline can check the words it keeps against them.
 */

/** Analysis frame: long enough for three periods of an 80 Hz note, short enough to follow a syllable. */
const FRAME_MS = 40;
/** Frames advance by half their length, so a boundary can be placed within 20 ms. */
const HOP_MS = 20;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
const FRAME_SAMPLES = FRAME_MS * SAMPLES_PER_MS;
const HOP_SAMPLES = HOP_MS * SAMPLES_PER_MS;
/** Next power of two above FRAME_SAMPLES; the FFT is radix-2. */
const FFT_SIZE = 1024;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;

/** The band a human voice lives in, and where we look for harmonics. Below 200 Hz is mostly bass and rumble. */
const BAND_LO_HZ = 200;
const BAND_HI_HZ = 4000;
const BAND_LO_BIN = Math.ceil(BAND_LO_HZ / BIN_HZ);
const BAND_HI_BIN = Math.floor(BAND_HI_HZ / BIN_HZ);
/** Singing fundamentals run roughly 80-400 Hz; a peak outside that is a bass note or a squeak, not a voice. */
const PITCH_MIN_HZ = 80;
const PITCH_MAX_HZ = 400;
const MIN_LAG = Math.floor(SAMPLE_RATE / PITCH_MAX_HZ);
const MAX_LAG = Math.ceil(SAMPLE_RATE / PITCH_MIN_HZ);

/**
 * "Loud" for the purpose of excluding audio: -34 dBFS. Well above speech at normal level and above the noise floor
 * of a phone recording, so only clearly audible music can ever be skipped. Silence has its own lower floor.
 */
const LOUD_RMS = 0.02;
/**
 * A frame counts as voiced when this much of its energy repeats at a pitch period (0.30 is the value measured on a
 * separated vocal stem in `.team/auto/king-vocal-energy.json`) ...
 */
const ACF_MIN = 0.3;
/** ... and its 200-4000 Hz spectrum is not noise-flat (1.0 is white noise, a tone is near 0). */
const FLATNESS_MAX = 0.6;
/**
 * ... and at least this share of the frame's energy is in 200-4000 Hz. This exists only to stop a frame with no voice
 * band content at all (a pure bass note, rumble) from being read as voiced; it must stay low, because a low male voice
 * can put most of its energy under 200 Hz while its harmonics (which carry the words) are in the band. Measured on
 * KING: 10 % of the frames where the separated vocal is active sit below 0.14. A 110 Hz voice over a loud 60 Hz bass
 * measures about 0.04 here, so 0.02 keeps it; an earlier 0.08 excluded it.
 */
const BAND_SHARE_MIN = 0.02;

/** 300 ms of continuous evidence opens a vocal interval (backdated to its first frame, so no word is cut). */
const ENTER_MS = 300;
/** 450 ms of continuous evidence closes one. Shorter dips (a breath, a consonant) never split a phrase. */
const EXIT_MS = 450;
/** Two vocal intervals closer than this are joined, so the gap between them is kept as part of the phrase. */
const BRIDGE_MS = 600;

export interface VocalActivityOptions {
  /** Frame RMS below which audio can never be excluded (see the rule above). */
  loudRms?: number;
  /** Minimum normalised autocorrelation peak in the pitch range for a frame to count as voiced. */
  acfMin?: number;
  /** Maximum spectral flatness (in the vocal band) for a frame to count as voiced. */
  flatnessMax?: number;
  /** Minimum share of the frame's energy that must be in the 200-4000 Hz band for it to count as voiced. */
  bandShareMin?: number;
  /** Evidence needed to start keeping audio again. */
  enterMs?: number;
  /** Evidence needed to stop keeping audio. */
  exitMs?: number;
  /** Vocal intervals closer than this are joined. */
  bridgeMs?: number;
}

export interface VocalActivityDetector extends VoiceDetector {
  /**
   * The stretches this detector skipped as instrumental, in global ms, in order, up to the audio read so far. They
   * are the complement of the vocal intervals it returned. The pipeline uses them to check junk words.
   */
  instrumentalSpans(): readonly SpeechInterval[];
}

/** What one frame's numbers say, and whether they are evidence of a voice. */
interface FrameReading {
  /** False means "excluded": loud (or silent) with no voicing in the vocal band. */
  vocal: boolean;
}

/**
 * Hann window, computed once. Without a window the frame edges leak energy across the spectrum and the flatness of
 * a clean tone would look noise-like.
 */
function hannWindow(): Float64Array {
  const window = new Float64Array(FRAME_SAMPLES);
  for (let i = 0; i < FRAME_SAMPLES; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SAMPLES - 1));
  return window;
}

const WINDOW = hannWindow();

/**
 * In-place iterative radix-2 FFT (forward transform). `re` and `im` must have the same power-of-two length.
 * One small implementation instead of a dependency: the transform is 1024 points and the maths is standard.
 */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const aRe = re[start + k];
        const aIm = im[start + k];
        const bRe = re[start + k + size / 2] * curRe - im[start + k + size / 2] * curIm;
        const bIm = re[start + k + size / 2] * curIm + im[start + k + size / 2] * curRe;
        re[start + k] = aRe + bRe;
        im[start + k] = aIm + bIm;
        re[start + k + size / 2] = aRe - bRe;
        im[start + k + size / 2] = aIm - bIm;
        const nextRe = curRe * stepRe - curIm * stepIm;
        curIm = curRe * stepIm + curIm * stepRe;
        curRe = nextRe;
      }
    }
  }
}

/** Reusable scratch buffers, so a 4-minute song does not allocate a new FFT workspace 12 000 times. */
class FrameAnalyzer {
  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);
  private readonly acfRe = new Float64Array(FFT_SIZE);
  private readonly acfIm = new Float64Array(FFT_SIZE);

  constructor(private readonly options: Required<VocalActivityOptions>) {}

  analyse(frame: Float32Array): FrameReading {
    let energy = 0;
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      const value = frame[i];
      energy += value * value;
    }
    const rms = Math.sqrt(energy / FRAME_SAMPLES);
    // Digital silence and the room noise below the old detector's floor: never vocal, and never worth an FFT.
    if (rms < SILENCE_RMS) return { vocal: false };
    // Quiet audio is always kept, voiced or not (the conservative rule). It also needs no spectral work.
    if (rms < this.options.loudRms) return { vocal: true };

    const { re, im } = this;
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      re[i] = frame[i] * WINDOW[i];
      im[i] = 0;
    }
    for (let i = FRAME_SAMPLES; i < FFT_SIZE; i += 1) {
      re[i] = 0;
      im[i] = 0;
    }
    fft(re, im);

    // Power spectrum, band 200-4000 Hz only from here on. `totalPower` is the whole frame, for the band share.
    let bandPower = 0;
    let logSum = 0;
    let bandBins = 0;
    let totalPower = 0;
    for (let k = 0; k <= FFT_SIZE / 2; k += 1) {
      const power = re[k] * re[k] + im[k] * im[k];
      totalPower += power;
      if (k < BAND_LO_BIN || k > BAND_HI_BIN) continue;
      bandPower += power;
      logSum += Math.log(power + 1e-12);
      bandBins += 1;
    }
    const bandShare = totalPower > 0 ? bandPower / totalPower : 0;
    if (bandBins === 0 || bandPower <= 0 || bandShare < this.options.bandShareMin) return { vocal: false };
    // Geometric mean over arithmetic mean: 1 for flat noise, near 0 for a tone. A voice sits well below 1.
    const flatness = Math.exp(logSum / bandBins) / (bandPower / bandBins + 1e-12);
    if (flatness > this.options.flatnessMax) return { vocal: false };

    // Autocorrelation of the band-limited frame: inverse transform of the (symmetric) band power spectrum. With a
    // real, even spectrum the result is real, and only its scale is off - which cancels in the normalisation.
    const { acfRe, acfIm } = this;
    acfRe.fill(0);
    acfIm.fill(0);
    for (let k = 0; k <= FFT_SIZE / 2; k += 1) {
      if (k < BAND_LO_BIN || k > BAND_HI_BIN) continue;
      const power = re[k] * re[k] + im[k] * im[k];
      acfRe[k] = power;
      if (k > 0 && k < FFT_SIZE / 2) acfRe[FFT_SIZE - k] = power;
    }
    fft(acfRe, acfIm);
    const zeroLag = acfRe[0];
    if (!(zeroLag > 0)) return { vocal: false };
    let peak = 0;
    for (let lag = MIN_LAG; lag <= MAX_LAG; lag += 1) {
      const value = acfRe[lag] / zeroLag;
      if (value > peak) peak = value;
    }
    return { vocal: peak >= this.options.acfMin };
  }
}

/** Rounds to whole ms and drops an interval that rounding would empty. */
function whole(interval: SpeechInterval): SpeechInterval | null {
  const startMs = Math.round(interval.startMs);
  const endMs = Math.round(interval.endMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

export function createVocalActivityDetector(options: VocalActivityOptions = {}): VocalActivityDetector {
  const settings: Required<VocalActivityOptions> = {
    loudRms: options.loudRms ?? LOUD_RMS,
    acfMin: options.acfMin ?? ACF_MIN,
    flatnessMax: options.flatnessMax ?? FLATNESS_MAX,
    bandShareMin: options.bandShareMin ?? BAND_SHARE_MIN,
    enterMs: options.enterMs ?? ENTER_MS,
    exitMs: options.exitMs ?? EXIT_MS,
    bridgeMs: options.bridgeMs ?? BRIDGE_MS,
  };
  const analyser = new FrameAnalyzer(settings);

  /** Unprocessed samples, and the global time of `buffer[0]`. */
  let buffer = new Float32Array(0);
  let bufferStartMs = 0;
  let audioEndMs = 0;

  /** "vocal" = kept for the model; "instrumental" = skipped. Starts as "vocal", because keeping is the safe default. */
  let state: "vocal" | "instrumental" = "vocal";
  /** Where the vocal interval being built began. */
  let vocalStartMs = 0;
  /** The run of identical frame evidence in progress. */
  let runKind: "vocal" | "instrumental" | null = null;
  let runStartMs = 0;
  let runMs = 0;
  /** A vocal interval we have decided to close, held until no bridge can reach it any more. */
  let held: SpeechInterval | null = null;
  /** Start of the skipped stretch in progress, or null when the audio is currently kept. */
  let instrumentalStartMs: number | null = null;
  const instrumental: SpeechInterval[] = [];

  const emit = (out: SpeechInterval[], interval: SpeechInterval | null) => {
    const rounded = interval === null ? null : whole(interval);
    if (rounded) out.push(rounded);
  };

  const flushHeld = (out: SpeechInterval[]) => {
    emit(out, held);
    held = null;
  };

  const commitInstrumental = (endMs: number) => {
    const startMs = instrumentalStartMs;
    instrumentalStartMs = null;
    if (startMs === null || endMs <= startMs) return;
    const rounded = whole({ startMs, endMs });
    if (rounded) instrumental.push(rounded);
  };

  /** One 20 ms step of the gate. Returns the vocal intervals that became certain during it. */
  const step = (frameStartMs: number, reading: FrameReading): SpeechInterval[] => {
    const out: SpeechInterval[] = [];
    const kind: "vocal" | "instrumental" = reading.vocal ? "vocal" : "instrumental";
    if (kind !== runKind) {
      runKind = kind;
      runStartMs = frameStartMs;
      runMs = 0;
    }
    runMs += HOP_MS;

    if (state === "vocal" && kind === "instrumental" && runMs >= settings.exitMs) {
      // Leave: the whole run was instrumental, so the vocal interval ends where it began.
      state = "instrumental";
      instrumentalStartMs = runStartMs;
      flushHeld(out);
      if (runStartMs > vocalStartMs) held = { startMs: vocalStartMs, endMs: runStartMs };
    } else if (state === "instrumental" && kind === "vocal" && runMs >= settings.enterMs) {
      // Enter: the whole run was voiced, so the new interval starts at its first frame (nothing is cut).
      state = "vocal";
      const bridged = held !== null && runStartMs - held.endMs <= settings.bridgeMs;
      if (bridged && held !== null) {
        vocalStartMs = held.startMs;
        held = null;
        // The gap turned out to be part of a phrase: it is kept, so it is not an instrumental span.
        instrumentalStartMs = null;
      } else {
        commitInstrumental(runStartMs);
        flushHeld(out);
        vocalStartMs = runStartMs;
      }
    }

    // A held interval is certain once a later phrase could no longer be bridged to it. Entering a bridge needs
    // `enterMs` of evidence after the gap, so the wait is the bridge plus that confirmation.
    if (held !== null && frameStartMs >= held.endMs + settings.bridgeMs + settings.enterMs) flushHeld(out);
    return out;
  };

  return {
    async push(chunk: PcmChunk, signal?: AbortSignal): Promise<SpeechInterval[]> {
      if (signal?.aborted) throw new CaptionError("aborted", "Vocal activity detection was cancelled.");
      if (chunk.samples.length === 0) return [];
      if (buffer.length === 0) bufferStartMs = chunk.startMs;
      const joined = new Float32Array(buffer.length + chunk.samples.length);
      joined.set(buffer, 0);
      joined.set(chunk.samples, buffer.length);
      buffer = joined;
      audioEndMs = Math.max(audioEndMs, chunk.startMs + chunk.samples.length / SAMPLES_PER_MS);

      const out: SpeechInterval[] = [];
      while (buffer.length >= FRAME_SAMPLES) {
        out.push(...step(bufferStartMs, analyser.analyse(buffer.subarray(0, FRAME_SAMPLES))));
        buffer = buffer.subarray(HOP_SAMPLES);
        bufferStartMs += HOP_MS;
      }
      return out;
    },

    async flush(): Promise<SpeechInterval[]> {
      const out: SpeechInterval[] = [];
      if (state === "vocal" && audioEndMs > vocalStartMs) {
        flushHeld(out);
        held = { startMs: vocalStartMs, endMs: audioEndMs };
      }
      commitInstrumental(audioEndMs);
      flushHeld(out);
      return out;
    },

    instrumentalSpans(): readonly SpeechInterval[] {
      const open = instrumentalStartMs === null ? null : whole({ startMs: instrumentalStartMs, endMs: audioEndMs });
      return open ? [...instrumental, open] : [...instrumental];
    },

    reset(): void {
      buffer = new Float32Array(0);
      bufferStartMs = 0;
      audioEndMs = 0;
      state = "vocal";
      vocalStartMs = 0;
      runKind = null;
      runStartMs = 0;
      runMs = 0;
      held = null;
      instrumentalStartMs = null;
      instrumental.length = 0;
    },

    async release(): Promise<void> {},
  };
}
