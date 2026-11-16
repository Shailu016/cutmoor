import { describe, expect, it } from "vitest";
import { parseLyrics } from "./lyrics";
import { lyricPlanLooksRight, normaliseRegions, planGlobalLyrics, syllableWeight } from "./lyrics-global";
import type { GlobalLyricPlan, PlannedLyricWord, TimedWord, VoicedRegion } from "./lyrics-global";
import { rng } from "./test-kit";

/**
 * The global lyric planner (PLAN-R5 Track 1) is pure: pasted words + heard words + voiced regions in,
 * a prediction per word and per line out. Every case here is synthetic and self-contained so a failure
 * names one rule, not one song: the Sajan/KING shapes are reproduced with a dozen words and the regions
 * and anchor times we hand it.
 */

const parsedOf = (text: string) => parseLyrics(text);

/** A heard word, 300 ms long unless told otherwise. */
function heard(text: string, startMs: number, lengthMs = 300): TimedWord {
  return { text, startMs, endMs: startMs + lengthMs };
}

function region(startMs: number, endMs: number): VoicedRegion {
  return { startMs, endMs };
}

function insideRegions(regions: readonly VoicedRegion[], startMs: number, endMs: number): boolean {
  return regions.some((r) => startMs >= r.startMs && endMs <= r.endMs);
}

function overlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function gapsOf(regions: readonly VoicedRegion[]): VoicedRegion[] {
  const gaps: VoicedRegion[] = [];
  for (let i = 1; i < regions.length; i += 1) {
    const startMs = regions[i - 1].endMs;
    const endMs = regions[i].startMs;
    if (endMs > startMs) gaps.push({ startMs, endMs });
  }
  return gaps;
}

/** The planner's ordering contract: no word ends before it starts, and starts never go backwards. */
function expectOrdered(words: readonly PlannedLyricWord[]): void {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    expect(word.endMs, `word ${i} ends before it starts: ${word.startMs}..${word.endMs}`).toBeGreaterThanOrEqual(word.startMs);
    if (i > 0) {
      expect(word.startMs, `word ${i} starts at ${word.startMs}, before word ${i - 1} at ${words[i - 1].startMs}`).toBeGreaterThanOrEqual(words[i - 1].startMs);
    }
  }
}

describe("syllableWeight", () => {
  it("counts vowel groups, not characters", () => {
    expect(syllableWeight("sajan")).toBe(2);
    expect(syllableWeight("zindagi")).toBe(3);
    expect(syllableWeight("mera")).toBe(2);
    // "aa" is one long vowel, not two syllables; the "j" starts the next group.
    expect(syllableWeight("aaja")).toBe(2);
    expect(syllableWeight("dil")).toBe(1);
    expect(syllableWeight("sky")).toBe(1);
    // Punctuation is decoration: the core of the word is what counts.
    expect(syllableWeight("sa-jan!")).toBe(2);
    expect(syllableWeight("(zindagi)")).toBe(3);
  });

  it("never returns less than one", () => {
    expect(syllableWeight("")).toBe(1);
    expect(syllableWeight("...")).toBe(1);
    expect(syllableWeight("shh")).toBe(1);
    expect(syllableWeight("123")).toBe(1);
    expect(syllableWeight("क्")).toBe(1); // consonant + virama: no vowel mark
  });

  it("counts Devanagari vowel marks", () => {
    // Each matra opens a group: म े र ा / स ा र े.
    expect(syllableWeight("मेरा")).toBe(2);
    expect(syllableWeight("सारे")).toBe(2);
    expect(syllableWeight("है")).toBe(1);
    // क ् य ा: the virama is not a vowel, the aa-matra is.
    expect(syllableWeight("क्या")).toBe(1);
    // Without vowel marks the same skeleton is one group.
    expect(syllableWeight("मर")).toBe(1);
    expect(syllableWeight("कय")).toBe(1);
  });
});

