/**
 * Repetition-aware pass for song mode (O3).
 *
 * WHY THIS EXISTS
 * Songs are often edited as loops: a chorus is repeated verbatim or nearly so, while the ASR reads only one of the
 * two occurrences (the other falls in a window that came out as `nan`, or in a stretch the model simply missed).
 * `.team/auto/r2/wpE-repeat.md` measures the loop on the one real song: lag 33.6586 s, vocal-band cosine similarity
 * 0.84, prominence well above the noise floor, and a hard splice (no drift). The words of the second occurrence are
 * then a strong hypothesis when the first one decoded. Product rule (PLAN-R3 item 4): transfer only above the
 * similarity and prominence gates, mark every copied word `inferred` with a low confidence, and never on speech.
 *
 * THE CONSTRAINT THAT SHAPES THE CODE
 * The product keeps only a rolling audio buffer, so the pass cannot look at the PCM again once it has streamed
 * past. Everything here is therefore accumulated as audio arrives: one small feature vector per 50 ms hop, no raw
 * audio retained (`push` copies each sample exactly once into a fixed-size frame buffer). A 4-minute song costs
 * ~4800 frames * 10 floats = 192 KB.
 *
 * FEATURES
 * Ten log-energy bands between 200 and 3500 Hz (the vocal band), each computed with a Goertzel recurrence - no FFT
 * dependency, no allocation per frame. Per frame the log energies are mean-subtracted and L2-normalised, so the
 * cosine of two frames depends only on the shape of the spectrum, not on loudness or on one band dominating. Frames
 * below the RMS floor (digital silence) are stored as an "invalid" slot: they keep the hop grid exact for the time
 * mapping but never contribute to a similarity, because silence is identical to silence at every lag and would
 * otherwise inflate the score.
 *
 * SCORING IS BLOCK-LOCAL, NOT WHOLE-FILE
 * A song is usually only partly looped: on the measured song the repeated block is 33.65 s inside a 125 s file, so
 * a mean over every overlapping frame is diluted by the unique sections (measured: 0.998 inside the block vs 0.384
 * over the file). `find()` therefore scores each lag by its best contiguous 8 s window of frame cosines (prefix
 * sums, O(frames) per lag), extends that window while the neighbouring frames stay similar (>= max(0.55,
 * best - 0.2)), and reports the mean over the extended block together with its start and end. The block is
 * reported for diagnostics and for a caller that wants to be stricter; `transferRepeatedWords` does NOT restrict
 * copies to it, because the most self-similar 8 s can sit at the end of the block while the decoded words are at its
 * start (measured on Sajan: block 71.2-79.2 s, decoded words 47.6-59.3 s). The per-word audio probe is the gate.
 *
 * LIMITS
 * This is a *repeat detector*, not a lyric comparator. It says "this stretch sounds like that stretch"; whether the
 * words are the same (verse/chorus asymmetry is normal in songs) is a hypothesis, which is exactly why every
 * transferred word is flagged inferred and low-confidence. A stationary tone (a synth pad, a sustained note) is
 * self-similar at every lag; the prominence gate is what rejects it, not the similarity gate. A repeated stretch
 * shorter than 8 s never produces a block, by design: the point is to fill a missing line, not to duplicate a word.
 */
import type { PcmChunk } from "../contracts";
import type { Word } from "../types";

export interface RepeatMatch {
  /** Measured lag in ms (the second occurrence is this much later than the first). */
  lagMs: number;
  /** Mean cosine similarity over the extended repeated block (not the whole file), 0..1. */
  similarity: number;
  /**
   * (best block - baseline) / (1 - baseline), 0..1. `best block` is the highest 8 s window mean at this lag and the
   * baseline is the MEDIAN of the same statistic at lags outside +-1 s (the typical unrelated lag; a 90th-percentile
   * baseline counted near-harmonic lags as "typical" and put the measured Sajan repeat's prominence at 0.481, just
   * under the gate, while the true block was 0.755 against a median of 0.482).
   */
  prominence: number;
  /**
   * First frame time of the source block in the EARLIER occurrence, integer ms. Diagnostic: the transfer is gated
   * per word by the audio probe, not by this range (the best 8 s window can sit away from the decoded words).
   */
  blockStartMs: number;
  /**
   * End of the source block in the earlier occurrence, integer ms, EXCLUSIVE: the block is
   * `[blockStartMs, blockEndMs)` and `blockEndMs` is the start of the first frame after it.
   */
  blockEndMs: number;
}

