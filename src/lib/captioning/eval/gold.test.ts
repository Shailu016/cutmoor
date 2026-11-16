import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import type { Word } from "../types";
import {
  DEFAULT_GOLD_THRESHOLDS,
  evaluateGoldRun,
  parseGoldHypothesisFile,
  parseGoldManifest,
  parseGoldThresholds,
  type GoldClip,
  type GoldHypothesis,
  type GoldHypothesisClip,
  type GoldManifest,
  type GoldThresholds,
} from "./gold";
import { parseThresholds } from "./report";

/**
 * Tests for the gold-set scorer. The arithmetic is worked out by hand in the assertions (not
 * recomputed with the implementation), so a wrong formula fails here.
 */

function word(text: string, startMs: number, endMs: number): Word {
  return { text, startMs, endMs, confidence: 1, index: 0, windowIndex: 0 };
}

function words(pairs: ReadonlyArray<readonly [string, number, number]>): Word[] {
  return pairs.map(([text, startMs, endMs]) => word(text, startMs, endMs));
}

function makeClip(id: string, overrides: Partial<GoldClip> = {}): GoldClip {
  return {
    id,
    path: `media/${id}.mp4`,
    tags: [],
    references: ["a b"],
    expectNoWords: false,
    ...overrides,
  };
}

function makeManifest(clips: GoldClip[]): GoldManifest {
  return { clips };
}

function hypothesisClip(clipWords: Word[], seconds: number | null = null): GoldHypothesisClip {
  return { words: clipWords, seconds };
}

function makeHypothesis(clips: Record<string, GoldHypothesisClip>): GoldHypothesis {
  return { model: "test-model", backend: "test-backend", device: "test-device", clips };
}

function score(
  manifest: GoldManifest,
  clips: Record<string, GoldHypothesisClip>,
  thresholds: GoldThresholds = DEFAULT_GOLD_THRESHOLDS,
) {
  return evaluateGoldRun(manifest, makeHypothesis(clips), thresholds);
}

function withLimits(overrides: Partial<GoldThresholds>): GoldThresholds {
  return { ...DEFAULT_GOLD_THRESHOLDS, ...overrides };
}

function expectInvalid(run: () => unknown, pattern: RegExp): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CaptionError);
  expect((caught as CaptionError).code).toBe("unsupported-file");
  expect((caught as CaptionError).message).toMatch(pattern);
}

// ---------------------------------------------------------------- manifest parsing

