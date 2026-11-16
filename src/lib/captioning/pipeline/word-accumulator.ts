import { mergeWindowWords } from "../overlap-merge";
import type { WindowWords } from "../overlap-merge";
import type { Word } from "../types";

/**
 * Builds the merged transcript one window at a time.
 *
 * `mergeWindowWords` looks at every window on every call, which is fine once but quadratic when it
 * is repeated after each of hundreds of windows to feed the "first captions early" preview. Windows
 * only ever interact with windows whose video coverage overlaps theirs (the pieces of one long split
 * region). So windows are grouped into runs of overlapping coverage, each run is merged on its own,
 * and a run that a later window can no longer touch is never merged again.
 */
interface Run {
  endMs: number;
  windows: WindowWords[];
  merged: Word[];
}

export class WordAccumulator {
  private runs: Run[] = [];

  /** Adds one window's words (global time). Windows must arrive in order of coverage start. */
  add(window: WindowWords): void {
    if (!(window.coverage.endMs > window.coverage.startMs)) return;
    const last = this.runs[this.runs.length - 1];
    if (last && window.coverage.startMs < last.endMs) {
      last.windows.push(window);
      last.endMs = Math.max(last.endMs, window.coverage.endMs);
      last.merged = mergeWindowWords(last.windows);
    } else {
      this.runs.push({ endMs: window.coverage.endMs, windows: [window], merged: mergeWindowWords([window]) });
    }
  }

  /** The whole transcript so far, in order, with `index` running 0.. across the lot. Always equals `mergeWindowWords` on every window added. */
  words(): Word[] {
    return this.collect(null);
  }

  /**
   * The part of the transcript that no window added LATER can still change, for live previews.
   *
   * Why this exists: adding a window to an open run re-decides who owns the seam where the two
   * windows overlap, so a word near the end of the newest window may be re-timed or swapped for the
   * next window's copy. `words()` is therefore only final once the last window is in. A preview built
   * from `words()` would visibly move a caption the viewer already read.
   *
   * What is held back: in the newest run only, every word that ends within `guardMs` of the end of
   * that run's coverage (a later window of the same run starts at most the split overlap before that
   * end, and merging looks a little further, `seamSlackMs`, round the seam). Words of earlier runs are
   * never touched again, so they are all returned. The result is an exact prefix of `words()`, and
   * of every later `settledWords()`, as long as windows really do start within `guardMs` of the
   * previous window's end. With `guardMs` of 0 or less nothing is held back.
   */
  settledWords(guardMs: number): Word[] {
    return this.collect(guardMs > 0 ? guardMs : null);
  }

  private collect(guardMs: number | null): Word[] {
    // Two runs never overlap in coverage, but a word's own times can sit on the shared edge: trim
    // so the transcript is strictly ordered, and drop a word that trimming would leave empty.
    const out: Word[] = [];
    this.runs.forEach((run, runIndex) => {
      const limit = guardMs !== null && runIndex === this.runs.length - 1 ? run.endMs - guardMs : Number.POSITIVE_INFINITY;
      for (const word of run.merged) {
        // Stop at the first word that is too close to the open end, so what is returned is a prefix.
        if (word.endMs > limit) break;
        const previous = out[out.length - 1];
        const startMs = previous ? Math.max(word.startMs, previous.endMs) : word.startMs;
        if (word.endMs <= startMs) continue;
        out.push({ ...word, startMs, index: out.length });
      }
    });
    return out;
  }
}
