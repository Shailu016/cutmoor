import { describe, expect, it } from "vitest";
import type { ForcedAlignWord } from "../contracts";
import {
  CHUNK_HEADROOM,
  DEFAULT_END_GUARD_MS,
  END_OF_AUDIO_GUARD_MS,
  MAX_ALIGN_TEXT_CHARS,
  UNMATCHED_LINES_MAX,
  UNMATCHED_LINE_MAX_CHARS,
  acceptAlignedWords,
  alignerWord,
  findAnchors,
  forcedWordConfidence,
  lyricEndGuardMs,
  lyricWordCore,
  parseLyrics,
  planLyricChunk,
  reconcileWithAnchors,
  unmatchedLyricLines,
} from "./lyrics";

describe("parseLyrics", () => {
  it("splits lines and words, ignores blank lines, and normalises whitespace", () => {
    const parsed = parseLyrics("  Kya   der hai  \r\n\r\n  Aaj   sajan mera\n\n");
    expect(parsed.lines.map((line) => line.text)).toEqual(["Kya der hai", "Aaj sajan mera"]);
    expect(parsed.words).toEqual(["Kya", "der", "hai", "Aaj", "sajan", "mera"]);
    expect(parsed.lines.map((line) => line.firstWord)).toEqual([0, 3]);
    expect(parsed.lineOfWord).toEqual([0, 0, 0, 1, 1, 1]);
    expect(parsed.truncated).toBe(false);
  });

  it("keeps the visitor's spelling for display and strips only what tokenizes badly for the aligner", () => {
    const parsed = parseLyrics(`"Kya," (der) hai... don't well-known 1999\n· · ·\nmusic 🎵`);
    expect(parsed.words).toEqual([`"Kya,"`, "(der)", "hai...", "don't", "well-known", "1999", "music"]);
    expect(parsed.alignerWords).toEqual(["Kya", "der", "hai", "don't", "well-known", "1999", "music"]);
    expect(parsed.lines).toHaveLength(2); // the decoration-only line is not a line
    expect(parsed.lines[1].words).toEqual(["music"]);
  });

  it("returns nothing for empty or decoration-only text", () => {
    expect(parseLyrics("")).toEqual({ lines: [], words: [], alignerWords: [], lineOfWord: [], truncated: false });
    expect(parseLyrics("   \n\n ... --- \n").words).toEqual([]);
  });

  it("caps a paste at 4000 words and says it was cut", () => {
    const parsed = parseLyrics(Array.from({ length: 4200 }, () => "la").join(" "));
    expect(parsed.words).toHaveLength(4000);
    expect(parsed.alignerWords).toHaveLength(4000);
    expect(parsed.truncated).toBe(true);
  });

  it("caps a paste at about 20 000 characters and says it was cut", () => {
    const parsed = parseLyrics(Array.from({ length: 5000 }, () => "lalala").join(" "));
    expect(parsed.words.length).toBeGreaterThan(0);
    expect(parsed.words.length).toBeLessThan(4000);
    expect(parsed.words.join(" ").length).toBeLessThanOrEqual(20_000);
    expect(parsed.truncated).toBe(true);
  });

  it("keeps the aligner and display arrays the same length when a token is pure punctuation", () => {
    const parsed = parseLyrics("Kya ... der");
    expect(parsed.words).toEqual(["Kya", "der"]);
    expect(parsed.alignerWords).toHaveLength(2);
    expect(parsed.lineOfWord).toHaveLength(2);
    expect(parsed.lines[0].firstWord).toBe(0);
    expect(parsed.lines[0].words).toEqual(["Kya", "der"]);
  });
});

describe("alignerWord / lyricWordCore", () => {
  it("strips edge decoration but keeps an internal apostrophe or hyphen", () => {
    expect(alignerWord("(Kya),")).toBe("Kya");
    expect(alignerWord("—well-known—")).toBe("well-known");
    expect(alignerWord("'don't'")).toBe("don't");
    expect(alignerWord("...")).toBe("");
  });

  it("compares on letters, digits and marks only", () => {
    expect(lyricWordCore("Kya,")).toBe("kya");
    expect(lyricWordCore("डर")).toBe("डर");
    expect(lyricWordCore("!?!")).toBe("");
  });
});

