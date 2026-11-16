import { describe, expect, it } from "vitest";
import { LEXICON, normalizeToken, normalizeWords } from "./normalize";
import type { Word } from "./types";

const word = (text: string, index: number): Word => ({
  text,
  startMs: index * 100,
  endMs: index * 100 + 80,
  confidence: 0.5,
  index,
  windowIndex: 2,
});

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The three capitalisation shapes a single word can arrive in. */
function caseForms(text: string): string[] {
  const lower = text.toLowerCase();
  return [lower, `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`, lower.toUpperCase()];
}

const DEVANAGARI_TEXT = /[\u0900-\u097F\uA8E0-\uA8FF]/;

describe("normalizeToken", () => {
  it("returns an empty string untouched", () => {
    expect(normalizeToken("")).toBe("");
  });

  it("normalises the common Hinglish spelling variants", () => {
    const cases: Array<[string, string]> = [
      ["nahi", "nahi"],
      ["nahin", "nahi"],
      ["nhi", "nahi"],
      ["nahii", "nahi"],
      ["nahee", "nahi"],
      ["nahe", "nahi"],
      ["hai", "hai"],
      ["hae", "hai"],
      ["hain", "hain"],
      ["haien", "hain"],
      ["haan", "haan"],
      ["haa", "haan"],
      ["kya", "kya"],
      ["kyaa", "kya"],
      ["kyun", "kyun"],
      ["kyu", "kyun"],
      ["kyon", "kyun"],
      ["kaise", "kaise"],
      ["kese", "kaise"],
      ["kaisa", "kaisa"],
      ["kesa", "kaisa"],
      ["kaun", "kaun"],
      ["bohot", "bahut"],
      ["bhot", "bahut"],
      ["accha", "achha"],
      ["acha", "achha"],
      ["thik", "theek"],
      ["mtlb", "matlab"],
      ["yar", "yaar"],
      ["krna", "karna"],
      ["rha", "raha"],
      ["gya", "gaya"],
      ["muje", "mujhe"],
      ["ye", "yeh"],
      ["wo", "woh"],
      ["samj", "samajh"],
      ["vala", "wala"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeToken(input), input).toBe(expected);
    }
  });

  it("keeps hai and hain distinct without flattening their case", () => {
    expect(normalizeToken("hai")).toBe("hai");
    expect(normalizeToken("hain")).toBe("hain");
    expect(normalizeToken("HAIN")).toBe("HAIN");
    expect(normalizeToken("Hain")).toBe("Hain");
  });

  it("preserves the input capitalisation pattern for plain-word variants", () => {
    const cases: Array<[string, string]> = [
      ["Nahin", "Nahi"],
      ["NAHIN", "NAHI"],
      ["Nahi", "Nahi"],
      ["nahi", "nahi"],
      ["nAhin", "nahi"],
      ["Hai", "Hai"],
      ["HAI", "HAI"],
      ["KYAA", "KYA"],
      ["Bohot", "Bahut"],
      ["BOHOT", "BAHUT"],
      ["Muje", "Mujhe"],
      ["MUJE", "MUJHE"],
      ["Thik", "Theek"],
      ["NAHI,", "NAHI,"],
      ["Nahin!", "Nahi!"],
      ["(KYA?)", "(KYA?)"],
      ["--NAHIN!!", "--NAHI!!"],
      ["«nhi»", "«nahi»"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeToken(input), input).toBe(expected);
    }
  });

  it("uses canonical casing for brands and initialisms regardless of input", () => {
    const cases: Array<[string, string]> = [
      ["youtube", "YouTube"],
      ["Youtube", "YouTube"],
      ["YOUTUBE", "YouTube"],
      ["yt", "YouTube"],
      ["YT", "YouTube"],
      ["instagram", "Instagram"],
      ["INSTA", "Instagram"],
      ["instgram", "Instagram"],
      ["whatsapp", "WhatsApp"],
      ["WHATSAPP", "WhatsApp"],
      ["watsapp", "WhatsApp"],
      ["github", "GitHub"],
      ["linkedin", "LinkedIn"],
      ["iphone", "iPhone"],
      ["ios", "iOS"],
      ["IOS", "iOS"],
      ["ipad", "iPad"],
      ["chatgpt", "ChatGPT"],
      ["CHATGPT", "ChatGPT"],
      ["openai", "OpenAI"],
      ["gpay", "GPay"],
      ["phonepe", "PhonePe"],
      ["upi", "UPI"],
      ["ok", "OK"],
      ["OK", "OK"],
      ["ai", "AI"],
      ["AI", "AI"],
      ["i", "I"],
      ["i'm", "I'm"],
      ["I'M", "I'm"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeToken(input), input).toBe(expected);
    }
  });

  it("returns unknown Roman words exactly as they arrived", () => {
    const untouched = [
      "Delhi",
      "Rahul",
      "Mumbai",
      "NASA",
      "IPL",
      "ISRO",
      "Modi",
      "America",
      "Hello",
      "WORLD",
      "Some-Word",
      "MP3",
      "4K",
      "COVID-19",
      "$500",
      "iPhone15",
    ];
    for (const input of untouched) {
      expect(normalizeToken(input), input).toBe(input);
    }
  });

  it("leaves a spelling alone when it is also a different real word", () => {
    // "kam" = less, "nai" = new, "kia" = Kia/kiya, "ig" = I guess, "tm" = TM, "id" = the id,
    // "sb" = somebody, "yr" = year, "bhut" = bhoot, "han" = Han, "kon" = Kon. All are ambiguous,
    // so none may be rewritten.
    const ambiguous = [
      "kam",
      "nai",
      "kia",
      "Kia",
      "ig",
      "IG",
      "tm",
      "TM",
      "id",
      "ID",
      "sb",
      "yr",
      "bhut",
      "han",
      "Han",
      "kon",
      "Kon",
    ];
    for (const input of ambiguous) {
      expect(normalizeToken(input), input).toBe(input);
    }
    expect(normalizeToken("kam karo")).toBe("kam karo");
    expect(normalizeToken("nai gaadi")).toBe("nai gaadi");
    expect(normalizeToken("Kia Seltos")).toBe("Kia Seltos");
  });

  it("preserves leading and trailing punctuation exactly", () => {
    expect(normalizeToken("nahi,")).toBe("nahi,");
    expect(normalizeToken("«nhi»")).toBe("«nahi»");
    expect(normalizeToken("...")).toBe("...");
    expect(normalizeToken("?!")).toBe("?!");
    expect(normalizeToken("🔥")).toBe("🔥");
    expect(normalizeToken("🔥nahi")).toBe("🔥nahi");
    expect(normalizeToken("don't")).toBe("don't");
    expect(normalizeToken("YouTube.")).toBe("YouTube.");
  });

  it("leaves Devanagari alone, even when punctuation or Latin text is mixed in", () => {
    expect(normalizeToken("नहीं")).toBe("नहीं");
    expect(normalizeToken("क्या")).toBe("क्या");
    expect(normalizeToken("नमस्ते,")).toBe("नमस्ते,");
    expect(normalizeToken("नहीं।")).toBe("नहीं।");
    expect(normalizeToken("nahi नहीं")).toBe("nahi नहीं");
    expect(normalizeToken("क्या kya")).toBe("क्या kya");
    expect(normalizeToken("NAHIN नहीं")).toBe("NAHIN नहीं");
  });

  it("never transliterates", () => {
    expect(normalizeToken("nahi")).toBe("nahi");
    expect(normalizeToken("nahi")).not.toMatch(DEVANAGARI_TEXT);
    expect(normalizeToken("क्या")).not.toMatch(/[a-z]/);
  });

  it("is idempotent for hand-picked traps", () => {
    const traps = ["NAHI,", "(KYA?)", "«nhi»", "नहीं", "WHATsApp", "I'm", "4K!", "...", "🔥", "i", ""];
    for (const trap of traps) {
      const once = normalizeToken(trap);
      expect(normalizeToken(once), trap).toBe(once);
    }
  });

  it("is idempotent over every lexicon key and canonical value in every case pattern", () => {
    expect(LEXICON.size).toBeGreaterThan(100);
    for (const [key, canonical] of LEXICON) {
      for (const form of caseForms(key)) {
        const once = normalizeToken(form);
        expect(once.toLowerCase(), `${key} / ${form}`).toBe(canonical.toLowerCase());
        expect(normalizeToken(once), `${key} / ${form} -> ${once}`).toBe(once);
      }
      for (const form of caseForms(canonical)) {
        const once = normalizeToken(form);
        expect(once.toLowerCase(), `${canonical} / ${form}`).toBe(canonical.toLowerCase());
        expect(normalizeToken(once), `${canonical} / ${form} -> ${once}`).toBe(once);
      }
    }
  });

  it("keeps every lexicon key lowercase, as the lookup requires", () => {
    for (const key of LEXICON.keys()) {
      expect(key, key).toBe(key.toLowerCase());
    }
  });

  it("contains none of the ambiguous spellings the lexicon policy forbids", () => {
    for (const key of ["kam", "nai", "kia", "ig", "tm", "id", "sb", "yr", "bhut", "han", "kon"]) {
      expect(LEXICON.has(key), key).toBe(false);
    }
  });

  it("is idempotent on random tokens (seeded fuzz)", () => {
    const random = makeRandom(20261113);
    const pieces = [
      "nahi",
      "NAHI",
      "Nhi",
      "hai",
      "HAIN",
      "kya",
      "youtube",
      "INSTA",
      "watsapp",
      "hello",
      "WORLD",
      "Delhi",
      "NASA",
      "नहीं",
      "क्या",
      "",
      "--",
      "!!",
      "...",
      "4K",
      "i'm",
      "I'M",
      " ",
      "'",
      "«",
      "»",
      "9",
      "🔥",
    ];
    for (let round = 0; round < 2000; round += 1) {
      const parts = 1 + Math.floor(random() * 3);
      let token = "";
      for (let part = 0; part < parts; part += 1) {
        token += pieces[Math.floor(random() * pieces.length)];
      }
      const once = normalizeToken(token);
      expect(normalizeToken(once), token).toBe(once);
      if (DEVANAGARI_TEXT.test(token)) {
        expect(once, token).toBe(token);
      }
    }
  });
});

