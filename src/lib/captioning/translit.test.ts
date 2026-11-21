import { describe, expect, it } from "vitest";
import { applyScript, hasDevanagari, transliterateDevanagari, transliterateWord } from "./translit";
import type { Word } from "./types";

/**
 * The transliteration is a display spelling, so these expectations are the product's Hinglish
 * conventions worked out by hand, not values recomputed with the implementation. The 70-word
 * table below is the shared vocabulary of Hindi/Hinglish captions: pronouns, everyday verbs,
 * family words, numbers of the day, and the loanwords the product already writes in Latin.
 */

const COMMON_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["नमस्ते", "namaste"],
  ["नमस्कार", "namaskar"],
  ["धन्यवाद", "dhanyavaad"],
  ["क्या", "kya"],
  ["है", "hai"],
  ["हैं", "hain"],
  ["नहीं", "nahi"],
  ["हाँ", "haan"],
  ["मैं", "main"],
  ["तुम", "tum"],
  ["आप", "aap"],
  ["हम", "hum"],
  ["वह", "woh"],
  ["यह", "yeh"],
  ["कैसे", "kaise"],
  ["क्यों", "kyun"],
  ["कहाँ", "kahan"],
  ["अच्छा", "achha"],
  ["बहुत", "bahut"],
  ["थोड़ा", "thoda"],
  ["बड़ा", "bada"],
  ["छोटा", "chhota"],
  ["पानी", "paani"],
  ["खाना", "khaana"],
  ["जाना", "jaana"],
  ["आना", "aana"],
  ["करना", "karna"],
  ["करता", "karta"],
  ["रहा", "raha"],
  ["रही", "rahi"],
  ["गया", "gaya"],
  ["गई", "gayi"],
  ["हुआ", "hua"],
  ["हुई", "hui"],
  ["जी", "ji"],
  ["दिल", "dil"],
  ["प्यार", "pyaar"],
  ["ज़िंदगी", "zindagi"],
  ["दोस्त", "dost"],
  ["स्कूल", "school"],
  ["वीडियो", "video"],
  ["भारत", "bharat"],
  ["हिन्दी", "hindi"],
  ["भाषा", "bhasha"],
  ["इंसान", "insaan"],
  ["भाई", "bhai"],
  ["घर", "ghar"],
  ["काम", "kaam"],
  ["समय", "samay"],
  ["वक़्त", "waqt"],
  ["लड़का", "ladka"],
  ["लड़की", "ladki"],
  ["बच्चा", "bachcha"],
  ["पढ़ना", "padhna"],
  ["लिखना", "likhna"],
  ["देखना", "dekhna"],
  ["समझना", "samajhna"],
  ["चाहिए", "chahiye"],
  ["खुशी", "khushi"],
  ["मोहब्बत", "mohabbat"],
  ["शादी", "shaadi"],
  ["चाय", "chai"],
  ["दूध", "doodh"],
  ["मीठा", "meetha"],
  ["कितना", "kitna"],
  ["कहानी", "kahani"],
  ["दुनिया", "duniya"],
  ["क़िस्सा", "kissa"],
  ["क़िताब", "kitaab"],
  ["ठीक", "theek"],
];

