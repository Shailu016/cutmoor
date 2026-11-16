// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import type { Word } from "../types";
import { wordErrorRate } from "./wer";
import {
  applyScore2Overrides,
  devanagariShare,
  evaluateScore2,
  parseScore2Manifest,
  renderScore2Markdown,
  score2ReportToJson,
  tokenizeScriptAware,
  transliterateDevanagari,
  transliterateWord,
  transliterationPolicy,
  type Score2Clip,
  type Score2Manifest,
} from "./score2";
import type { GoldHypothesis, GoldHypothesisClip } from "./gold";

/**
 * Tests for the script-aware scorer. The expected numbers are worked out by hand in the assertions
 * (not recomputed with the implementation), so a wrong transliteration table, WER oracle, F1
 * formula or words-per-minute denominator fails here.
 */

function word(text: string, startMs: number, endMs: number): Word {
  return { text, startMs, endMs, confidence: 1, index: 0, windowIndex: 0 };
}

function hypothesis(clips: Record<string, GoldHypothesisClip>): GoldHypothesis {
  return { model: "test-model", backend: "test-backend", device: "test-device", clips };
}

function manifest(clips: Score2Clip[]): Score2Manifest {
  return { notes: "test data", clips };
}

function clip(overrides: Partial<Score2Clip> & Pick<Score2Clip, "id" | "path">): Score2Clip {
  return {
    tags: ["clean"],
    references: ["a b"],
    expectNoWords: false,
    durationMs: null,
    noVoiceSpans: [],
    ...overrides,
  };
}

function parseClip(raw: Record<string, unknown>): Score2Clip {
  const parsed = parseScore2Manifest({ clips: [{ path: "x", tags: ["clean"], ...raw }] });
  return parsed.clips[0];
}

describe("transliteration rule set", () => {
  it("maps the ITRANS consonants, vowels and matras to the documented Roman-Hinglish key", () => {
    expect(transliterateWord("नमस्ते")).toBe("namaste");
    expect(transliterateWord("क्या")).toBe("kya");
    expect(transliterateWord("मुझे")).toBe("mujhe");
    expect(transliterateWord("हैं")).toBe("hain");
    expect(transliterateWord("में")).toBe("mein");
    expect(transliterateWord("पढ़ने")).toBe("padhne"); // nukta consonant
    expect(transliterateWord("बड़ा")).toBe("bada");
    expect(transliterateWord("हिन्दी")).toBe("hindi");
    expect(transliterateWord("१२३")).toBe("123");
    expect(transliterateWord("संभव")).toBe("sambhav"); // anusvara before a labial
    expect(transliterateWord("संसार")).toBe("sansar");
  });

  it("applies the closed loanword/function-word map instead of a phonetic spelling", () => {
    expect(transliterateWord("स्कूल")).toBe("school");
    expect(transliterateWord("स्टूडेंट्स")).toBe("students");
    expect(transliterateWord("मार्क्स")).toBe("marks");
    expect(transliterateWord("आप")).toBe("aap");
    expect(transliterateWord("तो")).toBe("toh");
    expect(transliterateWord("ज़िंदगी")).toBe("zindagi");
  });

  it("behaves the same for canonically equivalent nukta input", () => {
    const precomposed = "\u095B\u0930\u093E"; // ज़रा with the single U+095B code point
    const decomposed = "\u091C\u093C\u0930\u093E"; // ज + nukta + र + ा
    expect(precomposed).not.toBe(decomposed);
    expect(transliterateWord(decomposed)).toBe(transliterateWord(precomposed));
    expect(transliterateWord("\u095B\u093F\u0902\u0926\u0917\u0940")).toBe("zindagi");
    expect(transliterateWord("\u092C\u095C\u093E")).toBe("bada");
  });

  it("keeps schwa where Hinglish keeps it and drops it where it does not", () => {
    // Oracle: both are C-a-C-a words, but only कमरा loses the medial schwa in common Hinglish.
    expect(transliterateWord("कमल")).toBe("kamal");
    expect(transliterateWord("कमरा")).toBe("kamra");
    expect(transliterateWord("लड़का")).toBe("ladka");
    expect(transliterateWord("इतने")).toBe("itne");
  });

  it("preserves matras and nuktas in the raw normaliser", () => {
    // "है" and "हैं" are different words. A normaliser that strips combining marks would score 0.
    expect(wordErrorRate("है", "हैं").wer).toBe(1);
    expect(wordErrorRate("ज़रा", "जरा").wer).toBe(1);
  });

  it("tokenises Devanagari and Latin together, splitting only at a script change", () => {
    expect(tokenizeScriptAware("मुझेvideo देखो")).toEqual(["मुझे", "video", "देखो"]);
    expect(transliterateWord("मुझेvideo")).toBe("mujhevideo");
    expect(tokenizeScriptAware("क्या, aap")).toEqual(["क्या,", "aap"]);
    expect(tokenizeScriptAware("video")).toEqual(["video"]);
    expect(tokenizeScriptAware("है?")).toEqual(["है?"]);
  });

  it("transliterates a whole string without moving whitespace or punctuation", () => {
    expect(transliterateDevanagari("क्या आप ठीक हैं?")).toBe("kya aap thik hain?");
  });

  it("reports the Devanagari share used by the policy", () => {
    expect(devanagariShare("abc")).toBe(0);
    expect(devanagariShare("क्या")).toBe(1);
    expect(devanagariShare("क्या video")).toBeGreaterThan(0);
    expect(devanagariShare("क्या video")).toBeLessThan(1);
  });
});

