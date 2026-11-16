/**
 * Alignment math for the captioning pipeline: pure arrays in, pure arrays out.
 *
 * `ctcForcedAlign` recovers where each decoder token sat inside a packed window.
 * It is a Viterbi pass over the standard CTC state graph (blank, token, blank, ...),
 * not a greedy argmax, because greedy alignment drifts badly on long repeated sounds.
 *
 * `spansToWords` is the only function here that knows about milliseconds. The aligner
 * stays in frames so a hop-size change cannot silently move a timestamp.
 *
 * `bandedDtw` is a pure-array fallback for models that expose per-frame costs instead
 * of CTC log-probabilities. The band keeps the usual 1500-frame table small.
 */

import type { Word } from "./types";

/** One token's occupancy of the model frames. `endFrame` is exclusive. */
export interface TokenSpan {
  startFrame: number;
  endFrame: number;
  /**
   * Mean log-probability per frame over the frames assigned to this token.
   * `Math.exp(score)` is therefore a per-token confidence, and the mean of several
   * token scores is a geometric mean of those confidences.
   */
  score: number;
}

export interface SpansToWordsOptions {
  /** Duration of one model frame in milliseconds. */
  frameMs: number;
  /** Packed window that produced these words. */
  windowIndex: number;
  /** Real content length of the window; no word may be emitted past this. */
  usedMs: number;
}

const NEG_INFINITY = Number.NEGATIVE_INFINITY;
const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * CTC forced alignment (Viterbi).
 *
 * `logProbs` is T frames x V classes of log-probabilities. `tokens` are non-blank
 * class ids in transcript order. One span is returned per token, in token order.
 *
 * The extended state sequence is blank, token0, blank, token1, ..., tokenN-1, blank.
 * Moving two states forward is only legal when it jumps over a blank between two
 * different labels, which is what forces a blank between repeated tokens.
 */
export function ctcForcedAlign(
  logProbs: number[][],
  tokens: number[],
  blankId: number,
): TokenSpan[] {
  if (tokens.length === 0) return [];

  // The minimum is known before the matrix shape, which lets the zero-frame error
  // explain how many frames were actually needed.
  let minimumFrames = tokens.length;
  for (let index = 1; index < tokens.length; index++) {
    if (tokens[index] === tokens[index - 1]) minimumFrames++;
  }

  const frames = logProbs.length;
  if (frames === 0) {
    throw new Error(
      `ctcForcedAlign: impossible to align ${tokens.length} token(s) in 0 frame(s); at least ${minimumFrames} frame(s) are needed (a blank frame is required between repeated tokens)`,
    );
  }

  const classes = logProbs[0].length;
  if (classes === 0) {
    throw new Error("ctcForcedAlign: logProbs must contain at least one class per frame");
  }

  for (let frame = 0; frame < frames; frame++) {
    const row = logProbs[frame];
    if (row.length !== classes) {
      throw new Error(
        `ctcForcedAlign: logProbs must be rectangular; frame ${frame} has ${row.length} classes, expected ${classes}`,
      );
    }
    for (let cls = 0; cls < classes; cls++) {
      const value = row[cls];
      // -Infinity is a legitimate "impossible emission"; NaN and +Infinity are not
      // log-probabilities and would poison the Viterbi comparisons.
      if (!Number.isFinite(value) && value !== NEG_INFINITY) {
        throw new Error(
          `ctcForcedAlign: logProbs[${frame}][${cls}] must be finite or -Infinity`,
        );
      }
    }
  }

  if (!Number.isInteger(blankId) || blankId < 0 || blankId >= classes) {
    throw new Error(
      `ctcForcedAlign: blankId must be an integer in [0, ${classes}), got ${blankId}`,
    );
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!Number.isInteger(token) || token < 0 || token >= classes) {
      throw new Error(
        `ctcForcedAlign: token ${token} at position ${index} is not a class id in [0, ${classes})`,
      );
    }
    if (token === blankId) {
      throw new Error(
        `ctcForcedAlign: token at position ${index} equals blankId ${blankId}; tokens must be non-blank classes`,
      );
    }
  }

  if (frames < minimumFrames) {
    throw new Error(
      `ctcForcedAlign: impossible to align ${tokens.length} token(s) in ${frames} frame(s); at least ${minimumFrames} frame(s) are needed (a blank frame is required between repeated tokens)`,
    );
  }

  const labelCount = tokens.length;
  const stateCount = labelCount * 2 + 1;

  let previous = new Float64Array(stateCount).fill(NEG_INFINITY);
  previous[0] = logProbs[0][blankId];
  previous[1] = logProbs[0][tokens[0]];

  // back[t][s] says how state s at frame t was reached: 0 = stay, 1 = from s-1,
  // 2 = from s-2 across a blank. Keeping the pointers is what lets us recover spans.
  const backpointers: Uint8Array[] = [new Uint8Array(stateCount)];

  for (let frame = 1; frame < frames; frame++) {
    const emissions = logProbs[frame];
    const current = new Float64Array(stateCount).fill(NEG_INFINITY);
    const pointer = new Uint8Array(stateCount);

    for (let state = 0; state < stateCount; state++) {
      let best = previous[state];
      let move = 0;

      if (state > 0 && previous[state - 1] > best) {
        best = previous[state - 1];
        move = 1;
      }

      if (state >= 3 && state % 2 === 1) {
        const label = (state - 1) / 2;
        // Skipping the blank between two equal labels would collapse them into one
        // emitted token, so only differing neighbours may take the +2 transition.
        if (tokens[label] !== tokens[label - 1] && previous[state - 2] > best) {
          best = previous[state - 2];
          move = 2;
        }
      }

      if (best !== NEG_INFINITY) {
        const cls = state % 2 === 0 ? blankId : tokens[(state - 1) / 2];
        current[state] = best + emissions[cls];
        pointer[state] = move;
      }
    }

    backpointers.push(pointer);
    previous = current;
  }

  const finalBlank = stateCount - 1;
  const finalLabel = stateCount - 2;
  let endState = finalBlank;
  let bestTotal = previous[finalBlank];
  if (previous[finalLabel] > bestTotal) {
    bestTotal = previous[finalLabel];
    endState = finalLabel;
  }

  if (bestTotal === NEG_INFINITY) {
    throw new Error(
      "ctcForcedAlign: no CTC path has non-zero probability; every alignment of the given tokens hits a -Infinity log-probability",
    );
  }

  const statePath = new Int32Array(frames);
  let state = endState;
  for (let frame = frames - 1; frame >= 0; frame--) {
    statePath[frame] = state;
    if (frame > 0) {
      const move = backpointers[frame][state];
      if (move === 1) state -= 1;
      else if (move === 2) state -= 2;
    }
  }

  if (statePath[0] !== 0 && statePath[0] !== 1) {
    throw new Error("ctcForcedAlign: internal error, backtracked to an invalid start state");
  }

  const spans: TokenSpan[] = [];
  let frame = 0;
  while (frame < frames) {
    const extendedState = statePath[frame];
    if (extendedState % 2 === 0) {
      frame++;
      continue;
    }

    const label = (extendedState - 1) / 2;
    if (label !== spans.length) {
      throw new Error(
        "ctcForcedAlign: internal error, backtracked path does not contain one run per token in order",
      );
    }

    const classId = tokens[label];
    const startFrame = frame;
    let endFrame = frame;
    let sum = 0;
    while (endFrame < frames && statePath[endFrame] === extendedState) {
      sum += logProbs[endFrame][classId];
      endFrame++;
    }

    spans.push({
      startFrame,
      endFrame,
      score: sum / (endFrame - startFrame),
    });
    frame = endFrame;
  }

  if (spans.length !== labelCount) {
    throw new Error(
      `ctcForcedAlign: internal error, recovered ${spans.length} spans for ${labelCount} token(s)`,
    );
  }

  return spans;
}

