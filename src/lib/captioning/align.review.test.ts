import { describe, expect, it } from "vitest";
import { ctcForcedAlign, type TokenSpan } from "./align";

/**
 * Reviewer's oracle (Claude, reviewing DeepSeek's align.ts): enumerate EVERY legal CTC path of a
 * tiny problem and check that the aligner returns one with the best possible total log-probability.
 * Independent of the implementation: it only uses the CTC rules.
 *
 * A path is a class per frame. It is legal when collapsing repeats and removing blanks gives exactly
 * the token sequence.
 */
function collapse(path: number[], blank: number): number[] {
  const out: number[] = [];
  let previous = -1;
  for (const cls of path) {
    if (cls !== previous && cls !== blank) out.push(cls);
    previous = cls;
  }
  return out;
}

function bestScore(logProbs: number[][], tokens: number[], blank: number): number {
  const frames = logProbs.length;
  const classes = logProbs[0].length;
  let best = -Infinity;
  const path = new Array<number>(frames).fill(0);
  const walk = (frame: number, total: number) => {
    if (frame === frames) {
      const collapsed = collapse(path, blank);
      if (collapsed.length === tokens.length && collapsed.every((value, i) => value === tokens[i])) best = Math.max(best, total);
      return;
    }
    for (let cls = 0; cls < classes; cls += 1) {
      path[frame] = cls;
      walk(frame + 1, total + logProbs[frame][cls]);
    }
  };
  walk(0, 0);
  return best;
}

/** Score of the path the spans describe: token frames inside their span, blank everywhere else. */
function scoreOfSpans(logProbs: number[][], tokens: number[], blank: number, spans: TokenSpan[]): number {
  const path = new Array<number>(logProbs.length).fill(blank);
  spans.forEach((span, i) => {
    for (let frame = span.startFrame; frame < span.endFrame; frame += 1) path[frame] = tokens[i];
  });
  // The spans must describe a legal CTC path.
  const collapsed = collapse(path, blank);
  expect(collapsed).toEqual(tokens);
  return path.reduce((sum, cls, frame) => sum + logProbs[frame][cls], 0);
}

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("ctcForcedAlign against a brute-force oracle (reviewer's test)", () => {
  it("always finds the best-scoring legal alignment on tiny random problems", () => {
    const next = random(2024);
    let checked = 0;
    for (let round = 0; round < 400; round += 1) {
      const classes = 3 + Math.floor(next() * 2); // blank = 0, tokens from 1..classes-1
      const tokenCount = 1 + Math.floor(next() * 3);
      const tokens = Array.from({ length: tokenCount }, () => 1 + Math.floor(next() * (classes - 1)));
      let needed = tokenCount;
      for (let i = 1; i < tokens.length; i += 1) if (tokens[i] === tokens[i - 1]) needed += 1;
      const frames = needed + Math.floor(next() * 4);
      if (frames > 7) continue;
      const logProbs = Array.from({ length: frames }, () => {
        const raw = Array.from({ length: classes }, () => next() + 0.01);
        const total = raw.reduce((a, b) => a + b, 0);
        return raw.map((value) => Math.log(value / total));
      });
      const spans = ctcForcedAlign(logProbs, tokens, 0);
      expect(spans).toHaveLength(tokens.length);
      for (let i = 0; i < spans.length; i += 1) {
        expect(spans[i].endFrame).toBeGreaterThan(spans[i].startFrame);
        if (i > 0) {
          expect(spans[i].startFrame).toBeGreaterThanOrEqual(spans[i - 1].endFrame);
          // Repeated tokens need at least one blank frame between them.
          if (tokens[i] === tokens[i - 1]) expect(spans[i].startFrame).toBeGreaterThan(spans[i - 1].endFrame);
        }
      }
      expect(scoreOfSpans(logProbs, tokens, 0, spans)).toBeCloseTo(bestScore(logProbs, tokens, 0), 9);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("handles impossible emissions (-Infinity) without choosing them", () => {
    const logProbs = [
      [Math.log(0.5), Math.log(0.5), -Infinity],
      [-Infinity, Math.log(0.9), Math.log(0.1)],
      [Math.log(0.2), Math.log(0.1), Math.log(0.7)],
    ];
    const spans = ctcForcedAlign(logProbs, [1, 2], 0);
    expect(scoreOfSpans(logProbs, [1, 2], 0, spans)).toBeCloseTo(bestScore(logProbs, [1, 2], 0), 9);
  });
});