describe("planGlobalLyrics with no anchors", () => {
  const text = ["aa aa aa aa", "aa aa aa aa", "aa aa aa aa"].join("\n");

  it("distributes every word across all voiced regions, in order, and never into a gap", () => {
    // Three voiced pieces separated by short (0.6 s) pauses: one sung phrase, not an instrumental.
    const regions = [region(0, 2000), region(2600, 5000), region(5600, 9000)];
    const parsed = parsedOf(text);
    const plan = planGlobalLyrics(parsed, [], regions);

    expect(plan.regions).toEqual(regions);
    expect(plan.words).toHaveLength(12);
    expect(plan.matchedWords).toBe(0);
    expect(plan.anchoredLines).toBe(0);
    expect(plan.heardCoverage).toBe(0);
    expect(plan.unplacedLines).toEqual([]);

    // Order is monotonic and every interval is real, non-empty audio.
    for (let i = 0; i < plan.words.length; i += 1) {
      const word = plan.words[i];
      expect(word.wordIndex).toBe(i);
      expect(word.endMs).toBeGreaterThan(word.startMs);
      expect(word.support).toBe("structure");
      expect(word.approximate).toBe(true);
      if (i > 0) expect(word.startMs).toBeGreaterThanOrEqual(plan.words[i - 1].startMs);
    }

    // Every word lies inside one of the regions and none spans a pause.
    for (const word of plan.words) {
      expect(insideRegions(plan.regions, word.startMs, word.endMs)).toBe(true);
      for (const gap of gapsOf(plan.regions)) {
        expect(overlap(word.startMs, word.endMs, gap.startMs, gap.endMs)).toBe(0);
      }
    }

    // All three regions receive words: the distribution did not stop at the first pause.
    for (const r of plan.regions) {
      expect(plan.words.some((word) => word.startMs >= r.startMs && word.startMs < r.endMs)).toBe(true);
    }

    // The whole voiced span is used: first word at the first voiced ms, last word ends at the last.
    expect(plan.words[0].startMs).toBe(0);
    expect(plan.words[plan.words.length - 1].endMs).toBe(9000);
  });

  it("apportions time by syllable weight", () => {
    // One line, four equal-weight words over 4 s: each gets ~1 s.
    const plan = planGlobalLyrics(parsedOf("aa aa aa aa"), [], [region(0, 4000)]);
    const lengths = plan.words.map((word) => word.endMs - word.startMs);
    for (const length of lengths) expect(Math.abs(length - 1000)).toBeLessThanOrEqual(2);
  });
});

describe("planGlobalLyrics with anchors", () => {
  it("pins anchored words to the heard times and interpolates the neighbours between them", () => {
    const parsed = parsedOf(["kya der hai", "ab sajan aaja", "mera dil"].join("\n"));
    const heardWords = [heard("kya", 1000), heard("der", 1300), heard("hai", 1600), heard("sajan", 3000, 400)];
    const plan = planGlobalLyrics(parsed, heardWords, [region(0, 5000)]);

    // Anchor support and the measured run are reported.
    expect(plan.matchedWords).toBe(4);
    expect(plan.longestAnchorRun).toBe(3);
    expect(plan.anchoredLines).toBe(1); // line 0 has all three words anchored
    expect(plan.heardCoverage).toBeCloseTo(0.75, 6); // only the strong run counts as covered

    // Anchored words keep the heard times exactly.
    const expected = [
      { text: "kya", startMs: 1000, endMs: 1300 },
      { text: "der", startMs: 1300, endMs: 1600 },
      { text: "hai", startMs: 1600, endMs: 1900 },
    ];
    plan.words.slice(0, 3).forEach((word, i) => {
      expect(word.startMs).toBe(expected[i].startMs);
      expect(word.endMs).toBe(expected[i].endMs);
      expect(word.support).toBe("anchor");
      expect(word.approximate).toBe(false);
    });
    expect(plan.words[4].startMs).toBe(3000);
    expect(plan.words[4].endMs).toBe(3400);
    expect(plan.words[4].support).toBe("anchor");

    // "ab" (word 3) has no anchor: it is interpolated between "hai" (ends 1900) and "sajan"
    // (starts 3000), ending exactly where the next anchor starts.
    const ab = plan.words[3];
    expect(ab.support).toBe("structure");
    expect(ab.startMs).toBeGreaterThanOrEqual(1900);
    expect(ab.endMs).toBe(3000);
    expect(ab.startMs).toBeLessThan(ab.endMs);

    // The words after the last anchor are still inside voiced time and ordered.
    for (const word of plan.words.slice(5)) {
      expect(word.startMs).toBeGreaterThanOrEqual(3200); // last anchor's middle
      expect(word.endMs).toBeLessThanOrEqual(5000);
      expect(word.endMs).toBeGreaterThan(word.startMs);
    }
    for (let i = 1; i < plan.words.length; i += 1) {
      expect(plan.words[i].startMs).toBeGreaterThanOrEqual(plan.words[i - 1].startMs);
    }
  });

  it("keeps singing out of a long instrumental gap and puts the tail in the later region", () => {
    // The Sajan shape: the read words are all before the 10 s gap; everything after must land after 30 s.
    const parsed = parsedOf(["kya der hai kya", "sajan mera", "dil jaane", "na ja"].join("\n"));
    const heardWords = [
      heard("kya", 1000),
      heard("der", 1300),
      heard("hai", 1600),
      heard("kya", 1900),
      heard("sajan", 2200),
      heard("mera", 2500),
    ];
    const regions = [region(0, 10_000), region(30_000, 40_000)];
    const plan = planGlobalLyrics(parsed, heardWords, regions);

    expect(plan.words).toHaveLength(10);
    // The six read words are anchors in the first region.
    for (const word of plan.words.slice(0, 6)) {
      expect(word.support).toBe("anchor");
      expect(word.endMs).toBeLessThanOrEqual(10_000);
    }

    // No planned word has its middle inside the instrumental.
    for (const word of plan.words) {
      const middle = (word.startMs + word.endMs) / 2;
      expect(middle > 10_000 && middle < 30_000).toBe(false);
    }

    // The four unanchored words after the last anchor go into 30-40 s, not into the gap.
    const tail = plan.words.slice(6);
    expect(tail).toHaveLength(4);
    for (const word of tail) {
      expect(word.startMs).toBeGreaterThanOrEqual(30_000);
      expect(word.endMs).toBeLessThanOrEqual(40_000);
      expect(word.support).toBe("structure");
    }
    // And they are still in reading order.
    for (let i = 1; i < tail.length; i += 1) expect(tail[i].startMs).toBeGreaterThanOrEqual(tail[i - 1].startMs);
  });
});