export interface RepeatTrackerOptions {
  sampleRate?: number; // default 16000
  frameMs?: number; // default 100
  hopMs?: number; // default 50
  minLagMs?: number; // default 20000
  maxLagMs?: number; // default 60000
  minSimilarity?: number; // default 0.70 (real mix measurement, see DEFAULT_MIN_SIMILARITY)
  minProminence?: number; // default 0.5
  /** Frames are dropped below this RMS (digital silence), default 0.002. */
  silenceRms?: number;
}

export interface RepeatTracker {
  /** Feeds streamed audio in order. Cheap: O(samples) per chunk, no raw audio retained. */
  push(chunk: PcmChunk): void;
  /** Number of feature frames collected so far (tests/diagnostics). */
  readonly frames: number;
  /** Best accepted lag, or null when nothing passes both gates. Deterministic. */
  find(): RepeatMatch | null;
  /**
   * Mean cosine similarity of the frames covering [startMs, endMs] against the same span shifted by
   * `lagMs` (only frames that exist on both sides). 0 when there is not enough overlap.
   */
  similarityAt(startMs: number, endMs: number, lagMs: number): number;
}

export function createRepeatTracker(options?: RepeatTrackerOptions): RepeatTracker {
  return new StreamingRepeatTracker(options ?? {});
}

/** Number of spectral bands the feature vector keeps. Ten points are enough to tell a voice from a pad. */
const BAND_COUNT = 10;
/** The vocal band. Below 200 Hz is bass and kick; above ~3.5 kHz is cymbal and hiss, which do not carry words. */
const BAND_LOW_HZ = 200;
const BAND_HIGH_HZ = 3500;

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_FRAME_MS = 100;
const DEFAULT_HOP_MS = 50;
const DEFAULT_MIN_LAG_MS = 20_000;
const DEFAULT_MAX_LAG_MS = 60_000;
/**
 * Block-level cosine floor. The plan's 0.75 came from the Demucs VOCAL stem (0.84); the product hears the mix, and on
 * the real Sajan mix (this module, 16 kHz, 10 bands) the true repeat block scores 0.755 with a median unrelated lag at
 * 0.482. 0.70 therefore accepts the measured repeat and still sits far above unrelated audio (best block 0.5 or less).
 */
const DEFAULT_MIN_SIMILARITY = 0.7;
const DEFAULT_MIN_PROMINENCE = 0.5;
const DEFAULT_SILENCE_RMS = 0.002;

/**
 * The block searched at every lag: 8 s of contiguous comparable frames (160 at the default 50 ms hop). Long enough
 * that a few noisy frames cannot invent a block, short enough to sit inside the shortest repeated lyric.
 */
const BLOCK_MS = 8000;
/** A neighbouring frame joins the block while its similarity clears both this floor ... */
const EXTEND_FLOOR = 0.55;
/** ... and `best - this`. Together they recover the whole repeated block without crossing into the unique sections. */
const EXTEND_SLACK = 0.2;
/** Lags this close to the best cannot be part of the baseline: they are the peak itself, only offset by a frame. */
const BASELINE_GUARD_MS = 1000;
/** Fewer than this many baseline lags means the search range is too small to say what "unusual" means. */
const MIN_BASELINE_LAGS = 10;
/**
 * A lag only replaces the current best when it is clearly better. An exact loop also matches at twice the lag
 * (harmonic double-lag), and with floating-point sums the two means differ in the last bits; without this the
 * detector would sometimes report 2x the real period. This is also the documented "ties pick the smaller lag".
 */
const TIE_TOLERANCE = 1e-4;
/** Relative power floor for a band with no energy at all; keeps `log` finite. */
const LOG_POWER_FLOOR = 1e-12;

