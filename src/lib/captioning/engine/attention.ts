/**
 * Word timing from the cross-attention maps the Whisper decoder already produces.
 *
 * Why this file exists: the hosted FAST decoder returns `cross_attentions.{layer}` for every
 * generated token, free of charge. Whisper's own `timing.py` turns those maps into token times by
 * (1) keeping a small set of "alignment heads", (2) z-scoring each head over the tokens for every
 * audio frame, (3) median-filtering along time, (4) averaging the heads, and (5) dynamic time
 * warping the resulting [text token x frame] score matrix so every token gets a monotonic frame.
 * That is exactly what `wordTimesFromAttention` does.
 *
 * The function is deliberately fixture-free: callers hand it plain arrays, so unit tests use small
 * hand-computed matrices and the eval script wires the browser-captured JSON to it. It never throws:
 * a bad or incomplete matrix returns `null`, and the pipeline can fall back to the uniform aligner.
 *
 * TIME: one encoder frame is 20 ms, so 50 frames per second. Output is integer milliseconds, in
 * window-local time (audio starts at 0 for the window this matrix belongs to).
 */

/** One of Whisper's "alignment heads" (a decoder layer and an attention head inside it). */
export interface AlignmentHead {
  layer: number;
  head: number;
}

/**
 * The 8 heads listed in the hosted FAST model's generation_config. These are the heads Whisper was
 * trained to align with; using any other layer/head pair makes the score matrix nearly flat.
 */
export const FAST_ALIGNMENT_HEADS: readonly AlignmentHead[] = [
  { layer: 3, head: 1 },
  { layer: 4, head: 2 },
  { layer: 4, head: 3 },
  { layer: 4, head: 7 },
  { layer: 5, head: 1 },
  { layer: 5, head: 2 },
  { layer: 5, head: 4 },
  { layer: 5, head: 6 },
];

/** Whisper's alignment heads for large-v3-turbo, kept here so a future Apex export can reuse the spike. */
export const LARGE_V3_TURBO_ALIGNMENT_HEADS: readonly AlignmentHead[] = [
  { layer: 2, head: 4 },
  { layer: 2, head: 11 },
  { layer: 3, head: 3 },
  { layer: 3, head: 6 },
  { layer: 3, head: 11 },
  { layer: 3, head: 14 },
];

/** A raw ORT output: dims [1, heads, queries, frames] and row-major float data. */
export interface AttentionMatrix {
  dims: readonly number[];
  data: ArrayLike<number>;
}

/** One decoder step captured from the model. Step 0 is the prompt and has q = prompt length. */
export interface AttentionStep {
  step: number;
  inputIds: readonly number[];
  /** Keyed by output name, e.g. "cross_attentions.4". */
  tensors: Readonly<Record<string, AttentionMatrix>>;
}

/** A decoded model token. `text` is `tokenizer.decode([id])`, used only to find word starts. */
export interface AttentionToken {
  id: number;
  text: string;
}

export interface WordTimesInput {
  /** Captured decoder steps, any order. */
  steps: readonly AttentionStep[];
  /** The generated text tokens, in order (the end-of-text token is not one of them). */
  tokens: readonly AttentionToken[];
  usedMs: number;
  /** Defaults to FAST_ALIGNMENT_HEADS. Pass a subset to test fewer heads. */
  heads?: readonly AlignmentHead[];
  /**
   * Query rows at the start of the capture that belong to the prompt rather than to text. Whisper
   * prepends `<|startoftranscript|>`, language, `<|transcribe|>`, `<|notimestamps|>` (4 rows for
   * our model), so those rows are at the front. The last of them predicts the first text token, so
   * the shift below keeps one prompt row. Default 4.
   */
  promptRows?: number;
  /** Whisper uses 7 (odd). 1 disables filtering. */
  medianFilterWidth?: number;
  /** Encoder frames per second. Stock Whisper is 50 (20 ms per frame). */
  framesPerSecond?: number;
  /**
   * How to turn the [token x frame] score matrix into token starts.
   *
   * - "whisper-dtw" (default): OpenAI Whisper's `find_alignment`, i.e. DTW and the first frame of
   *   each token's path segment. Faithful, but the path enters a token as soon as its score turns
   *   favourable, which on a fine-tuned model can be 150-300 ms before the attention peak.
   * - "attention-peak": the strongest frame of each token row. Not Whisper's recipe. Very accurate
   *   on isolated words, but can pick the wrong occurrence of a repeated word because nothing
   *   enforces order across tokens.
   * - "dtw-peak": DTW first (which keeps the words ordered and resolves repeats), then the strongest
   *   frame inside the frames DTW assigns to each token. This is the best of the two on the real
   *   captures.
   */
  boundaryMode?: "whisper-dtw" | "attention-peak" | "dtw-peak";
}