describe("gold manifest parsing", () => {
  const timedClip = {
    id: "clean-01",
    path: "local/clean-01.mp4",
    tags: ["clean", "fast"],
    references: ["yaar yeh", "yaar ye"],
    wordTimes: [
      { text: "yaar", startMs: 0, endMs: 300 },
      { text: "yeh", startMs: 320, endMs: 600 },
    ],
  };

  it("accepts references and hand-checked word times", () => {
    const manifest = parseGoldManifest({ version: 1, notes: "private", clips: [timedClip] });
    expect(manifest.version).toBe(1);
    expect(manifest.notes).toBe("private");
    expect(manifest.clips).toHaveLength(1);
    expect(manifest.clips[0].references).toEqual(timedClip.references);
    expect(manifest.clips[0].wordTimes).toHaveLength(2);
    expect(manifest.clips[0].expectNoWords).toBe(false);
  });

  it("de-duplicates tags in first-seen order", () => {
    const manifest = parseGoldManifest({
      clips: [{ ...timedClip, tags: ["fast", "clean", "fast"] }],
    });
    expect(manifest.clips[0].tags).toEqual(["fast", "clean"]);
  });

  it("rejects an unknown tag", () => {
    expectInvalid(
      () => parseGoldManifest({ clips: [{ ...timedClip, tags: ["wavey"] }] }),
      /"wavey" is not one of/,
    );
  });

  it("rejects duplicate clip ids", () => {
    expectInvalid(
      () => parseGoldManifest({ clips: [timedClip, { ...timedClip, path: "other.mp4" }] }),
      /used twice/,
    );
  });

  it("rejects a clip without a path", () => {
    const { path: _path, ...noPath } = timedClip;
    expectInvalid(() => parseGoldManifest({ clips: [noPath] }), /path must be a non-empty string/);
  });

  it("rejects a normal clip with no references", () => {
    const { references: _references, ...noReferences } = timedClip;
    expectInvalid(() => parseGoldManifest({ clips: [noReferences] }), /references is required/);
  });

  it("rejects a reference that has no scoreable words", () => {
    expectInvalid(
      () => parseGoldManifest({ clips: [{ ...timedClip, references: ["--- ..."] }] }),
      /no words to score/,
    );
  });

  it("accepts a silence clip with no references key", () => {
    const manifest = parseGoldManifest({
      clips: [{ id: "s", path: "local/s.wav", tags: ["silence"], expectNoWords: true }],
    });
    expect(manifest.clips[0].references).toEqual([]);
    expect(manifest.clips[0].expectNoWords).toBe(true);
  });

  it("accepts a music clip with an empty references array", () => {
    const manifest = parseGoldManifest({
      clips: [{ id: "m", path: "local/m.wav", tags: ["music"], references: [], expectNoWords: true }],
    });
    expect(manifest.clips[0].references).toEqual([]);
  });

  it("rejects expectNoWords without a silence or music tag", () => {
    expectInvalid(
      () =>
        parseGoldManifest({
          clips: [{ id: "s", path: "local/s.wav", tags: ["clean"], references: [], expectNoWords: true }],
        }),
      /needs a "silence" or "music" tag/,
    );
  });

  it("rejects reference text on an expectNoWords clip", () => {
    expectInvalid(
      () =>
        parseGoldManifest({
          clips: [{ id: "s", path: "local/s.wav", tags: ["silence"], references: ["hello"], expectNoWords: true }],
        }),
      /must be empty when expectNoWords is true/,
    );
  });

  it("rejects word times on an expectNoWords clip", () => {
    expectInvalid(
      () =>
        parseGoldManifest({
          clips: [
            {
              id: "s",
              path: "local/s.wav",
              tags: ["silence"],
              references: [],
              expectNoWords: true,
              wordTimes: [{ text: "a", startMs: 0, endMs: 10 }],
            },
          ],
        }),
      /makes no sense when expectNoWords is true/,
    );
  });

  it("rejects word times that do not spell references[0]", () => {
    expectInvalid(
      () =>
        parseGoldManifest({
          clips: [
            {
              ...timedClip,
              references: ["a b"],
              wordTimes: [
                { text: "a", startMs: 0, endMs: 100 },
                { text: "c", startMs: 120, endMs: 200 },
              ],
            },
          ],
        }),
      /do not spell references\[0\]/,
    );
  });

  it("accepts word times that differ only in case and punctuation", () => {
    const manifest = parseGoldManifest({
      clips: [
        {
          ...timedClip,
          references: ["yaar nahin bola"],
          wordTimes: [
            { text: "Yaar,", startMs: 0, endMs: 100 },
            { text: "nahi", startMs: 120, endMs: 220 },
            { text: "bola.", startMs: 240, endMs: 340 },
          ],
        },
      ],
    });
    expect(manifest.clips[0].wordTimes).toHaveLength(3);
  });

  it("rejects fractional milliseconds", () => {
    expectInvalid(
      () =>
        parseGoldManifest({
          clips: [
            {
              ...timedClip,
              references: ["a b"],
              wordTimes: [{ text: "a", startMs: 0.5, endMs: 100 }],
            },
          ],
        }),
      /whole milliseconds/,
    );
  });

  it("rejects an end before the start", () => {
    expectInvalid(
      () =>
        parseGoldManifest({
          clips: [
            {
              ...timedClip,
              references: ["a b"],
              wordTimes: [{ text: "a", startMs: 100, endMs: 50 }],
            },
          ],
        }),
      /must not be before startMs/,
    );
  });

  it("rejects unknown clip and top-level fields", () => {
    expectInvalid(
      () => parseGoldManifest({ clips: [{ ...timedClip, tag: ["clean"] }] }),
      /not a known field/,
    );
    expectInvalid(() => parseGoldManifest({ clips: [timedClip], clip: [] }), /not a known field/);
  });

  it("rejects an empty clips array", () => {
    expectInvalid(() => parseGoldManifest({ clips: [] }), /nothing would be measured/);
  });
});