describe("transliteration policy", () => {
  it("translates only the Devanagari side when the scripts differ", () => {
    const policy = transliterationPolicy("kya aap theek hain", "क्या आप ठीक हैं");
    expect(policy.applied).toBe(true);
    expect(policy.translateHypothesis).toBe(true);
    expect(policy.translateReference).toBe(false);
  });

  it("does not transliterate when both sides are already Devanagari", () => {
    const policy = transliterationPolicy("क्या आप ठीक हैं", "क्या आप ठीक हैं");
    expect(policy.applied).toBe(false);
    expect(policy.translateHypothesis).toBe(false);
    expect(policy.translateReference).toBe(false);
  });
});

describe("script-aware WER", () => {
  it("scores an all-Devanagari hypothesis against a Roman reference near zero, and shows the raw number", () => {
    const parsed = parseClip({
      id: "cross-script",
      references: ["kya aap theek hain"],
      wordTimes: [
        { text: "kya", startMs: 0, endMs: 100 },
        { text: "aap", startMs: 110, endMs: 200 },
        { text: "theek", startMs: 210, endMs: 300 },
        { text: "hain", startMs: 310, endMs: 400 },
      ],
    });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        "cross-script": {
          words: [
            word("क्या", 0, 100),
            word("आप", 110, 200),
            word("ठीक", 210, 300),
            word("हैं", 310, 400),
          ],
          seconds: 1,
        },
      }),
    );

    const wer = report.clips[0].wer;
    expect(wer).not.toBeNull();
    if (wer === null) return;
    expect(wer.raw.oiwer).toBe(1); // every Roman token is a substitution
    expect(wer.scriptAware.oiwer).toBe(0);
    expect(wer.scriptAware.transliteration?.applied).toBe(true);
    expect(wer.scriptAware.refWords).toBe(4);
    expect(wer.scriptAware.hypWords).toBe(4);
    expect(report.summary.meanOiwerRaw).toBe(1);
    expect(report.summary.meanOiwerScriptAware).toBe(0);
  });

  it("translates a Devanagari reference against a Roman hypothesis too", () => {
    const parsed = parseClip({ id: "reverse", references: ["क्या आप ठीक हैं"] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({ reverse: { words: ["kya", "aap", "theek", "hain"].map((text, index) => word(text, index * 100, index * 100 + 90)), seconds: null } }),
    );
    const wer = report.clips[0].wer;
    expect(wer?.raw.oiwer).toBe(1);
    expect(wer?.scriptAware.oiwer).toBe(0);
    expect(wer?.scriptAware.transliteration?.translateReference).toBe(true);
  });

  it("handles a mixed-script hypothesis without losing the Latin words", () => {
    const parsed = parseClip({ id: "mixed", references: ["kya aap video dekhte hain"] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        mixed: { words: ["क्या", "आप", "video", "देखते", "हैं"].map((text, index) => word(text, index * 100, index * 100 + 90)), seconds: null },
      }),
    );
    expect(report.clips[0].wer?.scriptAware.oiwer).toBe(0);
  });

  it("shows that the studypoint reference is not ~100% error for a good Devanagari transcript", () => {
    const reference =
      "Parents, kya aap jaante hain ek hi school mein padhne wale do students ke marks itne different kyu hote hain?";
    const devanagari =
      "पैरेंट्स, क्या आप जानते हैं एक ही स्कूल में पढ़ने वाले दो स्टूडेंट्स के मार्क्स इतने डिफरेंट क्यु होते हैं?";
    const parsed = parseClip({ id: "studypoint-prefix", references: [reference] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        "studypoint-prefix": {
          words: devanagari.split(/\s+/u).map((text, index) => word(text, index * 300, index * 300 + 250)),
          seconds: null,
        },
      }),
    );

    const wer = report.clips[0].wer;
    expect(wer?.raw.oiwer).toBe(1);
    // Only जानते -> "jante" differs from the reference's "jaante": 1 error in 20 words.
    expect(wer?.scriptAware.oiwer).toBeCloseTo(1 / 20, 12);
    expect(wer?.scriptAware.deletions).toBe(0);
    expect(wer?.scriptAware.insertions).toBe(0);
  });
});

