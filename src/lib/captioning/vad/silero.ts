/**
 * Voice activity detection with Silero VAD v5 (ONNX, 16 kHz). Implements `VoiceDetector` from contracts.ts.
 *
 * How the model is fed (this is the part that is easy to get subtly wrong):
 *  - Audio is cut into frames of 512 samples (32 ms). The model never sees more than one frame at a time.
 *  - Each call gets `input` of shape [1, 576]: the LAST 64 SAMPLES OF THE PREVIOUS FRAME followed by the
 *    512 new ones. Without that context the first samples of each frame sit on a hard edge and scores drift.
 *  - `state` [2, 1, 128] is the network's memory. It starts as zeros and each call returns the next one
 *    as `stateN`, which must be passed into the following call.
 *  - `sr` is the sample rate as an int64 scalar (16000).
 *  - The result `output` [1, 1] is the probability that this frame is speech.
 *
 * Chunks from the audio reader have arbitrary sizes, so a partial frame waits in a small buffer until the
 * next chunk completes it. Times stay in global milliseconds: frame k is at origin + k * 32 ms, where origin
 * is the start time of the first chunk.
 *
 * Nothing in this file touches the network. The model bytes are handed in by the caller.
 */

import { CaptionError, SAMPLE_RATE, type PcmChunk, type VoiceDetector } from "../contracts";
import type { SpeechInterval } from "../types";
import { createOrtSession, type OrtRuntime } from "./ort-session";
import { SpeechSegmenter, type SegmenterOptions } from "./segmenter";
import type { InferenceSessionLike, VadTensor } from "./session";

export const SILERO_FRAME_SAMPLES = 512;
export const SILERO_CONTEXT_SAMPLES = 64;
const STATE_SIZE = 2 * 1 * 128;
const FRAME_MS = (SILERO_FRAME_SAMPLES * 1000) / SAMPLE_RATE; // 32

export interface SileroOptions {
  /** Overrides for the thresholds and timings in segmenter.ts. Rarely needed. */
  segmenter?: Partial<SegmenterOptions>;
}

export interface CreateSileroVadArgs extends SileroOptions {
  /** The Silero VAD v5 `.onnx` file's bytes, already downloaded and verified by the caller. */
  model: Uint8Array;
  /** The `onnxruntime-web` module (passed in so this file never imports it, and tests can skip it). */
  ort: OrtRuntime;
}

export async function createSileroVad(args: CreateSileroVadArgs): Promise<VoiceDetector> {
  const session = await createOrtSession(args.ort, args.model);
  return createSileroVadFromSession(session, { segmenter: args.segmenter });
}

/** Same detector around any session; this is what the tests drive with a fake. */
export function createSileroVadFromSession(session: InferenceSessionLike, options: SileroOptions = {}): VoiceDetector {
  return new SileroVoiceDetector(session, new SpeechSegmenter({ frameMs: FRAME_MS, ...options.segmenter }));
}

function abortedError(): CaptionError {
  return new CaptionError("aborted", "Voice detection was cancelled.");
}

class SileroVoiceDetector implements VoiceDetector {
  private state = new Float32Array(STATE_SIZE);
  private readonly context = new Float32Array(SILERO_CONTEXT_SAMPLES);
  private readonly partial = new Float32Array(SILERO_FRAME_SAMPLES);
  private partialLength = 0;

  private originMs: number | null = null;
  /** Samples placed on the frame grid so far, including any silence inserted for a gap in the input. */
  private gridSamples = 0;

