import { describe, expect, it } from "vitest";
import {
  dtw,
  FAST_ALIGNMENT_HEADS,
  headNormalisedRows,
  wordTimesFromAttention,
  type AttentionMatrix,
  type AttentionStep,
  type AttentionToken,
} from "./attention";

/** Build a [1, heads, queries, frames] row-major tensor from one row per query per head. */
function tensor(heads: number, queries: number, frames: number, rows: number[][]): AttentionMatrix {
  if (rows.length !== heads * queries) throw new Error("test tensor: row count does not match shape");
  const data = new Float32Array(heads * queries * frames);
  for (let i = 0; i < rows.length; i += 1) {
    expect(rows[i]).toHaveLength(frames);
    data.set(rows[i], i * frames);
  }
  return { dims: [1, heads, queries, frames], data };
}

function step(stepNumber: number, ids: number[], tensors: Record<string, AttentionMatrix>): AttentionStep {
  return { step: stepNumber, inputIds: ids, tensors };
}

/** One head, one layer, one query row per step, with a high plateau at the given frames. */
function plateauStep(stepNumber: number, id: number, frames: number, plateau: [number, number], layer = 0, heads = 1): AttentionStep {
  const headRows: number[][] = [];
  for (let h = 0; h < heads; h += 1) {
    const row = new Array<number>(frames).fill(0);
    for (let f = plateau[0]; f <= plateau[1]; f += 1) row[f] = 1;
    headRows.push(row);
  }
  return step(stepNumber, [id], { [`cross_attentions.${layer}`]: tensor(heads, 1, frames, headRows) });
}

function flatStep(stepNumber: number, id: number, frames: number, layer = 0): AttentionStep {
  return step(stepNumber, [id], { [`cross_attentions.${layer}`]: tensor(1, 1, frames, [new Array<number>(frames).fill(0)]) });
}

const words = (texts: string[]): AttentionToken[] => texts.map((text, id) => ({ id, text }));

describe("dtw", () => {
  it("finds the zero-cost diagonal path", () => {
    const result = dtw([
      [0, 1],
      [1, 0],
    ]);
    expect(result).not.toBeNull();
    expect(result?.path).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(result?.total).toBe(0);
  });

  it("is monotonic and covers every row and column when the matrix is all zeros", () => {
    const result = dtw([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(result).not.toBeNull();
    const path = result?.path ?? [];
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([2, 2]);
    for (let i = 1; i < path.length; i += 1) {
      const [row, col] = path[i];
      const [prevRow, prevCol] = path[i - 1];
      expect(row).toBeGreaterThanOrEqual(prevRow);
      expect(col).toBeGreaterThanOrEqual(prevCol);
      expect(row - prevRow + (col - prevCol)).toBe(1);
    }
    for (let row = 0; row < 3; row += 1) expect(path.some(([r]) => r === row)).toBe(true);
    for (let col = 0; col < 3; col += 1) expect(path.some(([, c]) => c === col)).toBe(true);
  });

  it("takes the cheaper detour rather than the diagonal", () => {
    // The diagonal cell is expensive; going down then right around it is cheap.
    const result = dtw([
      [0, 1, 1],
      [1, 9, 0],
      [1, 0, 1],
    ]);
    expect(result).not.toBeNull();
    expect(result?.total).toBe(2);
    expect(result?.path).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [2, 2],
    ]);
  });

  it("returns null for empty, ragged, or non-finite costs", () => {
    expect(dtw([])).toBeNull();
    expect(dtw([[]])).toBeNull();
    expect(dtw([[1], [1, 2]])).toBeNull();
    expect(dtw([[Number.NaN]])).toBeNull();
    expect(dtw([[Number.POSITIVE_INFINITY]])).toBeNull();
  });
});