// ---------------------------------------------------------------- hypothesis parsing

describe("gold hypothesis parsing", () => {
  const base = { model: "fast", backend: "webgpu", device: "laptop" };

  it("defaults Word fields and keeps measured seconds", () => {
    const parsed = parseGoldHypothesisFile({
      ...base,
      clips: { c1: { seconds: 2.5, words: [{ text: "a", startMs: 0, endMs: 100 }] } },
    });
    expect(parsed.clips.c1.seconds).toBe(2.5);
    expect(parsed.clips.c1.words[0]).toEqual({
      text: "a",
      startMs: 0,
      endMs: 100,
      confidence: 1,
      index: 0,
      windowIndex: 0,
    });
  });

  it("reports seconds as null when the caller did not measure it", () => {
    const parsed = parseGoldHypothesisFile({ ...base, clips: { c1: { words: [] } } });
    expect(parsed.clips.c1.seconds).toBeNull();
  });

  it("requires model, backend and device", () => {
    expectInvalid(() => parseGoldHypothesisFile({ backend: "webgpu", device: "x", clips: {} }), /model/);
    expectInvalid(() => parseGoldHypothesisFile({ model: "m", device: "x", clips: {} }), /backend/);
    expectInvalid(() => parseGoldHypothesisFile({ model: "m", backend: "b", clips: {} }), /device/);
  });

  it("rejects negative seconds", () => {
    expectInvalid(
      () => parseGoldHypothesisFile({ ...base, clips: { c1: { seconds: -1, words: [] } } }),
      /must not be negative/,
    );
  });

  it("rejects fractional word times", () => {
    expectInvalid(
      () =>
        parseGoldHypothesisFile({
          ...base,
          clips: { c1: { words: [{ text: "a", startMs: 1.5, endMs: 10 }] } },
        }),
      /whole milliseconds/,
    );
  });

  it("rejects confidence outside 0..1", () => {
    expectInvalid(
      () =>
        parseGoldHypothesisFile({
          ...base,
          clips: { c1: { words: [{ text: "a", startMs: 0, endMs: 10, confidence: 1.5 }] } },
        }),
      /between 0 and 1/,
    );
  });

  it("rejects unknown keys at every level", () => {
    expectInvalid(() => parseGoldHypothesisFile({ ...base, clips: {}, note: "x" }), /not a known field/);
    expectInvalid(
      () => parseGoldHypothesisFile({ ...base, clips: { c1: { words: [], extra: 1 } } }),
      /not a known field/,
    );
    expectInvalid(
      () =>
        parseGoldHypothesisFile({
          ...base,
          clips: { c1: { words: [{ text: "a", startMs: 0, endMs: 1, conf: 0.5 }] } },
        }),
      /not a known field/,
    );
  });

  it("accepts an empty clips object (every manifest clip will be reported missing)", () => {
    const parsed = parseGoldHypothesisFile({ ...base, clips: {} });
    expect(Object.keys(parsed.clips)).toEqual([]);
  });
});

// ---------------------------------------------------------------- thresholds