describe("multi-reference OIWER and edit split", () => {
  it("takes the minimum WER over references and uses that reference's counts", () => {
    const parsed = parseClip({ id: "two-refs", references: ["a b c d", "a x c d"] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        "two-refs": {
          words: ["a", "x", "c", "d", "e"].map((text, index) => word(text, index * 100, index * 100 + 90)),
          seconds: null,
        },
      }),
    );

    const wer = report.clips[0].wer;
    expect(wer?.raw.oiwer).toBeCloseTo(0.25, 12);
    expect(wer?.raw.plainWer).toBeCloseTo(0.5, 12);
    expect(wer?.raw.bestReference).toBe(1);
    expect(wer?.raw.refWords).toBe(4);
    expect(wer?.raw.hypWords).toBe(5);
    expect(wer?.raw.substitutions).toBe(0);
    expect(wer?.raw.deletions).toBe(0);
    expect(wer?.raw.insertions).toBe(1);
    expect(report.summary.substitutions).toBe(0);
    expect(report.summary.deletions).toBe(0);
    expect(report.summary.insertions).toBe(1);
  });

  it("splits a substitution correctly", () => {
    const parsed = parseClip({ id: "sub", references: ["a b c"] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({ sub: { words: ["a", "x", "c"].map((text, index) => word(text, index * 100, index * 100 + 90)), seconds: null } }),
    );
    const wer = report.clips[0].wer;
    expect(wer?.raw.substitutions).toBe(1);
    expect(wer?.raw.deletions).toBe(0);
    expect(wer?.raw.insertions).toBe(0);
    expect(wer?.raw.oiwer).toBeCloseTo(1 / 3, 12);
  });
});

