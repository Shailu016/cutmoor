/**
 * Turns one speech probability per audio frame into closed speech intervals. Pure: no audio, no model,
 * no clock, so it can be tested exhaustively with made-up probability sequences.
 *
 * The rules, in the order they apply (the tests hold a plain batch version of the same rules and
 * check the streaming version against it for random chunkings):
 *  1. Hysteresis. A stretch of speech starts at the first frame at or above `startThreshold` and
 *     goes on while frames stay at or above `endThreshold`. It ends once `minSilenceMs` of frames in a
 *     row fall below `endThreshold`; it then covers up to the end of its last speech frame.
 *     Two thresholds stop a voice hovering around one number from flickering on and off.
 *  2. A stretch shorter than `minSpeechMs` is a click or a cough: dropped.
 *  3. Each survivor grows by `padMs` on both sides (consonants at word edges score low and would be
 *     clipped otherwise). The start never goes before the first audio.
 *  4. Padded stretches closer than `mergeGapMs` become one interval.
 *  5. An interval longer than `maxIntervalMs` is cut. The cut goes at the lowest-probability frame in
 *     the stretch from (max - 1 s) to (max - 250 ms) after the piece starts: the quietest place just
 *     before the limit, so a word is not sliced in half. The window stops 250 ms short of the limit so
 *     the piece that is left over is never a sliver. Cutting repeats on what is left.
 *
 * Streaming: an interval is handed out only when no later audio can change it. Rule 4 means that is
 * `mergeGapMs + 2 * padMs` after its last speech frame (700 ms by default). The one exception is rule 5:
 * a piece that is certainly going to be cut is handed out as soon as the audio proves the interval runs
 * past the limit, so an hour of non-stop talking does not wait until the end to produce its first piece.
 */

import type { SpeechInterval } from "../types";

export interface SegmenterOptions {
  /** Length of one probability frame. Silero v5 at 16 kHz: 512 samples = 32 ms. */
  frameMs: number;
  startThreshold: number;
  endThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  padMs: number;
  mergeGapMs: number;
  maxIntervalMs: number;
}

export const DEFAULT_SEGMENTER_OPTIONS: Readonly<SegmenterOptions> = {
  frameMs: 32,
  startThreshold: 0.5,
  endThreshold: 0.35,
  minSpeechMs: 250,
  minSilenceMs: 300,
  padMs: 200,
  mergeGapMs: 300,
  maxIntervalMs: 30_000,
};

/** How far before the length limit the cut search starts and stops (see rule 5). */
export const CUT_SEARCH_FROM_BEFORE_LIMIT_MS = 1000;
export const CUT_SEARCH_TO_BEFORE_LIMIT_MS = 250;

export function resolveSegmenterOptions(partial: Partial<SegmenterOptions> = {}): SegmenterOptions {
  const o = { ...DEFAULT_SEGMENTER_OPTIONS, ...partial };
  const positive = [o.frameMs, o.minSpeechMs, o.minSilenceMs, o.mergeGapMs, o.maxIntervalMs];
  const bad =
    !positive.every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(o.padMs) ||
    o.padMs < 0 ||
    !(o.startThreshold > 0 && o.startThreshold <= 1) ||
    !(o.endThreshold > 0 && o.endThreshold <= o.startThreshold) ||
    o.maxIntervalMs < 5000;
  if (bad) throw new Error("Segmenter options are out of range.");
  return o;
}

interface Chain {
  /** Start of the piece that has not been handed out yet. */
  pieceStartMs: number;
  /** Where that piece will be cut if the interval turns out to be longer than the limit. */
  cutMs: number | null;
}

export class SpeechSegmenter {
  private readonly o: SegmenterOptions;
  private readonly minSilenceFrames: number;
  /** Two stretches whose RAW gap (before padding) is at least this far apart never merge. */
  private readonly mergeRawGapMs: number;

  private originMs: number | null = null;
  private frames = 0;

  private triggered = false;
  private openStartF = 0;
  private lastActiveF = 0;
  private silenceRun = 0;

