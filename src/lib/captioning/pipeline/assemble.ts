import { SAMPLE_RATE } from "../contracts";
import type { WindowAudio } from "../contracts";
import type { PackedWindow } from "../types";

/** Anything that can hand back a stretch of the source audio by time. `PcmStore` is one. */
export interface PcmSource {
  /** Returns exactly `(endMs - startMs) * 16` samples; silence where there is no audio. */
  read(startMs: number, endMs: number): Float32Array;
}

const SAMPLES_PER_MS = SAMPLE_RATE / 1000;

/**
 * Builds the model input for one packed window: every speech region copied to its `packOffsetMs`,
 * silence (zeros) in the gaps between regions and in the padding at the end, always exactly
 * `lengthMs` of audio. This is the mirror image of `toGlobalMs`: whatever sits at window-local time
 * `t` here is what the model "hears" at `t`, so the two must agree on every offset.
 *
 * A region that would run past the end of the window (a packer bug, or a hand-built window) is cut
 * to fit rather than written out of bounds.
 */
export function assembleWindowAudio(window: PackedWindow, pcm: PcmSource): WindowAudio {
  const total = Math.round(window.lengthMs * SAMPLES_PER_MS);
  const samples = new Float32Array(total);
  for (const region of window.regions) {
    const at = Math.round(region.packOffsetMs * SAMPLES_PER_MS);
    const length = Math.round((region.sourceEndMs - region.sourceStartMs) * SAMPLES_PER_MS);
    if (length <= 0 || at >= total || at < 0) continue;
    const piece = pcm.read(region.sourceStartMs, region.sourceEndMs);
    samples.set(piece.subarray(0, Math.min(length, total - at)), at);
  }
  return { window, samples };
}
