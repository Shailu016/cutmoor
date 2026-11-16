import { describe, expect, it } from "vitest";
import type { CaptionResult } from "../../lib/captioning/contracts";
import { describeUnreadSinging, UNREAD_SINGING_ACTION, UNREAD_SINGING_MESSAGE } from "./unread-singing";

function result(overrides: { speechSeconds?: number; words?: number; uncovered?: [number, number][]; lyrics?: CaptionResult["stats"]["lyrics"] } = {}): Pick<CaptionResult, "words" | "uncoveredSpeech" | "stats"> {
  const wordCount = overrides.words ?? 4;
  const speechSeconds = overrides.speechSeconds ?? 10;
  return {
    words: Array.from({ length: wordCount }, (_, index) => ({ text: `w${index}`, startMs: index * 100, endMs: index * 100 + 80, confidence: 1, index, windowIndex: 0 })),
    uncoveredSpeech: (overrides.uncovered ?? []).map(([startMs, endMs]) => ({ startMs, endMs })),
    stats: {
      audioSeconds: 60,
      speechSeconds,
      windows: 2,
      flaggedWindows: 0,
      droppedWords: 0,
      stageMs: {},
      engineId: "e",
      alignerId: "a",
      lyrics: overrides.lyrics,
    },
  };
}

describe("describeUnreadSinging", () => {
  it("asks for the lyrics when most of the voiced seconds have no words", () => {
    const note = describeUnreadSinging(result({ uncovered: [[0, 6000]] }));
    expect(note).toEqual({ message: UNREAD_SINGING_MESSAGE, actionLabel: UNREAD_SINGING_ACTION });
    expect(note?.message).toBe("Some singing could not be read. If you have the lyrics, paste them in the lyrics box and Cutmoor will fill them in.");
  });

  it("asks for the lyrics when a song window heard nothing at all", () => {
    expect(describeUnreadSinging(result({ words: 0, uncovered: [] }))).not.toBeNull();
  });

  it("stays quiet when the words cover more than 60% of the singing", () => {
    expect(describeUnreadSinging(result({ uncovered: [[0, 3000]] }))).toBeNull();
  });

  it("stays quiet for short clips and odd numbers", () => {
    expect(describeUnreadSinging(result({ speechSeconds: 5, uncovered: [[0, 5000]] }))).toBeNull();
    expect(describeUnreadSinging(result({ speechSeconds: Number.NaN, words: 0 }))).toBeNull();
    expect(describeUnreadSinging(result({ uncovered: [[0, Number.NaN]] }))).toBeNull();
  });

  it("stays quiet once the visitor's lyrics were pasted, even if none were placed", () => {
    const placed = { lines: 2, placed: 7, uncertain: 0, unmatched: 3, unmatchedLines: [] };
    expect(describeUnreadSinging(result({ words: 0, uncovered: [[0, 7000]], lyrics: placed }))).toBeNull();
    // Wrong or unusable paste: the panel already says "0 of N placed", so the nudge must not ask again.
    const rejected = { lines: 2, placed: 0, uncertain: 0, unmatched: 10, unmatchedLines: ["a"] };
    expect(describeUnreadSinging(result({ uncovered: [[0, 7000]], lyrics: rejected }))).toBeNull();
  });

  it("ignores negative or empty uncovered spans", () => {
    expect(describeUnreadSinging(result({ uncovered: [[500, 400], [100, 100]] }))).toBeNull();
  });
});