export interface AttentionWordTime {
  text: string;
  startMs: number;
  endMs: number;
  /** Index of the first token of this word in `input.tokens`. */
  tokenStart: number;
  /** Index one past the last token of this word. */
  tokenEnd: number;
}

export interface DtwResult {
  /** Monotonic path of [token row, frame column] pairs, from the first cell to the last. */
  path: [number, number][];
  total: number;
}

const DEFAULT_PROMPT_ROWS = 4;
const DEFAULT_MEDIAN_WIDTH = 7;
const DEFAULT_FPS = 50;
/** A filter wider than this is a caller mistake, not a tuning choice; refusing it also bounds the work. */
const MAX_MEDIAN_WIDTH = 101;

function isInt(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

/**
 * Whisper's median filter: reflect the edges, then take the median of each width-long window along
 * the last axis. Reflection avoids inventing a hard edge at the start/end of the audio, which would
 * otherwise pull the first and last token towards 0 or `usedMs`. Width 1 is a no-op.
 */
function medianFilterRow(values: Float64Array, width: number): Float64Array {
  const n = values.length;
  if (width <= 1 || n === 0) return values;
  const out = new Float64Array(n);
  const pad = (width - 1) / 2;
  const window = new Float64Array(width);
  const reflect = (index: number): number => {
    if (n === 1) return 0;
    const period = 2 * (n - 1);
    let k = ((index % period) + period) % period;
    if (k >= n) k = period - k;
    return k;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < width; j += 1) window[j] = values[reflect(i - pad + j)];
    // Width is at most 9 in practice, so a tiny insertion sort is clearer (and fast enough) than
    // allocating and sorting a fresh array for every frame.
    for (let a = 1; a < width; a += 1) {
      const value = window[a];
      let b = a - 1;
      while (b >= 0 && window[b] > value) {
        window[b + 1] = window[b];
        b -= 1;
      }
      window[b + 1] = value;
    }
    out[i] = window[(width - 1) / 2];
  }
  return out;
}

/**
 * One head's rows, shaped the way Whisper's `timing.py` does it: z-score every frame across the
 * rows (population standard deviation; a frame whose rows are all equal becomes zeros instead of
 * NaN), then median-filter every row along time.
 *
 * `raw` is row-major [rows x frames] and is only read; the result has the same layout. Exported so
 * the character-level aligner (char-align.ts) applies byte-for-byte the same normalisation as the
 * generated-token path; that path's behaviour is unchanged.
 */
export function headNormalisedRows(raw: ArrayLike<number>, rows: number, frames: number, width: number): Float64Array {
  const normalised = new Float64Array(rows * frames);
  for (let f = 0; f < frames; f += 1) {
    let mean = 0;
    for (let r = 0; r < rows; r += 1) mean += raw[r * frames + f];
    mean /= rows;
    let variance = 0;
    for (let r = 0; r < rows; r += 1) {
      const delta = raw[r * frames + f] - mean;
      variance += delta * delta;
    }
    variance /= rows;
    const std = Math.sqrt(variance);
    if (std < 1e-12) continue; // already all zeros
    for (let r = 0; r < rows; r += 1) normalised[r * frames + f] = (raw[r * frames + f] - mean) / std;
  }
  const filtered = new Float64Array(rows * frames);
  for (let r = 0; r < rows; r += 1) {
    filtered.set(medianFilterRow(normalised.subarray(r * frames, (r + 1) * frames), width), r * frames);
  }
  return filtered;
}

/**
 * Full dynamic time warping over a [rows x columns] cost matrix.
 *
 * Moves are diagonal (advance both), down (advance the token row) and right (advance the frame).
 * Like Whisper's `dtw`, the first and last row must start/end at the first/last column; we enforce
 * that by making the border cells unreachable (`Infinity`). This keeps the path a true monotonic
 * alignment from (0,0) to (rows-1, cols-1) and is why the first token always starts at frame 0.
 *
 * Ties follow Whisper's order: horizontal (same token, later frame) wins, then vertical, then
 * diagonal. Returns `null` for an empty, ragged or non-finite matrix.
 */
