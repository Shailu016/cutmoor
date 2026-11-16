import { describe, expect, it } from "vitest";
import { coverageOf, summariseErrors, timingError, type TimedWordLike } from "./timing";

function word(text: string, startMs: number, endMs?: number): TimedWordLike {
  return endMs === undefined ? { text, startMs } : { text, startMs, endMs };
}

describe("summariseErrors", () => {
  it("uses mean, linearly interpolated median and p90, and max", () => {
    const stats = summariseErrors([30, 0, 20, 10]);
    expect(stats.maeMs).toBe(15);
    expect(stats.medianMs).toBe(15);
    expect(stats.p90Ms).toBe(27);
    expect(stats.maxMs).toBe(30);
  });

  it("returns nulls for an empty series instead of NaN", () => {
    expect(summariseErrors([])).toEqual({ maeMs: null, medianMs: null, p90Ms: null, maxMs: null });
  });

  it("reports the single value for a one-element series", () => {
    expect(summariseErrors([42])).toEqual({ maeMs: 42, medianMs: 42, p90Ms: 42, maxMs: 42 });
  });
});

describe("timingError", () => {
  const reference = [word("alpha", 0, 100), word("beta", 200, 300), word("gamma", 400, 500)];
  const hypothesis = [word("alpha", 10, 120), word("beta", 230, 330), word("gamma", 400, 480)];

  it("computes onset, offset and boundary errors for matched words", () => {
    const metrics = timingError(hypothesis, reference);
    expect(metrics.matched).toBe(3);
    expect(metrics.unusable).toBe(0);

    expect(metrics.onset.maeMs).toBeCloseTo(40 / 3, 12);
    expect(metrics.onset.medianMs).toBe(10);
    expect(metrics.onset.p90Ms).toBeCloseTo(26, 12);
    expect(metrics.onset.maxMs).toBe(30);

    expect(metrics.offset.maeMs).toBeCloseTo(70 / 3, 12);
    expect(metrics.offset.medianMs).toBe(20);
    expect(metrics.offset.p90Ms).toBeCloseTo(28, 12);
    expect(metrics.offset.maxMs).toBe(30);

    expect(metrics.boundary.maeMs).toBeCloseTo(55 / 3, 12);
    expect(metrics.boundary.medianMs).toBe(15);
    expect(metrics.boundary.p90Ms).toBeCloseTo(27, 12);
    expect(metrics.boundary.maxMs).toBe(30);

    expect(metrics.onsetBiasMs).toBeCloseTo(40 / 3, 12);
    expect(metrics.offsetBiasMs).toBeCloseTo(10, 12);
  });

  it("counts only words the WER aligner matched", () => {
    const hyp = [word("alpha", 10, 120), word("zeta", 20_000, 21_000), word("gamma", 400, 480)];
    const metrics = timingError(hyp, reference);
    expect(metrics.matched).toBe(2);
    // alpha and gamma: boundary errors (10+20)/2 = 15 and (0+20)/2 = 10; zeta's absurd times must not leak in.
    expect(metrics.onset.maeMs).toBeCloseTo(5, 12);
    expect(metrics.onset.maxMs).toBe(10);
    expect(metrics.boundary.maeMs).toBeCloseTo(12.5, 12);
  });

  it("ignores inserted words", () => {
    const hyp = [word("alpha", 10, 120), word("noise", 5000, 5100), word("beta", 230, 330), word("gamma", 400, 480)];
    const metrics = timingError(hyp, reference);
    expect(metrics.matched).toBe(3);
    expect(metrics.onset.maxMs).toBe(30);
  });

  it("aligns through spelling variants instead of shifting every later word", () => {
    const ref = [word("nahin", 0, 100), word("yaar", 200, 300)];
    const hyp = [word("Nahin", 20, 120), word("yaar", 210, 310)];
    const metrics = timingError(hyp, ref);
    expect(metrics.matched).toBe(2);
    expect(metrics.onset.maeMs).toBeCloseTo(15, 12);
  });

  it("falls back to onset-only when the reference has no end times", () => {
    const ref = [word("alpha", 0), word("beta", 200)];
    const hyp = [word("alpha", 10, 120), word("beta", 230, 330)];
    const metrics = timingError(hyp, ref);
    expect(metrics.offset.maeMs).toBeNull();
    expect(metrics.offsetBiasMs).toBeNull();
    expect(metrics.boundary.maeMs).toBe(metrics.onset.maeMs);
    expect(metrics.onset.maeMs).toBeCloseTo(20, 12);
  });

  it("returns nulls when nothing matched", () => {
    const metrics = timingError([word("gamma", 1000, 1100)], [word("alpha", 0, 100)]);
    expect(metrics.matched).toBe(0);
    expect(metrics.onset.maeMs).toBeNull();
    expect(metrics.boundary.maeMs).toBeNull();
    expect(metrics.onsetBiasMs).toBeNull();
  });

  it("uses the reference as the anchor, so swapping the arguments changes the sign", () => {
    const forward = timingError(hypothesis, reference);
    const backward = timingError(reference, hypothesis);
    expect(backward.onsetBiasMs).toBeCloseTo(-(forward.onsetBiasMs ?? Number.NaN), 12);
    expect(backward.onset.maeMs).toBeCloseTo(forward.onset.maeMs ?? Number.NaN, 12);
  });

  it("skips matched words whose timestamps are not finite instead of producing NaN", () => {
    const metrics = timingError([word("alpha", Number.NaN, 120), word("beta", 230, 330)], reference.slice(0, 2));
    expect(metrics.matched).toBe(1);
    expect(metrics.unusable).toBe(1);
    expect(metrics.onset.maeMs).toBe(30);
  });
});

describe("coverageOf", () => {
  const speech = [
    { startMs: 0, endMs: 1000 },
    { startMs: 1500, endMs: 2500 },
  ];

  it("is 1 when the words tile the speech exactly", () => {
    const words = [word("a", 0, 1000), word("b", 1500, 2500)];
    const report = coverageOf(words, speech);
    expect(report?.coverage).toBe(1);
    expect(report?.gaps).toEqual([]);
  });

  it("measures the uncovered share and reports gaps above the minimum", () => {
    const words = [word("a", 0, 1000), word("b", 1500, 2400)];
    expect(coverageOf(words, speech)?.coverage).toBeCloseTo(0.95, 12);
    expect(coverageOf(words, speech)?.gaps).toEqual([]);
    expect(coverageOf(words, speech, 50)?.gaps).toEqual([{ startMs: 2400, endMs: 2500 }]);
  });

  it("returns null without speech intervals, so coverage cannot fake a pass", () => {
    expect(coverageOf([word("a", 0, 1000)], [])).toBeNull();
  });

  it("merges overlapping speech intervals before counting", () => {
    const overlapping = [
      { startMs: 0, endMs: 1000 },
      { startMs: 500, endMs: 1500 },
    ];
    const words = [word("a", 0, 1500)];
    expect(coverageOf(words, overlapping)?.coverage).toBe(1);
  });

  it("treats a missing word end as a zero-length word", () => {
    const words = [word("a", 0)]; // no endMs: covers nothing
    expect(coverageOf(words, [{ startMs: 0, endMs: 1000 }])?.coverage).toBe(0);
  });
});