/**
 * Convert frame spans to the frozen `Word` contract.
 *
 * A word starts at the first token's start and ends at the last token's end. Times are
 * window-local integer milliseconds. Words that begin in window padding are dropped,
 * and any remaining end is clamped to `usedMs`; this is the packer contract, and it is
 * also what stops a hallucinated tail from leaking into the transcript.
 */
export function spansToWords(
  texts: string[],
  tokenSpans: TokenSpan[][],
  opts: SpansToWordsOptions,
): Word[] {
  if (texts.length !== tokenSpans.length) {
    throw new Error(
      `spansToWords: expected one token-span list per word, got ${texts.length} text(s) and ${tokenSpans.length} list(s)`,
    );
  }
  if (!Number.isFinite(opts.frameMs) || opts.frameMs <= 0) {
    throw new Error("spansToWords: frameMs must be a finite number greater than 0");
  }
  if (!Number.isInteger(opts.usedMs) || opts.usedMs < 0) {
    throw new Error("spansToWords: usedMs must be a non-negative integer");
  }
  if (!Number.isInteger(opts.windowIndex) || opts.windowIndex < 0) {
    throw new Error("spansToWords: windowIndex must be a non-negative integer");
  }

  const words: Word[] = [];

  for (let wordIndex = 0; wordIndex < texts.length; wordIndex++) {
    const spans = tokenSpans[wordIndex];
    if (spans.length === 0) {
      throw new Error(
        `spansToWords: word ${wordIndex} ("${texts[wordIndex]}") has no token spans`,
      );
    }

    let scoreSum = 0;
    let previousEndFrame = 0;

    for (let spanIndex = 0; spanIndex < spans.length; spanIndex++) {
      const span = spans[spanIndex];

      if (
        !Number.isInteger(span.startFrame) ||
        !Number.isInteger(span.endFrame) ||
        span.startFrame < 0 ||
        span.endFrame < span.startFrame
      ) {
        throw new Error(
          `spansToWords: word ${wordIndex} span ${spanIndex} has invalid frames [${span.startFrame}, ${span.endFrame})`,
        );
      }
      if (span.startFrame < previousEndFrame) {
        throw new Error(
          `spansToWords: word ${wordIndex} span ${spanIndex} overlaps or is out of order`,
        );
      }
      if (Number.isNaN(span.score) || (span.score !== NEG_INFINITY && !Number.isFinite(span.score))) {
        throw new Error(
          `spansToWords: word ${wordIndex} span ${spanIndex} has a non-finite score`,
        );
      }

      scoreSum += span.score;
      previousEndFrame = span.endFrame;
    }

    const first = spans[0];
    const last = spans[spans.length - 1];
    const startMs = Math.round(first.startFrame * opts.frameMs);
    let endMs = Math.round(last.endFrame * opts.frameMs);

    // Padding starts at usedMs; anything that begins there is hallucination.
    if (startMs >= opts.usedMs) continue;

    // Rounding a very short word can collapse it. The contract requires a positive
    // duration, so repair to the next millisecond before clamping.
    if (endMs <= startMs) endMs = startMs + 1;
    if (endMs > opts.usedMs) endMs = opts.usedMs;
    if (endMs <= startMs) continue;

    const confidence = clampUnit(Math.exp(scoreSum / spans.length));

    words.push({
      text: texts[wordIndex],
      startMs,
      endMs,
      confidence,
      index: words.length,
      windowIndex: opts.windowIndex,
    });
  }

  return words;
}