export function dtw(cost: readonly (readonly number[])[]): DtwResult | null {
  const rows = cost.length;
  if (rows === 0) return null;
  const cols = cost[0]?.length ?? 0;
  if (!Array.isArray(cost[0]) || cols === 0) return null;
  for (let r = 1; r < rows; r += 1) {
    if (!Array.isArray(cost[r]) || cost[r].length !== cols) return null;
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!Number.isFinite(cost[r][c])) return null;
    }
  }

  const width = cols + 1;
  const scores = new Float64Array((rows + 1) * width).fill(Number.POSITIVE_INFINITY);
  // 0 = diagonal, 1 = up (previous token row), 2 = left (previous frame).
  const moves = new Uint8Array((rows + 1) * width);
  scores[0] = 0;

  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const diag = scores[(r - 1) * width + (c - 1)];
      const up = scores[(r - 1) * width + c];
      const left = scores[r * width + (c - 1)];
      let best = left;
      let move = 2;
      if (up < best) {
        best = up;
        move = 1;
      }
      if (diag < best) {
        best = diag;
        move = 0;
      }
      scores[r * width + c] = cost[r - 1][c - 1] + best;
      moves[r * width + c] = move;
    }
  }

  const path: [number, number][] = [];
  let r = rows;
  let c = cols;
  while (r > 0 && c > 0) {
    path.push([r - 1, c - 1]);
    const move = moves[r * width + c];
    if (move === 0) {
      r -= 1;
      c -= 1;
    } else if (move === 1) {
      r -= 1;
    } else {
      c -= 1;
    }
  }
  path.reverse();
  return { path, total: scores[rows * width + cols] };
}

interface QueryRow {
  step: AttentionStep;
  query: number;
}

function readStepTensor(
  step: AttentionStep,
  layer: number,
): { heads: number; queries: number; frames: number; data: ArrayLike<number> } | null {
  const matrix = step.tensors[`cross_attentions.${layer}`];
  if (!matrix) return null;
  const { dims, data } = matrix;
  if (dims.length !== 4) return null;
  const [batch, heads, queries, frames] = dims;
  if (batch !== 1 || !isInt(heads, 1) || !isInt(queries, 1) || !isInt(frames, 1)) return null;
  if (queries !== step.inputIds.length) return null;
  if (data.length < heads * queries * frames) return null;
  return { heads, queries, frames, data };
}

/**
 * Turns captured cross-attention into one `{ startMs, endMs }` per word.
 *
 * Pipeline, matching OpenAI Whisper `timing.py > find_alignment`:
 *  1. Flatten the captured query rows in step order. A cross-attention row belongs to the input
 *     token at that position, and (because the decoder is causal and predicts the next token) that
 *     row describes the audio of the *next* token. So text token 0 uses the last prompt row, text
 *     token i>0 uses the row of text token i-1, and the row that predicts end-of-text is unused.
 *     This is Whisper's own one-row shift (`timing.py` runs the prompt + text + eot in one forward
 *     pass and keeps the rows that predict the text tokens), and getting it wrong makes every word
 *     late by roughly one word. We prepend that one prompt row and drop the final text step instead
 *     of materialising the eot row we never captured.
 *  2. For each alignment head, keep the first `usedMs * fps / 1000` frame columns.
 *  3. Z-score that head across the tokens for every frame (population standard deviation, as in
 *     Whisper). A flat frame (std 0) becomes all zeros instead of NaN.
 *  4. Median-filter every token row along time (width 7 by default).
 *  5. Average the heads, negate to make a cost matrix, and either DTW over [tokens x frames]
 *     (Whisper's recipe) or take each token's strongest frame ("attention-peak", our improvement).
 *  6. For DTW, the first frame of each token row is its jump time. Token end is the next token's
 *     jump time; the last token ends at the last frame the path assigns to it. For attention-peak,
 *     starts are the per-token minima made monotonic and the last token ends at the right edge of
 *     its negative-cost run.
 *  7. Join tokens into words. A token starts a word when its decoded text begins with a space (the
 *     byte-level BPE marker Whisper uses); the very first token always starts a word.
 *
 * Returns `null` (never throws) if the matrices are missing/mismatched or the timings cannot be made
 * monotonic inside `usedMs`.
 */