  /** Bumped by reset/release so a call still running when that happens quietly stops instead of writing into a fresh state. */
  private epoch = 0;
  private released = false;
  /** push and flush run one at a time, in call order, even if the caller forgets to await. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly session: InferenceSessionLike,
    private readonly segmenter: SpeechSegmenter,
  ) {}

  push(chunk: PcmChunk, signal?: AbortSignal): Promise<SpeechInterval[]> {
    // Stamp the request with the epoch it was made in: a reset() before it starts makes it stale.
    const epoch = this.epoch;
    return this.enqueue(() => (epoch === this.epoch ? this.doPush(chunk, signal) : Promise.resolve([])));
  }

  flush(): Promise<SpeechInterval[]> {
    const epoch = this.epoch;
    return this.enqueue(() => (epoch === this.epoch ? this.doFlush() : Promise.resolve([])));
  }

  reset(): void {
    this.epoch++;
    this.clearState();
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.epoch++;
    this.clearState();
    await this.session.release();
  }

  // ------------------------------------------------------------------

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private clearState(): void {
    this.state = new Float32Array(STATE_SIZE);
    this.context.fill(0);
    this.partialLength = 0;
    this.originMs = null;
    this.gridSamples = 0;
    this.segmenter.reset();
  }

  private assertUsable(signal?: AbortSignal): void {
    if (this.released) throw new CaptionError("internal", "The voice detector was already released.");
    if (signal?.aborted) throw abortedError();
  }

  private async doPush(chunk: PcmChunk, signal?: AbortSignal): Promise<SpeechInterval[]> {
    this.assertUsable(signal);
    const epoch = this.epoch;
    const probabilities: number[] = [];

    try {
      if (this.originMs === null) {
        this.originMs = chunk.startMs;
        this.gridSamples = 0;
      }
      let samples = chunk.samples;

      // Contract: chunks are contiguous. If the reader dropped or repeated a little audio anyway, keep the
      // timeline honest instead of letting every later time drift: fill a gap with silence, skip a repeat.
      const expectedMs = this.originMs + (this.gridSamples + this.partialLength) / (SAMPLE_RATE / 1000);
      const driftMs = chunk.startMs - expectedMs;
      if (driftMs <= -FRAME_MS / 2) {
        const skip = Math.min(samples.length, Math.round((-driftMs * SAMPLE_RATE) / 1000));
        samples = samples.subarray(skip);
      } else if (driftMs >= FRAME_MS / 2) {
        if (this.partialLength > 0) {
          this.partial.fill(0, this.partialLength);
          probabilities.push(await this.inferFrame(this.partial, signal));
          if (epoch !== this.epoch) return [];
          this.gridSamples += SILERO_FRAME_SAMPLES;
          this.partialLength = 0;
        }
        const gapMs = chunk.startMs - (this.originMs + this.gridSamples / (SAMPLE_RATE / 1000));
        const gapFrames = Math.round(gapMs / FRAME_MS);
        if (gapFrames > 0) {
          // Silence needs no model call; it only has to count as silence and forget the old context.
          for (let i = 0; i < gapFrames; i++) probabilities.push(0);
          this.gridSamples += gapFrames * SILERO_FRAME_SAMPLES;
          this.state = new Float32Array(STATE_SIZE);
          this.context.fill(0);
        }
      }

      let pos = 0;
      while (pos < samples.length) {
        const take = Math.min(SILERO_FRAME_SAMPLES - this.partialLength, samples.length - pos);
        let frame: Float32Array;
        if (this.partialLength === 0 && take === SILERO_FRAME_SAMPLES) {
          frame = samples.subarray(pos, pos + take); // whole frame straight from the chunk, no copy
        } else {
          this.partial.set(samples.subarray(pos, pos + take), this.partialLength);
          this.partialLength += take;
          if (this.partialLength < SILERO_FRAME_SAMPLES) {
            pos += take;
            break;
          }
          frame = this.partial;
        }
        pos += take;
        probabilities.push(await this.inferFrame(frame, signal));
        if (epoch !== this.epoch) return [];
        this.gridSamples += SILERO_FRAME_SAMPLES;
        this.partialLength = 0;
      }

      return this.segmenter.push(probabilities, this.originMs);
    } catch (error) {
      // Whatever went wrong, do not leave a half-fed state behind: the next push starts a clean file.
      if (epoch === this.epoch) this.reset();
      throw error;
    }
  }

  private async doFlush(): Promise<SpeechInterval[]> {
    this.assertUsable();
    const epoch = this.epoch;
    if (this.originMs === null) return [];
    try {
      const probabilities: number[] = [];
      let realSamples = this.gridSamples;
      if (this.partialLength > 0) {
        // The last frame is part audio, part zeros. Score it so speech right at the end is not lost.
        realSamples += this.partialLength;
        this.partial.fill(0, this.partialLength);
        probabilities.push(await this.inferFrame(this.partial, undefined));
        if (epoch !== this.epoch) return [];
      }
      const origin = this.originMs;
      const audioEndMs = origin + Math.round((realSamples * 1000) / SAMPLE_RATE);
      const closedByLastFrame = this.segmenter.push(probabilities, origin);
      const intervals = [...closedByLastFrame, ...this.segmenter.flush(audioEndMs)];
      this.clearState();
      return intervals;
    } catch (error) {
      if (epoch === this.epoch) this.reset();
      throw error;
    }
  }

  /** One model call for one 512-sample frame. Returns the speech probability. */
  private async inferFrame(frame: Float32Array, signal: AbortSignal | undefined): Promise<number> {
    if (signal?.aborted) throw abortedError();
    const input = new Float32Array(SILERO_CONTEXT_SAMPLES + SILERO_FRAME_SAMPLES);
    input.set(this.context, 0);
    input.set(frame, SILERO_CONTEXT_SAMPLES);

    const feeds: Record<string, VadTensor> = {
      input: { type: "float32", data: input, dims: [1, input.length] },
      state: { type: "float32", data: this.state, dims: [2, 1, 128] },
      sr: { type: "int64", data: BigInt64Array.of(BigInt(SAMPLE_RATE)), dims: [] },
    };

    const epoch = this.epoch;
    let outputs: Record<string, VadTensor>;
    try {
      outputs = await this.session.run(feeds);
    } catch (cause) {
      if (cause instanceof CaptionError) throw cause;
      throw new CaptionError("inference", "The voice detection model failed on a piece of audio.", { cause });
    }

    const probability = outputs.output?.data[0];
    const nextState = outputs.stateN?.data;
    if (typeof probability !== "number" || !Number.isFinite(probability) || !(nextState instanceof Float32Array) || nextState.length !== STATE_SIZE) {
      throw new CaptionError("inference", "The voice detection model returned something unexpected.");
    }
    // A reset() while the model was running made this answer stale: leave the fresh state and context alone.
    // The caller notices the epoch change and drops the result.
    if (epoch !== this.epoch) return probability;
    // Keep our own copy: the runtime may reuse or free its output buffer.
    this.state = Float32Array.from(nextState);
    this.context.set(frame.subarray(SILERO_FRAME_SAMPLES - SILERO_CONTEXT_SAMPLES));
    return probability;
  }
}