describe("headNormalisedRows", () => {
  it("z-scores every frame across the rows (population std), and a flat frame becomes zeros", () => {
    // Two rows, three frames: [2,0,5] and [0,0,5].
    // Frame 0: 2 vs 0 -> mean 1, std 1 -> +1 / -1. Frame 1: equal -> 0. Frame 2: equal -> 0.
    const shaped = headNormalisedRows(new Float64Array([2, 0, 5, 0, 0, 5]), 2, 3, 1);
    expect(Array.from(shaped)).toEqual([1, 0, 0, -1, 0, 0]);
    expect(Array.from(shaped).every(Number.isFinite)).toBe(true);
  });

  it("median-filters every row along time, and width 1 is a no-op", () => {
    // Row 0 spikes at frame 1, row 1 at frame 4. After z-scoring: row0 = [0,1,0,0,-1], row1 = [0,-1,0,0,1].
    const raw = new Float64Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(headNormalisedRows(raw, 2, 5, 1))).toEqual([0, 1, 0, 0, -1, 0, -1, 0, 0, 1]);
    // Width 5 takes the median of each five-frame window: one spike among four zeros disappears.
    expect(Array.from(headNormalisedRows(raw, 2, 5, 5))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("wordTimesFromAttention", () => {
  const frames = 20;
  // Three words, each one token, with well-separated high-attention plateaus. The row at step 0
  // predicts "a", step 1 predicts "b", step 2 predicts "c"; step 3 would predict end-of-text.
  const threeWords = () =>
    wordTimesFromAttention({
      steps: [
        plateauStep(0, 999, frames, [1, 4]),
        plateauStep(1, 1, frames, [5, 8]),
        plateauStep(2, 2, frames, [9, 12]),
        flatStep(3, 3, frames),
      ],
      tokens: words([" a", " b", " c"]),
      usedMs: 400,
      promptRows: 1,
      heads: [{ layer: 0, head: 0 }],
      medianFilterWidth: 1,
    });

  it("puts the token jumps on the high-attention plateaus and stays inside usedMs", () => {
    const result = threeWords();
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result?.map((word) => word.text)).toEqual(["a", "b", "c"]);

    // The first token must start at frame 0 (Whisper's DTW border); each later plateau starts
    // exactly where the previous one ends, so the jump frames are unambiguous.
    expect(result?.[0].startMs).toBe(0);
    expect(result?.[1].startMs).toBe(100);
    expect(result?.[2].startMs).toBe(180);
    expect(result?.[2].endMs).toBe(400);

    for (let i = 0; i < 3; i += 1) {
      const word = result?.[i];
      expect(word?.startMs).toBeGreaterThanOrEqual(0);
      expect(word?.endMs).toBeLessThanOrEqual(400);
      expect(word?.endMs ?? 0).toBeGreaterThan(word?.startMs ?? 0);
      if (i > 0) expect(word?.startMs).toBeGreaterThanOrEqual(result?.[i - 1].endMs ?? 0);
    }
  });

  it("attention-peak mode starts on the strongest frame and stops the last word at its basin edge", () => {
    const result = wordTimesFromAttention({
      steps: [
        plateauStep(0, 999, frames, [1, 4]),
        plateauStep(1, 1, frames, [5, 8]),
        plateauStep(2, 2, frames, [9, 12]),
        flatStep(3, 3, frames),
      ],
      tokens: words([" a", " b", " c"]),
      usedMs: 400,
      promptRows: 1,
      heads: [{ layer: 0, head: 0 }],
      medianFilterWidth: 1,
      boundaryMode: "attention-peak",
    });
    expect(result).not.toBeNull();
    expect(result?.map((word) => word.startMs)).toEqual([20, 100, 180]);
    expect(result?.map((word) => word.endMs)).toEqual([100, 180, 260]);
  });

  it("dtw-peak keeps DTW order but moves each start to the strongest frame inside its segment", () => {
    const result = wordTimesFromAttention({
      steps: [
        plateauStep(0, 999, frames, [1, 4]),
        plateauStep(1, 1, frames, [5, 8]),
        plateauStep(2, 2, frames, [9, 12]),
        flatStep(3, 3, frames),
      ],
      tokens: words([" a", " b", " c"]),
      usedMs: 400,
      promptRows: 1,
      heads: [{ layer: 0, head: 0 }],
      medianFilterWidth: 1,
      boundaryMode: "dtw-peak",
    });
    expect(result).not.toBeNull();
    expect(result?.map((word) => word.startMs)).toEqual([20, 100, 180]);
    // The last token keeps DTW's end, so the word reaches usedMs (unlike pure peak, which stops at
    // the edge of the attention basin).
    expect(result?.map((word) => word.endMs)).toEqual([100, 180, 400]);
  });

  it("joins continuation tokens into one word at the space-marked token", () => {
    const result = wordTimesFromAttention({
      steps: [
        plateauStep(0, 999, frames, [1, 3]),
        plateauStep(1, 10, frames, [5, 7]),
        plateauStep(2, 11, frames, [9, 11]),
        plateauStep(3, 12, frames, [13, 15]),
        flatStep(4, 13, frames),
      ],
      // "Mama," is four tokens in the real Hinglish capture: " M" | "ama" | "," | " hello".
      // Each step's row predicts the following token, so the first word starts at the prompt row.
      tokens: words([" M", "ama", ",", " hello"]),
      usedMs: 400,
      promptRows: 1,
      heads: [{ layer: 0, head: 0 }],
      medianFilterWidth: 1,
    });
    expect(result).toHaveLength(2);
    expect(result?.[0].text).toBe("Mama,");
    expect(result?.[0].tokenStart).toBe(0);
    expect(result?.[0].tokenEnd).toBe(3);
    expect(result?.[1].text).toBe("hello");
    expect(result?.[0].endMs).toBe(result?.[1].startMs);
  });

  it("does not turn a bare-space token into an empty word", () => {
    for (const texts of [[" a", " ", " b"], [" a", " b", " "]]) {
      const result = wordTimesFromAttention({
        steps: [plateauStep(0, 999, frames, [1, 4]), plateauStep(1, 1, frames, [5, 8]), plateauStep(2, 2, frames, [9, 12]), plateauStep(3, 3, frames, [13, 16])],
        tokens: words(texts),
        usedMs: 400,
        promptRows: 1,
        heads: [{ layer: 0, head: 0 }],
        medianFilterWidth: 1,
        boundaryMode: "dtw-peak",
      });
      expect(result?.map((word) => word.text)).not.toContain("");
      expect(result).toHaveLength(2);
    }
  });

  it("reads the requested head index, not always head 0", () => {
    // Head 0 is deliberately flat, so selecting only head 1 is the only way to see the plateaus.
    const framesA = 10;
    const flat = new Array<number>(framesA).fill(0);
    const head1Row = (start: number, end: number) => {
      const row = new Array<number>(framesA).fill(0);
      for (let f = start; f <= end; f += 1) row[f] = 1;
      return row;
    };
    const twoHeadStep = (stepNumber: number, id: number, row: number[]) =>
      step(stepNumber, [id], { "cross_attentions.0": tensor(2, 1, framesA, [flat, row]) });

    const result = wordTimesFromAttention({
      steps: [
        step(0, [999], { "cross_attentions.0": tensor(2, 1, framesA, [flat, head1Row(1, 3)]) }),
        twoHeadStep(1, 1, head1Row(4, 6)),
        step(2, [999], { "cross_attentions.0": tensor(2, 1, framesA, [flat, flat]) }),
      ],
      tokens: words([" a", " b"]),
      usedMs: 200,
      promptRows: 1,
      heads: [{ layer: 0, head: 1 }],
      medianFilterWidth: 1,
    });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // The second plateau starts at frame 4 (80 ms).
    expect(result?.[1].startMs).toBe(80);
  });

  it("returns null (never throws) for bad input", () => {
    const goodTokens = words([" a", " b"]);
    const goodSteps = (): AttentionStep[] => [
      plateauStep(0, 999, frames, [1, 4]),
      plateauStep(1, 1, frames, [5, 8]),
      flatStep(2, 2, frames),
    ];
    const base = { steps: goodSteps(), tokens: goodTokens, usedMs: 400, promptRows: 1, heads: [{ layer: 0, head: 0 }], medianFilterWidth: 1 };

    expect(wordTimesFromAttention({ ...base, usedMs: 0 })).toBeNull();
    expect(wordTimesFromAttention({ ...base, usedMs: Number.NaN })).toBeNull();
    expect(wordTimesFromAttention({ ...base, medianFilterWidth: 2 })).toBeNull();
    expect(wordTimesFromAttention({ ...base, medianFilterWidth: 0 })).toBeNull();
    expect(wordTimesFromAttention({ ...base, medianFilterWidth: 103 })).toBeNull();
    expect(wordTimesFromAttention({ ...base, promptRows: -1 })).toBeNull();
    expect(wordTimesFromAttention({ ...base, promptRows: 0 })).toBeNull();
    expect(wordTimesFromAttention({ ...base, heads: [] })).toBeNull();
    expect(wordTimesFromAttention({ ...base, boundaryMode: "nope" as never })).toBeNull();
    expect(wordTimesFromAttention({ ...base, tokens: words([" a", " b", " c", " d"]) })).toBeNull();
    expect(wordTimesFromAttention({ ...base, steps: [] })).toBeNull();
    expect(wordTimesFromAttention({ ...base, steps: [{ ...goodSteps()[0], inputIds: [] }, ...goodSteps().slice(1)] })).toBeNull();
    // Missing tensor for the requested layer.
    expect(wordTimesFromAttention({ ...base, heads: [{ layer: 2, head: 0 }] })).toBeNull();
    // Head index outside the tensor's head dimension.
    expect(wordTimesFromAttention({ ...base, heads: [{ layer: 0, head: 3 }] })).toBeNull();
    // Ragged frames: a used text row claims two query rows while its input has one.
    const bad = goodSteps();
    bad[1] = { ...bad[1], tensors: { "cross_attentions.0": { dims: [1, 1, 2, 5], data: new Float32Array(10) } } };
    expect(wordTimesFromAttention({ ...base, steps: bad })).toBeNull();
    // Non-finite attention.
    const nan = goodSteps();
    const nanData = new Float32Array(frames);
    nanData[0] = Number.NaN;
    nan[1] = { ...nan[1], tensors: { "cross_attentions.0": { dims: [1, 1, 1, frames], data: nanData } } };
    expect(wordTimesFromAttention({ ...base, steps: nan })).toBeNull();
  });

  it("has the documented FAST alignment heads", () => {
    expect(FAST_ALIGNMENT_HEADS).toHaveLength(8);
    expect(FAST_ALIGNMENT_HEADS.map((head) => `${head.layer}.${head.head}`)).toEqual([
      "3.1",
      "4.2",
      "4.3",
      "4.7",
      "5.1",
      "5.2",
      "5.4",
      "5.6",
    ]);
  });
});