class StreamingRepeatTracker implements RepeatTracker {
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private readonly hopSamples: number;
  private readonly msPerFrame: number;
  private readonly minLagMs: number;
  private readonly maxLagMs: number;
  private readonly minSimilarity: number;
  private readonly minProminence: number;
  private readonly silenceRms: number;

  /** Goertzel coefficients (2*cos(omega)) for the band centres, computed once. */
  private readonly coefficients: Float64Array;
  /** Hann window, computed once: without it the frame edges leak across the spectrum and blur the bands. */
  private readonly window: Float32Array;
  /** Scratch for the windowed frame, reused for every band and every frame. */
  private readonly windowed: Float64Array;

  /** The frame being filled: always exactly `frameSamples` long, slid forward by `hopSamples`. */
  private readonly frame: Float32Array;
  private filled = 0;
  /** Global time of the first sample ever pushed, or null before the first chunk. */
  private originMs: number | null = null;

  /** Row-major feature store: `frameCount` rows of BAND_COUNT floats, unit length or all zero. */
  private features: Float32Array;
  /** 1 for a frame with a real, unit-length feature; 0 for a silent or flat frame. */
  private valid: Uint8Array;
  private frameCount = 0;

  /** Per-lag scratch, reused so `find()` allocates nothing inside the lag loop (sized to the frame count). */
  private sims = new Float64Array(0);
  private defined = new Uint8Array(0);
  private prefixSum = new Float64Array(0);
  private prefixCount = new Int32Array(0);

  constructor(options: RepeatTrackerOptions) {
    const sampleRate = options.sampleRate !== undefined && options.sampleRate > 0 ? options.sampleRate : DEFAULT_SAMPLE_RATE;
    const frameMs = Math.max(1, options.frameMs ?? DEFAULT_FRAME_MS);
    // A hop longer than the frame would leave gaps, so it is clamped instead of rejected.
    const hopMs = Math.min(frameMs, Math.max(1, options.hopMs ?? DEFAULT_HOP_MS));

    this.sampleRate = sampleRate;
    this.frameSamples = Math.max(1, Math.round((frameMs * sampleRate) / 1000));
    this.hopSamples = Math.max(1, Math.min(this.frameSamples, Math.round((hopMs * sampleRate) / 1000)));
    this.msPerFrame = (this.hopSamples * 1000) / sampleRate;

    this.minLagMs = Math.max(0, options.minLagMs ?? DEFAULT_MIN_LAG_MS);
    this.maxLagMs = Math.max(this.minLagMs, options.maxLagMs ?? DEFAULT_MAX_LAG_MS);
    this.minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
    this.minProminence = options.minProminence ?? DEFAULT_MIN_PROMINENCE;
    this.silenceRms = Math.max(0, options.silenceRms ?? DEFAULT_SILENCE_RMS);

    this.coefficients = bandCoefficients(sampleRate);
    this.window = hannWindow(this.frameSamples);
    this.windowed = new Float64Array(this.frameSamples);
    this.frame = new Float32Array(this.frameSamples);
    this.features = new Float32Array(256 * BAND_COUNT);
    this.valid = new Uint8Array(256);
  }

  get frames(): number {
    return this.frameCount;
  }

  push(chunk: PcmChunk): void {
    const samples = chunk.samples;
    if (samples.length === 0) return;
    if (this.originMs === null) this.originMs = chunk.startMs;

    let at = 0;
    while (at < samples.length) {
      const take = Math.min(this.frameSamples - this.filled, samples.length - at);
      this.frame.set(samples.subarray(at, at + take), this.filled);
      this.filled += take;
      at += take;
      if (this.filled === this.frameSamples) {
        this.emitFrame();
        // Keep the tail of this frame: the next one starts `hopSamples` later.
        this.frame.copyWithin(0, this.hopSamples);
        this.filled = this.frameSamples - this.hopSamples;
      }
    }
  }

