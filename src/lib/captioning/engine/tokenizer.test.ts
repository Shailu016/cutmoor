import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import { createWhisperTokenizer, splitWords } from "./tokenizer";
import { bytesAsTokens, bytesToUnicode, FAKE, fakeAddedTokens, fakeVocab, jsonBytes } from "./fake-model";

const build = () => createWhisperTokenizer({ vocab: jsonBytes(fakeVocab()), addedTokens: jsonBytes(fakeAddedTokens()) });

describe("byte-level symbol table (the oracle the tokenizer is checked against)", () => {
  it("matches known GPT-2 values", () => {
    const table = bytesToUnicode();
    expect(table[0x20]).toBe("Ġ"); // space -> "Ġ"
    expect(table[0x0a]).toBe("Ċ"); // newline -> "Ċ"
    expect(table[0x41]).toBe("A");
    expect(table[0xe0]).toBe("à");
    expect(new Set(table).size).toBe(256);
  });
});

describe("decode", () => {
  it("turns merged tokens back into text with their leading space", () => {
    const tok = build();
    expect(tok.decode([FAKE.hai])).toBe(" hai");
    expect(tok.decode([FAKE.kya, FAKE.hai])).toBe(" kya hai");
  });

  it.each([
    ["plain Latin", " aaj mausam accha hai"],
    ["Hinglish with punctuation", " Kya haal hai, bhai? Sab theek!"],
    ["Devanagari", " नमस्ते दोस्तों"],
    ["emoji and ZWJ sequences", " great 😀 👨‍👩‍👧"],
    ["accents and newline", " café\nnaïve"],
    ["mixed scripts", " yeh सब ठीक hai 100%"],
  ])("round-trips %s through one-byte tokens", (_name, text) => {
    // One byte per token is the hardest case: a single letter or emoji is spread over several tokens.
    expect(build().decode(bytesAsTokens(text))).toBe(text);
  });

  it("joins a character split across two tokens", () => {
    const bytes = bytesAsTokens("😀");
    expect(bytes).toHaveLength(4);
    expect(build().decode(bytes.slice(0, 2).concat(bytes.slice(2)))).toBe("😀");
    // Half an emoji must not throw; it shows the replacement character.
    expect(build().decode(bytes.slice(0, 2))).toContain("�");
  });

  it("skips end-of-text, language and timestamp tokens and unknown ids", () => {
    const tok = build();
    const ids = [...bytesAsTokens(" ok"), FAKE.eot, FAKE.en, FAKE.firstTimestamp + 3, 9999];
    expect(tok.decode(ids)).toBe(" ok");
    expect(tok.decode([])).toBe("");
  });

  it("knows which ids are not text", () => {
    const tok = build();
    expect(tok.isSpecial(FAKE.eot)).toBe(true);
    expect(tok.isSpecial(FAKE.firstTimestamp)).toBe(true);
    expect(tok.isSpecial(FAKE.hai)).toBe(false);
    expect(tok.isSpecial(65)).toBe(false);
  });
});

describe("special tokens and formats", () => {
  it("finds the special ids by name", () => {
    const tok = build();
    expect(tok.special).toEqual({ eot: FAKE.eot, sot: FAKE.sot, transcribe: FAKE.transcribe, noTimestamps: FAKE.noTimestamps, noSpeech: FAKE.noSpeech, startOfPrev: FAKE.startOfPrev });
    expect(tok.tokenId("<|en|>")).toBe(FAKE.en);
    expect(tok.tokenId("<|nope|>")).toBeUndefined();
    expect(tok.vocabSize).toBe(FAKE.hi + 1);
  });

  it("reads a Hugging Face tokenizer.json (model.vocab + added_tokens)", () => {
    const added = Object.entries(fakeAddedTokens()).map(([content, id]) => ({ id, content, special: true }));
    const tok = createWhisperTokenizer({ vocab: jsonBytes({ model: { vocab: fakeVocab() }, added_tokens: added }) });
    expect(tok.special.sot).toBe(FAKE.sot);
    expect(tok.decode(bytesAsTokens(" नमस्ते"))).toBe(" नमस्ते");
  });

  it("accepts <|nospeech|> as the no-speech name", () => {
    const added = { ...fakeAddedTokens() } as Record<string, number>;
    delete added["<|nocaptions|>"];
    added["<|nospeech|>"] = 777;
    const tok = createWhisperTokenizer({ vocab: jsonBytes(fakeVocab()), addedTokens: jsonBytes(added) });
    expect(tok.special.noSpeech).toBe(777);
  });

  it("falls back to the standard multilingual layout when the files name no special tokens", () => {
    const vocab: Record<string, number> = {};
    bytesToUnicode().forEach((symbol, byte) => {
      vocab[symbol] = byte;
    });
    for (let id = 256; id < 50257; id += 1) vocab[`tok${id}`] = id;
    const tok = createWhisperTokenizer({ vocab: jsonBytes(vocab) });
    expect(tok.special).toEqual({ eot: 50257, sot: 50258, transcribe: 50359, noTimestamps: 50363, noSpeech: 50362, startOfPrev: 50361 });
    expect(tok.tokenId("<|en|>")).toBe(50259);
    expect(tok.isSpecial(50257)).toBe(true);
    expect(tok.isSpecial(50256)).toBe(false);
    // The highest id is <|notimestamps|> (50363), so the vocabulary has 50364 entries, not 50257.
    expect(tok.vocabSize).toBe(50364);
  });

  it("refuses a vocabulary it cannot place the special tokens in", () => {
    const vocab: Record<string, number> = {};
    bytesToUnicode().forEach((symbol, byte) => {
      vocab[symbol] = byte;
    });
    vocab.extra = 1000;
    expect(() => createWhisperTokenizer({ vocab: jsonBytes(vocab) })).toThrow(CaptionError);
  });

  it("rejects broken input with a model-load error", () => {
    const expectLoadError = (fn: () => unknown) => {
      try {
        fn();
        throw new Error("did not throw");
      } catch (error) {
        expect(error).toBeInstanceOf(CaptionError);
        expect((error as CaptionError).code).toBe("model-load");
      }
    };
    expectLoadError(() => createWhisperTokenizer({ vocab: new TextEncoder().encode("{not json") }));
    expectLoadError(() => createWhisperTokenizer({ vocab: jsonBytes([1, 2, 3]) }));
    expectLoadError(() => createWhisperTokenizer({ vocab: jsonBytes({ a: "x" }) }));
    expectLoadError(() => createWhisperTokenizer({ vocab: jsonBytes({ a: 1, b: 2 }) }));
    expectLoadError(() => createWhisperTokenizer({ vocab: jsonBytes(fakeVocab()), addedTokens: new TextEncoder().encode("nope") }));
  });
});