describe("gold thresholds", () => {
  it("returns the documented defaults when the section is absent", () => {
    expect(parseGoldThresholds(undefined)).toEqual({
      meanWerMax: 0.25,
      clipWerMax: 0.5,
      timingMaeMsMax: 120,
      hallucinatedWordsMax: 0,
      byTag: {},
    });
  });

  it("parses a full gold section", () => {
    const parsed = parseGoldThresholds({
      meanWerMax: 0.3,
      clipWerMax: 0.6,
      timingMaeMsMax: 150,
      hallucinatedWordsMax: 2,
      byTag: { noisy: { meanWerMax: 0.4 } },
    });
    expect(parsed.meanWerMax).toBe(0.3);
    expect(parsed.clipWerMax).toBe(0.6);
    expect(parsed.timingMaeMsMax).toBe(150);
    expect(parsed.hallucinatedWordsMax).toBe(2);
    expect(parsed.byTag.noisy.meanWerMax).toBe(0.4);
  });

  it("rejects an unknown gold key", () => {
    expectInvalid(() => parseGoldThresholds({ werMax: 0.2 }), /not a known field/);
  });

  it("rejects an unknown tag in byTag", () => {
    expectInvalid(
      () => parseGoldThresholds({ byTag: { wavey: { meanWerMax: 0.4 } } }),
      /unknown tag "wavey"/,
    );
  });

  it("rejects a negative limit", () => {
    expectInvalid(() => parseGoldThresholds({ meanWerMax: -0.1 }), /must not be negative/);
  });

  it("rejects a fractional hallucinatedWordsMax", () => {
    expectInvalid(
      () => parseGoldThresholds({ hallucinatedWordsMax: 1.5 }),
      /non-negative integer/,
    );
  });

  it("lets the MVP threshold parser accept the gold section without changing old keys", () => {
    const parsed = parseThresholds({
      default: { werMax: 0.2, timingMaeMsMax: 90, coverageMin: 0.9 },
      gold: { meanWerMax: 0.3 },
    });
    expect(parsed.default).toEqual({ werMax: 0.2, timingMaeMsMax: 90, coverageMin: 0.9 });
    expect(parsed.gold?.meanWerMax).toBe(0.3);

    const withoutGold = parseThresholds({ default: { werMax: 0.2 } });
    expect(withoutGold.gold).toBeUndefined();
  });
});

// ---------------------------------------------------------------- multi-reference WER

describe("multi-reference WER", () => {
  it("picks the best reference and keeps plain WER against references[0]", () => {
    const manifest = makeManifest([
      makeClip("c1", { references: ["a b c d", "a b c e"] }),
    ]);
    const report = score(manifest, { c1: hypothesisClip(words([["a", 0, 100], ["b", 100, 200], ["c", 200, 300], ["e", 300, 400]])) });
    const wer = report.clips[0].wer;
    expect(wer).not.toBeNull();
    expect(wer?.referenceWers).toEqual([0.25, 0]);
    expect(wer?.oiwer).toBe(0);
    expect(wer?.plainWer).toBe(0.25);
    expect(wer?.bestReference).toBe(1);
    expect(wer?.errors).toBe(0);
  });

  it("treats normalised spelling variants as correct", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["yaar nahin bola"] })]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["Yaar,", 0, 100], ["nahi", 100, 200], ["bola.", 200, 300]])),
    });
    expect(report.clips[0].wer?.oiwer).toBe(0);
    expect(report.clips[0].wer?.plainWer).toBe(0);
  });

  it("scores an empty hypothesis as every reference word deleted", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b c d"] })]);
    const report = score(manifest, { c1: hypothesisClip([]) });
    const wer = report.clips[0].wer;
    expect(wer?.oiwer).toBe(1);
    expect(wer?.refWords).toBe(4);
    expect(wer?.hypWords).toBe(0);
    expect(wer?.deletions).toBe(4);
    expect(wer?.insertions).toBe(0);
    expect(report.clips[0].notes).toContain("empty hypothesis: every reference word counts as a deletion");
  });

  it("scores insertion-only errors", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b"] })]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["a", 0, 10], ["b", 10, 20], ["c", 20, 30]])),
    });
    const wer = report.clips[0].wer;
    expect(wer?.oiwer).toBe(0.5);
    expect(wer?.substitutions).toBe(0);
    expect(wer?.deletions).toBe(0);
    expect(wer?.insertions).toBe(1);
  });

  it("breaks a tie by choosing the first reference", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b", "a b"] })]);
    const report = score(manifest, { c1: hypothesisClip(words([["a", 0, 10], ["c", 10, 20]])) });
    expect(report.clips[0].wer?.referenceWers).toEqual([0.5, 0.5]);
    expect(report.clips[0].wer?.bestReference).toBe(0);
  });
});

