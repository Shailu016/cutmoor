/**
 * Turns decoded audio blocks (any rate, already mono, each with a timestamp) into the 16 kHz
 * `PcmChunk`s of about one second that the rest of the pipeline wants.
 *
 * This is where the timeline is kept honest. Containers are messy: audio can start at a negative
 * time (an edit list that skips encoder priming), start late (the video begins first), have small
 * holes, or have blocks that overlap by a few samples. The rules:
 *  - Anything before time 0 is dropped (a chunk's startMs is never negative).
 *  - Audio that starts late keeps its true startMs; we do not pad the front with silence.
 *  - A hole of up to MAX_FILL_GAP_S is filled with silence so the stream stays continuous and
 *    later words do not slide earlier. A longer hole starts a fresh chunk at its true time.
 *  - Overlapping samples are trimmed so chunks never overlap.
 * Only the resampler's small history and one unfinished chunk are held in memory.
 */

import type { PcmChunk } from "../contracts";
import { SAMPLE_RATE } from "../contracts";
import { StreamingResampler } from "./resampler";

export const CHUNK_SAMPLES = SAMPLE_RATE; // one second
/** Timestamps within this many seconds of seamless are treated as seamless (codec rounding noise). */
export const GAP_TOLERANCE_S = 0.02;
/** Holes up to this long are filled with silence. */
export const MAX_FILL_GAP_S = 2;

export class PcmStreamBuilder {
  private readonly inputRate: number;
  private resampler: StreamingResampler;
  /** Where (in 16 kHz samples since the video start) the current resampler's output sample 0 sits. */
  private segmentStart = 0;
  /** Seconds at which the next input block is expected if the stream is seamless. null before the first block. */
  private expectedNext: number | null = null;
  /** Samples waiting to fill the next chunk. */
  private buffer = new Float32Array(CHUNK_SAMPLES);
  private buffered = 0;
  /** Absolute 16 kHz sample position of buffer[0]. */
  private bufferStart = 0;

  constructor(inputRate: number) {
    this.inputRate = inputRate;
    this.resampler = new StreamingResampler(inputRate);
  }

  /** Adds one decoded mono block whose first frame is at `timestampSeconds` on the video timeline. */
  push(mono: Float32Array, timestampSeconds: number): PcmChunk[] {
    const chunks: PcmChunk[] = [];
    if (mono.length === 0 || !Number.isFinite(timestampSeconds)) return chunks;
    let block = mono;
    let timestamp = timestampSeconds;

    // Drop the part before time 0.
    if (timestamp < 0) {
      const drop = Math.round(-timestamp * this.inputRate);
      if (drop >= block.length) {
        return chunks; // entirely before the start of the video
      }
      block = block.subarray(drop);
      timestamp = 0;
    }

    if (this.expectedNext === null) {
      this.startSegment(timestamp);
    } else {
      const delta = timestamp - this.expectedNext;
      if (delta > GAP_TOLERANCE_S) {
        if (delta <= MAX_FILL_GAP_S) {
          this.feed(new Float32Array(Math.round(delta * this.inputRate)), chunks);
        } else {
          this.endSegment(chunks, true);
          this.startSegment(timestamp);
        }
      } else if (delta < -GAP_TOLERANCE_S) {
        const drop = Math.round(-delta * this.inputRate);
        if (drop >= block.length) return chunks; // entirely a repeat of audio we already have
        block = block.subarray(drop);
        timestamp += drop / this.inputRate;
      }
    }
    this.feed(block, chunks);
    this.expectedNext = timestamp + block.length / this.inputRate;
    return chunks;
  }

  /** Ends the stream and returns the final partial chunk, if any. */
  flush(): PcmChunk[] {
    const chunks: PcmChunk[] = [];
    if (this.expectedNext !== null) this.endSegment(chunks, false);
    return chunks;
  }

  private startSegment(timestampSeconds: number): void {
    this.segmentStart = Math.round(timestampSeconds * SAMPLE_RATE);
    this.resampler.reset();
    this.bufferStart = this.segmentStart;
    this.buffered = 0;
    this.expectedNext = timestampSeconds;
  }

  private endSegment(chunks: PcmChunk[], restart: boolean): void {
    this.collect(this.resampler.flush(), chunks);
    this.emit(chunks, true);
    if (restart) this.expectedNext = null;
  }

  private feed(block: Float32Array, chunks: PcmChunk[]): void {
    this.collect(this.resampler.process(block), chunks);
  }

  private collect(samples: Float32Array, chunks: PcmChunk[]): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(CHUNK_SAMPLES - this.buffered, samples.length - offset);
      this.buffer.set(samples.subarray(offset, offset + take), this.buffered);
      this.buffered += take;
      offset += take;
      if (this.buffered === CHUNK_SAMPLES) this.emit(chunks, false);
    }
  }

  private emit(chunks: PcmChunk[], partialAllowed: boolean): void {
    if (this.buffered === 0 || (this.buffered < CHUNK_SAMPLES && !partialAllowed)) return;
    chunks.push({
      startMs: Math.round((this.bufferStart * 1000) / SAMPLE_RATE),
      samples: this.buffer.slice(0, this.buffered),
    });
    this.bufferStart += this.buffered;
    this.buffered = 0;
  }
}
