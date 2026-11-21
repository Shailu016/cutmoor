import type { CaptionEvent, Word } from "./types";

/**
 * Turns a transcript into caption events: each event is one screenful of words, already broken
 * into lines. All times here are global integer milliseconds (see types.ts).
 *
 * Three decisions that keep this module predictable:
 *
 *  - Events are grown greedily from the next unplaced word. Adding a word may break a limit, so the
 *    longest prefix that respects duration, characters-per-second and line count wins. Greedy is
 *    fine for a single ordered transcript: a dynamic program over whole events would only help if
 *    events could be reordered, which would scramble the words.
 *
 *  - Lines inside an event use a Knuth-Plass-style dynamic program. It minimises the total squared
 *    slack over all lines instead of filling each line to the brim, which is what makes two lines
 *    come out balanced rather than "long line + orphan". The DP is over the words of one event
 *    only (tens, not thousands), uses no heap, and cannot loop on an over-long word: a word wider
 *    than the line budget simply owns a line. That is the only kind of overflow it tolerates while
 *    a legal layout exists; a line that overflows with 2+ words is treated as a failure, not as a
 *    trade-off.
 *
 *  - `preferredBreakBefore` carries the line starts of a pasted transcript (the visitor's own line
 *    breaks). They are PREFERENCES, never hard breaks: a caption may end at such an index only
 *    when that end is already legal (duration, characters per line, line count and the strict
 *    reading-speed limit `maxCps`) and keeps at least `MIN_BLOCK_WORDS` words. In addition, the
 *    words left after the break must still be layoutable by the ordinary breaker without any
 *    caption below `MIN_BLOCK_WORDS` or faster than `maxCps`, so a preference cannot manufacture a
 *    one-word tail or a fast caption that the old layout did not have. To keep the cost bounded,
 *    the preferred end may pull the caption end earlier by at most `PREFERRED_BREAK_SLACK_WORDS`
 *    words (a small documented cost: the words that move to the next caption). A preferred break
 *    never extends a caption and never overrides a limit, so reading speed and the character/line
 *    rules still win. Without the option the layout is byte-for-byte the old layout.
 */

export interface LayoutOptions {
  maxCharsPerLine?: number;
  maxLines?: number;
  maxCps?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  /**
   * Hard upper bound on words in one caption, 1 or more. Absent (or not finite) means no word
   * limit, which is the old layout exactly. Used by the visitor's "words per caption" choice;
   * the layout still applies every other limit, so a value only ever shortens a caption.
   */
  maxWordsPerCaption?: number;
  /**
   * Word indices (into the `words` array passed to `layoutCaptions`) where a pasted lyric line
   * starts, i.e. the break the visitor asked for. Values are usually sorted but any order,
   * duplicates and out-of-range/non-integer entries are tolerated and ignored. A value that cannot
   * satisfy every limit is simply not used.
   */
  preferredBreakBefore?: readonly number[];
}

const DEFAULTS = {
  maxCharsPerLine: 42,
  maxLines: 2,
  maxCps: 17,
  minDurationMs: 1000,
  maxDurationMs: 6000,
} as const;

interface Limits {
  maxCharsPerLine: number;
  maxLines: number;
  maxCps: number;
  minDurationMs: number;
  maxDurationMs: number;
  /** Infinity when the caller did not ask for a word limit. */
  maxWordsPerCaption: number;
}

