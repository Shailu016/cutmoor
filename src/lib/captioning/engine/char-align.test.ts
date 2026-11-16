import { describe, expect, it } from "vitest";
import {
  characterTokens,
  characterWordTimes,
  type CharacterAlignmentInput,
  type CharacterTokenRow,
  type CharacterWordTime,
} from "./char-align";
import type { AttentionMatrix } from "./attention";
import { createWhisperTokenizer } from "./tokenizer";
import { FAKE, fakeAddedTokens, fakeModelFiles, fakeVocab, jsonBytes } from "./fake-model";

/**
 * A [1, heads, rows, frames] tensor with one strong frame per query row. Row r of the tensor
 * predicts token r - promptRows, so the peaks are indexed by query row. `baselines` (optional) gives
 * every cell of a row that value before its peak is written, which lets a row attend weakly to the
 * whole window instead of to one frame.
 */
function attention(
  peaks: readonly number[],
  frames = 15,
  secondHead?: readonly number[],
  baselines?: readonly number[],
): AttentionMatrix {
  const rows = peaks.length;
  const heads = secondHead ? 2 : 1;
  const data = new Float32Array(heads * rows * frames);
  for (let head = 0; head < heads; head += 1) {
    const source = head === 0 ? peaks : (secondHead as readonly number[]);
    expect(source).toHaveLength(rows);
    expect(baselines ?? peaks).toHaveLength(rows);
    for (let row = 0; row < rows; row += 1) {
      if (baselines) {
        for (let f = 0; f < frames; f += 1) data[(head * rows + row) * frames + f] = baselines[row];
      }
      const peak = source[row];
      if (!Number.isInteger(peak) || peak < 0 || peak >= frames) throw new Error(`test tensor: bad peak ${peak} for row ${row}`);
      data[(head * rows + row) * frames + peak] = 1;
    }
  }
  return { dims: [1, heads, rows, frames], data };
}

/** One token per character: the common case for Latin text. */
function oneTokenRows(count: number): CharacterTokenRow[] {
  return Array.from({ length: count }, (_, index) => ({ firstToken: index, tokenCount: 1 }));
}

const ONE_HEAD = [{ layer: 0, head: 0 }];
/** Tests use one prompt row and no median filter so the DTW result can be worked out by hand. */
const BASE = { usedMs: 300, promptRows: 1, heads: ONE_HEAD, medianFilterWidth: 1 } as const;

/** times as [start, end] pairs, which is what the oracles assert. */
const pairs = (times: CharacterWordTime[] | null) => times?.map((word) => [word.startMs, word.endMs]);

