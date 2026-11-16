import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import type { Word } from "../types";
import {
  DEFAULT_THRESHOLDS,
  evaluateClip,
  evaluateRun,
  parseClipsManifest,
  parseHypothesisFile,
  parseThresholds,
  renderTable,
  reportToJson,
  resolveThresholds,
  type ClipsManifest,
  type EvalClip,
  type HypothesisFile,
  type ThresholdFile,
} from "./report";

/** Minimal `Word[]` builder; the scorer only reads text/start/end. */
function w(text: string, startMs: number, endMs: number): Word {
  return { text, startMs, endMs, confidence: 1, index: 0, windowIndex: 0 };
}

function words(pairs: ReadonlyArray<readonly [string, number, number]>): Word[] {
  return pairs.map(([text, startMs, endMs]) => w(text, startMs, endMs));
}

const clip: EvalClip = {
  id: "c1",
  language: "hinglish",
  media: "media/c1.mp4",
  reference: "ek do teen",
  referenceWords: [
    { text: "ek", startMs: 0, endMs: 100 },
    { text: "do", startMs: 100, endMs: 200 },
    { text: "teen", startMs: 200, endMs: 300 },
  ],
  speech: [{ startMs: 0, endMs: 300 }],
  tags: ["talking-head"],
};

const perfect = words([
  ["ek", 0, 100],
  ["do", 100, 200],
  ["teen", 200, 300],
]);

function expectInvalid(run: () => unknown, pattern?: RegExp): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CaptionError);
    const captionError = error as CaptionError;
    expect(captionError.code).toBe("unsupported-file");
    if (pattern) expect(captionError.message).toMatch(pattern);
    return;
  }
  throw new Error("expected a CaptionError, but the call returned");
}

