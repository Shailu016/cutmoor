import { describe, expect, it } from "vitest";
import { isSongJunkWord, pickBetterSongReading, scoreSongWords, SONG_JUNK_TOKENS, songWordCore, trimSongReading } from "./song-junk";

describe("songWordCore / isSongJunkWord", () => {
  it("keeps letters, digits and combining marks only, lowercased", () => {
    expect(songWordCore("  Kya, der?!  ")).toBe("kyader");
    expect(songWordCore("Dhadkane,")).toBe("dhadkane");
    expect(songWordCore("hai.")).toBe("hai");
    expect(songWordCore("२")).toBe("२");
    expect(songWordCore("---")).toBe("");
  });

  it("recognises the junk family regardless of case and punctuation, and nothing else", () => {
    expect(SONG_JUNK_TOKENS).toEqual(["nan", "n", "nn"]);
    expect(isSongJunkWord("nan")).toBe(true);
    expect(isSongJunkWord("NaN.")).toBe(true);
    expect(isSongJunkWord(" N! ")).toBe(true);
    expect(isSongJunkWord("nn,")).toBe(true);
    expect(isSongJunkWord("na")).toBe(false);
    expect(isSongJunkWord("nana")).toBe(false);
    expect(isSongJunkWord("on")).toBe(false);
    // Consecutive junk tokens joined into one word are still junk; a real word is not.
    expect(isSongJunkWord("nannan.")).toBe(true);
    expect(isSongJunkWord("nannannan")).toBe(true);
    expect(isSongJunkWord("nunn")).toBe(false);
    expect(isSongJunkWord("नन")).toBe(false);
    expect(isSongJunkWord("---")).toBe(false);
  });
});

describe("trimSongReading", () => {
  it("keeps the real prefix of a reading with a nan tail", () => {
    expect(trimSongReading(["dhadkane", "dil", "ki", "nan", "nan"])).toEqual({
      words: ["dhadkane", "dil", "ki"],
      dropped: 2,
      cutLoop: false,
    });
  });

  it("keeps the real tail of a reading that starts with a junk run (59-80.85 s shape)", () => {
    const result = trimSongReading(["nan", "n", "nn", "nan", "chaand", "niraat", "taaron", "ki"]);
    expect(result.words).toEqual(["chaand", "niraat", "taaron", "ki"]);
    expect(result.dropped).toBe(4);
    expect(result.cutLoop).toBe(false);
  });

  it("keeps the longest interior span when junk sits on both sides", () => {
    const result = trimSongReading(["nan", "dil", "ki", "nan", "nan"]);
    expect(result.words).toEqual(["dil", "ki"]);
    expect(result.dropped).toBe(3);
  });

  it("does not touch junk inside the kept span (only edge runs are cut)", () => {
    expect(trimSongReading(["dil", "nan", "ki"])).toEqual({ words: ["dil", "nan", "ki"], dropped: 0, cutLoop: false });
  });

  it("keeps a lyric refrain of exactly three identical real words", () => {
    expect(trimSongReading(["aaja", "aaja", "aaja"])).toEqual({ words: ["aaja", "aaja", "aaja"], dropped: 0, cutLoop: false });
    expect(trimSongReading(["dil", "ki", "aaja", "aaja", "aaja"])).toEqual({
      words: ["dil", "ki", "aaja", "aaja", "aaja"],
      dropped: 0,
      cutLoop: false,
    });
  });

  it("cuts a run of four identical real words to one copy", () => {
    expect(trimSongReading(["kya", "der", "hai", "hai", "hai", "hai"])).toEqual({
      words: ["kya", "der", "hai"],
      dropped: 3,
      cutLoop: true,
    });
  });

  it("cuts a repeated 2-word n-gram at four repeats, but keeps three (a real refrain)", () => {
    // Three copies of a real phrase are lyric ("I mean I mean I mean"); four are a decoder loop.
    expect(trimSongReading(["kya", "der", "kya", "der", "kya", "der"])).toEqual({
      words: ["kya", "der", "kya", "der", "kya", "der"],
      dropped: 0,
      cutLoop: false,
    });
    expect(trimSongReading(["kya", "der", "kya", "der", "kya", "der", "kya", "der"])).toEqual({
      words: ["kya", "der"],
      dropped: 6,
      cutLoop: true,
    });
  });

  it("cuts a repeated 3-word or 4-word n-gram at four repeats", () => {
    const three = ["dil", "ki", "aaja"];
    expect(trimSongReading([...three, ...three, ...three]).dropped).toBe(0);
    expect(trimSongReading([...three, ...three, ...three, ...three]).words).toEqual(three);
    const four = ["chaand", "ki", "baat", "hai"];
    expect(trimSongReading([...four, ...four, ...four]).dropped).toBe(0);
    expect(trimSongReading([...four, ...four, ...four, ...four]).words).toEqual(four);
  });

  it("cuts loops repeatedly, so a loop that exposes another loop is fully trimmed", () => {
    const result = trimSongReading(["dil", "dil", "dil", "dil", "dil", "dil"]);
    expect(result.words).toEqual(["dil"]);
    expect(result.dropped).toBe(5);
    expect(result.cutLoop).toBe(true);

    const nested = trimSongReading(["kya", "der", "kya", "der", "kya", "der", "kya", "der"]);
    expect(nested.words).toEqual(["kya", "der"]);
    expect(nested.dropped).toBe(6);
    expect(nested.cutLoop).toBe(true);
  });

  it("compares loop copies on the word core, so case and punctuation do not hide a loop", () => {
    expect(trimSongReading(["Kya", "der", "kya.", "der,", "KYA", "der!", "kya", "der"])).toEqual({
      words: ["Kya", "der"],
      dropped: 6,
      cutLoop: true,
    });
  });

  it("returns empty for an all-junk reading and for an empty reading", () => {
    expect(trimSongReading(["nan", "n", "nn"])).toEqual({ words: [], dropped: 3, cutLoop: false });
    expect(trimSongReading(["nan", "nan"])).toEqual({ words: [], dropped: 2, cutLoop: false });
    expect(trimSongReading([])).toEqual({ words: [], dropped: 0, cutLoop: false });
  });

  it("adds junk and loop removals into `dropped`", () => {
    const result = trimSongReading(["nan", "hai", "hai", "hai", "hai", "nan"]);
    expect(result.words).toEqual(["hai"]);
    expect(result.dropped).toBe(5);
    expect(result.cutLoop).toBe(true);
    expect(result.dropped).toBe(6 - result.words.length);
  });

  it("does not mutate the input array", () => {
    const input = ["nan", "dil", "nan"];
    trimSongReading(input);
    expect(input).toEqual(["nan", "dil", "nan"]);
  });
});

