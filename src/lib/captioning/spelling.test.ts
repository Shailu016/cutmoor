import { describe, expect, it } from "vitest";
import {
  BLOCKED_PHONETIC_KEYS,
  REJECTED_SPELLINGS,
  SPELLING_FAMILIES,
} from "./data/hinglish-variants";
import { normalizeWords } from "./normalize";
import { applySpelling, phoneticKey } from "./spelling";
import type { Word } from "./types";

const word = (text: string, index = 0): Word => ({
  text,
  startMs: index * 100,
  endMs: index * 100 + 80,
  confidence: 0.25 + (index % 7) * 0.1,
  index,
  windowIndex: index % 3,
});

const words = (...texts: string[]): Word[] => texts.map((text, index) => word(text, index));

const texts = (list: Word[]): string[] => list.map((item) => item.text);

const spell = (input: string[], glossary?: string[]): string[] =>
  texts(applySpelling(words(...input), glossary === undefined ? {} : { glossary }));

const spellOne = (input: string, glossary?: string[]): string => spell([input], glossary)[0];

const DEVANAGARI_TEXT = /[\u0900-\u097F\uA8E0-\uA8FF]/;

describe("applySpelling: basics", () => {
  it("returns an empty transcript unchanged", () => {
    expect(applySpelling([])).toEqual([]);
  });

  it("leaves unknown lowercase Roman words exactly as they arrived", () => {
    for (const input of ["hello", "world", "banana", "jupiter", "someword", "xyzzy"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("applies the v1 exact-variant lexicon to lowercase words", () => {
    const cases: Array<[string, string]> = [
      ["nahin", "nahi"],
      ["nhi", "nahi"],
      ["haien", "hain"],
      ["haa", "haan"],
      ["kyaa", "kya"],
      ["kyu", "kyun"],
      ["kyon", "kyun"],
      ["kese", "kaise"],
      ["kesa", "kaisa"],
      ["bhii", "bhi"],
      ["bohot", "bahut"],
      ["bhot", "bahut"],
      ["acha", "achha"],
      ["accha", "achha"],
      ["thik", "theek"],
      ["mtlb", "matlab"],
      ["yar", "yaar"],
      ["kro", "karo"],
      ["krna", "karna"],
      ["rha", "raha"],
      ["gya", "gaya"],
      ["muje", "mujhe"],
      ["ye", "yeh"],
      ["wo", "woh"],
      ["samj", "samajh"],
      ["vala", "wala"],
      ["paagar", "pagal"],
    ];
    for (const [input, expected] of cases) {
      expect(spellOne(input), input).toBe(expected);
    }
  });

  it("uses the v1 lexicon for brands and initialisms that are not Hinglish families", () => {
    expect(spellOne("youtube")).toBe("YouTube");
    expect(spellOne("watsapp")).toBe("WhatsApp");
    expect(spellOne("ok")).toBe("OK");
    expect(spellOne("upi")).toBe("UPI");
    expect(spellOne("iphone")).toBe("iPhone");
  });
});

describe("applySpelling: phonetic key", () => {
  it("joins a family when the key is listed and the word is within one edit", () => {
    const cases: Array<[string, string]> = [
      ["kyunn", "kyun"],
      ["mujhhe", "mujhe"],
      ["theekk", "theek"],
      ["achhaa", "achha"],
      ["samajhh", "samajh"],
      ["samaaj", "samajh"],
    ];
    for (const [input, expected] of cases) {
      expect(spellOne(input), input).toBe(expected);
    }
  });

  it("does not use the phonetic path when the edit distance is more than one", () => {
    for (const input of ["nahiiii", "mujh", "quasar", "khyaal", "zindagiiii"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("folds long vowels, doubled letters, v/w, ph/f, final h", () => {
    expect(phoneticKey("theek")).toBe(phoneticKey("thik"));
    expect(phoneticKey("achha")).toBe(phoneticKey("acha"));
    expect(phoneticKey("woh")).toBe(phoneticKey("vo"));
    expect(phoneticKey("phir")).toBe(phoneticKey("fir"));
    expect(phoneticKey("zindagi")).toBe(phoneticKey("jindagi"));
    expect(phoneticKey("kyunn")).toBe("kyun");
    expect(phoneticKey("baat")).toBe("bat");
  });
});

describe("applySpelling: safety", () => {
  it("never touches capitalised tokens", () => {
    const protectedTokens = [
      "Kyun?",
      "Rahul",
      "NASA",
      "Delhi",
      "Kon",
      "Han",
      "Accha",
      "Bohot",
      "Theek",
      "Nahin",
      "Hello",
    ];
    for (const input of protectedTokens) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("never touches ALL-CAPS tokens", () => {
    for (const input of ["NAHIN", "THEEK", "ACCHA", "HAIN", "KYUN", "NASA", "MP3", "4K"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("never touches mixed-case brands or names", () => {
    for (const input of ["iPhone", "YouTube", "WhatsApp", "GitHub", "McDonald", "OpenAI", "IPhone"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("never touches Devanagari tokens, including mixed tokens", () => {
    for (const input of ["नहीं", "क्या", "नमस्ते,", "नहीं।", "nahi नहीं", "क्या kya", "NAHIN नहीं"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("never touches tokens containing a digit", () => {
    for (const input of ["4K", "iPhone15", "MP3", "500", "COVID-19", "$500", "3", "a1"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("keeps leading and trailing punctuation exactly where it was", () => {
    const cases: Array<[string, string]> = [
      ["accha,", "achha,"],
      ["(accha)", "(achha)"],
      ["«nhi»", "«nahi»"],
      ["accha?!", "achha?!"],
      ['"accha"', '"achha"'],
      ["--nhi!!", "--nahi!!"],
      ["nahin.", "nahi."],
      ["🔥accha", "🔥achha"],
    ];
    for (const [input, expected] of cases) {
      expect(spellOne(input), input).toBe(expected);
    }
  });

  it("leaves punctuation-only tokens and internal punctuation alone", () => {
    for (const input of ["...", "?!", "🔥", "don't", "some-word", "e-mail", "a/b"]) {
      expect(spellOne(input), input).toBe(input);
    }
  });

  it("keeps the word count, timing, confidence and indexes untouched", () => {
    const input = words("nhi", "HAIN", "youtube", "नहीं", "ok", "Hello", "accha", "4K", "Rahul");
    const snapshot = input.map((item) => ({ ...item }));
    const output = applySpelling(input);

    expect(output).toHaveLength(input.length);
    expect(texts(output)).toEqual([
      "nahi",
      "HAIN",
      "YouTube",
      "नहीं",
      "OK",
      "Hello",
      "achha",
      "4K",
      "Rahul",
    ]);
    for (let index = 0; index < input.length; index += 1) {
      expect(output[index].startMs).toBe(input[index].startMs);
      expect(output[index].endMs).toBe(input[index].endMs);
      expect(output[index].index).toBe(input[index].index);
      expect(output[index].windowIndex).toBe(input[index].windowIndex);
      expect(output[index].confidence).toBe(input[index].confidence);
    }
    expect(input).toEqual(snapshot);
    expect(input[0].text).toBe("nhi");
  });

  it("returns new word objects even when nothing changes", () => {
    const input = words("Hello", "Rahul", "4K");
    const output = applySpelling(input);
    for (let index = 0; index < input.length; index += 1) {
      expect(output[index]).not.toBe(input[index]);
      expect(output[index]).toEqual(input[index]);
    }
  });
});

describe("applySpelling: document consensus", () => {
  it("rewrites every lowercase occurrence to the most frequent spelling", () => {
    expect(spell(["humein", "hume", "hume"])).toEqual(["hume", "hume", "hume"]);
    expect(spell(["accha", "acha", "acha"])).toEqual(["acha", "acha", "acha"]);
  });

  it("breaks a tie with the family's canonical spelling", () => {
    // kyon and kyu both occur once and neither is canonical.
    expect(spell(["kyon", "kyu"])).toEqual(["kyun", "kyun"]);
    // The canonical spelling does not even occur in this transcript.
    expect(spell(["hume", "humen"])).toEqual(["humein", "humein"]);
    expect(spell(["nahin", "nahi"])).toEqual(["nahi", "nahi"]);
    expect(spell(["thik", "theek"])).toEqual(["theek", "theek"]);
  });

  it("does not count capitalised occurrences as evidence and never rewrites them", () => {
    expect(spell(["Hume", "hume", "hume"])).toEqual(["Hume", "hume", "hume"]);
    expect(spell(["Kyun", "kyun", "kyu"])).toEqual(["Kyun", "kyun", "kyun"]);
    expect(spell(["NAHIN", "nahin", "nahi"])).toEqual(["NAHIN", "nahi", "nahi"]);
  });

  it("keeps consensus inside one transcript", () => {
    expect(spell(["humein", "hume"])).toEqual(["humein", "humein"]);
    expect(spell(["hume", "hume"])).toEqual(["hume", "hume"]);
    expect(spell(["humein"])).toEqual(["humein"]);
    expect(spell(["hume"])).toEqual(["humein"]);
  });

  it("is idempotent on a consensus transcript", () => {
    const once = applySpelling(words("humein", "hume", "hume", "jaana"));
    expect(texts(once)).toEqual(["hume", "hume", "hume", "jaana"]);
    expect(applySpelling(once)).toEqual(once);
  });
});

describe("applySpelling: glossary", () => {
  it("uses the glossary spelling and exact casing", () => {
    expect(spellOne("rahul", ["Rahul"])).toBe("Rahul");
    expect(spellOne("nasa", ["NASA"])).toBe("NASA");
    expect(spellOne("rahul", ["rahul"])).toBe("rahul");
    expect(spellOne("Rahul", ["Rahul"])).toBe("Rahul");
  });

  it("matches a glossary entry within one edit (case-insensitive)", () => {
    expect(spellOne("rahil", ["Rahul"])).toBe("Rahul");
    expect(spellOne("cutmor", ["Cutmoor"])).toBe("Cutmoor");
    expect(spellOne("nassa", ["NASA"])).toBe("NASA");
  });

  it("lets the glossary win over the Hinglish table", () => {
    expect(spellOne("accha", ["Accha"])).toBe("Accha");
    expect(spellOne("acha", ["Accha"])).toBe("Accha");
    expect(spellOne("accha", ["Acha"])).toBe("Acha");
  });

  it("keeps punctuation around a glossary replacement", () => {
    expect(spellOne("rahil,", ["Rahul"])).toBe("Rahul,");
    expect(spellOne("(rahil)", ["Rahul"])).toBe("(Rahul)");
    expect(spellOne("nasa?!", ["NASA"])).toBe("NASA?!");
  });

  it("still refuses to touch ALL-CAPS tokens even when they match a glossary", () => {
    expect(spellOne("RAHUL", ["Rahul"])).toBe("RAHUL");
    expect(spellOne("NASA", ["Nasa"])).toBe("NASA");
  });

  it("only matches short glossary entries exactly, not fuzzily", () => {
    expect(spellOne("al", ["Al"])).toBe("Al");
    expect(spellOne("ak", ["Al"])).toBe("ak");
    expect(spellOne("ab", ["Al"])).toBe("ab");
  });

  it("uses the first spelling when the glossary repeats a name", () => {
    expect(spellOne("rahul", ["Rahul", "rahul"])).toBe("Rahul");
    expect(spellOne("rahul", ["rahul", "Rahul"])).toBe("rahul");
  });

  it("ignores glossary entries that are not a single Latin word", () => {
    expect(spellOne("rahul", ["Rahul Sharma"])).toBe("rahul");
    expect(spellOne("rahul", ["  "])).toBe("rahul");
    expect(spellOne("rahul", ["नमस्ते"])).toBe("rahul");
  });

  it("does not mutate the glossary or the transcript", () => {
    const glossary = ["Rahul", "Cutmoor"];
    const input = words("rahul", "cutmor");
    const snapshot = input.map((item) => ({ ...item }));
    applySpelling(input, { glossary });
    expect(glossary).toEqual(["Rahul", "Cutmoor"]);
    expect(input).toEqual(snapshot);
    expect(spell(["rahul"], [])).toEqual(["rahul"]);
  });
});

describe("hinglish variant table policy", () => {
  const allSpellings = SPELLING_FAMILIES.flatMap((family) => [family.canonical, ...family.variants]);

  it("contains at least 60 high-frequency families", () => {
    expect(SPELLING_FAMILIES.length).toBeGreaterThanOrEqual(60);
  });

  it("includes the words the brief calls out", () => {
    const present = new Set(allSpellings);
    const required = [
      "nahi",
      "hai",
      "hain",
      "tha",
      "kyun",
      "kya",
      "kaise",
      "achha",
      "bahut",
      "thoda",
      "bilkul",
      "matlab",
      "theek",
      "sahi",
      "abhi",
      "phir",
      "lekin",
      "isliye",
      "mujhe",
      "tumhe",
      "humein",
      "mera",
      "meri",
      "karna",
      "kar",
      "kiya",
      "hona",
      "jana",
      "aana",
      "dekhna",
      "bolna",
      "sunna",
      "samajh",
      "pagal",
    ];
    for (const spelling of required) expect(present.has(spelling), spelling).toBe(true);
  });

  it("keeps every spelling lowercase and owned by one family", () => {
    const owner = new Map<string, string>();
    for (const family of SPELLING_FAMILIES) {
      for (const spelling of [family.canonical, ...family.variants]) {
        expect(spelling, spelling).toBe(spelling.toLowerCase());
        const previous = owner.get(spelling);
        if (previous !== undefined) {
          expect(previous, spelling).toBe(family.canonical);
        } else {
          owner.set(spelling, family.canonical);
        }
      }
    }
  });

  it("has no unblocked phonetic-key collision between families", () => {
    const blocked = new Set(BLOCKED_PHONETIC_KEYS);
    const owner = new Map<string, string>();
    for (const family of SPELLING_FAMILIES) {
      for (const spelling of [family.canonical, ...family.variants]) {
        const key = phoneticKey(spelling);
        if (blocked.has(key)) continue;
        const previous = owner.get(key);
        if (previous !== undefined) {
          expect(previous, `${spelling} -> ${key}`).toBe(family.canonical);
        } else {
          owner.set(key, family.canonical);
        }
      }
    }
  });

  it("never admits a rejected ambiguous spelling into a family", () => {
    const present = new Set(allSpellings);
    for (const rejected of REJECTED_SPELLINGS) {
      expect(present.has(rejected.word), rejected.word).toBe(false);
      expect(rejected.reason.length, rejected.word).toBeGreaterThan(3);
    }
  });

  it("leaves every rejected ambiguous word unchanged", () => {
    for (const rejected of REJECTED_SPELLINGS) {
      expect(spellOne(rejected.word), rejected.word).toBe(rejected.word);
    }
  });
});

describe("applySpelling: idempotence", () => {
  const allSpellings = SPELLING_FAMILIES.flatMap((family) => [family.canonical, ...family.variants]);

  it("is idempotent for every spelling in the table", () => {
    for (const spelling of allSpellings) {
      const once = spellOne(spelling);
      expect(spellOne(once), `${spelling} -> ${once}`).toBe(once);
    }
  });

  it("is idempotent over one transcript containing the whole table", () => {
    const once = applySpelling(words(...allSpellings));
    const twice = applySpelling(once);
    expect(texts(twice)).toEqual(texts(once));
  });

  it("is idempotent on hand-picked traps", () => {
    const traps = ["NAHI,", "(KYA?)", "«nhi»", "नहीं", "WhatSApp", "I'm", "4K!", "...", "🔥", "i", ""];
    for (const trap of traps) {
      const once = spellOne(trap);
      expect(spellOne(once), trap).toBe(once);
    }
  });
});

describe("normalizeWords integration with spelling v2", () => {
  it("keeps the v1 casing behaviour and then adds consensus", () => {
    expect(texts(normalizeWords(words("Nahin", "Rahul", "NASA")))).toEqual(["Nahi", "Rahul", "NASA"]);
    expect(texts(normalizeWords(words("humein", "hume")))).toEqual(["humein", "humein"]);
    expect(texts(normalizeWords(words("humein", "hume", "hume")))).toEqual(["hume", "hume", "hume"]);
  });

  it("is still idempotent and still preserves timing", () => {
    const input = words("NHI", "watsapp", "क्या", "I", "accha", "acha", "acha");
    const once = normalizeWords(input);
    expect(normalizeWords(once)).toEqual(once);
    for (let index = 0; index < input.length; index += 1) {
      expect(once[index].startMs).toBe(input[index].startMs);
      expect(once[index].endMs).toBe(input[index].endMs);
      expect(once[index].confidence).toBe(input[index].confidence);
    }
  });
});

/**
 * Hand-checked evaluation set. This is throwaway calibration data, kept in the test file
 * so it cannot drift away from the implementation unnoticed.
 *
 * Most pairs are real corrections a Hinglish transcript needs. The last bucket contains
 * names, acronyms, ambiguous words, digits and Devanagari that must NOT move, plus two
 * deliberately hard misspellings ("mujhay", "thike") that the conservative matcher is
 * expected to miss. Those two are the recall cost of never guessing.
 */
const EVAL_CASES: ReadonlyArray<readonly [string, string]> = [
  // 1-10: exact lexicon / family canonical
  ["nahin", "nahi"],
  ["nhi", "nahi"],
  ["haien", "hain"],
  ["haa", "haan"],
  ["kyaa", "kya"],
  ["kyu", "kyun"],
  ["kyon", "kyun"],
  ["kese", "kaise"],
  ["kesa", "kaisa"],
  ["bhii", "bhi"],

  // 11-20
  ["bohot", "bahut"],
  ["bhot", "bahut"],
  ["acha", "achha"],
  ["accha", "achha"],
  ["thik", "theek"],
  ["mtlb", "matlab"],
  ["yar", "yaar"],
  ["kro", "karo"],
  ["krna", "karna"],
  ["krta", "karta"],

  // 21-30
  ["krti", "karti"],
  ["krte", "karte"],
  ["kr", "kar"],
  ["kre", "kare"],
  ["rha", "raha"],
  ["rhi", "rahi"],
  ["rhe", "rahe"],
  ["gya", "gaya"],
  ["gyi", "gayi"],
  ["gye", "gaye"],

  // 31-40
  ["kch", "kuch"],
  ["mra", "mera"],
  ["mri", "meri"],
  ["muje", "mujhe"],
  ["mujhey", "mujhe"],
  ["tuje", "tujhe"],
  ["ye", "yeh"],
  ["vo", "woh"],
  ["voh", "woh"],
  ["yaha", "yahan"],

  // 41-50
  ["waha", "wahan"],
  ["abhee", "abhi"],
  ["lakin", "lekin"],
  ["thda", "thoda"],
  ["thora", "thoda"],
  ["zada", "zyada"],
  ["jyada", "zyada"],
  ["pyar", "pyaar"],
  ["zindgi", "zindagi"],
  ["jindagi", "zindagi"],

  // 51-60: phrases
  ["wakt kya", "waqt kya"],
  ["vakt kya", "waqt kya"],
  ["galt kya", "galat kya"],
  ["btao kya", "batao kya"],
  ["samj kya", "samajh kya"],
  ["paisaa kya", "paisa kya"],
  ["paagar kya", "pagal kya"],
  ["nam kya", "naam kya"],
  ["pani kya", "paani kya"],
  ["khana kya", "khaana kya"],

  // 61-70
  ["jana kya", "jaana kya"],
  ["oopar kya", "upar kya"],
  ["chaiye kya", "chahiye kya"],
  ["lgta kya", "lagta kya"],
  ["mlta kya", "milta kya"],
  ["janta jaanta", "janta jaanta"], // janta (the public) must not become jaanta (knows)
  ["phele kya", "pehle kya"],
  ["aj kya", "aaj kya"],
  ["roj kya", "roz kya"],
  ["maheena kya", "mahina kya"],

  // 71-80: morphology and consensus
  ["subha kya", "subah kya"],
  ["jese kya", "jaise kya"],
  ["wese kya", "waise kya"],
  ["esa kya", "aisa kya"],
  ["wesa kya", "waisa kya"],
  ["humein hume hume jaana", "hume hume hume jaana"],
  ["kyon kyu", "kyun kyun"],
  ["accha acha acha", "acha acha acha"],
  ["acha accha accha", "accha accha accha"],
  ["HAIN hain haien", "HAIN hain hain"],

  // 81-90: more consensus and protected tokens
  ["Kyun kyun kyu", "Kyun kyun kyun"],
  ["nahin nahi", "nahi nahi"],
  ["thik theek", "theek theek"],
  ["muje mujhe", "mujhe mujhe"],
  ["ye yeh", "yeh yeh"],
  ["Kyun? Rahul", "Kyun? Rahul"],
  ["NASA Delhi", "NASA Delhi"],
  ["Kon Han", "Kon Han"],
  ["kam nai", "kam nai"],
  ["kia pagar", "kia pagar"],

  // 91-100: ambiguity, digits, Devanagari, punctuation and two hard misses
  ["fir bat", "fir bat"],
  ["rat bad", "rat bad"],
  ["sham sal", "sham sal"],
  ["pas niche", "pas niche"],
  ["thike", "theek"],
  ["bhut suna", "bhut suna"],
  ["bhar 4K", "bhar 4K"],
  ["iPhone15 MP3", "iPhone15 MP3"],
  ["accha, (thik)", "achha, (theek)"],
  ["mujhay", "mujhe"],
];

describe("evaluation: 100 hand-checked pairs", () => {
  it("has exactly 100 pairs", () => {
    expect(EVAL_CASES).toHaveLength(100);
  });

  it("keeps word counts identical for every pair", () => {
    for (const [input, expected] of EVAL_CASES) {
      expect(input.split(" ").length, input).toBe(expected.split(" ").length);
    }
  });

  it("reaches at least 95% precision with zero changes to capitalised tokens", () => {
    let changed = 0;
    let correctChanges = 0;
    let expectedChanges = 0;
    let capitalisedChanges = 0;
    const misses: string[] = [];
    const wrongChanges: string[] = [];

    for (const [input, expected] of EVAL_CASES) {
      const inputWords = input.split(" ");
      const expectedWords = expected.split(" ");
      const outputWords = spell(inputWords);

      for (let index = 0; index < inputWords.length; index += 1) {
        const before = inputWords[index];
        const after = outputWords[index];
        const want = expectedWords[index];

        const capitalised = /[A-Z]/.test(before) || DEVANAGARI_TEXT.test(before);
        if (capitalised && after !== before) capitalisedChanges += 1;

        if (after !== before) {
          changed += 1;
          if (after === want) correctChanges += 1;
          else wrongChanges.push(`${input}: ${before} -> ${after}, wanted ${want}`);
        } else if (want !== before) {
          misses.push(`${input}: ${before} stayed, wanted ${want}`);
        }
        if (want !== before) expectedChanges += 1;
      }
    }

    const precision = changed === 0 ? 1 : correctChanges / changed;
    const recall = expectedChanges === 0 ? 1 : correctChanges / expectedChanges;


    expect(wrongChanges).toEqual([]);
    expect(capitalisedChanges).toBe(0);
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    // Two known conservative misses are expected; no more.
    expect(misses).toHaveLength(2);
    expect(misses.join(" | ")).toContain("mujhay");
    expect(misses.join(" | ")).toContain("thike");
  });

  it("is idempotent over every evaluation pair", () => {
    for (const [input] of EVAL_CASES) {
      const inputWords = input.split(" ");
      const once = texts(applySpelling(words(...inputWords)));
      const twice = texts(applySpelling(words(...once)));
      expect(twice, input).toEqual(once);
    }
  });

  it("does not merge different verbs: dikhata (shows) stays apart from dikhta (is visible), padhane (to teach) from padhne (to study)", () => {
    const w = (text: string, i: number) => ({ text, startMs: i * 100, endMs: i * 100 + 90, confidence: 1, index: i, windowIndex: 0 });
    const out = applySpelling([w("woh", 0), w("dikhata", 1), w("hai", 2), w("padhane", 3), w("jaata", 4)]).map((x) => x.text);
    expect(out[1]).toBe("dikhata");
    expect(out[3]).toBe("padhane");
  });
});
