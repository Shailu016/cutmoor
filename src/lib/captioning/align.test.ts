import { describe, expect, it } from "vitest";
import { bandedDtw, ctcForcedAlign, spansToWords } from "./align";
import type { TokenSpan } from "./align";

const NEG_INFINITY = Number.NEGATIVE_INFINITY;
const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function oneHotLogProbs(
  path: number[],
  classes: number,
  high = -0.05,
  low = -6,
): number[][] {
  return path.map((chosen) => {
    const row = new Array<number>(classes).fill(low);
    row[chosen] = high;
    return row;
  });
}

function pathTotal(
  logProbs: number[][],
  tokens: number[],
  blankId: number,
  spans: TokenSpan[],
): number {
  const classes = new Array<number>(logProbs.length).fill(blankId);
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index];
    for (let frame = span.startFrame; frame < span.endFrame; frame++) {
      classes[frame] = tokens[index];
    }
  }

  let total = 0;
  for (let frame = 0; frame < logProbs.length; frame++) {
    total += logProbs[frame][classes[frame]];
  }
  return total;
}

function assertSpansValid(spans: TokenSpan[], tokens: number[], frames: number): void {
  expect(spans).toHaveLength(tokens.length);

  let previousEnd = 0;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index];
    expect(Number.isInteger(span.startFrame)).toBe(true);
    expect(Number.isInteger(span.endFrame)).toBe(true);
    expect(span.startFrame).toBeGreaterThanOrEqual(previousEnd);
    expect(span.endFrame).toBeGreaterThan(span.startFrame);
    expect(span.endFrame).toBeLessThanOrEqual(frames);

    if (index > 0 && tokens[index] === tokens[index - 1]) {
      // Repeated labels must be separated by at least one blank frame.
      expect(span.startFrame).toBeGreaterThan(previousEnd);
    }

    previousEnd = span.endFrame;
  }
}

function expectSpanScores(
  logProbs: number[][],
  tokens: number[],
  spans: TokenSpan[],
): void {
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index];
    let sum = 0;
    for (let frame = span.startFrame; frame < span.endFrame; frame++) {
      sum += logProbs[frame][tokens[index]];
    }
    expect(span.score).toBeCloseTo(sum / (span.endFrame - span.startFrame), 10);
  }
}

/**
 * Independent oracle: enumerate every legal extended-state path. Only used for tiny
 * inputs, so exponential growth is fine. It shares nothing with the Viterbi code.
 */
function bruteForceBestTotal(
  logProbs: number[][],
  tokens: number[],
  blankId: number,
): number {
  const frames = logProbs.length;
  const labelCount = tokens.length;
  const stateCount = labelCount * 2 + 1;

  const classOf = (state: number): number =>
    state % 2 === 0 ? blankId : tokens[(state - 1) / 2];

  const canAdvance = (from: number, to: number): boolean => {
    if (to === from || to === from + 1) return true;
    if (to === from + 2) {
      if (to % 2 === 0) return false;
      const label = (to - 1) / 2;
      return tokens[label] !== tokens[label - 1];
    }
    return false;
  };

  let best = NEG_INFINITY;

  const visit = (frame: number, state: number, total: number): void => {
    if (frame === frames - 1) {
      if (state === stateCount - 1 || state === stateCount - 2) {
        if (total > best) best = total;
      }
      return;
    }

    const lastNext = Math.min(state + 2, stateCount - 1);
    for (let next = state; next <= lastNext; next++) {
      if (!canAdvance(state, next)) continue;
      const emission = logProbs[frame + 1][classOf(next)];
      if (emission === NEG_INFINITY) continue;
      visit(frame + 1, next, total + emission);
    }
  };

  visit(0, 0, logProbs[0][blankId]);
  if (labelCount > 0) visit(0, 1, logProbs[0][tokens[0]]);

  return best;
}