describe("hallucinated early copy of a line's first word", () => {
  it("drops a lone exact anchor whose own line is sung much later (Sajan's 'Meri' at 29.85 s)", () => {
    // Line 2 "meri zindagi mera" is sung at 47-50 s. The model also wrote a stray "meri" at 29.85 s, right after
    // line 1, before a long instrumental. Line 1's anchors are close by, so the old island rule kept it.
    const parsed = parsedOf(["kya der hai", "meri zindagi mera"].join("\n"));
    const heardWords = [heard("kya", 27_000), heard("der", 27_500), heard("hai", 28_000), heard("meri", 29_850), heard("zindagi", 47_650), heard("mera", 48_600)];
    const plan = planGlobalLyrics(parsed, heardWords, [region(26_000, 30_000), region(47_000, 52_000)]);
    const meri = plan.words[3];
    expect(meri.startMs).toBeGreaterThan(46_000); // next to its own line, not 17 s earlier
    expect(meri.startMs).toBeLessThan(47_650);
    expect(plan.words[4].startMs).toBe(47_650);
  });

  it("still catches the stray first word when the rest of the line has many anchors (the real Sajan line 10)", () => {
    const parsed = parsedOf(["kya der hai", "meri zindagi mera pyaar yaad aa raha hai"].join("\n"));
    const heardWords = [
      heard("kya", 27_000), heard("der", 27_500), heard("hai", 28_000), heard("meri", 29_850),
      heard("zindagi", 47_650), heard("mera", 48_600), heard("pyaar", 49_500), heard("yaad", 50_300),
      heard("aa", 51_300), heard("raha", 51_600), heard("hai", 52_200),
    ];
    const plan = planGlobalLyrics(parsed, heardWords, [region(26_000, 30_000), region(47_000, 53_000)]);
    expect(plan.words[3].startMs).toBeGreaterThan(46_000);
    expect(plan.words[3].startMs).toBeLessThan(47_650);
  });
});

