import { SAMPLE_RATE } from "../contracts";
import type { PcmChunk } from "../contracts";

/**
 * Holds only the audio the pipeline has not finished with yet.
 *
 * A two-hour video is 460 MB of 16 kHz Float32; the pipeline must never hold all of it. Chunks go in
 * as they are decoded, whole windows are cut out of them on demand, and `discardBefore` lets go of
 * everything older than the first speech still waiting to be transcribed.
 *
 * Positions are kept in SAMPLES (16 per millisecond), so cutting a region out never rounds.
 */

const SAMPLES_PER_MS = SAMPLE_RATE / 1000;

interface StoredChunk {
  /** First sample of the chunk, counted from the start of the source. */
  startSample: number;
  samples: Float32Array;
}

export class PcmStore {
  private chunks: StoredChunk[] = [];
  private totalSamples = 0;
  private endSample = 0;

  /** Milliseconds of audio currently held. */
  get retainedMs(): number {
    return this.totalSamples / SAMPLES_PER_MS;
  }

  /** The end of the newest audio, in ms from the start of the source. */
  get endMs(): number {
    return this.endSample / SAMPLES_PER_MS;
  }

  /**
   * Stores a copy of the chunk. A copy, because a decoder is free to reuse its output buffer for
   * the next chunk, which would silently rewrite audio we still need.
   */
  push(chunk: PcmChunk): void {
    if (chunk.samples.length === 0) return;
    const startSample = Math.max(0, Math.round(chunk.startMs * SAMPLES_PER_MS));
    this.chunks.push({ startSample, samples: chunk.samples.slice() });
    this.totalSamples += chunk.samples.length;
    this.endSample = Math.max(this.endSample, startSample + chunk.samples.length);
  }

  /**
   * Returns `[startMs, endMs)` as a new array. Stretches that were never stored, or were already
   * discarded, come back as silence, so a caller asking slightly past the end of the file still
   * gets the length it asked for.
   */
  read(startMs: number, endMs: number): Float32Array {
    const from = Math.round(startMs * SAMPLES_PER_MS);
    const to = Math.round(endMs * SAMPLES_PER_MS);
    const out = new Float32Array(Math.max(0, to - from));
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.startSample + chunk.samples.length;
      if (chunkEnd <= from) continue;
      if (chunk.startSample >= to) break;
      const copyFrom = Math.max(from, chunk.startSample);
      const copyTo = Math.min(to, chunkEnd);
      out.set(chunk.samples.subarray(copyFrom - chunk.startSample, copyTo - chunk.startSample), copyFrom - from);
    }
    return out;
  }

  /** Lets go of every chunk that ends at or before `ms`. A chunk straddling `ms` is kept whole. */
  discardBefore(ms: number): void {
    const limit = Math.floor(ms * SAMPLES_PER_MS);
    let drop = 0;
    while (drop < this.chunks.length && this.chunks[drop].startSample + this.chunks[drop].samples.length <= limit) {
      this.totalSamples -= this.chunks[drop].samples.length;
      drop += 1;
    }
    if (drop > 0) this.chunks = this.chunks.slice(drop);
  }

  clear(): void {
    this.chunks = [];
    this.totalSamples = 0;
    this.endSample = 0;
  }
}