// ---------------------------------------------------------------- hallucination

describe("hallucination on expectNoWords clips", () => {
  const silence = makeClip("s1", {
    tags: ["silence"],
    references: [],
    expectNoWords: true,
  });

  it("flags words on a silence clip and ignores punctuation-only emissions", () => {
    const report = score(makeManifest([silence]), {
      s1: hypothesisClip(words([["hello", 0, 100], ["...", 100, 200]])),
    });
    const clip = report.clips[0];
    expect(clip.wer).toBeNull();
    expect(clip.hallucination).toEqual({ expectNoWords: true, wordsProduced: 1, hallucinated: true });
    expect(clip.hard).toBe(false);
    expect(clip.failures).toHaveLength(1);
    expect(clip.failures[0]).toMatchObject({
      metric: "hallucinatedWords",
      scope: "clip",
      target: "s1",
      actual: 1,
      limit: 0,
    });
    expect(clip.pass).toBe(false);
    expect(report.failures.map((failure) => failure.metric)).toContain("hallucinatedWords");
  });

  it("passes a silent clip with an empty hypothesis", () => {
    const report = score(makeManifest([silence]), { s1: hypothesisClip([]) });
    expect(report.clips[0].hallucination).toEqual({
      expectNoWords: true,
      wordsProduced: 0,
      hallucinated: false,
    });
    expect(report.clips[0].pass).toBe(true);
    expect(report.pass).toBe(true);
  });

  it("counts expectNoWords clips but excludes them from WER aggregation", () => {
    const manifest = makeManifest([
      makeClip("clean", { tags: ["clean"], references: ["a b"] }),
      silence,
    ]);
    const report = score(manifest, {
      clean: hypothesisClip(words([["a", 0, 10], ["b", 10, 20]])),
      s1: hypothesisClip([]),
    });
    expect(report.summary.werClips).toBe(1);
    expect(report.summary.meanWer).toBe(0);
    expect(report.summary.expectNoWords).toBe(1);
    const silenceTag = report.byTag.find((entry) => entry.tag === "silence");
    expect(silenceTag).toMatchObject({ clips: 1, werClips: 0, meanWer: null, medianWer: null, p90Wer: null });
  });
});

// ---------------------------------------------------------------- timing