  find(): RepeatMatch | null {
    const n = this.frameCount;
    if (n < 2 || this.originMs === null) return null;

    const blockFrames = Math.max(1, Math.round(BLOCK_MS / this.msPerFrame));
    if (n < blockFrames + 1) return null;

    const minLagFrames = Math.max(1, Math.ceil(this.minLagMs / this.msPerFrame));
    // A lag with fewer than `blockFrames` comparable frames cannot hold a block, so it is not searched.
    const maxLagFrames = Math.min(Math.floor(this.maxLagMs / this.msPerFrame), n - blockFrames);
    if (maxLagFrames < minLagFrames) return null;

    const candidateCount = maxLagFrames - minLagFrames + 1;
    /** Highest 8 s window mean at each candidate lag: the statistic the peak and the baseline are both built on. */
    const scores = new Float64Array(candidateCount);
    let bestLagFrames = -1;
    let bestBlockMean = -1;

    for (let lagFrames = minLagFrames; lagFrames <= maxLagFrames; lagFrames += 1) {
      const { bestMean } = this.scanLag(lagFrames, blockFrames);
      scores[lagFrames - minLagFrames] = bestMean;
      // Strictly (and clearly) greater keeps the smaller lag on a tie, which is what a deterministic search needs.
      if (bestLagFrames < 0 || bestMean > bestBlockMean + TIE_TOLERANCE) {
        bestBlockMean = bestMean;
        bestLagFrames = lagFrames;
      }
    }
    if (bestLagFrames < 0) return null;

    const guardFrames = Math.ceil(BASELINE_GUARD_MS / this.msPerFrame);
    const baseline: number[] = [];
    for (let lagFrames = minLagFrames; lagFrames <= maxLagFrames; lagFrames += 1) {
      if (Math.abs(lagFrames - bestLagFrames) <= guardFrames) continue;
      baseline.push(scores[lagFrames - minLagFrames]);
    }
    if (baseline.length < MIN_BASELINE_LAGS) return null;
    baseline.sort((a, b) => a - b);
    const baselineScore = baseline[Math.floor(0.5 * (baseline.length - 1))];

    const headroom = 1 - baselineScore;
    const prominence = headroom <= 1e-9 ? 0 : clamp01((bestBlockMean - baselineScore) / headroom);
    if (prominence < this.minProminence) return null;

    // Re-scan the winning lag to recover its best window, then grow the block over similar neighbours.
    const winning = this.scanLag(bestLagFrames, blockFrames);
    if (winning.bestStart < 0) return null;
    const threshold = Math.max(EXTEND_FLOOR, winning.bestMean - EXTEND_SLACK);
    const comparable = n - bestLagFrames;
    let left = winning.bestStart;
    let right = winning.bestStart + blockFrames;
    while (left > 0 && this.defined[left - 1] !== 0 && this.sims[left - 1] >= threshold) left -= 1;
    while (right < comparable && this.defined[right] !== 0 && this.sims[right] >= threshold) right += 1;

    const similarity = (this.prefixSum[right] - this.prefixSum[left]) / (right - left);
    if (similarity < this.minSimilarity) return null;

    return {
      lagMs: Math.round(bestLagFrames * this.msPerFrame),
      similarity: clamp01(similarity),
      prominence,
      blockStartMs: Math.round(this.originMs + left * this.msPerFrame),
      blockEndMs: Math.round(this.originMs + right * this.msPerFrame),
    };
  }

  similarityAt(startMs: number, endMs: number, lagMs: number): number {
    if (this.frameCount === 0 || this.originMs === null || endMs <= startMs) return 0;
    const lagFrames = Math.round(lagMs / this.msPerFrame);
    const first = this.frameAtOrAfter(startMs);
    const end = this.frameAtOrAfter(endMs);

    let sum = 0;
    let count = 0;
    const from = Math.max(0, first);
    const to = Math.min(this.frameCount - 1, end - 1);
    for (let i = from; i <= to; i += 1) {
      const j = i + lagFrames;
      if (j < 0 || j >= this.frameCount) continue;
      if (this.valid[i] === 0 || this.valid[j] === 0) continue;
      sum += this.cosine(i, j);
      count += 1;
    }
    return count === 0 ? 0 : clampCosine(sum / count);
  }

  /** First frame whose start is at or after `ms`, on the hop grid anchored at the first chunk. */
  private frameAtOrAfter(ms: number): number {
    const origin = this.originMs ?? 0;
    // The epsilon keeps an exact multiple from rounding up to the next frame.
    return Math.ceil((ms - origin) / this.msPerFrame - 1e-9);
  }