describe("normalizeWords", () => {
  it("is a strict 1:1 map that only changes text", () => {
    const input: Word[] = [
      word("nhi", 0),
      word("HAIN", 1),
      word("youtube", 2),
      word("नहीं", 3),
      word("ok", 4),
      word("Hello", 5),
    ];
    const snapshot = input.map((item) => ({ ...item }));
    const output = normalizeWords(input);

    expect(output).toHaveLength(input.length);
    expect(output.map((item) => item.text)).toEqual(["nahi", "HAIN", "YouTube", "नहीं", "OK", "Hello"]);
    for (let i = 0; i < input.length; i += 1) {
      expect(output[i].startMs).toBe(input[i].startMs);
      expect(output[i].endMs).toBe(input[i].endMs);
      expect(output[i].index).toBe(input[i].index);
      expect(output[i].windowIndex).toBe(input[i].windowIndex);
      expect(output[i].confidence).toBe(input[i].confidence);
    }
    // The input array and its words are untouched.
    expect(input).toEqual(snapshot);
    expect(input[0].text).toBe("nhi");
  });

  it("handles an empty transcript", () => {
    expect(normalizeWords([])).toEqual([]);
  });

  it("is idempotent", () => {
    const input: Word[] = [word("NHI", 0), word("watsapp", 1), word("क्या", 2), word("I", 3)];
    const once = normalizeWords(input);
    expect(normalizeWords(once)).toEqual(once);
  });

  it("keeps timings on a random transcript (seeded fuzz)", () => {
    const random = makeRandom(77);
    const texts = ["nhi", "HAIN", "kya", "youtube", "नहीं", "ok", "Hello", "Delhi", "...", ""];
    for (let round = 0; round < 200; round += 1) {
      const count = Math.floor(random() * 30);
      const input: Word[] = [];
      let cursor = 0;
      for (let i = 0; i < count; i += 1) {
        const duration = 50 + Math.floor(random() * 500);
        input.push({
          text: texts[Math.floor(random() * texts.length)],
          startMs: cursor,
          endMs: cursor + duration,
          confidence: random(),
          index: i,
          windowIndex: Math.floor(random() * 3),
        });
        cursor += duration;
      }
      const output = normalizeWords(input);
      expect(output).toHaveLength(input.length);
      for (let i = 0; i < input.length; i += 1) {
        expect(output[i].startMs).toBe(input[i].startMs);
        expect(output[i].endMs).toBe(input[i].endMs);
        expect(output[i].index).toBe(input[i].index);
        expect(output[i].windowIndex).toBe(input[i].windowIndex);
        expect(output[i].confidence).toBe(input[i].confidence);
      }
      expect(normalizeWords(output)).toEqual(output);
    }
  });

  it("writes Whisper's 'paagar' and 'paagal' as 'pagal', keeping case and punctuation, but leaves 'pagar' alone", () => {
    const word = (text: string) => ({ text, startMs: 0, endMs: 1, confidence: 1, index: 0, windowIndex: 0 });
    const out = normalizeWords([word("paagar"), word("Paagal,"), word("pagar")]).map((w) => w.text);
    expect(out).toEqual(["pagal", "Pagal,", "pagar"]);
  });
});