describe("line refinement", () => {
  it("starts a line just before its first anchor, not at the end of the previous voiced block", () => {
    // Line 1's first word is unanchored; "zindagi" 4 s later is the line's only anchor. (A lone exact anchor more
    // than 6 s from every other anchor is dropped as an island: the Sajan "Meri" hallucinated in a 17 s instrumental.)
    // The global fill would leave "mera" at the end of the first block (2 s); refinement must pull it to just before 6 s.
    const parsed = parsedOf(["kya der hai", "mera zindagi"].join("\n"));
    const heardWords = [heard("kya", 1000), heard("der", 1300), heard("hai", 1600), heard("zindagi", 6000, 500)];
    const plan = planGlobalLyrics(parsed, heardWords, [region(0, 2000), region(5000, 9000)]);

    const mera = plan.words[3];
    const zindagi = plan.words[4];
    expect(mera.support).toBe("structure");
    expect(zindagi.support).toBe("anchor");
    expect(zindagi.startMs).toBe(6000);
    expect(mera.endMs).toBe(6000); // ends where the anchor starts
    expect(mera.startMs).toBeGreaterThan(5000); // inside the second block, not the first
    expect(mera.startMs).toBeLessThan(6000);

    const line = plan.lines[1];
    expect(line.startMs).toBe(mera.startMs);
    expect(line.startMs).toBeGreaterThan(5000);
    expect(line.startMs).not.toBe(2000); // the old failure: squeezed into the previous block's tail
    expect(line.regionIndex).toBe(1);
  });
});

const CHORUS_TEXT = [
  "alpha beta gamma",
  "chorus one here",
  "chorus two here",
  "delta beta gamma",
  "chorus one here",
  "chorus two here",
].join("\n");

describe("repeat mapping", () => {
  it("maps a verbatim repeated block by the measured lag", () => {
    const parsed = parsedOf(CHORUS_TEXT);
    const regions = [region(0, 40_000)];
    const first = planGlobalLyrics(parsed, [], regions);
    // The lag the repeat tracker would measure: the distance between the two block starts.
    const lag = first.lines[4].startMs - first.lines[1].startMs;
    expect(lag).toBeGreaterThan(0);
    expect(first.lines[1].support).toBe("structure");

    const second = planGlobalLyrics(parsed, [], regions, { repeatLagMs: lag });
    expect(second.repeatLagMs).toBe(lag);
    expect(second.lines[4].support).toBe("repeat");
    expect(second.lines[5].support).toBe("repeat");

    // The first copy is untouched; the second is the first + lag, word for word.
    for (let w = 0; w < 6; w += 1) {
      const source = first.words[3 + w];
      const target = second.words[12 + w];
      expect(second.words[3 + w].startMs).toBe(source.startMs); // source block not rewritten
      expect(target.support).toBe("repeat");
      expect(target.approximate).toBe(true);
      expect(target.startMs).toBe(source.startMs + lag);
      expect(target.endMs).toBe(source.endMs + lag);
    }
    expect(second.repeatLagMs).not.toBeNull();
  });

  it("never overwrites a target block that already has anchors", () => {
    const parsed = parsedOf(CHORUS_TEXT);
    const regions = [region(0, 40_000)];
    // We heard the last "delta beta gamma / chorus ..." lines in the audio: words 9..17 are anchors.
    const heardWords = [
      heard("delta", 29_000),
      heard("beta", 29_300),
      heard("gamma", 29_600),
      heard("chorus", 30_000),
      heard("one", 30_300),
      heard("here", 30_600),
      heard("chorus", 31_000),
      heard("two", 31_300),
      heard("here", 31_600),
    ];
    const before = planGlobalLyrics(parsed, heardWords, regions);
    for (let w = 12; w < 18; w += 1) expect(before.words[w].support).toBe("anchor");

    // Choose exactly the lag that the structure predicts, so the mapping is refused by the anchor rule,
    // never by the 4 s repeat tolerance.
    const lag = before.lines[4].startMs - before.lines[1].startMs;
    expect(lag).toBeGreaterThan(0);
    const after = planGlobalLyrics(parsed, heardWords, regions, { repeatLagMs: lag });

    expect(after.repeatLagMs).toBeNull();
    for (const word of after.words.slice(12, 18)) {
      expect(word.support).toBe("anchor");
      expect(word.support).not.toBe("repeat");
    }
    // The measured transcript times survive untouched.
    expect(after.words[12].startMs).toBe(30_000);
    expect(after.words[17].endMs).toBe(31_900);
  });
});