/**
 * Banded dynamic time warping with a Sakoe-Chiba band.
 *
 * Allowed steps are down (1,0), right (0,1) and diagonal (1,1). Cells satisfy
 * `|row - col| <= band`, where the band is rounded down to whole cells. A too-narrow
 * band is a caller bug, so it throws rather than returning a partial path.
 *
 * Ties prefer diagonal, then vertical, then horizontal. `total` includes both endpoints.
 * Empty matrices return an empty path with total 0 by convention.
 */
export function bandedDtw(
  cost: number[][],
  band: number,
): { path: [number, number][]; total: number } {
  if (!Number.isFinite(band) || band < 0) {
    throw new Error("bandedDtw: band must be a finite number >= 0");
  }

  const width = Math.floor(band);
  const rows = cost.length;
  if (rows === 0) return { path: [], total: 0 };

  const cols = cost[0].length;
  for (let row = 0; row < rows; row++) {
    if (cost[row].length !== cols) {
      throw new Error(
        `bandedDtw: cost must be rectangular; row ${row} has ${cost[row].length} columns, expected ${cols}`,
      );
    }
  }
  if (cols === 0) return { path: [], total: 0 };

  const gap = Math.abs(rows - cols);
  if (gap > width) {
    throw new Error(
      `bandedDtw: band ${width} is too narrow for a ${rows}x${cols} matrix (need at least ${gap})`,
    );
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!Number.isFinite(cost[row][col])) {
        throw new Error(`bandedDtw: cost[${row}][${col}] must be a finite number`);
      }
    }
  }

  const scores = new Float64Array(rows * cols).fill(POSITIVE_INFINITY);
  // 0 = diagonal, 1 = up, 2 = left.
  const moves = new Uint8Array(rows * cols);

  scores[0] = cost[0][0];

  for (let row = 0; row < rows; row++) {
    const firstCol = Math.max(0, row - width);
    const lastCol = Math.min(cols - 1, row + width);

    for (let col = firstCol; col <= lastCol; col++) {
      if (row === 0 && col === 0) continue;

      const index = row * cols + col;
      let best = POSITIVE_INFINITY;
      let move = 0;

      if (row > 0 && col > 0) {
        // The diagonal predecessor has the same |row-col| as this cell, so it is
        // always inside the band when the current cell is.
        best = scores[(row - 1) * cols + (col - 1)];
      }
      if (row > 0 && Math.abs(row - 1 - col) <= width) {
        const up = scores[(row - 1) * cols + col];
        if (up < best) {
          best = up;
          move = 1;
        }
      }
      if (col > 0 && Math.abs(row - (col - 1)) <= width) {
        const left = scores[row * cols + (col - 1)];
        if (left < best) {
          best = left;
          move = 2;
        }
      }

      if (best === POSITIVE_INFINITY) continue;

      scores[index] = best + cost[row][col];
      moves[index] = move;
    }
  }

  const endIndex = (rows - 1) * cols + (cols - 1);
  const total = scores[endIndex];
  if (!Number.isFinite(total)) {
    throw new Error(
      `bandedDtw: no path from (0,0) to (${rows - 1},${cols - 1}) inside band ${width}`,
    );
  }

  const path: [number, number][] = [];
  let row = rows - 1;
  let col = cols - 1;

  while (row > 0 || col > 0) {
    path.push([row, col]);
    const move = moves[row * cols + col];

    if (move === 0) {
      if (row === 0 || col === 0) {
        throw new Error("bandedDtw: internal error, diagonal backpointer on a border");
      }
      row--;
      col--;
    } else if (move === 1) {
      if (row === 0) {
        throw new Error("bandedDtw: internal error, up backpointer on the top row");
      }
      row--;
    } else if (move === 2) {
      if (col === 0) {
        throw new Error("bandedDtw: internal error, left backpointer on the first column");
      }
      col--;
    } else {
      throw new Error(`bandedDtw: internal error, missing backpointer at (${row}, ${col})`);
    }
  }

  path.push([0, 0]);
  path.reverse();

  return { path, total };
}