describe("transliterateWord", () => {
  it("transliterates the common Hindi vocabulary to the product's Hinglish spelling", () => {
    expect(COMMON_WORDS.length).toBeGreaterThanOrEqual(40);
    for (const [devanagari, roman] of COMMON_WORDS) {
      expect(transliterateWord(devanagari), devanagari).toBe(roman);
    }
  });

  it("handles conjuncts from the virama, including the conventional clusters", () => {
    expect(transliterateWord("नमस्ते")).toBe("namaste"); // स्त
    expect(transliterateWord("कर्म")).toBe("karm"); // र्म
    expect(transliterateWord("कल्पना")).toBe("kalpana"); // ल्प
    expect(transliterateWord("श्री")).toBe("shri"); // श्र
    expect(transliterateWord("ज्ञान")).toBe("gyaan"); // ज्ञ
    expect(transliterateWord("क्षेत्र")).toBe("kshetra"); // क्ष + त्र
    expect(transliterateWord("अच्छा")).toBe("achha"); // च्छ, not ch + chh
    expect(transliterateWord("बच्चा")).toBe("bachcha"); // च्च stays two sounds
  });

  it("handles matras and the word-final long-vowel shortening", () => {
    expect(transliterateWord("का")).toBe("ka");
    expect(transliterateWord("काम")).toBe("kaam");
    expect(transliterateWord("कि")).toBe("ki");
    expect(transliterateWord("की")).toBe("ki");
    expect(transliterateWord("कु")).toBe("ku");
    expect(transliterateWord("कूप")).toBe("koop");
    expect(transliterateWord("बहू")).toBe("bahu");
    expect(transliterateWord("पानी")).toBe("paani");
    expect(transliterateWord("हुआ")).toBe("hua");
    expect(transliterateWord("दुआ")).toBe("dua");
    expect(transliterateWord("आना")).toBe("aana");
    expect(transliterateWord("आप")).toBe("aap");
    expect(transliterateWord("भाई")).toBe("bhai");
  });

  it("handles nukta consonants in precomposed and decomposed spelling", () => {
    expect(transliterateWord("फ़िल्म")).toBe("film");
    expect(transliterateWord("ज़रा")).toBe("zara");
    expect(transliterateWord("पढ़ना")).toBe("padhna");
    expect(transliterateWord("क़िताब")).toBe("kitaab");
    // ज़रा as U+095B and as ज + U+093C must agree.
    expect(transliterateWord("\u095B\u0930\u093E")).toBe("zara");
    expect(transliterateWord("\u091C\u093C\u0930\u093E")).toBe("zara");
    // बड़ा as U+095C and as ब + ड + U+093C must agree.
    expect(transliterateWord("\u092C\u095C\u093E")).toBe("bada");
    expect(transliterateWord("\u092C\u0921\u093C\u093E")).toBe("bada");
    expect(transliterateWord("ज़िंदगी")).toBe("zindagi");
  });

  it("handles anusvara and chandrabindu, with m before a labial and n elsewhere", () => {
    expect(transliterateWord("संभव")).toBe("sambhav"); // भ is labial
    expect(transliterateWord("अंबर")).toBe("ambar"); // ब is labial
    expect(transliterateWord("संसार")).toBe("sansaar");
    expect(transliterateWord("अंगूर")).toBe("angoor");
    expect(transliterateWord("हैं")).toBe("hain");
    expect(transliterateWord("हाँ")).toBe("haan");
    expect(transliterateWord("हूँ")).toBe("hoon");
    expect(transliterateWord("माँ")).toBe("maa");
  });

  it("handles a halant as a bare consonant", () => {
    expect(transliterateWord("क्")).toBe("k");
    expect(transliterateWord("राम्")).toBe("raam");
    expect(transliterateWord("प्रेम")).toBe("prem");
    expect(transliterateWord("स्वर")).toBe("svar");
  });

  it("maps Devanagari digits and danda, and drops avagraha", () => {
    expect(transliterateWord("१२३")).toBe("123");
    expect(transliterateWord("१२:३०")).toBe("12:30");
    expect(transliterateWord("नमस्ते।")).toBe("namaste.");
    expect(transliterateWord("सोऽहम्")).toBe("soham");
  });

  it("leaves non-Devanagari text byte-for-byte untouched", () => {
    expect(transliterateWord("video")).toBe("video");
    expect(transliterateWord("café")).toBe("café");
    expect(transliterateWord("naïve")).toBe("naïve");
    expect(transliterateWord("123")).toBe("123");
    expect(transliterateWord("🙂")).toBe("🙂");
    expect(transliterateWord("")).toBe("");
    // Mixed tokens: only the Devanagari run changes, the Latin part stays glued to it.
    expect(transliterateWord("मुझेvideo")).toBe("mujhevideo");
    expect(transliterateWord("videoमें")).toBe("videomein");
  });

  it("preserves leading and trailing punctuation", () => {
    expect(transliterateWord("नमस्ते,")).toBe("namaste,");
    expect(transliterateWord("(नमस्ते)")).toBe("(namaste)");
    expect(transliterateWord("“है?”")).toBe("“hai?”");
    expect(transliterateWord("नहीं!")).toBe("nahi!");
  });

  it("keeps zero-width joiners from changing the result", () => {
    expect(transliterateWord("ज़िंदगी")).toBe("zindagi");
    expect(transliterateWord("ज़िन्दगी")).toBe("zindagi");
  });
});

describe("transliterateDevanagari", () => {
  it("transliterates a sentence and keeps its spacing and punctuation", () => {
    expect(transliterateDevanagari("क्या आप ठीक हैं?")).toBe("kya aap theek hain?");
    expect(transliterateDevanagari("नमस्ते  दोस्तों,\nफिर मिलेंगे।")).toBe("namaste  doston,\nphir milenge.");
    expect(transliterateDevanagari("video नहीं")).toBe("video nahi");
    expect(transliterateDevanagari("  ")).toBe("  ");
  });
});

describe("hasDevanagari", () => {
  it("reports only text that contains a Devanagari character", () => {
    expect(hasDevanagari("नमस्ते")).toBe(true);
    expect(hasDevanagari("video")).toBe(false);
    expect(hasDevanagari("मुझेvideo")).toBe(true);
    expect(hasDevanagari("")).toBe(false);
  });
});

function word(text: string, startMs: number, endMs: number, index: number): Word {
  return { text, startMs, endMs, confidence: 0.7, index, windowIndex: 2 };
}

describe("applyScript", () => {
  const input: Word[] = [
    word("नमस्ते", 0, 400, 0),
    word("दोस्तों,", 420, 900, 1),
    word("video", 920, 1200, 2),
  ];

  it("returns new Word objects with the same timings and fields", () => {
    const roman = applyScript(input, "roman");
    expect(roman).toHaveLength(input.length);
    expect(roman.map((item) => item.text)).toEqual(["namaste", "doston,", "video"]);
    for (let index = 0; index < input.length; index += 1) {
      expect(roman[index]).not.toBe(input[index]);
      expect(roman[index]).toMatchObject({
        startMs: input[index].startMs,
        endMs: input[index].endMs,
        confidence: input[index].confidence,
        index: input[index].index,
        windowIndex: input[index].windowIndex,
      });
    }
    // The source list is untouched, so the editor keeps the visitor's original words.
    expect(input.map((item) => item.text)).toEqual(["नमस्ते", "दोस्तों,", "video"]);
  });

  it("copies the text unchanged for the original script, still as new objects", () => {
    const original = applyScript(input, "original");
    expect(original.map((item) => item.text)).toEqual(input.map((item) => item.text));
    for (let index = 0; index < input.length; index += 1) expect(original[index]).not.toBe(input[index]);
  });

  it("handles an empty transcript and non-Devanagari words", () => {
    expect(applyScript([], "roman")).toEqual([]);
    const latin = [word("hello", 0, 300, 0)];
    expect(applyScript(latin, "roman")).toEqual(latin);
    expect(applyScript(latin, "roman")[0]).not.toBe(latin[0]);
  });
});