export function wordTimesFromAttention(input: WordTimesInput): AttentionWordTime[] | null {
  if (!input || typeof input !== "object") return null;
  const { steps, tokens, usedMs } = input;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  if (!Number.isFinite(usedMs) || usedMs <= 0) return null;
  if (tokens.length > usedMs) return null;

  const heads = input.heads ?? FAST_ALIGNMENT_HEADS;
  if (!Array.isArray(heads) || heads.length === 0) return null;
  for (const head of heads) {
    if (!head || !isInt(head.layer, 0) || !isInt(head.head, 0)) return null;
  }

  const promptRows = input.promptRows ?? DEFAULT_PROMPT_ROWS;
  if (!isInt(promptRows, 1)) return null;

  const width = input.medianFilterWidth ?? DEFAULT_MEDIAN_WIDTH;
  if (!isInt(width, 1) || width % 2 === 0 || width > MAX_MEDIAN_WIDTH) return null;

  const fps = input.framesPerSecond ?? DEFAULT_FPS;
  if (!Number.isFinite(fps) || fps <= 0) return null;

  const boundaryMode = input.boundaryMode ?? "whisper-dtw";
  if (boundaryMode !== "whisper-dtw" && boundaryMode !== "attention-peak" && boundaryMode !== "dtw-peak") return null;

  for (const token of tokens) {
    if (!token || typeof token.text !== "string") return null;
  }

  const ordered = [...steps].sort((a, b) => a.step - b.step);
  const rows: QueryRow[] = [];
  for (const step of ordered) {
    if (!step || !Array.isArray(step.inputIds) || step.inputIds.length === 0) return null;
    if (!step.tensors || typeof step.tensors !== "object") return null;
    for (let query = 0; query < step.inputIds.length; query += 1) rows.push({ step, query });
  }
  const textRows: QueryRow[] = [];
  if (rows.length < promptRows) return null;
  // Row promptRows-1 is the last prompt token and predicts text token 0.
  textRows.push(rows[promptRows - 1]);
  // Text token i>0 is predicted by the row of text token i-1 (rows promptRows ... promptRows+N-2).
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const row = rows[promptRows + i];
    if (!row) return null;
    textRows.push(row);
  }

  const requestedFrames = Math.max(1, Math.round((usedMs / 1000) * fps));
  let frames = Number.POSITIVE_INFINITY;
  for (const head of heads) {
    for (const row of textRows) {
      const tensor = readStepTensor(row.step, head.layer);
      if (!tensor || head.head >= tensor.heads) return null;
      if (tensor.frames < frames) frames = tensor.frames;
    }
  }
  if (!Number.isFinite(frames) || frames <= 0) return null;
  const usedFrames = Math.min(requestedFrames, frames);
  if (usedFrames <= 0) return null;

  const tokenCount = tokens.length;
  const sums = new Float64Array(tokenCount * usedFrames);
  const raw = new Float64Array(tokenCount * usedFrames);

  for (const head of heads) {
    for (let t = 0; t < tokenCount; t += 1) {
      const row = textRows[t];
      const tensor = readStepTensor(row.step, head.layer);
      if (!tensor) return null;
      // [1, heads, queries, frames] row-major; the batch index is always 0.
      const base = (head.head * tensor.queries + row.query) * tensor.frames;
      for (let f = 0; f < usedFrames; f += 1) {
        const value = tensor.data[base + f];
        if (!Number.isFinite(value)) return null;
        raw[t * usedFrames + f] = value;
      }
    }

    // Whisper normalises over the token axis for each frame, then median-filters along time.
    const shaped = headNormalisedRows(raw, tokenCount, usedFrames, width);
    for (let i = 0; i < shaped.length; i += 1) sums[i] += shaped[i];
  }

  const cost: number[][] = [];
  for (let t = 0; t < tokenCount; t += 1) {
    const row = new Array<number>(usedFrames);
    for (let f = 0; f < usedFrames; f += 1) row[f] = -sums[t * usedFrames + f] / heads.length;
    cost.push(row);
  }

  const firstFrame = new Array<number>(tokenCount).fill(-1);
  const lastFrame = new Array<number>(tokenCount).fill(-1);
  if (boundaryMode === "whisper-dtw" || boundaryMode === "dtw-peak") {
    const warped = dtw(cost);
    if (!warped || warped.path.length === 0) return null;
    for (const [token, frame] of warped.path) {
      if (token < 0 || token >= tokenCount) return null;
      if (firstFrame[token] < 0) firstFrame[token] = frame;
      lastFrame[token] = frame;
    }
    if (boundaryMode === "dtw-peak") {
      // Keep DTW's segment for each token (so repeats stay ordered), but replace its early first
      // frame with the strongest frame inside that segment.
      for (let token = 0; token < tokenCount; token += 1) {
        const from = firstFrame[token];
        const to = lastFrame[token];
        let best = from;
        for (let frame = from + 1; frame <= to; frame += 1) {
          if (cost[token][frame] < cost[token][best]) best = frame;
        }
        firstFrame[token] = best;
      }
    }
  } else {
    for (let token = 0; token < tokenCount; token += 1) {
      const row = cost[token];
      let best = 0;
      for (let frame = 1; frame < usedFrames; frame += 1) {
        if (row[frame] < row[best]) best = frame;
      }
      // Peaks can arrive slightly out of order when two words share attention; force the sequence
      // to advance, exactly as the word post-processing below expects.
      if (token > 0 && best < firstFrame[token - 1]) best = firstFrame[token - 1];
      firstFrame[token] = best;
    }
    for (let token = 0; token + 1 < tokenCount; token += 1) {
      lastFrame[token] = Math.max(firstFrame[token], firstFrame[token + 1] - 1);
    }
    // The final word has no next token to bound it. Walk right along its negative-cost run (the
    // attention basin) and stop at the first frame where the token is no longer favoured. If there
    // is no basin, fall back to the window end, which the clamp below keeps inside usedMs.
    const lastRow = cost[tokenCount - 1];
    let endFrame = firstFrame[tokenCount - 1];
    if (lastRow[endFrame] < 0) {
      while (endFrame + 1 < usedFrames && lastRow[endFrame + 1] < 0) endFrame += 1;
    }
    lastFrame[tokenCount - 1] = Math.max(firstFrame[tokenCount - 1], endFrame);
  }
  for (let t = 0; t < tokenCount; t += 1) {
    if (firstFrame[t] < 0 || lastFrame[t] < 0) return null;
  }

  const msPerFrame = 1000 / fps;
  const frameToMs = (frame: number) => Math.round(Math.min(Math.max(frame, 0), usedFrames) * msPerFrame);

  // Token boundaries: token t runs until token t+1 starts. Token starts are non-decreasing along the
  // DTW path; equal starts (a vertical move) are repaired when the words are clamped below.
  const tokenStartMs = new Array<number>(tokenCount);
  const tokenEndMs = new Array<number>(tokenCount);
  for (let t = 0; t < tokenCount; t += 1) tokenStartMs[t] = frameToMs(firstFrame[t]);
  for (let t = 0; t < tokenCount; t += 1) {
    tokenEndMs[t] = t + 1 < tokenCount ? tokenStartMs[t + 1] : frameToMs(lastFrame[t] + 1);
  }

  // A word starts at a token that begins with a space and has text. A bare-space token ("Ġ" on its own) starts a word only when the
  // next token continues it (the text follows without its own space); between two space-led tokens, or at the end, it carries no word
  // and must not create an empty one (that would make the word count differ from the transcript's).
  const startsWord = (index: number) => {
    if (index === 0) return true;
    const text = tokens[index].text;
    if (!text.startsWith(" ")) return false;
    if (text.trim() !== "") return true;
    return index + 1 < tokenCount && !tokens[index + 1].text.startsWith(" ");
  };
  const words: AttentionWordTime[] = [];
  let tokenStart = 0;
  let previousEnd = 0;
  for (let t = 1; t <= tokenCount; t += 1) {
    if (t < tokenCount && !startsWord(t)) continue;

    let start = Math.min(Math.max(tokenStartMs[tokenStart], 0), usedMs);
    let end = Math.min(Math.max(tokenEndMs[t - 1], 0), usedMs);
    // Keep the sequence strictly ordered and non-empty. Starting a word before the previous one
    // ended (possible when two tokens share a jump frame) is repaired by pushing it to that end.
    if (start < previousEnd) start = previousEnd;
    if (end <= start) end = Math.min(usedMs, start + 1);
    if (end <= start) {
      start = Math.max(0, usedMs - 1);
      end = usedMs;
    }
    if (end <= start) return null;

    words.push({
      text: tokens
        .slice(tokenStart, t)
        .map((token) => token.text)
        .join("")
        .trim(),
      startMs: start,
      endMs: end,
      tokenStart,
      tokenEnd: t,
    });
    previousEnd = end;
    tokenStart = t;
  }

  return words;
}