  /**
   * Frame cosines at one lag (0 where either side is silent), then the highest mean over a contiguous `blockFrames`
   * window. Prefix sums keep this O(frames) per lag; the raw per-frame values stay in scratch for the extension.
   */
  private scanLag(lagFrames: number, blockFrames: number): { bestMean: number; bestStart: number } {
    const comparable = this.frameCount - lagFrames;
    this.ensureScratch(this.frameCount + 1);
    const { sims, defined, prefixSum, prefixCount } = this;

    for (let i = 0; i < comparable; i += 1) {
      const j = i + lagFrames;
      const usable = this.valid[i] !== 0 && this.valid[j] !== 0;
      defined[i] = usable ? 1 : 0;
      sims[i] = usable ? this.cosine(i, j) : 0;
    }
    prefixSum[0] = 0;
    prefixCount[0] = 0;
    for (let i = 0; i < comparable; i += 1) {
      prefixSum[i + 1] = prefixSum[i] + sims[i];
      prefixCount[i + 1] = prefixCount[i] + defined[i];
    }

    let bestMean = -Infinity;
    let bestStart = -1;
    for (let start = 0; start + blockFrames <= comparable; start += 1) {
      if (prefixCount[start + blockFrames] - prefixCount[start] < blockFrames) continue;
      const mean = (prefixSum[start + blockFrames] - prefixSum[start]) / blockFrames;
      // Strictly (and clearly) greater keeps the earliest window, so two identical occurrences of the same phrase
      // report the earlier one and the block start is deterministic.
      if (mean > bestMean + TIE_TOLERANCE) {
        bestMean = mean;
        bestStart = start;
      }
    }
    // No window with a full block of comparable audio: this lag scores 0 and cannot win.
    return bestStart < 0 ? { bestMean: 0, bestStart: -1 } : { bestMean, bestStart };
  }

  private ensureScratch(size: number): void {
    if (this.sims.length >= size) return;
    this.sims = new Float64Array(size);
    this.defined = new Uint8Array(size);
    this.prefixSum = new Float64Array(size);
    this.prefixCount = new Int32Array(size);
  }

  /** Dot product of two stored rows. Both are unit length or zero, so this is their cosine. */
  private cosine(i: number, j: number): number {
    const a = i * BAND_COUNT;
    const b = j * BAND_COUNT;
    let sum = 0;
    for (let band = 0; band < BAND_COUNT; band += 1) sum += this.features[a + band] * this.features[b + band];
    return sum;
  }

  private emitFrame(): void {
    const frame = this.frame;
    let energy = 0;
    for (let i = 0; i < this.frameSamples; i += 1) energy += frame[i] * frame[i];
    const rms = Math.sqrt(energy / this.frameSamples);

    this.ensureCapacity(this.frameCount + 1);
    const offset = this.frameCount * BAND_COUNT;

    if (rms < this.silenceRms) {
      // Keep the slot (the hop grid is what the lag search counts in) but make it incomparable.
      this.features.fill(0, offset, offset + BAND_COUNT);
      this.valid[this.frameCount] = 0;
      this.frameCount += 1;
      return;
    }

    for (let i = 0; i < this.frameSamples; i += 1) this.windowed[i] = frame[i] * this.window[i];

    let mean = 0;
    const scale = this.frameSamples * this.frameSamples;
    for (let band = 0; band < BAND_COUNT; band += 1) {
      const power = goertzelPower(this.windowed, this.coefficients[band]);
      const value = Math.log(power / scale + LOG_POWER_FLOOR);
      this.features[offset + band] = value;
      mean += value;
    }
    mean /= BAND_COUNT;

    let normSquared = 0;
    for (let band = 0; band < BAND_COUNT; band += 1) {
      const value = this.features[offset + band] - mean;
      this.features[offset + band] = value;
      normSquared += value * value;
    }
    const norm = Math.sqrt(normSquared);
    if (!(norm > 1e-6)) {
      // A perfectly flat spectrum (or a denormal frame): no shape to compare, so treat it like silence.
      this.features.fill(0, offset, offset + BAND_COUNT);
      this.valid[this.frameCount] = 0;
      this.frameCount += 1;
      return;
    }
    for (let band = 0; band < BAND_COUNT; band += 1) this.features[offset + band] /= norm;
    this.valid[this.frameCount] = 1;
    this.frameCount += 1;
  }