describe("timing metrics", () => {
  const wordTimes = [
    { text: "alpha", startMs: 0, endMs: 100 },
    { text: "beta", startMs: 200, endMs: 300 },
    { text: "gamma", startMs: 400, endMs: 500 },
  ];

  it("computes boundary MAE, p90 and karaoke switch error by hand", () => {
    const manifest = makeManifest([
      makeClip("c1", { references: ["alpha beta gamma"], wordTimes }),
    ]);
    const report = score(manifest, {
      c1: hypothesisClip(
        words([
          ["alpha", 10, 130],
          ["beta", 240, 330],
          ["gamma", 400, 480],
        ]),
      ),
    });
    const timing = report.clips[0].timing;
    expect(timing).not.toBeNull();
    // boundary per matched word: (10+30)/2=20, (40+30)/2=35, (0+20)/2=10.
    expect(timing?.boundary.maeMs).toBeCloseTo(65 / 3, 12);
    expect(timing?.boundary.medianMs).toBe(20);
    expect(timing?.boundary.p90Ms).toBeCloseTo(32, 12);
    expect(timing?.boundary.maxMs).toBe(35);
    // karaoke switch error = mean |start error| = (10 + 40 + 0) / 3.
    expect(timing?.karaokeSwitchErrorMs).toBeCloseTo(50 / 3, 12);
    expect(timing?.neverMatchedWords).toBe(0);
    expect(timing?.extraWords).toBe(0);
  });

  it("counts reference words that never matched", () => {
    const manifest = makeManifest([
      makeClip("c1", { references: ["alpha beta gamma"], wordTimes }),
    ]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["alpha", 10, 130], ["gamma", 400, 480]])),
    });
    const timing = report.clips[0].timing;
    expect(timing?.matched).toBe(2);
    expect(timing?.neverMatchedWords).toBe(1);
    expect(timing?.extraWords).toBe(0);
    // boundary errors: alpha 20, gamma 10.
    expect(timing?.boundary.maeMs).toBe(15);
    expect(timing?.boundary.p90Ms).toBe(19);
    expect(timing?.karaokeSwitchErrorMs).toBe(5);
  });

  it("falls back to onset when word times have no endMs", () => {
    const manifest = makeManifest([
      makeClip("c1", {
        references: ["a b c"],
        wordTimes: [
          { text: "a", startMs: 0 },
          { text: "b", startMs: 100 },
          { text: "c", startMs: 200 },
        ],
      }),
    ]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["a", 10, 110], ["b", 120, 220], ["c", 230, 330]])),
    });
    const timing = report.clips[0].timing;
    expect(timing?.boundary.maeMs).toBe(20);
    expect(timing?.boundary.medianMs).toBe(20);
    expect(timing?.boundary.p90Ms).toBe(28);
    expect(timing?.boundary.maxMs).toBe(30);
    expect(timing?.karaokeSwitchErrorMs).toBe(20);
  });

  it("omits timing when the clip has no word times", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b"] })]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["a", 0, 10], ["b", 10, 20]])),
    });
    expect(report.clips[0].timing).toBeNull();
    expect(report.clips[0].notes).toContain("timing skipped: no wordTimes in the gold manifest");
  });
});

// ---------------------------------------------------------------- aggregation and flags

describe("per-tag aggregation and the hard flag", () => {
  const reference = "a b c d";
  const perfect = words([["a", 0, 10], ["b", 10, 20], ["c", 20, 30], ["d", 30, 40]]);
  const oneError = words([["a", 0, 10], ["b", 10, 20], ["c", 20, 30], ["x", 30, 40]]);
  const twoErrors = words([["a", 0, 10], ["b", 10, 20], ["x", 20, 30], ["y", 30, 40]]);

  it("computes mean, median and p90 by hand", () => {
    const manifest = makeManifest([
      makeClip("c0", { tags: ["clean"], references: [reference] }),
      makeClip("c1", { tags: ["clean"], references: [reference] }),
      makeClip("c2", { tags: ["clean"], references: [reference] }),
      makeClip("c3", { tags: ["clean"], references: [reference] }),
    ]);
    const report = score(manifest, {
      c0: hypothesisClip(perfect),
      c1: hypothesisClip(oneError),
      c2: hypothesisClip(twoErrors),
      c3: hypothesisClip([]),
    });
    // OIWERs are 0, 0.25, 0.5, 1: mean 0.4375, median 0.375,
    // p90 = 0.5 + (1 - 0.5) * 0.7 = 0.85.
    const clean = report.byTag.find((entry) => entry.tag === "clean");
    expect(clean).toMatchObject({
      tag: "clean",
      clips: 4,
      werClips: 4,
      meanWer: 0.4375,
      medianWer: 0.375,
      hardFailures: 1,
    });
    expect(clean?.p90Wer).toBeCloseTo(0.85, 12);
    expect(report.summary.hardFailures).toBe(1);
    expect(report.hardFailures).toEqual([{ id: "c3", wer: 1 }]);
  });

  it("flags a clip only when its WER is strictly above 0.5", () => {
    const manifest = makeManifest([
      makeClip("at-half", { tags: ["fast"], references: [reference] }),
      makeClip("above", { tags: ["fast"], references: [reference] }),
    ]);
    const report = score(manifest, {
      "at-half": hypothesisClip(twoErrors),
      above: hypothesisClip(words([["a", 0, 10], ["x", 10, 20], ["y", 20, 30], ["z", 30, 40]])),
    });
    expect(report.clips[0].wer?.oiwer).toBe(0.5);
    expect(report.clips[0].hard).toBe(false);
    expect(report.clips[1].wer?.oiwer).toBe(0.75);
    expect(report.clips[1].hard).toBe(true);
    expect(report.byTag[0].hardFailures).toBe(1);
  });

  it("lists only tags that appear and orders them canonically", () => {
    const manifest = makeManifest([
      makeClip("c1", { tags: ["phone"], references: ["a b"] }),
      makeClip("c2", { tags: ["clean", "noisy"], references: ["a b"] }),
    ]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["a", 0, 10], ["b", 10, 20]])),
      c2: hypothesisClip(words([["a", 0, 10], ["b", 10, 20]])),
    });
    expect(report.byTag.map((entry) => entry.tag)).toEqual(["clean", "noisy", "phone"]);
  });
});