describe("lyricPlanLooksRight", () => {
  function verdict(overrides: Partial<GlobalLyricPlan>): GlobalLyricPlan {
    return {
      words: [],
      lines: [],
      regions: [],
      matchedWords: 0,
      heardCoverage: 0,
      longestAnchorRun: 0,
      anchoredLines: 0,
      repeatLagMs: null,
      unplacedLines: [],
      ...overrides,
    };
  }

  it("trusts the Sajan-like shape: 15 of 25 lines anchored and a 13-word run", () => {
    expect(lyricPlanLooksRight(verdict({ matchedWords: 60, anchoredLines: 15, longestAnchorRun: 13 }), 25)).toBe(true);
  });

  it("trusts a paste right at the 20 % line threshold", () => {
    // 25 lines * 20 % = 2.5 -> ceil 5? No: max(2, ceil(25 * 0.2)) = max(2, 5) = 5.
    expect(lyricPlanLooksRight(verdict({ matchedWords: 12, anchoredLines: 5, longestAnchorRun: 2 }), 25)).toBe(true);
    expect(lyricPlanLooksRight(verdict({ matchedWords: 12, anchoredLines: 4, longestAnchorRun: 5 }), 25)).toBe(false);
    // A long adjacent run is trusted on its own.
    expect(lyricPlanLooksRight(verdict({ matchedWords: 13, anchoredLines: 0, longestAnchorRun: 6 }), 25)).toBe(true);
  });

  it("rejects a foreign paste: a short run and no anchored line", () => {
    // The KING-script-over-Sajan measurement: 0/29 lines anchored, 2-word run.
    expect(lyricPlanLooksRight(verdict({ matchedWords: 6, anchoredLines: 0, longestAnchorRun: 2 }), 29)).toBe(false);
  });

  it("rejects any paste with fewer than four matched words", () => {
    expect(lyricPlanLooksRight(verdict({ matchedWords: 3, anchoredLines: 15, longestAnchorRun: 13 }), 25)).toBe(false);
    expect(lyricPlanLooksRight(verdict({ matchedWords: 0 }), 25)).toBe(false);
  });

  it("trusts a paste shorter than four words only when every one of its words matched", () => {
    const short = (matched: number) => verdict({ words: new Array(3).fill(null) as unknown as GlobalLyricPlan["words"], matchedWords: matched, anchoredLines: 1, longestAnchorRun: matched });
    expect(lyricPlanLooksRight(short(3), 1)).toBe(true);
    expect(lyricPlanLooksRight(short(2), 1)).toBe(false);
  });

  it("uses the short-paste rule below eight lines", () => {
    expect(lyricPlanLooksRight(verdict({ matchedWords: 4, anchoredLines: 0, longestAnchorRun: 3 }), 6)).toBe(true);
    expect(lyricPlanLooksRight(verdict({ matchedWords: 4, anchoredLines: 1, longestAnchorRun: 2 }), 6)).toBe(true);
    expect(lyricPlanLooksRight(verdict({ matchedWords: 4, anchoredLines: 0, longestAnchorRun: 2 }), 6)).toBe(false);
    // Eight lines switch to the long-paste rule: 8 * 20 % = 1.6 -> 2 anchored lines are required.
    expect(lyricPlanLooksRight(verdict({ matchedWords: 6, anchoredLines: 1, longestAnchorRun: 5 }), 8)).toBe(false);
    expect(lyricPlanLooksRight(verdict({ matchedWords: 6, anchoredLines: 2, longestAnchorRun: 2 }), 8)).toBe(true);
  });
});

describe("zero/one voiced region edge cases", () => {
  const parsed = parsedOf(["one two", "three four"].join("\n"));

  it("marks every line unplaced and every word zero-length when there is no voiced audio", () => {
    const plan = planGlobalLyrics(parsed, [], []);
    expect(plan.regions).toEqual([]);
    expect(plan.unplacedLines).toEqual([0, 1]);
    expect(plan.words).toHaveLength(4);
    for (const word of plan.words) {
      expect(word.startMs).toBe(0);
      expect(word.endMs).toBe(0);
      expect(word.support).toBe("structure");
      expect(word.approximate).toBe(true);
    }
    for (const line of plan.lines) {
      expect(line.startMs).toBe(0);
      expect(line.endMs).toBe(0);
      expect(line.regionIndex).toBe(-1);
    }
  });

  it("does not squash words into a region shorter than 200 ms", () => {
    const short = [region(1000, 1150)];
    // Kept by normalisation (a 150 ms voiced blip) but too short to hold words.
    expect(normaliseRegions(short)).toEqual(short);
    const plan = planGlobalLyrics(parsed, [], short);
    expect(plan.regions).toEqual(short);
    for (const word of plan.words) {
      expect(word.startMs).toBe(1000);
      expect(word.endMs).toBe(1000);
    }
    expect(plan.unplacedLines).toEqual([0, 1]);
  });

  it("drops a click-sized region entirely", () => {
    const click = [region(1000, 1100)];
    expect(normaliseRegions(click)).toEqual([]);
    const plan = planGlobalLyrics(parsed, [], click);
    expect(plan.regions).toEqual([]);
    expect(plan.unplacedLines).toEqual([0, 1]);
  });

  it("places words in one usable region", () => {
    const plan = planGlobalLyrics(parsed, [], [region(500, 2000)]);
    expect(plan.regions).toEqual([{ startMs: 500, endMs: 2000 }]);
    expect(plan.unplacedLines).toEqual([]);
    expect(plan.words[0].startMs).toBe(500);
    expect(plan.words[3].endMs).toBe(2000);
    for (let i = 0; i < plan.words.length; i += 1) {
      const word = plan.words[i];
      expect(word.endMs).toBeGreaterThan(word.startMs);
      expect(word.startMs).toBeGreaterThanOrEqual(500);
      expect(word.endMs).toBeLessThanOrEqual(2000);
      if (i > 0) expect(word.startMs).toBeGreaterThanOrEqual(plan.words[i - 1].startMs);
    }
  });
});