  private ensureCapacity(needed: number): void {
    if (needed * BAND_COUNT <= this.features.length) return;
    let capacity = Math.max(256, this.features.length / BAND_COUNT);
    while (capacity < needed) capacity *= 2;
    const features = new Float32Array(capacity * BAND_COUNT);
    features.set(this.features);
    this.features = features;
    const valid = new Uint8Array(capacity);
    valid.set(this.valid);
    this.valid = valid;
  }
}

/** Log-spaced band centres between BAND_LOW_HZ and BAND_HIGH_HZ, kept below Nyquist. */
function bandCoefficients(sampleRate: number): Float64Array {
  const highest = Math.min(BAND_HIGH_HZ, sampleRate * 0.45);
  const lowest = Math.min(BAND_LOW_HZ, highest / 2);
  const coefficients = new Float64Array(BAND_COUNT);
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const position = band / (BAND_COUNT - 1);
    const hz = lowest * Math.pow(highest / lowest, position);
    coefficients[band] = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  }
  return coefficients;
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

/**
 * Power of one frequency in a windowed frame, by the Goertzel recurrence. One multiply-add per sample per band
 * instead of an FFT, and the recurrence state is two floats - no allocation inside the streaming loop.
 */
function goertzelPower(samples: Float64Array, coefficient: number): number {
  let previous = 0;
  let older = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i] + coefficient * previous - older;
    older = previous;
    previous = current;
  }
  return previous * previous + older * older - coefficient * previous * older;
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

function clampCosine(value: number): number {
  if (value < -1) return -1;
  return value > 1 ? 1 : value;
}

// ---------------------------------------------------------------- transfer

export interface RepeatTransferOptions {
  /** Two words closer than this are the same moment; default 1000 ms. */
  collisionMs?: number;
  /** Confidence given to a copied word; default 0.2 (below the editor's 0.6 "uncertain" line). */
  confidence?: number;
  /** Do not copy a word whose local audio similarity is below this; default 0.63 (measured mix, see the constant). */
  minSimilarity?: number;
  /** Similarity probe, normally tracker.similarityAt. REQUIRED: without audio evidence nothing is copied. */
  similarityAt?: (startMs: number, endMs: number, lagMs: number) => number;
}

/** Confidence of a copied word: well below the editor's 0.6 "uncertain" line, so it is always shown as a guess. */
const DEFAULT_TRANSFER_CONFIDENCE = 0.2;
const DEFAULT_COLLISION_MS = 1000;
const DEFAULT_TRANSFER_MIN_SIMILARITY = 0.63;

/**
 * Song mode only. Copies words from a decoded occurrence to an empty twin at +lagMs.
 * Rules: only when the twin has NO word overlapping [start+lag, end+lag] within collisionMs; only when the local
 * similarity probe says the audio at [start,end] really matches its twin (REQUIRED: no probe, no copy); the copy keeps
 * the same duration, gets `confidence` and `inferred: true`; results are sorted by time and re-indexed 0..n.
 * Never copies a word that would land beyond `durationMs` when that is given.
 */