describe("resolveThresholds", () => {
  const file: ThresholdFile = {
    default: { werMax: 0.3 },
    byLanguage: { hinglish: { werMax: 0.2 } },
    byTag: { "talking-head": { werMax: 0.15, timingMaeMsMax: 80 } },
    byClip: { c1: { werMax: 0.1 } },
  };

  it("layers default, language, tag and clip, strongest last", () => {
    expect(resolveThresholds(file, clip)).toEqual({ werMax: 0.1, timingMaeMsMax: 80, coverageMin: 0.995 });
    expect(resolveThresholds(file, { ...clip, id: "other" }).werMax).toBe(0.15);
    expect(resolveThresholds(file, { ...clip, id: "other", tags: [] }).werMax).toBe(0.2);
    expect(resolveThresholds(file, { ...clip, id: "other", tags: [], language: "hindi" })).toEqual({
      werMax: 0.3,
      timingMaeMsMax: 120,
      coverageMin: 0.995,
    });
  });

  it("uses the MVP defaults for a null file", () => {
    expect(resolveThresholds(null, clip)).toEqual(DEFAULT_THRESHOLDS);
    expect(resolveThresholds(undefined, clip)).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("evaluateClip", () => {
  it("passes a perfect hypothesis", () => {
    const result = evaluateClip(clip, { words: perfect }, DEFAULT_THRESHOLDS);
    expect(result.scored).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.metrics?.wer.wer).toBe(0);
    expect(result.metrics?.timing.boundary.maeMs).toBe(0);
    expect(result.metrics?.coverage?.coverage).toBe(1);
    expect(result.notes).toEqual([]);
  });

  it("fails a word error rate above the limit and reports the measured value", () => {
    const result = evaluateClip(clip, { words: words([["ek", 0, 100], ["do", 100, 200], ["chaar", 200, 300]]) }, DEFAULT_THRESHOLDS);
    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual({ metric: "wer", rule: "max", actual: 1 / 3, limit: 0.18 });
  });

  it("treats a limit as inclusive", () => {
    const fourWords: EvalClip = { ...clip, reference: "a b c d", referenceWords: undefined, speech: undefined };
    const result = evaluateClip(
      fourWords,
      { words: words([["a", 0, 1], ["b", 0, 1], ["c", 0, 1], ["x", 0, 1]]) },
      { ...DEFAULT_THRESHOLDS, werMax: 0.25 },
    );
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("fails timing above the limit", () => {
    const shifted = words([["ek", 200, 300], ["do", 400, 500], ["teen", 600, 700]]);
    const result = evaluateClip(
      clip,
      { words: shifted },
      { ...DEFAULT_THRESHOLDS, timingMaeMsMax: 120 },
    );
    expect(result.metrics?.timing.boundary.maeMs).toBe(300);
    expect(result.failures).toContainEqual({ metric: "timingMae", rule: "max", actual: 300, limit: 120 });
    expect(result.pass).toBe(false);
  });

  it("fails coverage below the limit while the words themselves are right", () => {
    const halfCovered = words([["ek", 0, 50], ["do", 50, 100], ["teen", 100, 150]]);
    const result = evaluateClip(
      clip,
      { words: halfCovered },
      { ...DEFAULT_THRESHOLDS, timingMaeMsMax: 1000 },
    );
    expect(result.metrics?.wer.wer).toBe(0);
    expect(result.metrics?.coverage?.coverage).toBeCloseTo(0.5, 12);
    expect(result.failures).toContainEqual({ metric: "coverage", rule: "min", actual: 0.5, limit: 0.995 });
    expect(result.pass).toBe(false);
  });

  it("does not invent a timing or coverage failure when the manifest cannot measure them", () => {
    const bare: EvalClip = { id: "bare", language: "hindi", media: "m.mp4", reference: "ek do" };
    const result = evaluateClip(bare, { words: words([["ek", 0, 1], ["do", 2, 3]]) }, DEFAULT_THRESHOLDS);
    expect(result.pass).toBe(true);
    expect(result.metrics?.timing.boundary.maeMs).toBeNull();
    expect(result.metrics?.coverage).toBeNull();
    expect(result.notes).toEqual([
      "timing skipped: manifest has no referenceWords",
      "coverage skipped: manifest has no speech intervals",
    ]);
  });

  it("explains a missing offset series when reference words have no end times", () => {
    const startsOnly: EvalClip = {
      id: "starts",
      language: "hindi",
      media: "m.mp4",
      reference: "ek do",
      referenceWords: [{ text: "ek", startMs: 0 }, { text: "do", startMs: 200 }],
      speech: [{ startMs: 0, endMs: 100 }, { startMs: 200, endMs: 300 }],
    };
    const result = evaluateClip(startsOnly, { words: words([["ek", 0, 100], ["do", 200, 300]]) }, DEFAULT_THRESHOLDS);
    expect(result.pass).toBe(true);
    expect(result.metrics?.timing.offset.maeMs).toBeNull();
    expect(result.notes).toEqual(["offset skipped: reference words have no endMs"]);
  });

  it("turns a missing hypothesis into a failure rather than a silent skip", () => {
    const result = evaluateClip(clip, undefined, DEFAULT_THRESHOLDS);
    expect(result).toMatchObject({ scored: false, pass: false, metrics: null, failures: [] });
    expect(result.notes).toEqual(["no hypothesis for this clip"]);
  });
});

describe("evaluateRun", () => {
  const manifest: ClipsManifest = {
    clips: [
      { ...clip, id: "a" },
      { ...clip, id: "b" },
    ],
  };

  it("fails missing clips and lists unknown hypothesis ids", () => {
    const hypothesis: HypothesisFile = { a: { words: perfect }, ghost: { words: perfect } };
    const report = evaluateRun(manifest, hypothesis);
    expect(report.pass).toBe(false);
    expect(report.missingClips).toEqual(["b"]);
    expect(report.unknownClips).toEqual(["ghost"]);
    expect(report.summary).toEqual({ clips: 2, scored: 1, passed: 1, failed: 1, missing: 1 });
  });

  it("pools WER per language instead of averaging short and long clips equally", () => {
    const unequal: ClipsManifest = {
      clips: [
        { id: "short", language: "hinglish", media: "s.mp4", reference: "a b" },
        { id: "long", language: "hinglish", media: "l.mp4", reference: "c d e f" },
      ],
    };
    const report = evaluateRun(unequal, {
      short: { words: words([["a", 0, 1], ["x", 1, 2]]) }, // 1 error / 2 words
      long: { words: words([["c", 0, 1], ["d", 1, 2], ["e", 2, 3], ["f", 3, 4]]) }, // 0 errors / 4 words
    });
    expect(report.byLanguage).toHaveLength(1);
    expect(report.byLanguage[0]).toMatchObject({ language: "hinglish", clips: 2, refWords: 6, errors: 1 });
    expect(report.byLanguage[0].wer).toBeCloseTo(1 / 6, 12);
    expect(report.byLanguage[0].meanTimingMaeMs).toBeNull();
    expect(report.byLanguage[0].meanCoverage).toBeNull();
  });

  it("passes only when every clip passes and at least one clip exists", () => {
    expect(evaluateRun(manifest, { a: { words: perfect }, b: { words: perfect } }).pass).toBe(true);
    expect(evaluateRun({ clips: [] }, {}).pass).toBe(false);
  });
});

describe("renderTable and JSON", () => {
  const report = evaluateRun(
    { clips: [{ ...clip, id: "good" }, { ...clip, id: "missing" }] },
    { good: { words: perfect } },
  );

  it("prints the clips, the verdict and the skipped-metric notes", () => {
    const table = renderTable(report);
    expect(table).toContain("clip");
    expect(table).toContain("good");
    expect(table).toContain("PASS");
    expect(table).toContain("missing");
    expect(table).toContain("FAIL");
    expect(table).toContain("clips 2 | scored 1 | passed 1 | failed 1 | missing 1");
    expect(table).toContain("note missing: no hypothesis for this clip");
    expect(renderTable(report)).toBe(table);
  });

  it("serialises to strict JSON that round-trips", () => {
    const json = reportToJson(report);
    expect(json).not.toMatch(/NaN|Infinity/);
    expect(JSON.parse(json)).toEqual(report);
  });

  it("renders a threshold failure with its limit", () => {
    const failing = evaluateRun({ clips: [{ ...clip, id: "bad" }] }, { bad: { words: [w("galat", 0, 10)] } });
    const table = renderTable(failing);
    expect(table).toContain("fail bad: wer");
    expect(table).toContain("limit <= 0.18");
  });
});

describe("parseClipsManifest", () => {
  it("accepts a minimal manifest and defaults optional fields", () => {
    const parsed = parseClipsManifest({
      clips: [{ id: "a", language: "hindi", media: "m.mp4", reference: "ek do" }],
    });
    expect(parsed.clips).toHaveLength(1);
    expect(parsed.clips[0]).toEqual({ id: "a", language: "hindi", media: "m.mp4", reference: "ek do" });
  });

  it("accepts referenceWords that differ from the reference only in punctuation and case", () => {
    const parsed = parseClipsManifest({
      clips: [
        {
          id: "a",
          language: "hinglish",
          media: "m.mp4",
          reference: "yaar yeh Video achhi hai",
          referenceWords: [
            { text: "Yaar,", startMs: 0, endMs: 100 },
            { text: "yeh", startMs: 100, endMs: 200 },
            { text: "video", startMs: 200, endMs: 300 },
            { text: "achhi", startMs: 300, endMs: 400 },
            { text: "hai", startMs: 400, endMs: 500 },
          ],
        },
      ],
    });
    expect(parsed.clips[0].referenceWords).toHaveLength(5);
  });

  it("rejects an empty manifest instead of reporting a perfect empty run", () => {
    expectInvalid(() => parseClipsManifest({ clips: [] }), /empty/);
  });

  it("rejects duplicate ids, bad languages and empty references", () => {
    expectInvalid(
      () =>
        parseClipsManifest({
          clips: [
            { id: "a", language: "hindi", media: "m", reference: "ek" },
            { id: "a", language: "hindi", media: "m", reference: "do" },
          ],
        }),
      /used twice/,
    );
    expectInvalid(() => parseClipsManifest({ clips: [{ id: "a", language: "bengali", media: "m", reference: "ek" }] }), /language/);
    expectInvalid(() => parseClipsManifest({ clips: [{ id: "a", language: "hindi", media: "m", reference: "— ।" }] }), /no words/);
  });

  it("rejects reference word times that belong to a different sentence", () => {
    expectInvalid(
      () =>
        parseClipsManifest({
          clips: [
            {
              id: "a",
              language: "hindi",
              media: "m",
              reference: "ek do teen",
              referenceWords: [
                { text: "ek", startMs: 0, endMs: 100 },
                { text: "do", startMs: 100, endMs: 200 },
                { text: "chaar", startMs: 200, endMs: 300 },
              ],
            },
          ],
        }),
      /spell the reference/,
    );
  });

  it("rejects inverted or negative speech intervals", () => {
    expectInvalid(
      () => parseClipsManifest({ clips: [{ id: "a", language: "hindi", media: "m", reference: "ek", speech: [{ startMs: 10, endMs: 5 }] }] }),
      /before startMs/,
    );
    expectInvalid(
      () => parseClipsManifest({ clips: [{ id: "a", language: "hindi", media: "m", reference: "ek", speech: [{ startMs: -1, endMs: 5 }] }] }),
      /negative/,
    );
  });
});

describe("parseHypothesisFile", () => {
  it("fills optional Word fields so the result is a real Word[]", () => {
    const parsed = parseHypothesisFile({ a: { words: [{ text: "ek", startMs: 0, endMs: 100 }] } });
    expect(parsed).toEqual({
      a: {
        words: [{ text: "ek", startMs: 0, endMs: 100, confidence: 1, index: 0, windowIndex: 0 }],
      },
    });
  });

  it("keeps supplied confidence and indices", () => {
    const parsed = parseHypothesisFile({
      a: { words: [{ text: "ek", startMs: 0, endMs: 100, confidence: 0.5, index: 7, windowIndex: 2 }] },
    });
    expect(parsed.a.words[0]).toMatchObject({ confidence: 0.5, index: 7, windowIndex: 2 });
  });

  it("accepts a silent clip", () => {
    expect(parseHypothesisFile({ a: { words: [] } })).toEqual({ a: { words: [] } });
  });

  it("rejects timestamps that cannot describe a word", () => {
    expectInvalid(() => parseHypothesisFile({ a: { words: [{ text: "ek", startMs: 100, endMs: 50 }] } }), /before startMs/);
    expectInvalid(
      () => parseHypothesisFile({ a: { words: [{ text: "ek", startMs: 0, endMs: 50, confidence: 2 }] } }),
      /confidence/,
    );
    expectInvalid(() => parseHypothesisFile({ a: { words: [{ text: "", startMs: 0, endMs: 50 }] } }), /text/);
  });
});

describe("parseThresholds", () => {
  it("accepts every section and partial values", () => {
    expect(
      parseThresholds({
        default: { werMax: 0.2 },
        byLanguage: { hindi: { coverageMin: 0.9 } },
        byTag: { "talking-head": { timingMaeMsMax: 90 } },
        byClip: { a: { werMax: 0.05 } },
      }),
    ).toEqual({
      default: { werMax: 0.2 },
      byLanguage: { hindi: { coverageMin: 0.9 } },
      byTag: { "talking-head": { timingMaeMsMax: 90 } },
      byClip: { a: { werMax: 0.05 } },
    });
  });

  it("rejects typos instead of silently disabling a limit", () => {
    expectInvalid(() => parseThresholds({ default: { wermax: 0.2 } }), /not a known threshold/);
    expectInvalid(() => parseThresholds({ byLanguage: { bengali: { werMax: 0.2 } } }), /unknown language/);
    expectInvalid(() => parseThresholds({ defaults: { werMax: 0.2 } }), /not known/);
  });

  it("rejects impossible limits", () => {
    expectInvalid(() => parseThresholds({ default: { coverageMin: 1.5 } }), /between 0 and 1/);
    expectInvalid(() => parseThresholds({ default: { werMax: -0.1 } }), /negative/);
    expectInvalid(() => parseThresholds({ default: { werMax: "0.2" } }), /finite number/);
  });
});