describe("regression: no word outside voiced time or out of order", () => {
  // These four scenarios are the minimal reproductions of defects A-D from the first review wave. The
  // module has since been fixed (distribution floor, inverted-pad guard, region-aware line refinement,
  // zero-length slots, final monotonic pass), so each test now asserts the CORRECT behaviour: a
  // regression in any of those fixes turns it red again.

  it("A: a word after an anchor that ends past the last voiced ms stays non-negative and ordered", () => {
    // The heard "hai" starts inside the last voiced region and ends 224 ms after it; `wordInVoiced`
    // accepts it at 30 % overlap (the Sajan "Meri" rule). No voiced time is left for "tum", so it gets
    // a zero-length slot at the anchor's end: end >= start, and the pair never runs backwards.
    const plan = planGlobalLyrics(parsedOf("hai tum"), [heard("hai", 1342, 481)], [region(274, 1599)]);
    expect(plan.words[0].support).toBe("anchor");
    expect(plan.words[0].startMs).toBe(1342);
    expect(plan.words[0].endMs).toBe(1823);
    expect(plan.words[1].startMs).toBe(1823);
    expect(plan.words[1].endMs).toBe(1823); // zero-length, not 1599 (which ended before the start)
    expectOrdered(plan.words);
  });

  it("B: words between two close anchors stay after the previous word and inside voiced time", () => {
    // "sang" (heard 2753-3143) and the second "hai" (3310-3631) are 557 ms apart but eight lyric words
    // apart, because the text repeats "hai" and findAnchors matches the later occurrence. The padded
    // span would be inverted ([3248, 3170.5]); the fixed planner uses the real span, and the final
    // monotonic pass collapses the words it cannot time to zero-length slots at 3923, after the line-0
    // tail (3533-3923) instead of jumping back to 3170.5.
    //
    // Lines 1-3 are reported unplaced, and that is the honest answer for this input: their only
    // voiced evidence is the duplicated "hai" anchor at 3310-3631, but the same text already fills
    // 3143-3923 in line 0, so honouring it would move time backwards. The planner says "no place
    // found" rather than inventing or reordering audio; the anchor word itself is kept as a
    // zero-length anchor (support "anchor") at the ordered position.
    const text = ["tum sang hai hai", "mera", "din", "mera der der hai"].join("\n");
    const plan = planGlobalLyrics(parsedOf(text), [heard("sang", 2753, 390), heard("hai", 3310, 321)], [region(1388, 6636)]);

    expect(plan.regions).toEqual([{ startMs: 1388, endMs: 6636 }]);
    expect(plan.words[3].startMs).toBe(3533); // end of the line-0 tail
    // The stretch between the two matches starts after the preceding word, never before it.
    for (let i = 4; i <= 8; i += 1) {
      expect(plan.words[i].startMs).toBe(3923);
      expect(plan.words[i].endMs).toBe(3923);
    }
    // Every word's middle sits in the single voiced region, or the interval is the documented
    // zero-length "no voiced audio available" encoding.
    for (const word of plan.words) {
      const middle = (word.startMs + word.endMs) / 2;
      expect(word.endMs === word.startMs || (middle >= 1388 && middle <= 6636)).toBe(true);
    }
    expect(plan.unplacedLines).toEqual([1, 2, 3]);
    expectOrdered(plan.words);
  });

  it("C: a line's leading word never starts before the previous line, and anchors keep measured times", () => {
    // "ja" (word 3) is unanchored and is pulled back from the "sang" anchor at 1490. The fix floors the
    // backwards placement at the previous word's end (1415) instead of the global region start (1118),
    // so starts read 1118, 1178, 1238, 1415, 1490, ... and line 2 starts at 1415.
    const text = ["sang tum", "zindagi", "ja sang", "aaja raat"].join("\n");
    const heardWords = [heard("sang", 1490, 568), heard("aaja", 2128, 446), heard("raat", 2636, 283)];
    const plan = planGlobalLyrics(parsedOf(text), heardWords, [region(1118, 2701)]);

    expect(plan.words[2].startMs).toBe(1238); // "zindagi", last word of line 1
    expect(plan.words[3].startMs).toBe(1415); // "ja" now starts where line 1 ends
    expect(plan.words[3].endMs).toBe(1490);
    expect(plan.lines[2].startMs).toBe(1415);

    // Anchor words keep exactly the measured heard times ("raat" is rejected by the 30 % voiced rule
    // because only 65 ms of it is inside the region, so it stays a structure word).
    expect(plan.words[4]).toMatchObject({ startMs: 1490, endMs: 2058, support: "anchor" });
    expect(plan.words[5]).toMatchObject({ startMs: 2128, endMs: 2574, support: "anchor" });

    expectOrdered(plan.words);
    for (let i = 1; i < plan.lines.length; i += 1) {
      const previous = plan.lines[i - 1];
      const previousLast = plan.words[previous.firstWord + previous.wordCount - 1];
      expect(plan.words[plan.lines[i].firstWord].startMs).toBeGreaterThanOrEqual(previousLast.startMs);
    }
  });

  it("D: surplus words become zero-length at the region end and never leave voiced time", () => {
    // Six words cannot fit in 300 ms at minWordMs 60: five fill the region, the sixth has no room left
    // and is a zero-length slot at 300 (the old defect pushed it to 301 and drifted further per word).
    const plan = planGlobalLyrics(parsedOf("na na na na na na"), [], [region(0, 300)]);
    expect(plan.words.map((word) => `${word.startMs}-${word.endMs}`)).toEqual([
      "0-60",
      "60-120",
      "120-180",
      "180-240",
      "240-300",
      "300-300",
    ]);
    expect(plan.words.filter((word) => word.endMs > 300)).toEqual([]);
    expect(plan.words[5].startMs).toBe(300);
    expect(plan.words[5].endMs).toBe(300);
    expect(plan.lines[0].startMs).toBe(0);
    expect(plan.lines[0].endMs).toBe(300); // five real words keep the line placed, the surplus is a slot
    expectOrdered(plan.words);
  });
});