function pick(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Clamps callers into a sane range. A zero/negative width would make every line overflow and a
 * huge line budget would make the DP allocate forever, so both ends are capped.
 */
function resolveOptions(options?: LayoutOptions): Limits {
  const maxWords =
    typeof options?.maxWordsPerCaption === "number" && Number.isFinite(options.maxWordsPerCaption)
      ? Math.max(1, Math.floor(options.maxWordsPerCaption))
      : Number.POSITIVE_INFINITY;
  return {
    maxCharsPerLine: Math.min(1_000_000, Math.max(1, Math.floor(pick(options?.maxCharsPerLine, DEFAULTS.maxCharsPerLine)))),
    maxLines: Math.min(100, Math.max(1, Math.floor(pick(options?.maxLines, DEFAULTS.maxLines)))),
    maxCps: Math.max(0.001, pick(options?.maxCps, DEFAULTS.maxCps)),
    minDurationMs: Math.max(0, Math.floor(pick(options?.minDurationMs, DEFAULTS.minDurationMs))),
    maxDurationMs: Math.max(1, Math.floor(pick(options?.maxDurationMs, DEFAULTS.maxDurationMs))),
    maxWordsPerCaption: maxWords,
  };
}

/** The two overflow tariffs used by the line breaker; see `lineCost`. */
interface OverflowCosts {
  /** Flat cost of a line whose single word is itself wider than the budget. Unavoidable. */
  singleWord: number;
  /** Cost of any other overflowing line. Must dominate every layout without one. */
  multiWord: number;
}

/**
 * Cost of one line.
 *
 * Legal lines pay the squared slack, so narrower lines cost more and the DP prefers a balanced
 * split. A line holding a single over-long word cannot be avoided by any arrangement, so it pays a
 * flat constant that does not depend on how badly it overflows; charging slack there is what used
 * to make the DP absorb neighbours into the long word's line. Any other overflowing line is a
 * layout failure rather than a trade-off, so it costs more than the worst layout made only of
 * legal lines and unavoidable single-word overflows, and the DP picks it only when nothing else
 * covers the event.
 */
function lineCost(width: number, wordCount: number, maxChars: number, overflow: OverflowCosts): number {
  const slack = maxChars - width;
  if (slack >= 0) return slack * slack;
  return wordCount === 1 ? overflow.singleWord : overflow.multiWord;
}

/** Line widths count one space between words, because that is what the reader sees. */
function lineWidth(prefix: readonly number[], from: number, to: number): number {
  return prefix[to] - prefix[from] + (to - from - 1);
}

/**
 * Breaks one event's words into at most `maxLines` lines, minimising total squared slack.
 * Returns slices of the input words in order; concatenating the result restores the input exactly.
 */
function breakLines(words: readonly Word[], maxChars: number, maxLines: number): Word[][] {
  const n = words.length;
  if (n === 0) return [];

  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + words[i].text.length;

  const lineSlots = Math.min(maxLines, n);

  // Every event holds the same set of over-long words whichever way it is broken, so the flat cost
  // cancels out of every comparison. 0 is therefore as good as any other value.
  const singleWordOverflowCost = 0;
  // A layout with no multi-word overflow has at most `lineSlots` lines and each costs at most
  // `maxChars^2` (legal) or `singleWordOverflowCost`. One more than that total guarantees that such
  // a layout always beats any layout containing a multi-word overflow.
  const overflow: OverflowCosts = {
    singleWord: singleWordOverflowCost,
    multiWord: lineSlots * (maxChars * maxChars + singleWordOverflowCost) + 1,
  };

  // dp[l][i] = best cost for the first i words in exactly l lines; from[l][i] = where line l starts.
  const dp: number[][] = [];
  const from: number[][] = [];
  for (let l = 0; l <= lineSlots; l += 1) {
    dp.push(new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY));
    from.push(new Array<number>(n + 1).fill(-1));
  }
  dp[0][0] = 0;

  for (let l = 1; l <= lineSlots; l += 1) {
    for (let i = l; i <= n; i += 1) {
      let best = Number.POSITIVE_INFINITY;
      let bestStart = -1;
      for (let j = l - 1; j < i; j += 1) {
        const previous = dp[l - 1][j];
        if (previous === Number.POSITIVE_INFINITY) continue;
        const total = previous + lineCost(lineWidth(prefix, j, i), i - j, maxChars, overflow);
        if (total < best) {
          best = total;
          bestStart = j;
        }
      }
      dp[l][i] = best;
      from[l][i] = bestStart;
    }
  }

  // Prefer fewer lines on a tie (earlier l wins because the comparison is strict).
  let chosenLines = 1;
  let chosenCost = Number.POSITIVE_INFINITY;
  for (let l = 1; l <= lineSlots; l += 1) {
    if (dp[l][n] < chosenCost) {
      chosenCost = dp[l][n];
      chosenLines = l;
    }
  }

  const lines: Word[][] = [];
  let cursor = n;
  for (let l = chosenLines; l >= 1; l -= 1) {
    const start = from[l][cursor] >= 0 ? from[l][cursor] : l - 1;
    lines.push(words.slice(start, cursor));
    cursor = start;
  }
  lines.reverse();
  return lines;
}

/**
 * Reading speed is a preference, not a rule that may shatter a caption. Real speech is often faster than 17 characters a second
 * (fast Hindi is 25 and more), and with word times from the model a strict limit leaves one word per caption, which flickers
 * and cannot be read. So a block may run up to `SOFT_CPS_FACTOR` times the preferred speed when the preferred speed would leave
 * fewer than `MIN_BLOCK_WORDS` words.
 */
const SOFT_CPS_FACTOR = 2;
const MIN_BLOCK_WORDS = 3;
/**
 * How many words a preferred (pasted line) break may take away from the caption the existing
 * breaker would otherwise choose. This is the whole "cost" of honouring a line break: the trimmed
 * words simply start the next caption, so a caption is at most this many words shorter than it
 * would have been. Zero would mean a preference only applies when the break already wins, which
 * pasted line starts almost never do because they do not know the reading-speed budget.
 */