describe("splitWords", () => {
  it("keeps punctuation attached to its word", () => {
    expect(splitWords(" Kya haal hai, bhai? Sab theek!")).toEqual(["Kya", "haal", "hai,", "bhai?", "Sab", "theek!"]);
  });
  it("handles runs of whitespace, newlines and tabs", () => {
    expect(splitWords("  a \n\n b\t\tc  ")).toEqual(["a", "b", "c"]);
  });
  it("returns nothing for blank text", () => {
    expect(splitWords("")).toEqual([]);
    expect(splitWords(" \n\t ")).toEqual([]);
  });
  it("splits Devanagari without breaking letters", () => {
    expect(splitWords("नमस्ते दोस्तों!")).toEqual(["नमस्ते", "दोस्तों!"]);
  });
});

describe("encode", () => {
  /** A tiny byte-level BPE: every byte is a token, plus the merges "h e" -> "he" and "he l" -> "hel" (and a space-led "Ġh"). */
  const symbols = bytesToUnicode();
  const vocabFor = () => {
    const vocab: Record<string, number> = {};
    symbols.forEach((symbol, byte) => {
      vocab[symbol] = byte;
    });
    vocab.he = 258;
    vocab.hel = 259;
    vocab[`${symbols[0x20]}h`] = 260;
    return vocab;
  };
  const withMerges = (merges: unknown) => ({
    model: { type: "BPE", vocab: vocabFor(), merges },
    added_tokens: Object.entries(fakeAddedTokens()).map(([content, id]) => ({ content, id })),
  });

  it("applies the merges in rank order", () => {
    const tok = createWhisperTokenizer({ vocab: jsonBytes(withMerges(["h e", "he l"])) });
    expect(tok.encode("hel")).toEqual([259]);
    expect(tok.encode("he")).toEqual([258]);
    expect(tok.encode("hex")).toEqual([258, "x".charCodeAt(0)]);
  });

  it("keeps a leading space with its word, as Whisper's pre-tokenizer does, and accepts merges written as pairs", () => {
    const tok = createWhisperTokenizer({ vocab: jsonBytes(withMerges([[symbols[0x20], "h"]])) });
    expect(tok.encode(" hi")).toEqual([260, "i".charCodeAt(0)]);
  });

  it("falls back to single bytes when there are no merges, and round-trips through decode", () => {
    const tok = createWhisperTokenizer({ vocab: jsonBytes(withMerges([])) });
    const ids = tok.encode(" Mumma, नमस्ते");
    expect(ids.length).toBeGreaterThan(8);
    expect(tok.decode(ids)).toBe(" Mumma, नमस्ते");
  });

  it("never produces a special token id, even if the text spells one", () => {
    const tok = createWhisperTokenizer({ vocab: jsonBytes(withMerges([])) });
    const ids = tok.encode("<|endoftext|> hi");
    expect(ids.every((id) => id < tok.special.eot)).toBe(true);
    expect(tok.decode(ids)).toBe("<|endoftext|> hi");
  });

  it("encodes the empty string to nothing", () => {
    expect(createWhisperTokenizer({ vocab: jsonBytes(withMerges([])) }).encode("")).toEqual([]);
  });

});