describe("scoreSongWords", () => {
  it("counts real Latin words, junk, Devanagari and all words", () => {
    expect(scoreSongWords(["dil", "nan", "नन", "Ki.", "kya", "hai"])).toEqual({
      realLatin: 4,
      junk: 1,
      devanagari: 1,
      words: 6,
    });
  });

  it("does not count a Devanagari word as a real Latin word and counts an empty list as zero", () => {
    expect(scoreSongWords(["नन", "है"])).toEqual({ realLatin: 0, junk: 0, devanagari: 2, words: 2 });
    expect(scoreSongWords([])).toEqual({ realLatin: 0, junk: 0, devanagari: 0, words: 0 });
  });
});

describe("pickBetterSongReading", () => {
  const wordsOf = (take: readonly string[]) => take;

  it("prefers more real Latin words", () => {
    const few = ["dil", "ki"];
    const many = ["dil", "ki", "aaja"];
    expect(pickBetterSongReading(few, many, wordsOf)).toBe(many);
    expect(pickBetterSongReading(many, few, wordsOf)).toBe(many);
  });

  it("prefers more real words even when the better take also carries junk", () => {
    const fewerNoJunk = ["dil"];
    const moreWithJunk = ["dil", "ki", "nan"];
    expect(pickBetterSongReading(fewerNoJunk, moreWithJunk, wordsOf)).toBe(moreWithJunk);
    expect(pickBetterSongReading(moreWithJunk, fewerNoJunk, wordsOf)).toBe(moreWithJunk);
  });

  it("prefers fewer junk words when real Latin words are equal", () => {
    const oneJunk = ["dil", "nan"];
    const twoJunk = ["dil", "nan", "nan"];
    expect(pickBetterSongReading(oneJunk, twoJunk, wordsOf)).toBe(oneJunk);
    expect(pickBetterSongReading(twoJunk, oneJunk, wordsOf)).toBe(oneJunk);
  });

  it("makes a Devanagari-only reading lose to a Latin reading", () => {
    const devanagari = ["नन", "है"];
    const latin = ["dil", "ki"];
    expect(pickBetterSongReading(devanagari, latin, wordsOf)).toBe(latin);
    expect(pickBetterSongReading(latin, devanagari, wordsOf)).toBe(latin);
    // Even when the Devanagari reading is longer and the Latin one is a single word.
    expect(pickBetterSongReading(devanagari, ["dil"], wordsOf)).toEqual(["dil"]);
  });

  it("breaks an exact tie on higher mean log-probability", () => {
    const a = ["dil", "ki"];
    const b = ["dil", "ki"];
    expect(pickBetterSongReading(a, b, wordsOf, () => -0.5)).toBe(a);
    expect(pickBetterSongReading(a, b, wordsOf, (take) => (take === a ? -0.5 : -0.2))).toBe(b);
    expect(pickBetterSongReading(a, b, wordsOf, (take) => (take === b ? -0.5 : -0.2))).toBe(a);
  });

  it("ranks a non-finite log-probability last instead of letting NaN win", () => {
    const broken = ["dil"];
    const fine = ["dil"];
    expect(pickBetterSongReading(broken, fine, wordsOf, (take) => (take === broken ? Number.NaN : -1))).toBe(fine);
    expect(pickBetterSongReading(fine, broken, wordsOf, (take) => (take === broken ? Number.NaN : -1))).toBe(fine);
  });

  it("keeps `a` on a full tie (identity, not a copy)", () => {
    const a = { id: "a", words: ["dil"] };
    const b = { id: "b", words: ["dil"] };
    const pick = (take: { id: string; words: string[] }) => take.words;
    expect(pickBetterSongReading(a, b, pick, () => -1)).toBe(a);
    expect(pickBetterSongReading(b, a, pick, () => -1)).toBe(b);
  });
});