const PREFERRED_BREAK_SLACK_WORDS = 2;
/** Ends a sentence or a clause: a good place to break a caption. */
const SENTENCE_END = /[.?!।]["')\]]*$/;
/** Reused for the no-preference simulations, so they do not allocate a set per call. */
const EMPTY_PREFERRED_BREAKS: ReadonlySet<number> = new Set<number>();

/**
 * Collects the usable preferred-break indices. Break 0 and break `total` are no-ops (a caption
 * cannot be empty and the last break is the end of the transcript), and anything that is not an
 * integer inside the transcript is ignored rather than throwing.
 */
function preferredBreakSet(indices: readonly number[] | undefined, total: number): ReadonlySet<number> {
  const set = new Set<number>();
  if (!indices) return set;
  for (const value of indices) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < total) set.add(value);
  }
  return set;
}

/** Reading speed of one block, measured exactly like `chooseBlockEnd` measures it. */
function blockCps(words: readonly Word[], from: number, to: number): number {
  if (to <= from) return Number.POSITIVE_INFINITY;
  let chars = to - from - 1;
  for (let i = from; i < to; i += 1) chars += words[i].text.length;
  const span = words[to - 1].endMs - words[from].startMs;
  return span > 0 ? (chars * 1000) / span : Number.POSITIVE_INFINITY;
}

/**
 * True when `words` from `start` can still be laid out by the ordinary (no-preference) breaker
 * without any caption holding fewer than `MIN_BLOCK_WORDS` words or reading faster than `maxCps`.
 *
 * This is the guard that stops a preferred break from moving the words it leaves behind into
 * captions the old breaker would never have produced (a one-word tail, or a fast caption created
 * only because its start moved). The result depends only on `start`, so it is memoised across the
 * whole transcript. `chooseBlockEnd` with an empty preference set is the exact old breaker, which
 * keeps "no option == old layout" true by construction.
 */
function remainderFits(
  words: readonly Word[],
  start: number,
  limits: Limits,
  memo: Map<number, boolean>,
): boolean {
  const starts: number[] = [];
  let cursor = start;
  let ok: boolean;
  for (;;) {
    if (cursor >= words.length) {
      ok = true;
      break;
    }
    const cached = memo.get(cursor);
    if (cached !== undefined) {
      ok = cached;
      break;
    }
    starts.push(cursor);
    const end = chooseBlockEnd(words, cursor, limits, EMPTY_PREFERRED_BREAKS, memo);
    if (end <= cursor) return false;
    cursor = end;
  }
  // `cursor` is the start of the already-checked suffix; walk the simulated blocks backwards.
  for (let k = starts.length - 1; k >= 0; k -= 1) {
    const blockStart = starts[k];
    ok = ok && cursor - blockStart >= MIN_BLOCK_WORDS && blockCps(words, blockStart, cursor) <= limits.maxCps;
    memo.set(blockStart, ok);
    cursor = blockStart;
  }
  return ok;
}

/**
 * Picks the exclusive end of the next event. The scan stops as soon as a hard limit is crossed:
 * duration and the greedy line count only grow with more words, so no later prefix can recover.
 * Characters-per-second can recover (a long pause lowers it), so a failing CPS test does not stop
 * the scan; it only withholds the "best end" mark. A word limit (`maxWordsPerCaption`) bounds the
 * scan too, so every event it returns holds at most that many words; the other limits still apply.
 *
 * Among the allowed ends: the longest one at the preferred reading speed wins; if that leaves fewer than three words, the longest one at
 * the soft (double) speed is used instead. Then, when the block would end mid-sentence but a sentence ended inside it after at
 * least three words (or half of them, if fewer), the caption ends at that sentence end, so a caption does not start a new sentence only to cut it.
 *
 * Finally, when the caller supplied preferred breaks, an allowed preferred end may pull the chosen end earlier (never later) by at
 * most `PREFERRED_BREAK_SLACK_WORDS` words, as long as the caption keeps `MIN_BLOCK_WORDS` words AND the words left behind still
 * pass `remainderFits` (no short/fast caption created by the move). "Allowed" means the end already passed the structural limits
 * (chars/lines/duration) and the strict reading speed `maxCps`, so a preference can never create an illegal, fast or one-word
 * caption. Empty preference sets skip this step entirely, which keeps the old behaviour exact.
 */