export function transferRepeatedWords(
  words: readonly Word[],
  match: RepeatMatch,
  options: RepeatTransferOptions & { durationMs?: number } = {},
): { words: Word[]; inferred: number } {
  const collisionMs = options.collisionMs ?? DEFAULT_COLLISION_MS;
  const confidence = options.confidence ?? DEFAULT_TRANSFER_CONFIDENCE;
  const minSimilarity = options.minSimilarity ?? DEFAULT_TRANSFER_MIN_SIMILARITY;
  const probe = options.similarityAt;
  const durationMs = options.durationMs;
  const lagMs = match.lagMs;

  // New objects throughout: the caller's words are readonly and must not be re-indexed in place.
  const out: Word[] = words.map((word) => ({ ...word }));
  let inferred = 0;

  for (const source of words) {
    const startMs = source.startMs + lagMs;
    const endMs = source.endMs + lagMs;
    // A word past the end of the file cannot be shown, and a zero/negative-length target is not a word.
    if (durationMs !== undefined && endMs > durationMs) continue;
    if (endMs <= startMs) continue;

    const collides = words.some(
      (other) =>
        other !== source && other.startMs < endMs + collisionMs && other.endMs > startMs - collisionMs,
    );
    if (collides) continue;

    // The per-word audio evidence is the gate, not the best 8 s block from `find()`. The measured Sajan repeat is
    // 47.2-80.85 s <-> 80.85-113.7 s, but the most self-similar 8 s sits near the end of that block, so restricting the
    // copy to it dropped exactly the decoded words at 47.6-59.3 s that O3 exists to recover. A word from a verse whose
    // audio does not actually match its twin fails this probe (unrelated blocks measured 0.27 against 0.66-0.77 for the
    // real repeat), so the evidence stays local and per word.
    if (!probe || probe(source.startMs, source.endMs, lagMs) < minSimilarity) continue;

    out.push({
      text: source.text,
      startMs,
      endMs,
      confidence,
      index: 0,
      windowIndex: source.windowIndex,
      inferred: true,
    });
    inferred += 1;
  }

  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || compareText(a.text, b.text));
  for (let i = 0; i < out.length; i += 1) out[i].index = i;
  return { words: out, inferred };
}

/** Locale-independent tie-break, so the same input always produces the same order. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Grow a repeated block outward while the audio still matches its twin, so the caller learns the whole
 * repeated passage (Sajan's chorus, not just its most self-similar 8 s). Pure over `similarityAt`; used by
 * the lyric planner to fit a repeated lyric block to the audio that actually repeats.
 *
 * `match.blockStartMs`/`blockEndMs` is the seed (the best 8 s window `find()` reported). Each step compares
 * a `probeMs` slice against the same slice shifted by the lag; the walk stops at the first slice below
 * `minSimilarity` (a different lyric over the same backing, a drop-out, a section boundary).
 */
export function measureRepeatExtent(
  tracker: Pick<RepeatTracker, "similarityAt">,
  match: Pick<RepeatMatch, "lagMs" | "blockStartMs" | "blockEndMs">,
  options: { probeMs?: number; stepMs?: number; minSimilarity?: number; durationMs?: number } = {},
): { startMs: number; endMs: number; lagMs: number } {
  const probeMs = Number.isFinite(options.probeMs) && (options.probeMs as number) > 0 ? (options.probeMs as number) : 500;
  const stepMs = Number.isFinite(options.stepMs) && (options.stepMs as number) > 0 ? (options.stepMs as number) : 250;
  const minSimilarity = Number.isFinite(options.minSimilarity) ? (options.minSimilarity as number) : 0.6;
  const lag = match.lagMs;
  let start = Math.max(0, match.blockStartMs);
  let end = Math.max(start + probeMs, Math.min(options.durationMs ?? Number.POSITIVE_INFINITY, match.blockEndMs));
  const agrees = (at: number): boolean => at >= 0 && tracker.similarityAt(at, Math.min(at + probeMs, end), lag) >= minSimilarity;
  // Backwards: [t, t + probeMs] must match its twin.
  let guard = 0;
  while (start - stepMs >= 0 && guard < 400) {
    const at = start - stepMs;
    if (tracker.similarityAt(at, at + probeMs, lag) < minSimilarity) break;
    start = at;
    guard += 1;
  }
  // Forwards: the last probeMs slice ending at `end` must match its twin.
  guard = 0;
  while (end + stepMs <= (options.durationMs ?? Number.POSITIVE_INFINITY) && guard < 400) {
    const at = end + stepMs - probeMs;
    if (tracker.similarityAt(at, at + probeMs, lag) < minSimilarity) break;
    end += stepMs;
    guard += 1;
  }
  if (!agrees(start)) {
    // The seed itself must agree; otherwise the extent is the seed alone (never invent one).
    return { startMs: match.blockStartMs, endMs: match.blockEndMs, lagMs: lag };
  }
  return { startMs: Math.round(start), endMs: Math.round(end), lagMs: lag };
}