  /** The interval being built from closed stretches. It can still grow until the merge window runs out. */
  private pending: { rawEndMs: number } | null = null;
  private chain: Chain | null = null;
  /** Probabilities of the frames from `histBaseFrame` on, kept only while a cut might need them. */
  private hist: number[] = [];
  private histBaseFrame = 0;

  private out: SpeechInterval[] = [];

  constructor(options: Partial<SegmenterOptions> = {}) {
    this.o = resolveSegmenterOptions(options);
    this.minSilenceFrames = Math.ceil(this.o.minSilenceMs / this.o.frameMs);
    this.mergeRawGapMs = this.o.mergeGapMs + 2 * this.o.padMs;
  }

  /** How many probabilities are being held for a possible cut. Bounded by about one maximum interval; tests check it. */
  get retainedFrames(): number {
    return this.hist.length;
  }

  /** Frames consumed so far. */
  get framesSeen(): number {
    return this.frames;
  }

  reset(): void {
    this.originMs = null;
    this.frames = 0;
    this.triggered = false;
    this.openStartF = 0;
    this.lastActiveF = 0;
    this.silenceRun = 0;
    this.pending = null;
    this.chain = null;
    this.hist = [];
    this.histBaseFrame = 0;
    this.out = [];
  }

  /**
   * Feeds the next probabilities, in order. `firstFrameStartMs` is the global time of the very first
   * frame and is only read on the first call after a reset. Returns the intervals that are now final.
   */
  push(probabilities: ArrayLike<number>, firstFrameStartMs = 0): SpeechInterval[] {
    if (this.originMs === null) this.originMs = firstFrameStartMs;
    for (let i = 0; i < probabilities.length; i++) this.step(probabilities[i]!);
    return this.take();
  }

  /**
   * Ends the audio: closes an open stretch and hands out everything still waiting. `audioEndMs` is the
   * true end of the audio (the last frame may be padded past it); it limits the final padding.
   * The segmenter is reset afterwards, ready for another file.
   */
  flush(audioEndMs?: number): SpeechInterval[] {
    if (this.originMs === null) return [];
    const audioEnd = audioEndMs ?? this.originMs + this.frames * this.o.frameMs;
    if (this.triggered) {
      this.closeStretch(this.lastActiveF + 1);
      this.triggered = false;
    }
    if (this.pending) this.finalize(audioEnd);
    const result = this.take();
    this.reset();
    return result;
  }

  // ------------------------------------------------------------------ the state machine

  private frameStart(frame: number): number {
    return (this.originMs as number) + frame * this.o.frameMs;
  }

  private step(p: number): void {
    const f = this.frames++;
    // NaN would fail every comparison below and quietly mean "silence"; treat a broken value as silence on purpose.
    const prob = Number.isFinite(p) ? p : 0;

    if (!this.triggered) {
      if (prob >= this.o.startThreshold) this.openStretch(f);
    } else if (prob >= this.o.endThreshold) {
      this.lastActiveF = f;
      this.silenceRun = 0;
    } else if (++this.silenceRun >= this.minSilenceFrames) {
      this.closeStretch(this.lastActiveF + 1);
      this.triggered = false;
    }

    if (this.chain) this.hist.push(prob);

    // Nothing that starts from the next frame on can merge any more: the interval is final.
    if (!this.triggered && this.pending && this.frameStart(f + 1) - this.pending.rawEndMs >= this.mergeRawGapMs) {
      this.finalize(null);
    }
    if (this.chain) this.drain(null);
  }

  private openStretch(f: number): void {
    const startMs = this.frameStart(f);
    if (this.pending && startMs - this.pending.rawEndMs >= this.mergeRawGapMs) this.finalize(null);
    this.triggered = true;
    this.openStartF = f;
    this.lastActiveF = f;
    this.silenceRun = 0;
    if (!this.chain) {
      this.chain = { pieceStartMs: Math.max(this.originMs as number, startMs - this.o.padMs), cutMs: null };
      this.hist = [];
      this.histBaseFrame = f;
    }
  }