function chooseBlockEnd(
  words: readonly Word[],
  from: number,
  limits: Limits,
  preferredBreaks: ReadonlySet<number>,
  remainderMemo: Map<number, boolean>,
): number {
  const total = words.length;
  const firstStart = words[from].startMs;
  let chars = 0;
  let currentLineWidth = 0;
  let linesUsed = 1;
  let preferredEnd = from + 1; // a single word is always allowed, even if it breaks every limit
  let softEnd = from + 1;
  const sentenceEnds: number[] = [];
  // Only needed for preferred breaks: ends that are within every hard limit and the strict speed.
  const allowed = preferredBreaks.size > 0 ? new Uint8Array(total - from + 1) : undefined;
  const scanEnd = Math.min(total, from + limits.maxWordsPerCaption);

  for (let to = from + 1; to <= scanEnd; to += 1) {
    const word = words[to - 1];
    const separator = to - 1 > from ? 1 : 0;
    const addition = word.text.length + separator;

    // Mirror greedy line packing. Greedy gives the minimum possible line count for ordered words,
    // which is exactly the feasibility test the balanced breaker needs.
    if (separator > 0 && currentLineWidth + addition > limits.maxCharsPerLine) {
      linesUsed += 1;
      currentLineWidth = word.text.length;
    } else {
      currentLineWidth += addition;
    }
    if (linesUsed > limits.maxLines) break;

    chars += addition;
    const duration = word.endMs - firstStart;
    if (duration > limits.maxDurationMs) break;

    const cps = duration > 0 ? (chars * 1000) / duration : Number.POSITIVE_INFINITY;
    if (cps <= limits.maxCps) {
      preferredEnd = to;
      // Preferences use the strict reading speed, not the 2x fallback the old breaker keeps for
      // captions that would otherwise hold fewer than MIN_BLOCK_WORDS words.
      if (allowed) allowed[to - from] = 1;
    }
    if (cps <= limits.maxCps * SOFT_CPS_FACTOR) {
      softEnd = to;
      if (SENTENCE_END.test(word.text)) sentenceEnds.push(to);
    }
  }

  let end = preferredEnd - from >= MIN_BLOCK_WORDS ? preferredEnd : Math.max(preferredEnd, softEnd);
  if (!SENTENCE_END.test(words[end - 1].text)) {
    // Break at the last sentence end inside this block, if it keeps at least three words (or half of a short block).
    for (let k = sentenceEnds.length - 1; k >= 0; k -= 1) {
      const candidate = sentenceEnds[k];
      if (candidate < end && candidate - from >= Math.max(2, Math.min(MIN_BLOCK_WORDS, Math.ceil((end - from) / 2)))) {
        end = candidate;
        break;
      }
    }
  }

  if (allowed) {
    // Latest preferred break that is still legal, keeps the minimum word count, costs at most the
    // documented slack, and leaves a remainder the ordinary breaker can still read safely.
    const floor = Math.max(from + MIN_BLOCK_WORDS, end - PREFERRED_BREAK_SLACK_WORDS);
    for (let candidate = end - 1; candidate >= floor; candidate -= 1) {
      if (allowed[candidate - from] !== 1 || !preferredBreaks.has(candidate)) continue;
      if (!remainderFits(words, candidate, limits, remainderMemo)) continue;
      end = candidate;
      break;
    }
  }
  return end;
}

/**
 * Lays out a transcript. The hard invariant is that
 * `events.flatMap((event) => event.lines.flat())` equals the input, in order, word for word.
 * With `maxWordsPerCaption` set, no event holds more words than that; every other limit and the
 * word times are untouched.
 *
 * Event times: startMs is always the first word's start. endMs is the last word's end, extended
 * up to `minDurationMs` so a one-word caption does not flash (never past the next event's start);
 * with `minDurationMs: 0` the times are exactly first/last word times. Degenerate words with
 * `endMs <= startMs` still produce a positive-length cue.
 */
export function layoutCaptions(words: Word[], options?: LayoutOptions): CaptionEvent[] {
  if (words.length === 0) return [];
  const limits = resolveOptions(options);
  const preferredBreaks = preferredBreakSet(options?.preferredBreakBefore, words.length);
  const remainderMemo = new Map<number, boolean>();
  const events: CaptionEvent[] = [];
  let from = 0;
  let previousEnd = Number.NEGATIVE_INFINITY;

  while (from < words.length) {
    const to = chooseBlockEnd(words, from, limits, preferredBreaks, remainderMemo);
    const first = words[from];
    const last = words[to - 1];
    let startMs = Math.round(first.startMs);
    // Only degenerate input (several words at the very same instant) can reach back into the previous caption; start after it, so two
    // captions never overlap.
    if (startMs < previousEnd) startMs = previousEnd;
    let endMs = Math.round(last.endMs);
    if (endMs < startMs) endMs = startMs;

    const nextStart = to < words.length ? Math.round(words[to].startMs) : Number.POSITIVE_INFINITY;
    if (endMs - startMs < limits.minDurationMs) {
      const target = startMs + Math.min(limits.minDurationMs, limits.maxDurationMs);
      endMs = Math.max(endMs, Math.min(target, nextStart));
    }
    if (endMs <= startMs) endMs = startMs + 1;
    previousEnd = endMs;

    events.push({
      index: events.length,
      startMs,
      endMs,
      lines: breakLines(words.slice(from, to), limits.maxCharsPerLine, limits.maxLines),
    });
    from = to;
  }

  return events;
}