function fullDtwReference(
  cost: number[][],
): { path: [number, number][]; total: number } {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0].length;
  if (rows === 0 || cols === 0) return { path: [], total: 0 };

  const scores = Array.from(
    { length: rows },
    () => new Array<number>(cols).fill(POSITIVE_INFINITY),
  );
  const moves = Array.from(
    { length: rows },
    () => new Array<number>(cols).fill(-1),
  );

  scores[0][0] = cost[0][0];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (row === 0 && col === 0) continue;

      let best = POSITIVE_INFINITY;
      let choice = -1;

      if (row > 0 && col > 0) {
        best = scores[row - 1][col - 1];
        choice = 0;
      }
      if (row > 0 && scores[row - 1][col] < best) {
        best = scores[row - 1][col];
        choice = 1;
      }
      if (col > 0 && scores[row][col - 1] < best) {
        best = scores[row][col - 1];
        choice = 2;
      }

      scores[row][col] = best + cost[row][col];
      moves[row][col] = choice;
    }
  }

  const path: [number, number][] = [];
  let row = rows - 1;
  let col = cols - 1;

  while (row > 0 || col > 0) {
    path.push([row, col]);
    const choice = moves[row][col];
    if (choice === 0) {
      row--;
      col--;
    } else if (choice === 1) {
      row--;
    } else {
      col--;
    }
  }

  path.push([0, 0]);
  path.reverse();

  return { path, total: scores[rows - 1][cols - 1] };
}

function bandedDtwReference(cost: number[][], band: number): number {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0].length;
  if (rows === 0 || cols === 0) return 0;

  const width = Math.floor(band);
  const scores = Array.from(
    { length: rows },
    () => new Array<number>(cols).fill(POSITIVE_INFINITY),
  );

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (Math.abs(row - col) > width) continue;

      if (row === 0 && col === 0) {
        scores[row][col] = cost[row][col];
        continue;
      }

      let best = POSITIVE_INFINITY;
      if (row > 0 && col > 0) best = Math.min(best, scores[row - 1][col - 1]);
      if (row > 0) best = Math.min(best, scores[row - 1][col]);
      if (col > 0) best = Math.min(best, scores[row][col - 1]);

      scores[row][col] =
        best === POSITIVE_INFINITY ? POSITIVE_INFINITY : best + cost[row][col];
    }
  }

  return scores[rows - 1][cols - 1];
}