describe("planned-word invariants over random layouts", () => {
  const VOCABULARY = ["sajan", "mera", "dil", "aaja", "kya", "der", "hai", "zindagi", "na", "ja", "tum", "ho", "sang", "raat", "din"];

  /** Words + 0..3 voiced regions; no transcript at all. */
  function randomLayout(seed: number) {
    const random = rng(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const lineCount = 2 + Math.floor(random() * 4);
    const lines: string[] = [];
    for (let l = 0; l < lineCount; l += 1) {
      const wordCount = 1 + Math.floor(random() * 4);
      const lineWords: string[] = [];
      for (let w = 0; w < wordCount; w += 1) lineWords.push(pick(VOCABULARY));
      lines.push(lineWords.join(" "));
    }
    const regions: VoicedRegion[] = [];
    let cursor = Math.floor(random() * 1500);
    const regionCount = Math.floor(random() * 4);
    for (let r = 0; r < regionCount; r += 1) {
      const length = 400 + Math.floor(random() * 6000);
      regions.push(region(cursor, cursor + length));
      cursor += length + 200 + Math.floor(random() * 5000);
    }
    return { random, pick, lines, regions, durationMs: cursor + 1000 };
  }

  it("holds for 200 seeded layouts without anchors", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      const layout = randomLayout(seed);
      const parsed = parsedOf(layout.lines.join("\n"));
      const plan = planGlobalLyrics(parsed, [], layout.regions, { durationMs: layout.durationMs });
      const note = `seed ${seed}: ${JSON.stringify(layout.lines)} regions=${JSON.stringify(plan.regions)}`;

      if (plan.words.length !== parsed.words.length) failures.push(`${note}: ${plan.words.length} words planned`);
      for (let i = 0; i < plan.words.length; i += 1) {
        const word = plan.words[i];
        if (word.endMs < word.startMs) failures.push(`${note}: word ${i} ends before it starts ${word.startMs}..${word.endMs}`);
        if (i > 0 && word.startMs < plan.words[i - 1].startMs) {
          failures.push(`${note}: word ${i} starts at ${word.startMs}, before word ${i - 1} at ${plan.words[i - 1].startMs}`);
        }
        // Structure-only distribution never crosses an internal instrumental gap. (The last-region
        // end is covered by the D regression test above.)
        for (const gap of gapsOf(plan.regions)) {
          if (overlap(word.startMs, word.endMs, gap.startMs, gap.endMs) > 0) {
            failures.push(`${note}: word ${i} ${word.startMs}..${word.endMs} overlaps the gap ${gap.startMs}-${gap.endMs}`);
          }
        }
      }
      plan.lines.forEach((line, i) => {
        const first = plan.words[line.firstWord];
        if (first === undefined) failures.push(`${note}: line ${i} has no first word`);
        else if (!(line.startMs <= first.startMs + 1)) failures.push(`${note}: line ${i} starts at ${line.startMs}, after its first word at ${first.startMs}`);
      });
    }
    expect(failures).toEqual([]);
  });

  it("holds for 200 seeded layouts with anchors", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      const layout = randomLayout(seed);
      const parsed = parsedOf(layout.lines.join("\n"));
      const total = parsed.words.length;
      const note = `seed ${seed}: ${JSON.stringify(layout.lines)} regions=${JSON.stringify(layout.regions)}`;
      const random = layout.random;
      const pick = layout.pick;

      // 1..4 heard words: a contiguous run of the pasted words dropped somewhere in the audio, the
      // shape of a partial read. They are exact copies, so their fate is decided by the voiced filter.
      const heardWords: TimedWord[] = [];
      if (layout.regions.length > 0 && total > 0) {
        const startIndex = Math.floor(random() * total);
        const runLength = 1 + Math.floor(random() * 4);
        const place = pick(layout.regions);
        let at = place.startMs + Math.floor(random() * Math.max(1, place.endMs - place.startMs) * 0.5);
        for (let k = 0; k < runLength && startIndex + k < total; k += 1) {
          const length = 150 + Math.floor(random() * 500);
          heardWords.push(heard(parsed.words[startIndex + k], at, length));
          at += length + 50 + Math.floor(random() * 400);
        }
      }

      const plan = planGlobalLyrics(parsed, heardWords, layout.regions, { durationMs: layout.durationMs });
      const gaps = gapsOf(plan.regions);
      if (plan.words.length !== total) failures.push(`${note}: ${plan.words.length} words planned, expected ${total}`);
      for (let i = 0; i < plan.words.length; i += 1) {
        const word = plan.words[i];
        const length = word.endMs - word.startMs;
        if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)) {
          failures.push(`${note}: word ${i} has non-finite times ${word.startMs}..${word.endMs}`);
          continue;
        }
        if (word.endMs < word.startMs) {
          failures.push(`${note}: word ${i} ends before it starts ${word.startMs}..${word.endMs}`);
        } else if (i > 0 && word.startMs < plan.words[i - 1].startMs) {
          failures.push(`${note}: word ${i} starts at ${word.startMs}, before word ${i - 1} at ${plan.words[i - 1].startMs}`);
        }
        if (word.endMs >= word.startMs) {
          for (const gap of gaps) {
            const inGap = overlap(word.startMs, word.endMs, gap.startMs, gap.endMs);
            if (inGap > length + 1) failures.push(`${note}: word ${i} (${length} ms) overlaps the gap ${gap.startMs}-${gap.endMs} by ${inGap} ms`);
          }
        }
      }
      plan.lines.forEach((line, i) => {
        const first = plan.words[line.firstWord];
        if (first === undefined) failures.push(`${note}: line ${i} has no first word`);
        else if (!(line.startMs <= first.startMs + 1)) failures.push(`${note}: line ${i} starts at ${line.startMs}, after its first word at ${first.startMs}`);
      });
    }
    // Compact failure report so a regression names the seeds instead of a 40-line diff.
    if (failures.length > 0) {
      throw new Error(`${failures.length} planned-word invariant violations across 200 layouts:\n${failures.slice(0, 10).join("\n")}`);
    }
  });
});