describe("characterWordTimes", () => {
  it("puts three known peaks on three words, in order and inside the window", () => {
    // "abc def ghi": 11 characters, 11 tokens, so 12 query rows (the first is the prompt row).
    // Character c is read from row c (the row before its first token); row 11 predicts nothing.
    const result = characterWordTimes({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]) },
    });
    expect(result?.map((word) => word.text)).toEqual(["abc", "def", "ghi"]);
    // A word starts where its first character starts and ends where the next word's first
    // character starts; the last word ends after its last character (frame 15 = 300 ms).
    expect(pairs(result)).toEqual([
      [0, 80],
      [80, 160],
      [160, 300],
    ]);
  });

  it("keeps punctuation inside the word it is attached to", () => {
    // "hai," is one word: h a i , (chars 0-3). If the comma were a word of its own there would be
    // three words instead of two.
    const result = characterWordTimes({
      ...BASE,
      text: "hai, kya",
      charRows: oneTokenRows(8),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 7, 0]) },
    });
    expect(result?.map((word) => word.text)).toEqual(["hai,", "kya"]);
    // The comma's frames belong to word 0: word 0 ends only when "k" (char 5, frame 5) starts.
    expect(pairs(result)).toEqual([
      [0, 100],
      [100, 300],
    ]);
  });

  it("reads each character from its first token, skipping the extra rows of a 2-token character", () => {
    // "ab cd": 'b' encodes to two tokens. Rows are 0:a, 1:b's first token, 2:b's SECOND token,
    // 3:space, 4:c, 5:d. Row 2 is given a peak at frame 12 (240 ms) on purpose: if the code
    // mistook token rows for character rows, the space would sit at 240 ms and "cd" could not
    // start before it.
    const result = characterWordTimes({
      ...BASE,
      text: "ab cd",
      charRows: [
        { firstToken: 0, tokenCount: 1 },
        { firstToken: 1, tokenCount: 2 },
        { firstToken: 3, tokenCount: 1 },
        { firstToken: 4, tokenCount: 1 },
        { firstToken: 5, tokenCount: 1 },
      ],
      tensors: { "cross_attentions.0": attention([0, 1, 12, 3, 6, 9, 0]) },
    });
    expect(result?.map((word) => word.text)).toEqual(["ab", "cd"]);
    expect(result?.[0].startMs).toBe(0);
    // "cd" starts at the first free frame after the space's peak at frame 3: frame 4 = 80 ms.
    expect(result?.[1].startMs).toBe(80);
    expect(result?.[1].startMs).toBeLessThan(200);
  });

  it("keeps a repeated word at two different times", () => {
    const result = characterWordTimes({
      ...BASE,
      text: "haan haan",
      charRows: oneTokenRows(9),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 7, 8, 0]) },
    });
    expect(result?.map((word) => word.text)).toEqual(["haan", "haan"]);
    // DTW keeps order, so the second "haan" starts where its own characters are (frame 5), not
    // on the first occurrence's peak.
    expect(pairs(result)).toEqual([
      [0, 100],
      [100, 300],
    ]);
  });

  it("reads only the head it is given", () => {
    const peaks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0];
    // Head 0 is flat (every row peaks at frame 0, so no frame distinguishes any row); head 1 has
    // the real plateaus. Selecting head 0 must not produce head 1's times.
    const tensors = { "cross_attentions.0": attention(new Array<number>(12).fill(0), 15, peaks) };
    const flat = characterWordTimes({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      heads: [{ layer: 0, head: 0 }],
      tensors,
    });
    const sharp = characterWordTimes({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      heads: [{ layer: 0, head: 1 }],
      tensors,
    });
    // A flat matrix cannot tell any row apart, so DTW enters every row at frame 0; the monotonic
    // repair then makes each word 1 ms long until the last one takes the tail of the window.
    expect(flat?.map((word) => word.startMs)).toEqual([0, 1, 2]);
    expect(sharp?.map((word) => word.startMs)).toEqual([0, 80, 160]);
  });

  it("stays monotonic, non-empty and inside usedMs even when the attention is flat", () => {
    const result = characterWordTimes({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      tensors: { "cross_attentions.0": attention(new Array<number>(12).fill(0)) },
    });
    expect(result).toHaveLength(3);
    for (let i = 0; i < (result?.length ?? 0); i += 1) {
      const word = (result as CharacterWordTime[])[i];
      expect(word.startMs).toBeGreaterThanOrEqual(0);
      expect(word.endMs).toBeGreaterThan(word.startMs);
      expect(word.endMs).toBeLessThanOrEqual(300);
      if (i > 0) expect(word.startMs).toBeGreaterThanOrEqual((result as CharacterWordTime[])[i - 1].endMs);
    }
  });

  it("returns null (never throws) when anything is doubtful", () => {
    const good = (extra: Partial<CharacterAlignmentInput> = {}): CharacterAlignmentInput => ({
      ...BASE,
      text: "abc def",
      charRows: oneTokenRows(7),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 0]) },
      ...extra,
    });
    const base = good();
    expect(characterWordTimes(base)).not.toBeNull();

    // Empty and blank transcripts.
    expect(characterWordTimes({ ...base, text: "" })).toBeNull();
    expect(characterWordTimes({ ...base, text: "   ", charRows: oneTokenRows(3) })).toBeNull();
    expect(characterWordTimes({ ...base, text: "a".repeat(513), charRows: oneTokenRows(513) })).toBeNull();

    // The character map does not describe the text: one row too few / too many.
    expect(characterWordTimes({ ...base, charRows: oneTokenRows(6) })).toBeNull();
    expect(characterWordTimes({ ...base, charRows: oneTokenRows(8) })).toBeNull();

    // A character map with a bad row.
    expect(characterWordTimes({ ...base, charRows: [{ firstToken: 0, tokenCount: 0 }, ...oneTokenRows(6).slice(1)] })).toBeNull();
    expect(characterWordTimes({ ...base, charRows: [{ firstToken: -1, tokenCount: 1 }, ...oneTokenRows(6).slice(1)] })).toBeNull();
    // Token rows that go backwards cannot describe one left-to-right pass.
    expect(
      characterWordTimes({ ...base, charRows: [{ firstToken: 5, tokenCount: 1 }, { firstToken: 0, tokenCount: 1 }, ...oneTokenRows(5)] }),
    ).toBeNull();

    // Bad scalars.
    expect(characterWordTimes({ ...base, usedMs: 0 })).toBeNull();
    expect(characterWordTimes({ ...base, usedMs: Number.NaN })).toBeNull();
    expect(characterWordTimes({ ...base, usedMs: Number.POSITIVE_INFINITY })).toBeNull();
    expect(characterWordTimes({ ...base, medianFilterWidth: 2 })).toBeNull();
    expect(characterWordTimes({ ...base, medianFilterWidth: 0 })).toBeNull();
    expect(characterWordTimes({ ...base, medianFilterWidth: 103 })).toBeNull();
    expect(characterWordTimes({ ...base, framesPerSecond: 0 })).toBeNull();
    expect(characterWordTimes({ ...base, framesPerSecond: Number.NaN })).toBeNull();
    expect(characterWordTimes({ ...base, promptRows: 0 })).toBeNull();
    expect(characterWordTimes({ ...base, heads: [] })).toBeNull();
    expect(characterWordTimes({ ...base, heads: [{ layer: 0, head: -1 }] })).toBeNull();

    // Missing layer, head outside the tensor, too few query rows, short data.
    expect(characterWordTimes({ ...base, heads: [{ layer: 3, head: 0 }] })).toBeNull();
    expect(characterWordTimes({ ...base, heads: [{ layer: 0, head: 1 }] })).toBeNull();
    expect(
      characterWordTimes({ ...base, tensors: { "cross_attentions.0": { dims: [1, 1, 5, 15], data: new Float32Array(75) } } }),
    ).toBeNull();
    expect(
      characterWordTimes({ ...base, tensors: { "cross_attentions.0": { dims: [1, 1, 8, 15], data: new Float32Array(10) } } }),
    ).toBeNull();
    expect(characterWordTimes({ ...base, tensors: {} })).toBeNull();

    // Non-finite attention, where it is actually read.
    const nan = new Float32Array(8 * 15);
    nan[3 * 15 + 2] = Number.NaN;
    expect(characterWordTimes({ ...base, tensors: { "cross_attentions.0": { dims: [1, 1, 8, 15], data: nan } } })).toBeNull();
    const infinite = new Float32Array(8 * 15);
    infinite[3 * 15 + 2] = Number.POSITIVE_INFINITY;
    expect(characterWordTimes({ ...base, tensors: { "cross_attentions.0": { dims: [1, 1, 8, 15], data: infinite } } })).toBeNull();

    // Not an object at all.
    expect(characterWordTimes(undefined as never)).toBeNull();
  });

  it("keeps times inside a window shorter than the attention tensor", () => {
    // 200 ms of used audio = 10 frames, although the tensor holds 15.
    const result = characterWordTimes({
      ...BASE,
      usedMs: 200,
      text: "abc def",
      charRows: oneTokenRows(7),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 0]) },
    });
    expect(result).toHaveLength(2);
    for (const word of result as CharacterWordTime[]) expect(word.endMs).toBeLessThanOrEqual(200);
  });

  it("returns the words it could time instead of null when a tail word's start reaches usedMs", () => {
    // "ab cd": a, b, space, c, d. The first three characters attend to frames 0-2; c and d attend
    // to the last frame only (with a weak baseline, so the walk's long stretch cannot be parked in
    // their rows). At 0.5 ms per frame the last frame's time rounds up to usedMs exactly, so the
    // second word would have to start where the window ends: only "ab" can be timed. The whole
    // window used to be thrown away here; the prefix keeps the word that was timed.
    const result = characterWordTimes({
      ...BASE,
      framesPerSecond: 2000,
      text: "ab cd",
      charRows: oneTokenRows(5),
      tensors: {
        "cross_attentions.0": attention([0, 1, 2, 599, 599, 0], 600, undefined, [0.15, 0.15, 0.15, 0, 0, 0]),
      },
    });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({ text: "ab", startMs: 0, endMs: 300 });
  });

  it("does not change a normal two-word window", () => {
    // The same text at 20 ms frames, one peak per character: both words keep their usual times, so
    // the prefix rule cannot fire while there is room for every word.
    const result = characterWordTimes({
      ...BASE,
      text: "ab cd",
      charRows: oneTokenRows(5),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 0]) },
    });
    expect(result?.map((word) => word.text)).toEqual(["ab", "cd"]);
    expect(pairs(result)).toEqual([
      [0, 60],
      [60, 300],
    ]);
  });

  it("still returns null when nothing can be timed", () => {
    // The relaxed tail/coverage rules must not turn a refused input into a timed one.
    const good: CharacterAlignmentInput = {
      ...BASE,
      text: "ab cd",
      charRows: oneTokenRows(5),
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 0]) },
    };
    expect(characterWordTimes(good)).not.toBeNull();
    expect(characterWordTimes({ ...good, text: "" })).toBeNull();
    expect(characterWordTimes({ ...good, text: "   ", charRows: oneTokenRows(3) })).toBeNull();
    expect(characterWordTimes({ ...good, charRows: [] })).toBeNull();
    expect(characterWordTimes({ ...good, tensors: {} })).toBeNull();
    expect(characterWordTimes({ ...good, usedMs: 0 })).toBeNull();
    expect(characterWordTimes(undefined as never)).toBeNull();
  });
});