describe("timing F1", () => {
  const referenceTimes = [
    { text: "one", startMs: 0, endMs: 100 },
    { text: "two", startMs: 200, endMs: 300 },
    { text: "three", startMs: 400, endMs: 500 },
  ];

  function scoreTiming(
    words: Word[],
    wordTimes: Array<{ text: string; startMs: number; endMs?: number }> = referenceTimes,
  ): ReturnType<typeof evaluateScore2>["clips"][number]["timing"] {
    const parsed = parseClip({ id: "timing", references: [referenceTimes.map((entry) => entry.text).join(" ")], wordTimes });
    return evaluateScore2(manifest([parsed]), hypothesis({ timing: { words, seconds: null } })).clips[0].timing;
  }

  it("scores exact boundaries as F1=1 at both tolerances", () => {
    const timing = scoreTiming([word("one", 0, 100), word("two", 200, 300), word("three", 400, 500)]);
    expect(timing).not.toBeNull();
    if (timing === null) return;
    expect(timing.matched).toBe(3);
    expect(timing.unmatched).toBe(0);
    expect(timing.unusable).toBe(0);
    expect(timing.boundary.maeMs).toBe(0);
    expect(timing.onset.maeMs).toBe(0);
    expect(timing.f1.find((entry) => entry.toleranceMs === 50)?.f1).toBe(1);
    expect(timing.f1.find((entry) => entry.toleranceMs === 100)?.f1).toBe(1);
  });

  it("fails F1@50 but passes F1@100 when every boundary is 60 ms late", () => {
    const timing = scoreTiming([
      word("one", 60, 160),
      word("two", 260, 360),
      word("three", 460, 560),
    ]);
    expect(timing?.boundary.maeMs).toBe(60);
    expect(timing?.f1.find((entry) => entry.toleranceMs === 50)?.f1).toBe(0);
    expect(timing?.f1.find((entry) => entry.toleranceMs === 100)?.f1).toBe(1);
  });

  it("counts a substituted word as a miss in both precision and recall", () => {
    const timing = scoreTiming([word("one", 0, 100), word("two", 200, 300), word("FOUR", 400, 500)]);
    expect(timing?.alignmentSubstitutions).toBe(1);
    expect(timing?.unmatched).toBe(1);
    expect(timing?.matched).toBe(2);
    const entry = timing?.f1.find((value) => value.toleranceMs === 50);
    expect(entry?.correct).toBe(2);
    expect(entry?.precision).toBeCloseTo(2 / 3, 12);
    expect(entry?.recall).toBeCloseTo(2 / 3, 12);
    expect(entry?.f1).toBeCloseTo(2 / 3, 12);
  });

  it("counts a deleted word as a recall miss", () => {
    const timing = scoreTiming([word("one", 0, 100), word("two", 200, 300)]);
    expect(timing?.alignmentDeletions).toBe(1);
    expect(timing?.unmatched).toBe(1);
    expect(timing?.matched).toBe(2);
    const entry = timing?.f1.find((value) => value.toleranceMs === 50);
    expect(entry?.correct).toBe(2);
    expect(entry?.precision).toBe(1);
    expect(entry?.recall).toBeCloseTo(2 / 3, 12);
    expect(entry?.f1).toBeCloseTo(0.8, 12);
  });

  it("refuses to invent F1 when the reference has no end times, but still reports onset MAE", () => {
    const timing = scoreTiming(
      [word("one", 10, 100), word("two", 210, 300), word("three", 410, 500)],
      [
        { text: "one", startMs: 0 },
        { text: "two", startMs: 200 },
        { text: "three", startMs: 400 },
      ],
    );
    expect(timing?.f1Computed).toBe(false);
    expect(timing?.unusable).toBe(3);
    expect(timing?.f1.every((entry) => entry.f1 === null)).toBe(true);
    expect(timing?.onset.maeMs).toBe(10);
  });
});

describe("hallucination words per minute", () => {
  it("divides words by the clip duration on an expectNoWords clip", () => {
    const parsed = parseClip({
      id: "silence",
      tags: ["silence"],
      references: [],
      expectNoWords: true,
      durationMs: 10_000,
    });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        silence: {
          words: [
            word("one", 1_000, 1_200),
            word("two", 2_000, 2_200),
            word("three", 3_000, 3_200),
            word("four", 4_000, 4_200),
            word("five", 5_000, 5_200),
          ],
          seconds: null,
        },
      }),
    );
    expect(report.clips[0].hallucination?.wordsProduced).toBe(5);
    expect(report.clips[0].hallucination?.wordsPerMinute).toBe(30);
    expect(report.summary.hallucinatedWords).toBe(5);
    expect(report.summary.silenceWordsPerMinute).toBe(30);
  });

  it("leaves the rate null when the duration is unknown instead of guessing", () => {
    const parsed = parseClip({
      id: "silence",
      tags: ["silence"],
      references: [],
      expectNoWords: true,
    });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({ silence: { words: [word("one", 0, 100)], seconds: null } }),
    );
    expect(report.clips[0].hallucination?.wordsPerMinute).toBeNull();
    expect(report.summary.silenceWordsPerMinute).toBeNull();
  });

  it("counts only words whose midpoint falls in a music-only span, and unions overlapping spans", () => {
    const parsed = parseClip({
      id: "song",
      tags: ["music"],
      references: ["la la la"],
      noVoiceSpans: [
        { startMs: 0, endMs: 6_000 },
        { startMs: 5_000, endMs: 10_000 },
      ],
    });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        song: {
          words: [word("la", 2_400, 2_600), word("la", 5_400, 5_600), word("la", 11_900, 12_100)],
          seconds: null,
        },
      }),
    );
    const hallucination = report.clips[0].hallucination;
    expect(hallucination?.spanWords).toBe(2);
    expect(hallucination?.spanDurationMs).toBe(10_000); // NOT 11 s: the overlap is counted once
    expect(hallucination?.spanWordsPerMinute).toBe(12);
    expect(hallucination?.spans.map((span) => span.words)).toEqual([2, 1]);
  });

  it("treats the span end as exclusive at the midpoint", () => {
    const parsed = parseClip({
      id: "edge",
      references: ["a"],
      noVoiceSpans: [{ startMs: 0, endMs: 1_000 }],
    });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        edge: {
          words: [word("a", 0, 1_000), word("b", 500, 1_500)],
          seconds: null,
        },
      }),
    );
    expect(report.clips[0].hallucination?.spanWords).toBe(1);
  });
});