describe("planLyricChunk", () => {
  const words = (count: number, word = "a") => Array.from({ length: count }, () => word);

  it("offers about the words a 30 s window can hold (1.0x), not 1.5x: the 400-character cap cannot deliver 1.5x", () => {
    // 30 s * 2.5 words/s = 75 estimated; 1.0x = 75 words offered. 1.5x (113) was silently cut to ~65 by the
    // 400-character cap, and the words that did arrive were DTW-spread over the whole window (REVIEW-1 finding 2).
    const chunk = planLyricChunk(words(200), 0, 30_000);
    expect(chunk).toMatchObject({ from: 0, to: 75, count: 75 });
    expect(chunk.text.split(" ")).toHaveLength(75);
    expect(CHUNK_HEADROOM).toBe(1);
  });

  it("uses the speech rate when asked", () => {
    // 20 s * 3.0 = 60 estimated; 20 s * 2.5 = 50.
    expect(planLyricChunk(words(200), 0, 20_000, 3).count).toBe(60);
    expect(planLyricChunk(words(200), 0, 20_000, 2.5).count).toBe(50);
  });

  it("still accepts an explicit headroom for a caller that wants a longer chunk", () => {
    // The option exists so the 1.0x default can be measured against the old 1.5x without a code change.
    expect(planLyricChunk(words(200), 0, 20_000, 3, 1.5).count).toBe(90);
    expect(planLyricChunk(words(200), 0, 20_000, 3, 0).count).toBe(60); // a nonsense headroom falls back to the default
    expect(planLyricChunk(words(200), 0, 20_000, 3, Number.NaN).count).toBe(60);
  });

  it("always offers at least eight words, even for a one-second window", () => {
    expect(planLyricChunk(words(20), 0, 1000).count).toBe(8);
    expect(planLyricChunk(words(20), 0, 0).count).toBe(8);
  });

  it("caps the text at the engine's 400 characters", () => {
    const chunk = planLyricChunk(words(200, "abcdefghij"), 0, 30_000);
    // 36 words of 10 chars + 35 spaces = 395; a 37th would be 406.
    expect(chunk.count).toBe(36);
    expect(chunk.text.length).toBeLessThanOrEqual(MAX_ALIGN_TEXT_CHARS);
    expect(chunk.text.length).toBe(395);
  });

  it("sends one over-long word alone, cut to 400 characters, instead of an empty chunk", () => {
    const chunk = planLyricChunk(["x".repeat(500), "next"], 0, 30_000);
    expect(chunk.count).toBe(1);
    expect(chunk.text).toHaveLength(MAX_ALIGN_TEXT_CHARS);
  });

  it("stops at the end of the pasted words and returns an empty chunk past it", () => {
    expect(planLyricChunk(words(3), 0, 30_000)).toMatchObject({ from: 0, to: 3, count: 3 });
    expect(planLyricChunk(words(3), 3, 30_000)).toEqual({ from: 3, to: 3, text: "", count: 0 });
    expect(planLyricChunk(words(3), 99, 30_000)).toEqual({ from: 3, to: 3, text: "", count: 0 });
    expect(planLyricChunk(words(3), -5, 30_000).from).toBe(0);
    expect(planLyricChunk(words(3), Number.NaN, 30_000).from).toBe(0);
  });
});