describe("ctcForcedAlign", () => {
  it("returns no spans when there are no tokens", () => {
    expect(ctcForcedAlign([], [], 0)).toEqual([]);
    expect(
      ctcForcedAlign(
        [
          [-1, -2],
          [-2, -1],
        ],
        [],
        0,
      ),
    ).toEqual([]);
  });

  it("aligns a single token and ignores leading and trailing blanks", () => {
    const logProbs = oneHotLogProbs([0, 1, 1, 1, 0], 3);
    const spans = ctcForcedAlign(logProbs, [1], 0);

    expect(spans).toHaveLength(1);
    expect(spans[0].startFrame).toBe(1);
    expect(spans[0].endFrame).toBe(4);
    expect(spans[0].score).toBeCloseTo(-0.05, 12);
  });

  it("puts a blank between repeated tokens", () => {
    const logProbs = oneHotLogProbs([2, 2, 0, 2, 0], 3);
    const spans = ctcForcedAlign(logProbs, [2, 2], 0);

    expect(spans.map((span) => [span.startFrame, span.endFrame])).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it("does not need a blank between different tokens", () => {
    const logProbs = oneHotLogProbs([0, 1, 2, 2, 0], 3);
    const spans = ctcForcedAlign(logProbs, [1, 2], 0);

    expect(spans.map((span) => [span.startFrame, span.endFrame])).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  it("refuses to merge repeated labels even when the label wins every frame", () => {
    const logProbs = oneHotLogProbs([1, 1, 1], 3, -0.05, -2);
    const spans = ctcForcedAlign(logProbs, [1, 1], 0);

    expect(spans.map((span) => [span.startFrame, span.endFrame])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("uses the minimum number of frames when every token is the same", () => {
    const logProbs = oneHotLogProbs([1, 0, 1, 0, 1], 3);
    const spans = ctcForcedAlign(logProbs, [1, 1, 1], 0);

    expect(spans.map((span) => [span.startFrame, span.endFrame])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("treats -Infinity as a forbidden emission but still finds a route", () => {
    const logProbs = [
      [-6, 0, NEG_INFINITY],
      [-6, NEG_INFINITY, 0],
      [0, NEG_INFINITY, NEG_INFINITY],
    ];
    const spans = ctcForcedAlign(logProbs, [1, 2], 0);

    expect(spans.map((span) => [span.startFrame, span.endFrame])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("throws when every possible route is impossible", () => {
    const logProbs = [
      [NEG_INFINITY, NEG_INFINITY],
      [NEG_INFINITY, NEG_INFINITY],
    ];
    expect(() => ctcForcedAlign(logProbs, [1], 0)).toThrow(/no CTC path/i);
  });

  it("throws when there are not enough frames for the tokens", () => {
    expect(() => ctcForcedAlign([[-1, -2]], [1, 1], 0)).toThrow(/impossible/i);
    expect(() => ctcForcedAlign([], [1], 0)).toThrow(/0 frame/i);
  });

  it("rejects malformed inputs with clear errors", () => {
    expect(() => ctcForcedAlign([[0, 0], [0]], [1], 0)).toThrow(/rectangular/i);
    expect(() => ctcForcedAlign([[]], [1], 0)).toThrow(/at least one class/i);
    expect(() => ctcForcedAlign([[0, 0]], [1], 2)).toThrow(/blankId/i);
    expect(() => ctcForcedAlign([[0, 0]], [0], 0)).toThrow(/non-blank/i);
    expect(() => ctcForcedAlign([[0, 0]], [3], 0)).toThrow(/class id/i);
    expect(() => ctcForcedAlign([[0, 0]], [1.5], 0)).toThrow(/class id/i);
    expect(() => ctcForcedAlign([[0, Number.NaN]], [1], 0)).toThrow(/finite or -Infinity/i);
    expect(() => ctcForcedAlign([[0, POSITIVE_INFINITY]], [1], 0)).toThrow(
      /finite or -Infinity/i,
    );
  });

  it("is deterministic and does not mutate its inputs", () => {
    const logProbs = oneHotLogProbs([0, 2, 2, 0, 1, 0], 3);
    const tokens = [2, 1];
    const logProbsCopy = logProbs.map((row) => row.slice());
    const tokensCopy = tokens.slice();

    const first = ctcForcedAlign(logProbs, tokens, 0);
    const second = ctcForcedAlign(logProbs, tokens, 0);

    expect(second).toEqual(first);
    expect(logProbs).toEqual(logProbsCopy);
    expect(tokens).toEqual(tokensCopy);
  });

  it("matches a brute-force Viterbi oracle on random tiny inputs", () => {
    const random = makeRandom(0x5eed);

    for (let trial = 0; trial < 30; trial++) {
      const classes = 3;
      const labelCount = randomInt(random, 1, 3);
      const tokens: number[] = [];

      for (let index = 0; index < labelCount; index++) {
        if (index > 0 && random() < 0.45) {
          tokens.push(tokens[index - 1]);
        } else {
          tokens.push(1 + randomInt(random, 0, classes - 2));
        }
      }

      let required = labelCount;
      for (let index = 1; index < labelCount; index++) {
        if (tokens[index] === tokens[index - 1]) required++;
      }

      const frames = required + randomInt(random, 0, 3);
      const logProbs = Array.from({ length: frames }, () =>
        Array.from({ length: classes }, () => -random() * 8),
      );

      const spans = ctcForcedAlign(logProbs, tokens, 0);

      assertSpansValid(spans, tokens, frames);
      expectSpanScores(logProbs, tokens, spans);

      const total = pathTotal(logProbs, tokens, 0, spans);
      const best = bruteForceBestTotal(logProbs, tokens, 0);

      expect(Number.isFinite(best)).toBe(true);
      expect(total).toBeCloseTo(best, 8);
    }
  });
});

describe("spansToWords", () => {
  it("uses the first token start and the last token end", () => {
    const texts = ["hello", "world"];
    const spans: TokenSpan[][] = [
      [{ startFrame: 0, endFrame: 2, score: -0.1 }],
      [
        { startFrame: 2, endFrame: 3, score: -0.2 },
        { startFrame: 3, endFrame: 5, score: -0.4 },
      ],
    ];

    const words = spansToWords(texts, spans, {
      frameMs: 20,
      windowIndex: 4,
      usedMs: 30_000,
    });

    expect(
      words.map((word) => [
        word.text,
        word.startMs,
        word.endMs,
        word.index,
        word.windowIndex,
      ]),
    ).toEqual([
      ["hello", 0, 40, 0, 4],
      ["world", 40, 100, 1, 4],
    ]);
    expect(words[0].confidence).toBeCloseTo(Math.exp(-0.1), 12);
    expect(words[1].confidence).toBeCloseTo(Math.exp(-0.3), 12);
  });

  it("returns nothing for no words", () => {
    expect(
      spansToWords([], [], { frameMs: 20, windowIndex: 0, usedMs: 1000 }),
    ).toEqual([]);
  });

  it("clamps confidence into [0, 1]", () => {
    const high = spansToWords(
      ["high"],
      [[{ startFrame: 0, endFrame: 1, score: 2 }]],
      { frameMs: 10, windowIndex: 0, usedMs: 100 },
    );
    expect(high[0].confidence).toBe(1);

    const zero = spansToWords(
      ["zero"],
      [[{ startFrame: 0, endFrame: 1, score: NEG_INFINITY }]],
      { frameMs: 10, windowIndex: 0, usedMs: 100 },
    );
    expect(zero[0].confidence).toBe(0);
  });

  it("clamps the end to usedMs and drops words that start in padding", () => {
    const texts = ["kept", "clipped", "padding", "later"];
    const spans: TokenSpan[][] = [
      [{ startFrame: 0, endFrame: 10, score: -1 }],
      [{ startFrame: 1495, endFrame: 1600, score: -1 }],
      [{ startFrame: 1500, endFrame: 1510, score: -1 }],
      [{ startFrame: 1520, endFrame: 1530, score: -1 }],
    ];

    const words = spansToWords(texts, spans, {
      frameMs: 20,
      windowIndex: 2,
      usedMs: 30_000,
    });

    expect(words.map((word) => [word.text, word.startMs, word.endMs])).toEqual([
      ["kept", 0, 200],
      ["clipped", 29_900, 30_000],
    ]);
  });

  it("rounds fractional frame sizes and keeps a positive duration", () => {
    const tick = spansToWords(
      ["tick"],
      [[{ startFrame: 0, endFrame: 1, score: -1 }]],
      { frameMs: 0.4, windowIndex: 0, usedMs: 10 },
    );
    expect(tick[0].startMs).toBe(0);
    expect(tick[0].endMs).toBe(1);

    const rounded = spansToWords(
      ["round"],
      [[{ startFrame: 1, endFrame: 3, score: -1 }]],
      { frameMs: 20.5, windowIndex: 0, usedMs: 1000 },
    );
    expect(rounded[0].startMs).toBe(21);
    expect(rounded[0].endMs).toBe(62);
  });

  it("repairs a zero-length token span to one millisecond", () => {
    const words = spansToWords(
      ["x"],
      [[{ startFrame: 2, endFrame: 2, score: -1 }]],
      { frameMs: 20, windowIndex: 0, usedMs: 100 },
    );
    expect(words[0].startMs).toBe(40);
    expect(words[0].endMs).toBe(41);
  });

  it("drops everything when the window has no used time", () => {
    const words = spansToWords(
      ["a"],
      [[{ startFrame: 0, endFrame: 1, score: -1 }]],
      { frameMs: 20, windowIndex: 0, usedMs: 0 },
    );
    expect(words).toEqual([]);
  });

  it("rejects mismatched or malformed inputs", () => {
    const span: TokenSpan = { startFrame: 0, endFrame: 1, score: -1 };

    expect(() =>
      spansToWords(["a"], [], { frameMs: 20, windowIndex: 0, usedMs: 100 }),
    ).toThrow(/one token-span list per word/i);

    expect(() =>
      spansToWords(["a"], [[]], { frameMs: 20, windowIndex: 0, usedMs: 100 }),
    ).toThrow(/no token spans/i);

    expect(() =>
      spansToWords(["a"], [[span]], { frameMs: 0, windowIndex: 0, usedMs: 100 }),
    ).toThrow(/frameMs/i);

    expect(() =>
      spansToWords(["a"], [[span]], { frameMs: -1, windowIndex: 0, usedMs: 100 }),
    ).toThrow(/frameMs/i);

    expect(() =>
      spansToWords(["a"], [[span]], { frameMs: 20, windowIndex: 0, usedMs: -1 }),
    ).toThrow(/usedMs/i);

    expect(() =>
      spansToWords(["a"], [[span]], { frameMs: 20, windowIndex: 0, usedMs: 10.5 }),
    ).toThrow(/usedMs/i);

    expect(() =>
      spansToWords(["a"], [[span]], { frameMs: 20, windowIndex: -1, usedMs: 100 }),
    ).toThrow(/windowIndex/i);

    expect(() =>
      spansToWords(
        ["a"],
        [[{ startFrame: 2, endFrame: 1, score: -1 }]],
        { frameMs: 20, windowIndex: 0, usedMs: 100 },
      ),
    ).toThrow(/invalid frames/i);

    expect(() =>
      spansToWords(
        ["a"],
        [[{ startFrame: -1, endFrame: 1, score: -1 }]],
        { frameMs: 20, windowIndex: 0, usedMs: 100 },
      ),
    ).toThrow(/invalid frames/i);

    expect(() =>
      spansToWords(
        ["a"],
        [[{ startFrame: 0, endFrame: 1, score: Number.NaN }]],
        { frameMs: 20, windowIndex: 0, usedMs: 100 },
      ),
    ).toThrow(/score/i);

    expect(() =>
      spansToWords(
        ["a"],
        [[{ startFrame: 0, endFrame: 1, score: POSITIVE_INFINITY }]],
        { frameMs: 20, windowIndex: 0, usedMs: 100 },
      ),
    ).toThrow(/score/i);

    expect(() =>
      spansToWords(
        ["a"],
        [
          [
            { startFrame: 5, endFrame: 6, score: -1 },
            { startFrame: 2, endFrame: 3, score: -1 },
          ],
        ],
        { frameMs: 20, windowIndex: 0, usedMs: 100 },
      ),
    ).toThrow(/overlaps|out of order/i);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const texts = ["a", "b"];
    const spans: TokenSpan[][] = [
      [{ startFrame: 0, endFrame: 2, score: -0.1 }],
      [{ startFrame: 3, endFrame: 4, score: -0.2 }],
    ];
    const textsCopy = texts.slice();
    const spansCopy = spans.map((list) => list.map((span) => ({ ...span })));
    const opts = { frameMs: 20, windowIndex: 1, usedMs: 1000 };

    const first = spansToWords(texts, spans, opts);
    const second = spansToWords(texts, spans, opts);

    expect(second).toEqual(first);
    expect(texts).toEqual(textsCopy);
    expect(spans).toEqual(spansCopy);
  });

  it("keeps every timing invariant on random monotonic spans", () => {
    const random = makeRandom(0xa11c);

    for (let trial = 0; trial < 40; trial++) {
      const wordCount = randomInt(random, 0, 8);
      const texts: string[] = [];
      const tokenSpans: TokenSpan[][] = [];
      let cursor = 0;

      for (let wordIndex = 0; wordIndex < wordCount; wordIndex++) {
        texts.push(`w${wordIndex}`);
        const tokensPerWord = randomInt(random, 1, 4);
        const spans: TokenSpan[] = [];

        for (let tokenIndex = 0; tokenIndex < tokensPerWord; tokenIndex++) {
          const length = randomInt(random, 1, 4);
          spans.push({
            startFrame: cursor,
            endFrame: cursor + length,
            score: -random() * 5,
          });
          cursor += length;
        }

        tokenSpans.push(spans);
        cursor += randomInt(random, 0, 3);
      }

      const frameMs = [10, 20, 20.5, 7.3][randomInt(random, 0, 3)];
      const usedMs = [0, 100, 1000, 10_000, 30_000][randomInt(random, 0, 4)];
      const opts = { frameMs, windowIndex: trial, usedMs };

      const words = spansToWords(texts, tokenSpans, opts);
      const again = spansToWords(texts, tokenSpans, opts);

      expect(again).toEqual(words);
      expect(words.length).toBeLessThanOrEqual(wordCount);

      for (let index = 0; index < words.length; index++) {
        const word = words[index];
        expect(word.index).toBe(index);
        expect(word.windowIndex).toBe(trial);
        expect(word.text).toBe(texts[index]);
        expect(Number.isInteger(word.startMs)).toBe(true);
        expect(Number.isInteger(word.endMs)).toBe(true);
        expect(word.startMs).toBeGreaterThanOrEqual(0);
        expect(word.startMs).toBeLessThan(word.endMs);
        expect(word.endMs).toBeLessThanOrEqual(usedMs);
        expect(word.confidence).toBeGreaterThanOrEqual(0);
        expect(word.confidence).toBeLessThanOrEqual(1);

        if (index > 0) {
          expect(word.startMs).toBeGreaterThanOrEqual(words[index - 1].startMs);
          expect(word.endMs).toBeGreaterThanOrEqual(words[index - 1].endMs);
        }
      }

      let expectedKept = 0;
      for (let wordIndex = 0; wordIndex < wordCount; wordIndex++) {
        const startMs = Math.round(tokenSpans[wordIndex][0].startFrame * frameMs);
        if (startMs < usedMs) expectedKept++;
        else break;
      }
      expect(words.length).toBe(expectedKept);
    }
  });
});

describe("bandedDtw", () => {
  it("returns an empty path for empty input", () => {
    expect(bandedDtw([], 0)).toEqual({ path: [], total: 0 });
    expect(bandedDtw([[]], 3)).toEqual({ path: [], total: 0 });
  });

  it("aligns a single cell", () => {
    expect(bandedDtw([[2]], 0)).toEqual({ path: [[0, 0]], total: 2 });
  });

  it("follows the diagonal with a zero band", () => {
    const cost = [
      [1, 9, 9],
      [9, 1, 9],
      [9, 9, 1],
    ];
    const result = bandedDtw(cost, 0);

    expect(result.path).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(result.total).toBe(3);
  });

  it("finds a cheaper off-diagonal route only when the band allows it", () => {
    const cost = [
      [5, 0, 9],
      [9, 5, 0],
      [9, 9, 5],
    ];

    const narrow = bandedDtw(cost, 0);
    expect(narrow.path).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(narrow.total).toBe(15);

    const wide = bandedDtw(cost, 1);
    expect(wide.path).toEqual([
      [0, 0],
      [0, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(wide.total).toBe(10);
  });

  it("walks a rectangular grid when the band is just wide enough", () => {
    const result = bandedDtw([[1], [2], [3], [4]], 3);

    expect(result.path).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(result.total).toBe(10);
  });

  it("throws when the band cannot reach the far corner", () => {
    expect(() => bandedDtw([[1], [2], [3]], 0)).toThrow(/too narrow/i);
  });

  it("rejects malformed matrices and bands", () => {
    expect(() => bandedDtw([[1, 2], [3]], 1)).toThrow(/rectangular/i);
    expect(() => bandedDtw([[1, Number.NaN]], 1)).toThrow(/finite/i);
    expect(() => bandedDtw([[1, POSITIVE_INFINITY]], 1)).toThrow(/finite/i);
    expect(() => bandedDtw([[1]], -1)).toThrow(/band/i);
    expect(() => bandedDtw([[1]], Number.NaN)).toThrow(/band/i);
  });

  it("is deterministic and does not mutate the cost matrix", () => {
    const cost = [
      [0, 1, 4],
      [1, 0, 1],
      [4, 1, 0],
    ];
    const copy = cost.map((row) => row.slice());

    const first = bandedDtw(cost, 1);
    const second = bandedDtw(cost, 1);

    expect(second).toEqual(first);
    expect(cost).toEqual(copy);
  });

  it("equals the full DP when the band covers the whole matrix", () => {
    const random = makeRandom(0x0d7);

    for (let trial = 0; trial < 30; trial++) {
      const rows = randomInt(random, 1, 6);
      const cols = randomInt(random, 1, 6);
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => random() * 10 - 5),
      );

      const expected = fullDtwReference(cost);
      const actual = bandedDtw(cost, Math.max(rows, cols) + 2);

      expect(actual.total).toBeCloseTo(expected.total, 10);
      expect(actual.path).toEqual(expected.path);
    }
  });

  it("keeps path and total invariants on random banded matrices", () => {
    const random = makeRandom(0xbeef);

    for (let trial = 0; trial < 40; trial++) {
      const rows = randomInt(random, 1, 7);
      const cols = randomInt(random, 1, 7);
      const band = Math.abs(rows - cols) + randomInt(random, 0, 4);
      const cost = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => random() * 8 - 4),
      );

      const { path, total } = bandedDtw(cost, band);

      expect(path.length).toBeGreaterThan(0);
      expect(path[0]).toEqual([0, 0]);
      expect(path[path.length - 1]).toEqual([rows - 1, cols - 1]);

      let sum = 0;
      for (let step = 0; step < path.length; step++) {
        const [row, col] = path[step];
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(rows);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(cols);
        expect(Math.abs(row - col)).toBeLessThanOrEqual(band);
        sum += cost[row][col];

        if (step > 0) {
          const [previousRow, previousCol] = path[step - 1];
          const rowStep = row - previousRow;
          const colStep = col - previousCol;
          expect(rowStep === 0 || rowStep === 1).toBe(true);
          expect(colStep === 0 || colStep === 1).toBe(true);
          expect(rowStep + colStep).toBeGreaterThan(0);
        }
      }

      expect(total).toBeCloseTo(sum, 9);
      expect(total).toBeCloseTo(bandedDtwReference(cost, band), 9);
    }
  });
});
