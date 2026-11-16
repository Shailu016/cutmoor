import { normalizeIntervals, packSpeech } from "../packer";
import type { PackOptions } from "../packer";
import type { PackedWindow, SpeechInterval } from "../types";

/**
 * Packs speech into windows while the voice detector is still running, so the first window can go
 * to the model before the end of the file has been read.
 *
 * The rule that keeps it identical to packing everything at once (`packSpeech`): a window is handed
 * out only when no later speech can still change it. Later speech can change the tail only:
 *  - a new interval within 300 ms of the last one is MERGED into it, so the last region may grow;
 *  - a grown region that was a single piece may now need splitting, which changes the last window;
 *  - a long split region's second-to-last piece has its cut nudged by the length of the last piece.
 * So the last window is always held back, and the last two when the last one is a continuation of a
 * split region (it starts before the previous window ends). Everything before them is final.
 *
 * What stays pending is trimmed to start where the first held window starts. For a split region that
 * means the pending region becomes "the rest of it", which re-splits exactly as the original did,
 * because each cut depends only on where its piece starts. Without this, a long unbroken stretch of
 * speech would keep every window waiting until the speaker paused.
 */
export class StreamingPacker {
  private pending: SpeechInterval[] = [];
  private emitted = 0;
  /** Nothing before this has been given away; late stragglers that start earlier are clipped. */
  private floorMs = 0;

  constructor(private readonly options: PackOptions = {}) {}

  /** Adds speech intervals the detector has closed (global ms, in any order). */
  add(intervals: readonly SpeechInterval[]): void {
    const clipped = intervals
      .map((item) => ({ startMs: Math.max(item.startMs, this.floorMs), endMs: item.endMs }))
      .filter((item) => item.endMs > item.startMs);
    if (clipped.length === 0) return;
    this.pending = normalizeIntervals([...this.pending, ...clipped], this.options.mergeBelowMs);
  }

  /** Where the earliest speech not yet handed out starts, or null when nothing is waiting. */
  get firstPendingStartMs(): number | null {
    return this.pending.length > 0 ? this.pending[0].startMs : null;
  }

  /** Windows handed out so far. */
  get windowsEmitted(): number {
    return this.emitted;
  }

  /** How many windows the speech waiting right now would make (an estimate until the audio ends). */
  get pendingWindowCount(): number {
    return this.pending.length === 0 ? 0 : packSpeech(this.pending, this.options).length;
  }

  /**
   * Returns the windows that are now final, with their global indexes. Pass `final: true` once the
   * detector has been flushed: then everything left is handed out.
   */
  take(final: boolean): PackedWindow[] {
    if (this.pending.length === 0) return [];
    const windows = packSpeech(this.pending, this.options);
    let keep: number;
    if (final) {
      keep = windows.length;
    } else {
      const last = windows[windows.length - 1];
      const before = windows[windows.length - 2];
      const lastIsContinuation = before !== undefined && last.regions[0].sourceStartMs <= before.regions[before.regions.length - 1].sourceEndMs;
      keep = windows.length - (lastIsContinuation ? 2 : 1);
    }
    if (keep <= 0) return [];

    const out = windows.slice(0, keep).map((window) => ({ ...window, index: window.index + this.emitted }));
    this.emitted += keep;
    if (keep === windows.length) {
      this.pending = [];
    } else {
      const start = windows[keep].regions[0].sourceStartMs;
      this.floorMs = start;
      this.pending = this.pending.filter((item) => item.endMs > start).map((item) => ({ startMs: Math.max(item.startMs, start), endMs: item.endMs }));
    }
    return out;
  }
}