describe("forcedWordConfidence", () => {
  it("stays inside 0..1 and rises with both inputs", () => {
    for (const [logProbability, sharpness] of [
      [0, 1],
      [-0.2, 0.9],
      [-1, 0.5],
      [-3, 0],
      [Number.NaN, Number.NaN],
    ]) {
      const value = forcedWordConfidence(logProbability, sharpness);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(forcedWordConfidence(-0.1, 0.9)).toBeGreaterThan(forcedWordConfidence(-1.4, 0.9));
    expect(forcedWordConfidence(-0.1, 0.9)).toBeGreaterThan(forcedWordConfidence(-0.1, 0.1));
    expect(forcedWordConfidence(-1.6, 0)).toBe(0);
    expect(forcedWordConfidence(0, 1)).toBe(1);
  });
});

describe("lyricEndGuardMs", () => {
  it("uses the 1 500 ms rule while a next chunk exists", () => {
    expect(lyricEndGuardMs(30_000)).toBe(DEFAULT_END_GUARD_MS);
    expect(lyricEndGuardMs(8_000)).toBe(DEFAULT_END_GUARD_MS);
  });

  it("never eats more than a quarter of a short window", () => {
    expect(lyricEndGuardMs(4_000)).toBe(1_000);
    expect(lyricEndGuardMs(1_000)).toBe(250);
    expect(lyricEndGuardMs(0)).toBe(0);
    expect(lyricEndGuardMs(Number.NaN)).toBe(0);
  });
});

describe("acceptAlignedWords", () => {
  const word = (startMs: number, endMs: number, logProbability = -0.2, sharpness = 0.9): ForcedAlignWord => ({
    text: "x",
    startMs,
    endMs,
    logProbability,
    sharpness,
  });

  it("accepts the words before the window's safe end and stops at the first late one", () => {
    const aligned = [word(1000, 1600), word(2000, 2600), word(17_800, 18_600), word(19_000, 19_500)];
    const accepted = acceptAlignedWords(aligned, 0, 20_000);
    expect(accepted.words.map((item) => item.wordIndex)).toEqual([0, 1]);
    expect(accepted.advance).toBe(2);
    expect(accepted.stoppedBy).toBe("end");
    expect(accepted.uncertain).toBe(0);
    // 20 000 - 1 500 = 18 500 is the line; an end of 18 600 is past it.
    expect(accepted.words[1].endMs).toBe(2600);
  });

  it("treats exactly the guard boundary as late", () => {
    const aligned = [word(1000, 20_000 - DEFAULT_END_GUARD_MS)];
    expect(acceptAlignedWords(aligned, 0, 20_000).words).toEqual([]);
  });

  it("accepts the last word of the file, which the aligner clamps to the window end", () => {
    // B5's tts-words: "your" ends at 14 458 ms and "file" at the window end, both inside the old 1.5 s guard.
    const aligned = [word(13_600, 14_458), word(14_458, 15_098), word(15_098, 15_398)];
    const accepted = acceptAlignedWords(aligned, 0, 15_400, { endGuardMs: END_OF_AUDIO_GUARD_MS, endOfAudio: true });
    expect(accepted.words.map((item) => item.endMs)).toEqual([14_458, 15_098, 15_398]);
    expect(accepted.stoppedBy).toBe("exhausted");
    // A word running past the audio is still refused, with only the 60 ms epsilon allowed.
    const past = acceptAlignedWords([word(15_000, 15_470)], 0, 15_400, { endGuardMs: END_OF_AUDIO_GUARD_MS, endOfAudio: true });
    expect(past.words).toEqual([]);
    // The same words without the end-of-audio flag keep the ordinary 1 500 ms guard and are left for the next window.
    expect(acceptAlignedWords(aligned, 0, 15_400, { endGuardMs: DEFAULT_END_GUARD_MS }).words).toEqual([]);
  });

  it("stops at impossible times instead of placing them", () => {
    const accepted = acceptAlignedWords([word(1000, 1600), word(3000, 2000), word(4000, 4600)], 0, 20_000);
    expect(accepted.words.map((item) => item.startMs)).toEqual([1000]);
    expect(accepted.stoppedBy).toBe("end");
  });

  it("places low-confidence words but marks them uncertain", () => {
    const aligned = [word(1000, 1600), word(2000, 2600, -1.5, 0.2), word(3000, 3600)];
    const accepted = acceptAlignedWords(aligned, 0, 20_000);
    expect(accepted.words).toHaveLength(3);
    expect(accepted.uncertain).toBe(1);
    expect(accepted.words.map((item) => item.uncertain)).toEqual([false, true, false]);
    expect(accepted.words[1].confidence).toBeLessThan(0.6);
  });

  it("clamps a word that leads the window to the window's start", () => {
    const accepted = acceptAlignedWords([word(-200, 400)], 500, 20_000);
    expect(accepted.words[0]).toMatchObject({ startMs: 500, endMs: 400 });
    // A clamped word whose end is before its start is not a caption word, but the timing stays as reported.
    expect(accepted.advance).toBe(1);
  });

  it("returns the visitor's spelling by chunk position and advances the word index", () => {
    const aligned = [word(1000, 1300), word(1400, 1700)];
    const accepted = acceptAlignedWords(aligned, 0, 20_000, {
      spellings: ["Kya,", "der"],
      wordIndexOffset: 10,
    });
    expect(accepted.words.map((item) => item.text)).toEqual(["Kya,", "der"]);
    expect(accepted.words.map((item) => item.wordIndex)).toEqual([10, 11]);
  });

  it("honours maxWords and reports an empty result as empty", () => {
    const aligned = [word(1000, 1300), word(1400, 1700), word(1800, 2100)];
    expect(acceptAlignedWords(aligned, 0, 20_000, { maxWords: 2 }).advance).toBe(2);
    expect(acceptAlignedWords([], 0, 20_000)).toEqual({ words: [], advance: 0, uncertain: 0, stoppedBy: "empty" });
    expect(acceptAlignedWords(aligned, 0, 20_000, { maxWords: 0 }).stoppedBy).toBe("empty");
  });

  it("accepts every word when the list ends before the safe end", () => {
    const accepted = acceptAlignedWords([word(1000, 1300), word(1400, 1700)], 0, 20_000);
    expect(accepted.stoppedBy).toBe("exhausted");
    expect(accepted.advance).toBe(2);
  });
});

describe("findAnchors", () => {
  it("finds a run of exact Hinglish matches", () => {
    const lyric = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil", "tera"];
    const heard = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil", "tera"];
    const anchors = findAnchors(lyric, heard);
    expect(anchors.anchors).toHaveLength(8);
    expect(anchors.runs).toHaveLength(1);
    expect(anchors.anchors[0]).toEqual({ lyricIndex: 0, heardIndex: 0 });
    expect(anchors.anchors[7]).toEqual({ lyricIndex: 7, heardIndex: 7 });
  });

  it("matches a sound-alike spelling inside a run", () => {
    const anchors = findAnchors(["Lucknow", "mera", "dil"], ["lakhanoo", "mera", "dil"]);
    expect(anchors.anchors).toEqual([
      { lyricIndex: 0, heardIndex: 0 },
      { lyricIndex: 1, heardIndex: 1 },
      { lyricIndex: 2, heardIndex: 2 },
    ]);
  });

  it("refuses a single isolated match: an anchor is a run of two or more", () => {
    const anchors = findAnchors(["kya", "zzz", "qqq"], ["kya", "yyy", "www"]);
    expect(anchors.anchors).toEqual([]);
    expect(anchors.runs).toEqual([]);
  });

  it("keeps the matches monotonic and re-synchronises after a gap", () => {
    const lyric = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil"];
    const heard = ["kya", "der", "hai", "sajan", "mera", "dil"];
    const anchors = findAnchors(lyric, heard);
    for (let i = 1; i < anchors.anchors.length; i += 1) {
      expect(anchors.anchors[i].lyricIndex).toBeGreaterThan(anchors.anchors[i - 1].lyricIndex);
      expect(anchors.anchors[i].heardIndex).toBeGreaterThan(anchors.anchors[i - 1].heardIndex);
    }
    expect(anchors.anchors.at(-1)).toEqual({ lyricIndex: 6, heardIndex: 5 });
  });

  it("detects a repeated line as two anchor runs", () => {
    const lyric = ["kya", "der", "hai", "kya", "der", "hai"];
    const heard = ["kya", "der", "hai", "kya", "der", "hai"];
    const anchors = findAnchors(lyric, heard);
    expect(anchors.anchors).toHaveLength(6);
    expect(anchors.runs).toHaveLength(1);
  });

  it("is bounded by maxWords and says it was trimmed", () => {
    const lyric = Array.from({ length: 20 }, () => "kya");
    const heard = Array.from({ length: 20 }, () => "kya");
    const anchors = findAnchors(lyric, heard, { maxWords: 4 });
    expect(anchors.trimmed).toBe(true);
    expect(anchors.anchors.every((anchor) => anchor.lyricIndex < 4 && anchor.heardIndex < 4)).toBe(true);
    expect(anchors.anchors).toHaveLength(4);
  });

  it("returns nothing when one side is empty", () => {
    expect(findAnchors([], ["kya"]).anchors).toEqual([]);
    expect(findAnchors(["kya"], []).anchors).toEqual([]);
  });
});

describe("reconcileWithAnchors", () => {
  const anchor = (lyricIndex: number, heardIndex: number) => ({ lyricIndex, heardIndex });

  it("leaves the cursor alone when there are no anchors", () => {
    expect(reconcileWithAnchors({ cursor: 4, placed: [], anchors: [], windowStartMs: 0, windowEndMs: 30_000 })).toEqual({
      cursor: 4,
      support: [],
      skipped: [],
      jumped: false,
    });
  });

  it("jumps to the anchored position and reports the words it skipped", () => {
    const result = reconcileWithAnchors({
      cursor: 0,
      placed: [],
      anchors: [anchor(10, 2), anchor(11, 3)],
      windowStartMs: 0,
      windowEndMs: 30_000,
      heardTimes: [500, 1000, 5000, 5400],
    });
    expect(result.cursor).toBe(10);
    expect(result.skipped).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.jumped).toBe(true);
    expect(result.support).toHaveLength(2);
  });

  it("never returns a word that was already placed", () => {
    const result = reconcileWithAnchors({
      cursor: 0,
      placed: [10, 11],
      anchors: [anchor(10, 0), anchor(11, 1)],
      windowStartMs: 0,
      windowEndMs: 30_000,
    });
    // It skips the ten unsupported words before the anchor, then moves past the two placed ones.
    expect(result.cursor).toBe(12);
    expect(result.skipped).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.jumped).toBe(true);
  });

  it("skips an instrumental gap when this window has no support and the next anchor is later", () => {
    const result = reconcileWithAnchors({
      cursor: 3,
      placed: [0, 1, 2],
      anchors: [anchor(0, 0), anchor(1, 1), anchor(2, 2), anchor(20, 5)],
      windowStartMs: 30_000,
      windowEndMs: 60_000,
      heardTimes: [500, 900, 1300, 2000, 2500, 70_000],
    });
    expect(result.cursor).toBe(20);
    expect(result.skipped).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(result.support).toEqual([]);
    expect(result.jumped).toBe(true);
  });

  it("does not jump when there is no later anchor either", () => {
    const result = reconcileWithAnchors({
      cursor: 3,
      placed: [],
      anchors: [anchor(0, 0), anchor(1, 1)],
      windowStartMs: 30_000,
      windowEndMs: 60_000,
      heardTimes: [500, 900],
    });
    expect(result).toMatchObject({ cursor: 3, skipped: [], jumped: false });
  });

  it("refuses a jump bigger than maxJumpWords, so wrong lyrics cannot run to the end", () => {
    const result = reconcileWithAnchors({
      cursor: 0,
      placed: [],
      anchors: [anchor(500, 0), anchor(501, 1)],
      windowStartMs: 0,
      windowEndMs: 30_000,
      maxJumpWords: 50,
    });
    expect(result).toMatchObject({ cursor: 0, skipped: [], jumped: false });
  });

  it("does not move for an anchor at the cursor itself", () => {
    const result = reconcileWithAnchors({
      cursor: 5,
      placed: [0, 1, 2, 3, 4],
      anchors: [anchor(5, 0), anchor(6, 1)],
      windowStartMs: 0,
      windowEndMs: 30_000,
    });
    expect(result).toMatchObject({ cursor: 5, jumped: false });
  });
});

describe("unmatchedLyricLines", () => {
  it("lists only the lines with no placed word, bounded in count and length", () => {
    const parsed = parseLyrics(
      Array.from({ length: 12 }, (_, i) => `${"word ".repeat(20)}line${i}`).join("\n"),
    );
    const placed = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // only words of line 0 are placed
    const lines = unmatchedLyricLines(parsed, placed);
    expect(lines).toHaveLength(UNMATCHED_LINES_MAX);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(UNMATCHED_LINE_MAX_CHARS);
    expect(lines[0].endsWith("…")).toBe(true);
  });

  it("returns nothing when every line has a placed word", () => {
    const parsed = parseLyrics("Kya der hai\nAaj sajan");
    expect(unmatchedLyricLines(parsed, new Set([0, 1, 2, 3, 4]))).toEqual([]);
  });
});