describe("report and parser", () => {
  it("renders deterministic markdown and JSON", () => {
    const parsed = parseClip({ id: "ok", references: ["a b"] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({ ok: { words: [word("a", 0, 100), word("b", 200, 300)], seconds: 1.5 } }),
    );
    const first = renderScore2Markdown(report);
    const second = renderScore2Markdown(report);
    expect(first).toBe(second);
    expect(first).toContain("# Caption score2 report (script-aware)");
    expect(first).toContain("mean OIWER");
    expect(first).toContain("F1@50");
    const json = JSON.parse(score2ReportToJson(report)) as { schemaVersion: number; model: string };
    expect(json.schemaVersion).toBe(2);
    expect(json.model).toBe("test-model");
  });

  it("reports a missing hypothesis without crashing and counts it", () => {
    const parsed = parseClip({ id: "gone", references: ["a b"] });
    const report = evaluateScore2(manifest([parsed]), hypothesis({}));
    expect(report.clips[0].scored).toBe(false);
    expect(report.missingClips).toEqual(["gone"]);
    expect(report.summary.missing).toBe(1);
  });

  it("lists hypothesis clips the manifest does not know", () => {
    const parsed = parseClip({ id: "known", references: ["a"] });
    const report = evaluateScore2(
      manifest([parsed]),
      hypothesis({
        known: { words: [word("a", 0, 100)], seconds: null },
        extra: { words: [word("a", 0, 100)], seconds: null },
      }),
    );
    expect(report.unknownClips).toEqual(["extra"]);
  });

  it("rejects invalid manifests instead of scoring them silently", () => {
    expect(() => parseScore2Manifest({ clips: [] })).toThrow(CaptionError);
    expect(() => parseClip({ id: "x", references: ["a"], surprise: 1 })).toThrow(/not a known field/);
    expect(() =>
      parseClip({ id: "x", tags: ["silence"], references: ["a"], expectNoWords: true }),
    ).toThrow(/must be empty/);
    expect(() =>
      parseClip({ id: "x", references: ["a"], noVoiceSpans: [{ startMs: 10, endMs: 5 }] }),
    ).toThrow(/must be after/);
    expect(() => parseClip({ id: "x", references: ["a"], durationMs: 0 })).toThrow(/greater than 0/);
    expect(() =>
      parseClip({
        id: "x",
        references: ["a"],
        wordTimes: [{ text: "different", startMs: 0, endMs: 100 }],
      }),
    ).toThrow(/do not spell/);
  });

  it("accepts Devanagari wordTimes against a Roman reference (script-aware consistency)", () => {
    const parsed = parseClip({
      id: "x",
      references: ["kya aap theek hain"],
      wordTimes: [
        { text: "क्या", startMs: 0, endMs: 100 },
        { text: "आप", startMs: 110, endMs: 200 },
        { text: "ठीक", startMs: 210, endMs: 300 },
        { text: "हैं", startMs: 310, endMs: 400 },
      ],
    });
    expect(parsed.wordTimes).toHaveLength(4);
  });

  it("applies CLI overrides and rejects an unknown clip id", () => {
    const parsed = parseClip({
      id: "silence",
      tags: ["silence"],
      references: [],
      expectNoWords: true,
    });
    const overridden = applyScore2Overrides(manifest([parsed]), {
      durations: { silence: 10_000 },
      noVoiceSpans: { silence: [{ startMs: 0, endMs: 5_000 }] },
    });
    expect(overridden.clips[0].durationMs).toBe(10_000);
    expect(overridden.clips[0].noVoiceSpans).toEqual([{ startMs: 0, endMs: 5_000 }]);
    expect(() => applyScore2Overrides(manifest([parsed]), { durations: { nope: 1 } })).toThrow(/unknown clip/);
  });
});