// ---------------------------------------------------------------- thresholds and verdict

describe("gold thresholds and the run verdict", () => {
  const reference = "a b c d";

  it("passes when every limit is met", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b"] })]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["a", 0, 10], ["b", 10, 20]])),
    });
    expect(report.pass).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.clips[0].pass).toBe(true);
  });

  it("fails the run when meanWerMax is exceeded", () => {
    const manifest = makeManifest([
      makeClip("c1", { references: [reference] }),
      makeClip("c2", { references: [reference] }),
    ]);
    const report = score(
      manifest,
      {
        c1: hypothesisClip([...words([["a", 0, 10], ["b", 10, 20], ["c", 20, 30]]), word("x", 30, 40)]),
        c2: hypothesisClip([...words([["a", 0, 10], ["b", 10, 20]]), word("x", 20, 30), word("y", 30, 40)]),
      },
      withLimits({ clipWerMax: 1, meanWerMax: 0.25 }),
    );
    // 0.25 and 0.5 -> mean 0.375 > 0.25. Both clip limits pass.
    expect(report.summary.meanWer).toBe(0.375);
    expect(report.failures).toEqual([
      { metric: "meanWer", scope: "run", target: null, actual: 0.375, limit: 0.25, rule: "max" },
    ]);
    expect(report.pass).toBe(false);
  });

  it("fails a single clip above clipWerMax", () => {
    const manifest = makeManifest([makeClip("c1", { references: [reference] })]);
    const report = score(
      manifest,
      {
        c1: hypothesisClip([...words([["a", 0, 10]]), word("x", 10, 20), word("y", 20, 30), word("z", 30, 40)]),
      },
      withLimits({ clipWerMax: 0.4, meanWerMax: 1 }),
    );
    expect(report.clips[0].wer?.oiwer).toBe(0.75);
    expect(report.clips[0].hard).toBe(true);
    expect(report.clips[0].failures).toEqual([
      { metric: "clipWer", scope: "clip", target: "c1", actual: 0.75, limit: 0.4, rule: "max" },
    ]);
    expect(report.pass).toBe(false);
  });

  it("fails a clip whose timing MAE exceeds the limit", () => {
    const manifest = makeManifest([
      makeClip("c1", {
        references: ["a"],
        wordTimes: [{ text: "a", startMs: 0, endMs: 100 }],
      }),
    ]);
    const report = score(manifest, { c1: hypothesisClip([word("a", 130, 230)]) });
    // Boundary error = (|130| + |130|) / 2 = 130 ms > 120.
    expect(report.clips[0].timing?.boundary.maeMs).toBe(130);
    expect(report.clips[0].failures).toEqual([
      { metric: "timingMae", scope: "clip", target: "c1", actual: 130, limit: 120, rule: "max" },
    ]);
  });

  it("fails an expectNoWords clip that produced words", () => {
    const manifest = makeManifest([
      makeClip("s1", { tags: ["music"], references: [], expectNoWords: true }),
    ]);
    const report = score(manifest, { s1: hypothesisClip([word("la", 0, 100)]) });
    expect(report.clips[0].failures).toEqual([
      { metric: "hallucinatedWords", scope: "clip", target: "s1", actual: 1, limit: 0, rule: "max" },
    ]);
  });

  it("applies a per-tag mean limit", () => {
    const manifest = makeManifest([
      makeClip("n1", { tags: ["noisy"], references: ["a b c d e"] }),
      makeClip("n2", { tags: ["noisy"], references: ["a b c d e"] }),
    ]);
    const report = score(
      manifest,
      {
        // 2/5 = 0.4 and 3/5 = 0.6 -> tag mean 0.5 > 0.45.
        n1: hypothesisClip(words([
          ["a", 0, 10],
          ["b", 10, 20],
          ["x", 20, 30],
          ["y", 30, 40],
          ["e", 40, 50],
        ])),
        n2: hypothesisClip([...words([["a", 0, 10], ["b", 10, 20]]), word("x", 20, 30), word("y", 30, 40), word("z", 40, 50)]),
      },
      withLimits({ meanWerMax: 1, clipWerMax: 1, byTag: { noisy: { meanWerMax: 0.45 } } }),
    );
    const noisy = report.byTag.find((entry) => entry.tag === "noisy");
    expect(noisy?.meanWer).toBeCloseTo(0.5, 12);
    expect(report.failures).toEqual([
      { metric: "tagWer", scope: "tag", target: "noisy", actual: 0.5, limit: 0.45, rule: "max" },
    ]);
  });

  it("does not fail only because of the hard flag when clipWerMax allows it", () => {
    const manifest = makeManifest([makeClip("c1", { references: [reference] })]);
    const report = score(
      manifest,
      {
        c1: hypothesisClip([...words([["a", 0, 10]]), word("x", 10, 20), word("y", 20, 30), word("z", 30, 40)]),
      },
      withLimits({ clipWerMax: 1, meanWerMax: 1 }),
    );
    expect(report.clips[0].hard).toBe(true);
    expect(report.clips[0].pass).toBe(true);
    expect(report.pass).toBe(true);
    expect(report.hardFailures).toEqual([{ id: "c1", wer: 0.75 }]);
  });

  it("fails a manifest clip with no hypothesis and reports it as missing", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b"] })]);
    const report = score(manifest, {});
    expect(report.missingClips).toEqual(["c1"]);
    expect(report.summary.missing).toBe(1);
    expect(report.summary.meanWer).toBeNull();
    expect(report.clips[0].scored).toBe(false);
    expect(report.clips[0].failures).toEqual([
      { metric: "missing", scope: "clip", target: "c1", actual: null, limit: null, rule: "max" },
    ]);
    expect(report.pass).toBe(false);
  });

  it("lists unknown hypothesis clips without scoring them", () => {
    const manifest = makeManifest([makeClip("c1", { references: ["a b"] })]);
    const report = score(manifest, {
      c1: hypothesisClip(words([["a", 0, 10], ["b", 10, 20]])),
      typo: hypothesisClip(words([["x", 0, 10]])),
    });
    expect(report.unknownClips).toEqual(["typo"]);
    expect(report.clips.map((clip) => clip.id)).toEqual(["c1"]);
    expect(report.summary.clips).toBe(1);
  });

  it("sums measured seconds and ignores clips without a measurement", () => {
    const manifest = makeManifest([
      makeClip("c1", { references: ["a b"] }),
      makeClip("c2", { references: ["a b"] }),
      makeClip("c3", { references: ["a b"] }),
    ]);
    const perfect = words([["a", 0, 10], ["b", 10, 20]]);
    const report = score(manifest, {
      c1: hypothesisClip(perfect, 10),
      c2: hypothesisClip(perfect, 20),
      c3: hypothesisClip(perfect, null),
    });
    expect(report.summary.totalSeconds).toBe(30);
    expect(report.summary.meanSeconds).toBe(15);
  });
});