describe("characterTokens", () => {
  const files = fakeModelFiles();
  const tok = createWhisperTokenizer({ vocab: files.bytes.tokenizer, addedTokens: files.bytes.addedTokens });

  it("gives one row per character and records where each character's tokens start", () => {
    const encoded = characterTokens(tok, "aaj");
    expect(encoded?.tokenIds).toHaveLength(3);
    expect(encoded?.rows).toEqual([
      { firstToken: 0, tokenCount: 1 },
      { firstToken: 1, tokenCount: 1 },
      { firstToken: 2, tokenCount: 1 },
    ]);
    expect(encoded?.rows).toHaveLength("aaj".length);
  });

  it("gives a multi-byte character all of its tokens and no character zero tokens", () => {
    // The fake vocabulary is byte-level, so a Devanagari letter is three byte tokens.
    const encoded = characterTokens(tok, "नम");
    expect(encoded?.tokenIds).toHaveLength(6);
    expect(encoded?.rows).toEqual([
      { firstToken: 0, tokenCount: 3 },
      { firstToken: 3, tokenCount: 3 },
    ]);
  });

  it("lets one merged token cover several characters, all pointing at that token", () => {
    // A tokenizer that merges "Ġ" + "h" + "a" + "i" into the single token "Ġhai" (id 256): the
    // four characters of " hai" then share one token row, which is the best time resolution BPE
    // can give us.
    const merged = createWhisperTokenizer({
      vocab: jsonBytes({ model: { vocab: fakeVocab(), merges: [["Ġ", "h"], ["Ġh", "a"], ["Ġha", "i"]] } }),
      addedTokens: jsonBytes(fakeAddedTokens()),
    });
    const encoded = characterTokens(merged, " hai");
    expect(encoded?.tokenIds).toEqual([FAKE.hai]);
    expect(encoded?.rows).toEqual([
      { firstToken: 0, tokenCount: 1 },
      { firstToken: 0, tokenCount: 1 },
      { firstToken: 0, tokenCount: 1 },
      { firstToken: 0, tokenCount: 1 },
    ]);
  });

  it("refuses text its tokenizer cannot reproduce, and empty or oversized text", () => {
    expect(characterTokens(tok, "")).toBeNull();
    expect(characterTokens(tok, "a".repeat(513))).toBeNull();
    // A tokenizer whose decode disagrees with its encode: the character map would be a guess.
    expect(characterTokens({ encode: () => [1, 2], decode: () => "other" }, "abc")).toBeNull();
    expect(characterTokens({ encode: () => [], decode: () => "" }, "abc")).toBeNull();
    expect(characterTokens({ encode: () => [1.5], decode: () => "abc" }, "abc")).toBeNull();
    expect(
      characterTokens({ encode: () => { throw new Error("no vocabulary"); }, decode: () => "abc" }, "abc"),
    ).toBeNull();
  });
});