  /** `endFrame` is exclusive: the stretch covers frames openStartF .. endFrame - 1. */
  private closeStretch(endFrame: number): void {
    const startMs = this.frameStart(this.openStartF);
    const endMs = this.frameStart(endFrame);
    if (endMs - startMs < this.o.minSpeechMs) {
      if (!this.pending) {
        this.chain = null;
        this.hist = [];
      }
      return;
    }
    this.pending = { rawEndMs: endMs };
  }

  // ------------------------------------------------------------------ handing intervals out

  /**
   * A time the pending interval is certain to reach, or null when nothing is certain yet. Used to decide
   * that an interval will exceed the length limit before it has finished.
   */
  private certainEndMs(): number | null {
    const known: number[] = [];
    if (this.pending) known.push(this.pending.rawEndMs + this.o.padMs);
    if (this.triggered) {
      const endMs = this.frameStart(this.lastActiveF + 1);
      // A stretch that is already long enough cannot be dropped later, so its end counts.
      if (endMs - this.frameStart(this.openStartF) >= this.o.minSpeechMs) known.push(endMs + this.o.padMs);
    }
    if (known.length === 0) return null;
    // The last frame may be only partly real audio, so trust audio up to the one before it.
    const audioSure = this.frameStart(this.frames - 1);
    return Math.min(audioSure, Math.max(...known));
  }

  /** Lowest-probability frame in the cut window of a piece starting at `pieceStartMs`; null if not all of it has arrived. */
  private findCut(pieceStartMs: number): number | null {
    const { frameMs, maxIntervalMs } = this.o;
    const origin = this.originMs as number;
    const from = Math.ceil((pieceStartMs + maxIntervalMs - CUT_SEARCH_FROM_BEFORE_LIMIT_MS - origin) / frameMs);
    const to = Math.ceil((pieceStartMs + maxIntervalMs - CUT_SEARCH_TO_BEFORE_LIMIT_MS - origin) / frameMs);
    if (this.frames < to) return null;
    let best = from;
    let bestP = Infinity;
    for (let i = from; i < to; i++) {
      const p = this.hist[i - this.histBaseFrame]!;
      if (p < bestP) {
        bestP = p;
        best = i;
      }
    }
    return origin + best * frameMs;
  }

  /**
   * Hands out the leading pieces of the interval that are certain to be cut off. With `finalEndMs` the
   * interval's end is known exactly; without it only a lower bound is.
   */
  private drain(finalEndMs: number | null): void {
    const chain = this.chain as Chain;
    for (;;) {
      const bound = finalEndMs ?? this.certainEndMs();
      if (bound === null || bound <= chain.pieceStartMs + this.o.maxIntervalMs) return;
      if (chain.cutMs === null) {
        chain.cutMs = this.findCut(chain.pieceStartMs);
        if (chain.cutMs === null) return;
      }
      this.out.push({ startMs: chain.pieceStartMs, endMs: chain.cutMs });
      chain.pieceStartMs = chain.cutMs;
      chain.cutMs = null;
      // Frames before the next cut window are no longer needed.
      const keepFrom = Math.ceil(
        (chain.pieceStartMs + this.o.maxIntervalMs - CUT_SEARCH_FROM_BEFORE_LIMIT_MS - (this.originMs as number)) / this.o.frameMs,
      );
      const drop = Math.min(Math.max(0, keepFrom - this.histBaseFrame), this.hist.length);
      if (drop > 0) {
        this.hist.splice(0, drop);
        this.histBaseFrame += drop;
      }
    }
  }

  private finalize(audioEndMs: number | null): void {
    const pending = this.pending as { rawEndMs: number };
    const chain = this.chain as Chain;
    let endMs = pending.rawEndMs + this.o.padMs;
    if (audioEndMs !== null) endMs = Math.min(endMs, audioEndMs);
    this.drain(endMs);
    this.out.push({ startMs: chain.pieceStartMs, endMs });
    this.pending = null;
    this.chain = null;
    this.hist = [];
  }

  private take(): SpeechInterval[] {
    const result = this.out;
    this.out = [];
    return result;
  }
}
