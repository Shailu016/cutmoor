import { CaptionError } from "../contracts";
import type { Word } from "../types";
import { parseGoldHypothesisFile, type GoldHypothesis } from "./gold";
import { summariseErrors, type ErrorStats } from "./timing";
import { normalizeForWer, tokenizeForWer, wordErrorRate } from "./wer";

/**
 * Script-aware, transliteration-aware scoring for Hinglish / Hindi / English transcripts.
 *
 * WHY this exists next to `gold.ts`: the old scorer compares Devanagari with Roman strings
 * literally, so a correct Devanagari transcript of a Roman reference scores ~100% WER and tells us
 * nothing. This scorer keeps the raw number (nothing hidden) and adds a second number where the
 * Devanagari side is transliterated by a fixed rule set first. It also adds timing F1 at 50/100 ms
 * and words-per-minute hallucination rates, which the old mean-absolute-error report hid.
 *
 * Everything here is pure: no file is opened, no media is decoded, no clock is read. The CLI in
 * `scripts/eval/score2.mjs` owns argument parsing and JSON IO. The report is deterministic (no
 * timestamps, no absolute paths, no locale formatting) so two runs on the same input diff cleanly.
 */

export const SCORE2_SCHEMA_VERSION = 2 as const;

/**
 * The transliteration is a deterministic Roman-Hinglish "key", not a scholarly transcription.
 * Consonants/vowels/matras follow the ITRANS 5.30 table (https://www.aczoom.com/itrans/), with the
 * simplifications listed in `scripts/eval/README.md` (long/short vowels merged, Hindi schwa
 * deletion, ढ़/ड़ -> dh/d, anusvara -> n/m). A small closed list of English loanwords and
 * high-frequency function words is mapped to the spelling Hinglish references actually use
 * (स्कूल -> school, में -> mein); the raw WER keeps the un-transliterated input.
 */
export const TRANSLITERATION_RULESET = "ITRANS 5.30 consonants/vowels/matras, Roman-Hinglish simplifications";

// ---------------------------------------------------------------- script helpers

/** Devanagari and Devanagari Extended. Matras, nukta and virama are inside this range. */
const DEVANAGARI = /[\u0900-\u097F\uA8E0-\uA8FF]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const LEADING_PUNCT = /^[^\p{L}\p{N}\p{M}]+/u;
const TRAILING_PUNCT = /[^\p{L}\p{N}\p{M}]+$/u;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

function letterCounts(text: string): { devanagari: number; latin: number } {
  let devanagari = 0;
  let latin = 0;
  for (const char of text.normalize("NFC")) {
    if (DEVANAGARI.test(char)) devanagari += 1;
    else if (LATIN_LETTER.test(char)) latin += 1;
  }
  return { devanagari, latin };
}

/** Share of Devanagari among Devanagari+Latin letters. 0 when the string has neither. */
export function devanagariShare(text: string): number {
  const { devanagari, latin } = letterCounts(text);
  const total = devanagari + latin;
  return total === 0 ? 0 : devanagari / total;
}

/**
 * Splits one whitespace token at a Devanagari/Latin boundary. ASR output often glues the two
 * scripts together ("मुझेvideo"), and keeping that as one token would make an otherwise correct
 * word an error. Punctuation and digits stay attached to the run they follow.
 */
function splitScriptRuns(token: string): string[] {
  const runs: string[] = [];
  let current = "";
  let currentIsDevanagari: boolean | null = null;

  for (const char of token.normalize("NFC")) {
    const isDevanagari = DEVANAGARI.test(char);
    const isLatin = LATIN_LETTER.test(char);
    if (isDevanagari || isLatin) {
      if (currentIsDevanagari !== null && isDevanagari !== currentIsDevanagari) {
        runs.push(current);
        current = "";
      }
      currentIsDevanagari = isDevanagari;
    }
    current += char;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Tokenises text that may mix Devanagari and Latin in one string. Whitespace separates words and a
 * script change inside a word starts a new token, so "मुझेvideo देखो" is three pieces.
 */
export function tokenizeScriptAware(text: string): string[] {
  const tokens: string[] = [];
  for (const token of text.normalize("NFC").split(/\s+/u)) {
    if (token.length === 0) continue;
    tokens.push(...splitScriptRuns(token));
  }
  return tokens;
}

// ---------------------------------------------------------------- transliteration table

const CONSONANTS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0915", "k"], // क
  ["\u0916", "kh"], // ख
  ["\u0917", "g"], // ग
  ["\u0918", "gh"], // घ
  ["\u0919", "n"], // ङ
  ["\u091A", "ch"], // च
  ["\u091B", "chh"], // छ
  ["\u091C", "j"], // ज
  ["\u091D", "jh"], // झ
  ["\u091E", "n"], // ञ
  ["\u091F", "t"], // ट
  ["\u0920", "th"], // ठ
  ["\u0921", "d"], // ड
  ["\u0922", "dh"], // ढ
  ["\u0923", "n"], // ण
  ["\u0924", "t"], // त
  ["\u0925", "th"], // थ
  ["\u0926", "d"], // द
  ["\u0927", "dh"], // ध
  ["\u0928", "n"], // न
  ["\u092A", "p"], // प
  ["\u092B", "ph"], // फ
  ["\u092C", "b"], // ब
  ["\u092D", "bh"], // भ
  ["\u092E", "m"], // म
  ["\u092F", "y"], // य
  ["\u0930", "r"], // र
  ["\u0932", "l"], // ल
  ["\u0933", "l"], // ळ
  ["\u0935", "v"], // व
  ["\u0936", "sh"], // श
  ["\u0937", "sh"], // ष
  ["\u0938", "s"], // स
  ["\u0939", "h"], // ह
  // Precomposed nukta consonants. Hinglish writes ड़/ढ़ as d/dh ("bada", "padhna").
  ["\u0958", "q"], // क़
  ["\u0959", "kh"], // ख़
  ["\u095A", "g"], // ग़
  ["\u095B", "z"], // ज़
  ["\u095C", "d"], // ड़
  ["\u095D", "dh"], // ढ़
  ["\u095E", "f"], // फ़
  ["\u095F", "y"], // य़
]);

/** Base consonant -> Roman form when a separate nukta (U+093C) follows (decomposed input). */
const NUKTA_CONSONANTS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0915", "q"],
  ["\u0916", "kh"],
  ["\u0917", "g"],
  ["\u091C", "z"],
  ["\u0921", "d"],
  ["\u0922", "dh"],
  ["\u092B", "f"],
  ["\u092F", "y"],
]);

const VOWELS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0905", "a"], // अ
  ["\u0906", "a"], // आ (long/short merged)
  ["\u0907", "i"], // इ
  ["\u0908", "i"], // ई
  ["\u0909", "u"], // उ
  ["\u090A", "u"], // ऊ
  ["\u090B", "ri"], // ऋ
  ["\u090C", "li"], // ऌ
  ["\u090D", "e"], // ऍ
  ["\u090E", "e"], // ऎ
  ["\u090F", "e"], // ए
  ["\u0910", "ai"], // ऐ
  ["\u0911", "o"], // ऑ
  ["\u0912", "o"], // ऒ
  ["\u0913", "o"], // ओ
  ["\u0914", "au"], // औ
  ["\u0960", "ri"], // ॠ
  ["\u0961", "li"], // ॡ
]);

const MATRAS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u093E", "a"], // ा
  ["\u093F", "i"], // ि
  ["\u0940", "i"], // ी
  ["\u0941", "u"], // ु
  ["\u0942", "u"], // ू
  ["\u0943", "ri"], // ृ
  ["\u0944", "ri"], // ॄ
  ["\u0945", "e"], // ॅ
  ["\u0946", "e"], // ॆ
  ["\u0947", "e"], // े
  ["\u0948", "ai"], // ै
  ["\u0949", "o"], // ॉ
  ["\u094A", "o"], // ॊ
  ["\u094B", "o"], // ो
  ["\u094C", "au"], // ौ
  ["\u094E", "e"], // ॎ
  ["\u094F", "au"], // ॏ
  ["\u0955", "e"], // ॕ
  ["\u0956", "u"], // ॖ
  ["\u0957", "u"], // ॗ
]);

const DEVANAGARI_DIGITS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0966", "0"],
  ["\u0967", "1"],
  ["\u0968", "2"],
  ["\u0969", "3"],
  ["\u096A", "4"],
  ["\u096B", "5"],
  ["\u096C", "6"],
  ["\u096D", "7"],
  ["\u096E", "8"],
  ["\u096F", "9"],
]);

const VIRAMA = "\u094D";
const NUKTA = "\u093C";
const ANUSVARA = "\u0902";
const CANDRABINDU = "\u0901";
const VISARGA = "\u0903";
const AVAGRAHA = "\u093D";
const DANDA = "\u0964";
const DOUBLE_DANDA = "\u0965";
const LABIAL_CONSONANTS: ReadonlySet<string> = new Set(["p", "ph", "b", "bh", "m"]);

/**
 * Precomposed nukta letters (U+0958..U+095F) are composition exclusions: NFC leaves them alone
 * instead of composing base+nukta. The override keys and the nukta lookahead both expect the
 * decomposed form, so normalise them explicitly. Without this, ज़िंदगी written with U+095B would
 * miss the override and come out as "zindgi".
 */
const PRECOMPOSED_NUKTA: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0958", `\u0915${NUKTA}`],
  ["\u0959", `\u0916${NUKTA}`],
  ["\u095A", `\u0917${NUKTA}`],
  ["\u095B", `\u091C${NUKTA}`],
  ["\u095C", `\u0921${NUKTA}`],
  ["\u095D", `\u0922${NUKTA}`],
  ["\u095E", `\u092B${NUKTA}`],
  ["\u095F", `\u092F${NUKTA}`],
]);

function decomposeNukta(text: string): string {
  let output = "";
  for (const char of text.normalize("NFC")) output += PRECOMPOSED_NUKTA.get(char) ?? char;
  return output;
}

/**
 * Conventional Roman-Hinglish spellings that the phonetic rule gets "wrong" in the same way every
 * time. Kept closed and short on purpose: every entry is a high-frequency function word or an
 * English loanword that Hindi writes phonetically. The raw WER is unaffected by this list.
 */
const WORD_OVERRIDES: ReadonlyMap<string, string> = new Map<string, string>([
  // Function words
  ["\u092E\u0947\u0902", "mein"], // में
  ["\u092E\u0948\u0902", "main"], // मैं
  ["\u0924\u094B", "toh"], // तो
  ["\u0915\u094D\u092F\u094B\u0902", "kyun"], // क्यों
  ["\u0915\u094D\u092F\u0941", "kyu"], // क्यु
  ["\u0935\u093E\u0932\u0947", "wale"], // वाले
  ["\u0935\u093E\u0932\u093E", "wala"], // वाला
  ["\u0935\u093E\u0932\u0940", "wali"], // वाली
  ["\u0935\u093E\u0932\u094B\u0902", "walon"], // वालों
  ["\u092F\u0939", "yeh"], // यह
  ["\u092F\u0947", "ye"], // ये
  ["\u0935\u0939", "woh"], // वह
  ["\u0935\u094B", "wo"], // वो
  ["\u0939\u092E", "hum"], // हम
  ["\u0939\u092E\u0947\u0902", "humein"], // हमें
  ["\u0906\u092A", "aap"], // आप
  ["\u0939\u093E\u0901", "haan"], // हाँ
  ["\u0939\u093E\u0902", "haan"], // हां
  ["\u0928\u0939\u0940\u0902", "nahi"], // नहीं
  ["\u0939\u0942\u0901", "hoon"], // हूँ
  ["\u0939\u0942\u0902", "hoon"], // हूं
  ["\u091C\u093C\u093F\u0902\u0926\u0917\u0940", "zindagi"], // ज़िंदगी
  ["\u091C\u093C\u093F\u0928\u094D\u0926\u0917\u0940", "zindagi"], // ज़िन्दगी
  ["\u0939\u092E\u093E\u0930\u093E", "hamara"], // हमारा
  ["\u0939\u092E\u093E\u0930\u0940", "hamari"], // हमारी
  ["\u0939\u092E\u093E\u0930\u0947", "hamare"], // हमारे

  // English loanwords written phonetically in Devanagari (Hinglish references keep Latin script)
  ["\u092A\u0948\u0930\u0947\u0902\u091F\u094D\u0938", "parents"], // पैरेंट्स
  ["\u092A\u0947\u0930\u0947\u0902\u091F\u094D\u0938", "parents"], // पेरेंट्स
  ["\u0938\u094D\u0915\u0942\u0932", "school"], // स्कूल
  ["\u0938\u094D\u091F\u0942\u0921\u0947\u0902\u091F", "student"], // स्टूडेंट
  ["\u0938\u094D\u091F\u0942\u0921\u0947\u0902\u091F\u094D\u0938", "students"], // स्टूडेंट्स
  ["\u092E\u093E\u0930\u094D\u0915\u094D\u0938", "marks"], // मार्क्स
  ["\u0921\u093F\u092B\u0930\u0947\u0902\u091F", "different"], // डिफरेंट
  ["\u0921\u093F\u092E\u094D\u092B\u0930\u0947\u0902\u091F", "different"], // डिम्फरेंट
  ["\u0938\u093F\u0932\u0947\u092C\u0938", "syllabus"], // सिलेबस
  ["\u0915\u0949\u0928\u094D\u0938\u0947\u092A\u094D\u091F", "concept"], // कॉन्सेप्ट
  ["\u0915\u094D\u0932\u093E\u0938", "class"], // क्लास
  ["\u092C\u094B\u0930\u094D\u0921", "board"], // बोर्ड
  ["\u090F\u0917\u094D\u091C\u093E\u092E", "exam"], // एग्जाम
  ["\u0930\u093F\u091C\u0932\u094D\u091F", "result"], // रिजल्ट
  ["\u091F\u0940\u091A\u0930", "teacher"], // टीचर
  ["\u092A\u0947\u092A\u0930", "paper"], // पेपर
  ["\u092A\u094D\u0930\u0948\u0915\u094D\u091F\u093F\u0938", "practice"], // प्रैक्टिस
  ["\u0935\u0940\u0921\u093F\u092F\u094B", "video"], // वीडियो
  ["\u091A\u0948\u0928\u0932", "channel"], // चैनल
  ["\u0910\u092A", "app"], // ऐप
  ["\u092B\u093E\u0907\u0932", "file"], // फाइल
  ["\u0938\u094D\u0915\u094D\u0930\u0940\u0928", "screen"], // स्क्रीन
  ["\u0928\u0902\u092C\u0930", "number"], // नंबर
  ["\u0915\u0949\u0932", "call"], // कॉल
  ["\u0935\u093F\u091C\u093F\u091F", "visit"], // विजिट
  ["\u090F\u0921\u094D\u0930\u0947\u0938", "address"], // एड्रेस
  ["\u092E\u0948\u0938\u0947\u091C", "message"], // मैसेज
  ["\u0911\u0921\u093F\u092F\u094B", "audio"], // ऑडियो
  ["\u0915\u0948\u092E\u0930\u093E", "camera"], // कैमरा
  ["\u092B\u094B\u0928", "phone"], // फोन
  ["\u0932\u0948\u092A\u091F\u0949\u092A", "laptop"], // लैपटॉप
  ["\u0907\u0902\u091F\u0930\u0928\u0947\u091F", "internet"], // इंटरनेट
  ["\u0915\u0902\u092A\u094D\u092F\u0942\u091F\u0930", "computer"], // कंप्यूटर
  ["\u092E\u094D\u092F\u0942\u091C\u093F\u0915", "music"], // म्यूजिक
  ["\u0938\u0949\u0928\u094D\u0917", "song"], // सॉन्ग
  ["\u091F\u094D\u0930\u0947\u0928\u093F\u0902\u0917", "training"], // ट्रेनिंग
  ["\u092E\u092E\u094D\u092E\u093E", "mumma"], // मम्मा
  ["\u092E\u092E\u094D\u092E\u0940", "mummy"], // मम्मी
]);

interface ConsonantSegment {
  kind: "consonant";
  roman: string;
  vowel: string | null;
  inherent: boolean;
}

interface TextSegment {
  kind: "text";
  text: string;
}

interface VowelSegment {
  kind: "vowel";
  text: string;
}

type TranslitSegment = ConsonantSegment | TextSegment | VowelSegment;

function nextConsonantRoman(chars: readonly string[], from: number): string | null {
  for (let index = from; index < chars.length; index += 1) {
    const char = chars[index];
    if (char === NUKTA) continue;
    const base = CONSONANTS.get(char);
    if (base === undefined) return null;
    const nukta = chars[index + 1] === NUKTA ? NUKTA_CONSONANTS.get(char) : undefined;
    return nukta ?? base;
  }
  return null;
}

/**
 * Transliterates one contiguous Devanagari run.
 *
 * The two rules that matter beyond a lookup table:
 *  - anusvara becomes "m" before a labial (संभव -> sambhav) and "n" elsewhere,
 *  - inherent "a" is deleted word-finally, and before a consonant carrying an explicit matra
 *    (इतने -> itne, कमरा -> kamra), while it is kept before a consonant with its own inherent
 *    vowel (कमल -> kamal). This is the standard Hindi schwa-deletion heuristic, not a full
 *    linguistic model, so a few words still come out with an extra or missing "a".
 */
function transliterateRun(run: string): string {
  const chars = Array.from(run.normalize("NFC"));
  const segments: TranslitSegment[] = [];

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    // Zero-width joiners are formatting, not sounds.
    if (char === "\u200C" || char === "\u200D") continue;

    const consonant = CONSONANTS.get(char);
    if (consonant !== undefined) {
      let roman = consonant;
      let cursor = index + 1;
      if (chars[cursor] === NUKTA) {
        const nukta = NUKTA_CONSONANTS.get(char);
        if (nukta !== undefined) {
          roman = nukta;
          cursor += 1;
        }
      }
      const next = chars[cursor];
      if (next === VIRAMA) {
        segments.push({ kind: "consonant", roman, vowel: null, inherent: false });
        index = cursor;
        continue;
      }
      const matra = next === undefined ? undefined : MATRAS.get(next);
      if (matra !== undefined) {
        segments.push({ kind: "consonant", roman, vowel: matra, inherent: false });
        index = cursor;
        continue;
      }
      segments.push({ kind: "consonant", roman, vowel: "a", inherent: true });
      index = cursor - 1;
      continue;
    }

    const vowel = VOWELS.get(char);
    if (vowel !== undefined) {
      segments.push({ kind: "vowel", text: vowel });
      continue;
    }

    if (char === ANUSVARA || char === CANDRABINDU) {
      const next = nextConsonantRoman(chars, index + 1);
      segments.push({ kind: "text", text: next !== null && LABIAL_CONSONANTS.has(next) ? "m" : "n" });
      continue;
    }

    if (char === VISARGA) {
      segments.push({ kind: "text", text: "h" });
      continue;
    }

    const digit = DEVANAGARI_DIGITS.get(char);
    if (digit !== undefined) {
      segments.push({ kind: "text", text: digit });
      continue;
    }

    if (char === AVAGRAHA || char === DANDA || char === DOUBLE_DANDA) continue;
    if (DEVANAGARI.test(char)) continue; // Vedic accents and other rare signs are not part of the key
    segments.push({ kind: "text", text: char });
  }

  // Schwa deletion, applied after the whole run is known so look-ahead is simple.
  // A word-initial consonant keeps its inherent "a" (बड़ा -> bada); a later one is deleted before
  // a consonant with an explicit vowel (कमरा -> kamra, इतने -> itne) or at the end of the word.
  let seenVowel = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === "vowel") {
      seenVowel = true;
      continue;
    }
    if (segment.kind !== "consonant") continue;

    if (segment.inherent) {
      let nextIndex = index + 1;
      while (nextIndex < segments.length) {
        const candidate = segments[nextIndex];
        if (candidate.kind === "text" && candidate.text.length === 0) {
          nextIndex += 1;
          continue;
        }
        break;
      }

      if (nextIndex >= segments.length) {
        segment.vowel = null;
        segment.inherent = false;
      } else {
        const next = segments[nextIndex];
        if (next.kind === "consonant" && !next.inherent && next.vowel !== null && seenVowel) {
          segment.vowel = null;
          segment.inherent = false;
        } else if (next.kind === "text" && !LETTER_OR_NUMBER.test(next.text)) {
          // Punctuation right after the word: this consonant is word-final.
          segment.vowel = null;
          segment.inherent = false;
        }
      }
    }

    if (segment.vowel !== null) seenVowel = true;
  }

  let output = "";
  for (const segment of segments) {
    if (segment.kind === "consonant") output += segment.roman + (segment.vowel ?? "");
    else output += segment.text;
  }
  return output;
}

function transliterateRuns(text: string): string {
  let output = "";
  let run = "";
  const flush = (): void => {
    if (run.length === 0) return;
    output += transliterateRun(run);
    run = "";
  };
  for (const char of text.normalize("NFC")) {
    if (DEVANAGARI.test(char)) {
      run += char;
    } else {
      flush();
      output += char;
    }
  }
  flush();
  return output;
}

/**
 * Transliterates one whitespace-free word, preserving leading/trailing punctuation and any Latin
 * part (a mixed token becomes "mujhevideo"). Never changes the number of words.
 */
export function transliterateWord(text: string): string {
  const canonical = decomposeNukta(text.normalize("NFC"));
  if (!hasDevanagari(canonical)) return canonical;

  const leading = LEADING_PUNCT.exec(canonical)?.[0] ?? "";
  const rest = canonical.slice(leading.length);
  const trailing = TRAILING_PUNCT.exec(rest)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);
  const override = core.length === 0 ? undefined : WORD_OVERRIDES.get(core);
  if (override !== undefined) return `${leading}${override}${trailing}`;
  return transliterateRuns(canonical);
}

/** Transliterates a whole string, keeping whitespace and punctuation in place (documentation/tests). */
export function transliterateDevanagari(text: string): string {
  return text
    .split(/(\s+)/u)
    .map((part) => (part.length === 0 || /^\s+$/u.test(part) ? part : transliterateWord(part)))
    .join("");
}

// ---------------------------------------------------------------- transliteration policy

export interface TransliterationPolicy {
  applied: boolean;
  translateHypothesis: boolean;
  translateReference: boolean;
  hypothesisDevanagariShare: number;
  referenceDevanagariShare: number;
}

/**
 * Decides whether the two sides are in different scripts. When both are mostly Devanagari the raw
 * comparison is already apples-to-apples and transliteration would only add noise. When one side is
 * mostly Devanagari and the other mostly Latin, Devanagari tokens on BOTH sides are transliterated
 * (a Latin token is unchanged), which handles mixed-script Hinglish too.
 */
export function transliterationPolicy(reference: string, hypothesis: string): TransliterationPolicy {
  const referenceDevanagariShare = devanagariShare(reference);
  const hypothesisDevanagariShare = devanagariShare(hypothesis);
  const hasDevanagariText = referenceDevanagariShare > 0 || hypothesisDevanagariShare > 0;
  const bothMostlyDevanagari = referenceDevanagariShare >= 0.5 && hypothesisDevanagariShare >= 0.5;
  const applied = hasDevanagariText && !bothMostlyDevanagari;
  return {
    applied,
    translateHypothesis: applied && hypothesisDevanagariShare > 0,
    translateReference: applied && referenceDevanagariShare > 0,
    hypothesisDevanagariShare,
    referenceDevanagariShare,
  };
}

function tokensWithPolicy(text: string, translate: boolean): string[] {
  const tokens = tokenizeScriptAware(text);
  return translate ? tokens.map(transliterateWord) : tokens;
}

function wordTokensWithPolicy(words: readonly { text: string }[], translate: boolean): string[] {
  const tokens = words.flatMap((word) => tokenizeScriptAware(word.text));
  return translate ? tokens.map(transliterateWord) : tokens;
}

// ---------------------------------------------------------------- manifest

export interface Score2WordTime {
  text: string;
  startMs: number;
  endMs?: number;
}

export interface Score2Span {
  startMs: number;
  endMs: number;
}

export interface Score2Clip {
  id: string;
  path: string;
  tags: string[];
  references: string[];
  wordTimes?: Score2WordTime[];
  expectNoWords: boolean;
  /** Clip length, needed for a silence words-per-minute rate. Optional: null means "not measured". */
  durationMs: number | null;
  /** Music-only / voice-free stretches inside an otherwise scored clip. */
  noVoiceSpans: Score2Span[];
}

export interface Score2Manifest {
  version?: number;
  notes?: string;
  clips: Score2Clip[];
}

function invalid(message: string): never {
  throw new CaptionError("unsupported-file", `invalid score2 input: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${where} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${where} must be an array`);
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${where} must be a non-empty string`);
  return value;
}

function asFinite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${where} must be a finite number`);
  return value;
}

function asMilliseconds(value: unknown, where: string): number {
  const parsed = asFinite(value, where);
  if (!Number.isInteger(parsed)) invalid(`${where} must be whole milliseconds`);
  if (parsed < 0) invalid(`${where} must not be negative`);
  return parsed;
}

function asDuration(value: unknown, where: string): number {
  const parsed = asMilliseconds(value, where);
  if (parsed === 0) invalid(`${where} must be greater than 0 (a zero-minute rate is undefined)`);
  return parsed;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) invalid(`${where}.${key} is not a known field (${allowed.join(", ")})`);
  }
}

function hasScoreableWords(text: string): boolean {
  return tokenizeForWer(text).some((token) => normalizeForWer(token).length > 0);
}

function parseSpan(value: unknown, where: string): Score2Span {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, ["startMs", "endMs"], where);
  const startMs = asMilliseconds(record.startMs, `${where}.startMs`);
  const endMs = asMilliseconds(record.endMs, `${where}.endMs`);
  if (endMs <= startMs) invalid(`${where}.endMs must be after startMs`);
  return { startMs, endMs };
}

function parseWordTime(value: unknown, where: string): Score2WordTime {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, ["text", "startMs", "endMs"], where);
  const text = asString(record.text, `${where}.text`);
  const startMs = asMilliseconds(record.startMs, `${where}.startMs`);
  if (record.endMs === undefined) return { text, startMs };
  const endMs = asMilliseconds(record.endMs, `${where}.endMs`);
  if (endMs < startMs) invalid(`${where}.endMs must not be before startMs`);
  return { text, startMs, endMs };
}

const MANIFEST_KEYS = ["version", "notes", "clips"] as const;
const CLIP_KEYS = [
  "id",
  "path",
  "tags",
  "references",
  "wordTimes",
  "expectNoWords",
  "durationMs",
  "noVoiceSpans",
] as const;

function parseReferences(value: unknown, where: string, expectNoWords: boolean): string[] {
  if (value === undefined) {
    if (expectNoWords) return [];
    invalid(`${where} is required (at least one acceptable transcript)`);
  }
  const references = asArray(value, where).map((entry, index) => asString(entry, `${where}[${index}]`));

  if (expectNoWords) {
    if (references.length > 0) invalid(`${where} must be empty when expectNoWords is true`);
    return [];
  }
  if (references.length === 0) invalid(`${where} must contain at least one transcript`);
  references.forEach((reference, index) => {
    if (!hasScoreableWords(reference)) invalid(`${where}[${index}] has no words to score`);
  });
  return references;
}

/**
 * True when `texts` spell `reference` after script-aware normalisation. Word times are ground
 * truth for ONE sentence; accepting a fixture for another sentence would silently score the wrong
 * timings, so this is checked with the same transliteration policy the metrics use.
 */
function textsSpellReference(reference: string, texts: readonly string[]): boolean {
  const policy = transliterationPolicy(reference, texts.join(" "));
  const refTokens = tokensWithPolicy(reference, policy.translateReference);
  const hypTokens = texts.flatMap((text) => tokensWithPolicy(text, policy.translateHypothesis));
  const result = wordErrorRate(refTokens, hypTokens);
  return result.errors === 0 && result.refWords === result.hypWords;
}

function parseClip(value: unknown, where: string, seenIds: Set<string>): Score2Clip {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, CLIP_KEYS, where);

  const id = asString(record.id, `${where}.id`);
  if (seenIds.has(id)) invalid(`${where}.id "${id}" is used twice`);
  seenIds.add(id);

  const path = asString(record.path, `${where}.path`);
  const tags = [
    ...new Set(asArray(record.tags, `${where}.tags`).map((entry, index) => asString(entry, `${where}.tags[${index}]`))),
  ];

  let expectNoWords = false;
  if (record.expectNoWords !== undefined) {
    if (typeof record.expectNoWords !== "boolean") invalid(`${where}.expectNoWords must be true or false`);
    expectNoWords = record.expectNoWords;
  }
  if (expectNoWords && !tags.some((tag) => tag === "silence" || tag === "music")) {
    invalid(`${where}.expectNoWords needs a "silence" or "music" tag, so a mislabelled speech clip is caught`);
  }

  const references = parseReferences(record.references, `${where}.references`, expectNoWords);
  const clip: Score2Clip = {
    id,
    path,
    tags,
    references,
    expectNoWords,
    durationMs: record.durationMs === undefined ? null : asDuration(record.durationMs, `${where}.durationMs`),
    noVoiceSpans: [],
  };

  if (record.noVoiceSpans !== undefined) {
    clip.noVoiceSpans = asArray(record.noVoiceSpans, `${where}.noVoiceSpans`).map((entry, index) =>
      parseSpan(entry, `${where}.noVoiceSpans[${index}]`),
    );
  }

  if (record.wordTimes !== undefined) {
    if (expectNoWords) invalid(`${where}.wordTimes makes no sense when expectNoWords is true`);
    const entries = asArray(record.wordTimes, `${where}.wordTimes`);
    if (entries.length === 0) invalid(`${where}.wordTimes is empty (remove it to skip timing)`);
    const wordTimes = entries.map((entry, index) => parseWordTime(entry, `${where}.wordTimes[${index}]`));
    if (!textsSpellReference(references[0], wordTimes.map((word) => word.text))) {
      invalid(`${where}.wordTimes do not spell references[0] after normalisation`);
    }
    clip.wordTimes = wordTimes;
  }

  return clip;
}

export function parseScore2Manifest(input: unknown, source = "score2 manifest"): Score2Manifest {
  const record = asRecord(input, source);
  rejectUnknownKeys(record, MANIFEST_KEYS, source);

  if (record.notes !== undefined && typeof record.notes !== "string") {
    invalid(`${source}.notes must be a string`);
  }
  const clips = asArray(record.clips, `${source}.clips`);
  if (clips.length === 0) invalid(`${source}.clips is empty; nothing would be measured`);

  const seenIds = new Set<string>();
  const parsed = clips.map((entry, index) => parseClip(entry, `${source}.clips[${index}]`, seenIds));

  const manifest: Score2Manifest = { clips: parsed };
  if (record.version !== undefined) manifest.version = asFinite(record.version, `${source}.version`);
  if (record.notes !== undefined) manifest.notes = record.notes as string;
  return manifest;
}

// ---------------------------------------------------------------- overrides

export interface Score2Overrides {
  /** Clip id -> clip length in ms, for clips whose manifest omits `durationMs`. */
  durations?: Readonly<Record<string, number>>;
  /** Clip id -> extra voice-free spans (replaces the manifest value when present). */
  noVoiceSpans?: Readonly<Record<string, readonly Score2Span[]>>;
}

/**
 * Applies CLI-side facts that do not belong in the shared gold manifest. Returns a new manifest and
 * rejects an unknown clip id, so a typo cannot quietly leave a metric unmeasured.
 */
export function applyScore2Overrides(manifest: Score2Manifest, overrides: Score2Overrides): Score2Manifest {
  const ids = new Set(manifest.clips.map((clip) => clip.id));
  for (const id of Object.keys(overrides.durations ?? {})) {
    if (!ids.has(id)) invalid(`--duration refers to unknown clip "${id}"`);
  }
  for (const id of Object.keys(overrides.noVoiceSpans ?? {})) {
    if (!ids.has(id)) invalid(`--no-voice-span refers to unknown clip "${id}"`);
  }

  return {
    ...manifest,
    clips: manifest.clips.map((clip) => {
      let next = clip;
      const duration = overrides.durations?.[clip.id];
      if (duration !== undefined) {
        next = { ...next, durationMs: asDuration(duration, `--duration ${clip.id}`) };
      }
      const spans = overrides.noVoiceSpans?.[clip.id];
      if (spans !== undefined) {
        next = {
          ...next,
          noVoiceSpans: spans.map((span, index) => parseSpan(span, `--no-voice-span ${clip.id}[${index}]`)),
        };
      }
      return next;
    }),
  };
}

// ---------------------------------------------------------------- metrics

export interface Score2Wer {
  /** Oracle WER: the minimum over every accepted reference. */
  oiwer: number;
  plainWer: number;
  bestReference: number;
  referenceWers: number[];
  refWords: number;
  hypWords: number;
  correct: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  errors: number;
  transliteration?: TransliterationPolicy;
}

export interface Score2TimingF1 {
  toleranceMs: number;
  correct: number;
  hypWords: number;
  refWords: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface Score2Timing {
  /** Reference words the text aligner matched to a hypothesis word. */
  matched: number;
  /** Words the text aligner did not match: substitutions + deletions + insertions. */
  unmatched: number;
  /** Matched words skipped because a boundary was missing (F1 needs both boundaries). */
  unusable: number;
  alignmentSubstitutions: number;
  alignmentDeletions: number;
  alignmentInsertions: number;
  refWords: number;
  hypWords: number;
  boundary: ErrorStats;
  onset: ErrorStats;
  offset: ErrorStats;
  onsetBiasMs: number | null;
  offsetBiasMs: number | null;
  /** F1 needs both boundaries on every matched word; false means the numbers below are null. */
  f1Computed: boolean;
  f1: Score2TimingF1[];
  transliteration: TransliterationPolicy;
}

export interface Score2HallucinationSpan {
  startMs: number;
  endMs: number;
  durationMs: number;
  words: number;
  wordsPerMinute: number | null;
}

export interface Score2Hallucination {
  expectNoWords: boolean;
  /** Scoreable words emitted for the whole clip. */
  wordsProduced: number;
  durationMs: number | null;
  /** Words per minute over the whole clip; only for `expectNoWords` clips with a duration. */
  wordsPerMinute: number | null;
  /** Per declared voice-free span, in manifest order. Overlaps can make these sum above `spanWords`. */
  spans: Score2HallucinationSpan[];
  /** Words whose midpoint falls in ANY declared span (counted once). */
  spanWords: number;
  /** Union of the declared spans, so overlapping spans are not double-counted. */
  spanDurationMs: number;
  spanWordsPerMinute: number | null;
}

export interface Score2ClipResult {
  id: string;
  path: string;
  tags: string[];
  expectNoWords: boolean;
  durationMs: number | null;
  scored: boolean;
  wer: { raw: Score2Wer; scriptAware: Score2Wer } | null;
  hallucination: Score2Hallucination | null;
  timing: Score2Timing | null;
  seconds: number | null;
  notes: string[];
}

export interface Score2Summary {
  clips: number;
  scored: number;
  missing: number;
  expectNoWords: number;
  speechClips: number;
  werClips: number;
  meanOiwerRaw: number | null;
  medianOiwerRaw: number | null;
  microOiwerRaw: number | null;
  meanOiwerScriptAware: number | null;
  medianOiwerScriptAware: number | null;
  maxOiwerScriptAware: number | null;
  microOiwerScriptAware: number | null;
  refWords: number;
  hypWords: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  hallucinatedClips: number;
  hallucinatedWords: number;
  silenceDurationMs: number;
  silenceWordsPerMinute: number | null;
  musicSpanWords: number;
  musicSpanDurationMs: number;
  musicSpanWordsPerMinute: number | null;
  timingClips: number;
  meanBoundaryMaeMs: number | null;
  meanOnsetMaeMs: number | null;
  meanF1At50: number | null;
  meanF1At100: number | null;
  microF1At50: number | null;
  microF1At100: number | null;
  totalSeconds: number | null;
  meanSeconds: number | null;
}

export interface Score2Report {
  schemaVersion: typeof SCORE2_SCHEMA_VERSION;
  model: string;
  backend: string;
  device: string;
  manifestNotes: string | null;
  transliterationRuleSet: string;
  summary: Score2Summary;
  clips: Score2ClipResult[];
  missingClips: string[];
  unknownClips: string[];
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function percentileOf(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function maxOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let maximum = values[0];
  for (const value of values) if (value > maximum) maximum = value;
  return maximum;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Deterministic trick: a distinguishability margin so F1 cannot be inflated by rounding. */
function harmonicMean(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function scoreWer(reference: string, words: readonly Word[], policy: TransliterationPolicy): Score2Wer {
  const refTokens = tokensWithPolicy(reference, policy.translateReference);
  const hypTokens = wordTokensWithPolicy(words, policy.translateHypothesis);
  const result = wordErrorRate(refTokens, hypTokens);
  return {
    oiwer: result.wer,
    plainWer: result.wer,
    bestReference: 0,
    referenceWers: [result.wer],
    refWords: result.refWords,
    hypWords: result.hypWords,
    correct: result.correct,
    substitutions: result.substitutions,
    deletions: result.deletions,
    insertions: result.insertions,
    errors: result.errors,
    transliteration: policy,
  };
}

function scoreClipWers(clip: Score2Clip, words: readonly Word[]): { raw: Score2Wer; scriptAware: Score2Wer } {
  const hypText = words.map((word) => word.text).join(" ");

  const rawResults = clip.references.map((reference) => {
    const result = wordErrorRate(reference, words.map((word) => word.text));
    return result;
  });
  let rawBest = 0;
  for (let index = 1; index < rawResults.length; index += 1) {
    if (rawResults[index].wer < rawResults[rawBest].wer) rawBest = index;
  }
  const rawChosen = rawResults[rawBest];
  const raw: Score2Wer = {
    oiwer: rawChosen.wer,
    plainWer: rawResults[0].wer,
    bestReference: rawBest,
    referenceWers: rawResults.map((result) => result.wer),
    refWords: rawChosen.refWords,
    hypWords: rawChosen.hypWords,
    correct: rawChosen.correct,
    substitutions: rawChosen.substitutions,
    deletions: rawChosen.deletions,
    insertions: rawChosen.insertions,
    errors: rawChosen.errors,
  };

  const awareResults = clip.references.map((reference) => {
    const policy = transliterationPolicy(reference, hypText);
    return scoreWer(reference, words, policy);
  });
  let awareBest = 0;
  for (let index = 1; index < awareResults.length; index += 1) {
    if (awareResults[index].oiwer < awareResults[awareBest].oiwer) awareBest = index;
  }
  const aware = awareResults[awareBest];
  aware.bestReference = awareBest;
  aware.plainWer = awareResults[0].oiwer;
  aware.referenceWers = awareResults.map((result) => result.oiwer);
  return { raw, scriptAware: aware };
}

function unionDurationMs(spans: readonly Score2Span[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let total = 0;
  let start = sorted[0].startMs;
  let end = sorted[0].endMs;
  for (let index = 1; index < sorted.length; index += 1) {
    const span = sorted[index];
    if (span.startMs <= end) {
      if (span.endMs > end) end = span.endMs;
    } else {
      total += end - start;
      start = span.startMs;
      end = span.endMs;
    }
  }
  total += end - start;
  return total;
}

function midpointMs(word: { startMs: number; endMs: number }): number {
  return word.startMs + (word.endMs - word.startMs) / 2;
}

function scoreHallucination(clip: Score2Clip, words: readonly Word[]): Score2Hallucination {
  const scoreable = words.filter((word) => normalizeForWer(word.text).length > 0);
  const wordsPerMinute =
    clip.expectNoWords && clip.durationMs !== null && clip.durationMs > 0
      ? scoreable.length / (clip.durationMs / 60_000)
      : null;

  const spans = clip.noVoiceSpans.map((span) => {
    const durationMs = span.endMs - span.startMs;
    const inside = scoreable.filter((word) => {
      const midpoint = midpointMs(word);
      return midpoint >= span.startMs && midpoint < span.endMs;
    });
    return {
      startMs: span.startMs,
      endMs: span.endMs,
      durationMs,
      words: inside.length,
      wordsPerMinute: durationMs > 0 ? inside.length / (durationMs / 60_000) : null,
    };
  });

  const inAnySpan = scoreable.filter((word) => {
    const midpoint = midpointMs(word);
    return clip.noVoiceSpans.some((span) => midpoint >= span.startMs && midpoint < span.endMs);
  });
  const spanDurationMs = unionDurationMs(clip.noVoiceSpans);

  return {
    expectNoWords: clip.expectNoWords,
    wordsProduced: scoreable.length,
    durationMs: clip.durationMs,
    wordsPerMinute,
    spans,
    spanWords: inAnySpan.length,
    spanDurationMs,
    spanWordsPerMinute: spanDurationMs > 0 ? inAnySpan.length / (spanDurationMs / 60_000) : null,
  };
}

function isFiniteTime(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function scoreTiming(clip: Score2Clip, words: readonly Word[]): Score2Timing | null {
  const wordTimes = clip.wordTimes;
  if (wordTimes === undefined) return null;

  const referenceText = wordTimes.map((word) => word.text).join(" ");
  const hypothesisText = words.map((word) => word.text).join(" ");
  const policy = transliterationPolicy(referenceText, hypothesisText);
  const referenceTexts = wordTimes.map((word) =>
    policy.translateReference ? transliterateWord(word.text) : word.text,
  );
  const hypothesisTexts = words.map((word) =>
    policy.translateHypothesis ? transliterateWord(word.text) : word.text,
  );

  const alignment = wordErrorRate(referenceTexts, hypothesisTexts);
  const onsetErrors: number[] = [];
  const offsetErrors: number[] = [];
  const boundaryErrors: number[] = [];
  const onsetSigned: number[] = [];
  const offsetSigned: number[] = [];
  let matched = 0;
  let boundaryPairs = 0;
  let unusable = 0;
  const correctAt = new Map<number, number>([
    [50, 0],
    [100, 0],
  ]);

  for (const op of alignment.ops) {
    if (op.type !== "match" || op.refIndex === null || op.hypIndex === null) continue;
    matched += 1;
    const reference = wordTimes[op.refIndex];
    const hypothesis = words[op.hypIndex];
    if (!isFiniteTime(reference.startMs) || !isFiniteTime(hypothesis.startMs)) {
      unusable += 1;
      continue;
    }
    const onset = hypothesis.startMs - reference.startMs;
    onsetErrors.push(Math.abs(onset));
    onsetSigned.push(onset);

    if (!isFiniteTime(reference.endMs) || !isFiniteTime(hypothesis.endMs)) {
      unusable += 1;
      continue;
    }
    const offset = hypothesis.endMs - reference.endMs;
    offsetErrors.push(Math.abs(offset));
    offsetSigned.push(offset);
    boundaryErrors.push((Math.abs(onset) + Math.abs(offset)) / 2);
    boundaryPairs += 1;

    for (const tolerance of [50, 100]) {
      if (Math.abs(onset) <= tolerance && Math.abs(offset) <= tolerance) {
        correctAt.set(tolerance, (correctAt.get(tolerance) ?? 0) + 1);
      }
    }
  }

  const f1Computed = unusable === 0;
  const f1 = [50, 100].map((toleranceMs) => {
    const correct = correctAt.get(toleranceMs) ?? 0;
    const precision = f1Computed ? ratio(correct, alignment.hypWords) : null;
    const recall = f1Computed ? ratio(correct, alignment.refWords) : null;
    return {
      toleranceMs,
      correct,
      hypWords: alignment.hypWords,
      refWords: alignment.refWords,
      precision,
      recall,
      f1: f1Computed ? harmonicMean(precision, recall) : null,
    };
  });

  return {
    matched,
    unmatched: alignment.errors,
    unusable,
    alignmentSubstitutions: alignment.substitutions,
    alignmentDeletions: alignment.deletions,
    alignmentInsertions: alignment.insertions,
    refWords: alignment.refWords,
    hypWords: alignment.hypWords,
    boundary: summariseErrors(boundaryErrors),
    onset: summariseErrors(onsetErrors),
    offset: summariseErrors(offsetErrors),
    onsetBiasMs: meanOf(onsetSigned),
    offsetBiasMs: meanOf(offsetSigned),
    f1Computed,
    f1,
    transliteration: policy,
  };
}

function missingResult(clip: Score2Clip): Score2ClipResult {
  return {
    id: clip.id,
    path: clip.path,
    tags: clip.tags,
    expectNoWords: clip.expectNoWords,
    durationMs: clip.durationMs,
    scored: false,
    wer: null,
    hallucination: null,
    timing: null,
    seconds: null,
    notes: ["no hypothesis for this clip"],
  };
}

function scoreClip(clip: Score2Clip, hypothesis: GoldHypothesis["clips"][string] | undefined): Score2ClipResult {
  if (hypothesis === undefined) return missingResult(clip);

  const notes: string[] = [];
  if (clip.expectNoWords) {
    const hallucination = scoreHallucination(clip, hypothesis.words);
    notes.push("WER skipped: clip is marked expectNoWords");
    if (hallucination.durationMs === null) {
      notes.push("silence words/minute not measured: the manifest has no durationMs for this clip");
    }
    return {
      id: clip.id,
      path: clip.path,
      tags: clip.tags,
      expectNoWords: true,
      durationMs: clip.durationMs,
      scored: true,
      wer: null,
      hallucination,
      timing: null,
      seconds: hypothesis.seconds,
      notes,
    };
  }

  if (clip.references.length === 0) invalid(`clip "${clip.id}" has no reference transcripts`);
  const wer = scoreClipWers(clip, hypothesis.words);
  if (hypothesis.words.length === 0) notes.push("empty hypothesis: every reference word counts as a deletion");

  const timing = scoreTiming(clip, hypothesis.words);
  if (timing === null) {
    notes.push("timing skipped: no wordTimes in the manifest");
  } else {
    if (timing.matched === 0) notes.push("timing skipped: no hypothesis word matched the wordTimes");
    if (!timing.f1Computed) {
      notes.push(
        `F1@50/100 not computed: ${timing.unusable} matched word(s) lack a reference endMs`,
      );
    }
  }
  if (wer.scriptAware.transliteration?.applied === true) {
    notes.push("script-aware WER applies the documented Devanagari transliteration key");
  }

  return {
    id: clip.id,
    path: clip.path,
    tags: clip.tags,
    expectNoWords: false,
    durationMs: clip.durationMs,
    scored: true,
    wer,
    hallucination: scoreHallucination(clip, hypothesis.words),
    timing,
    seconds: hypothesis.seconds,
    notes,
  };
}

/** Scores every clip. Pure: same inputs always produce the same report. */
export function evaluateScore2(manifest: Score2Manifest, hypothesis: GoldHypothesis): Score2Report {
  const clips = manifest.clips.map((clip) => scoreClip(clip, hypothesis.clips[clip.id]));
  const manifestIds = new Set(manifest.clips.map((clip) => clip.id));
  const unknownClips = Object.keys(hypothesis.clips)
    .filter((id) => !manifestIds.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const missingClips = clips.filter((clip) => !clip.scored).map((clip) => clip.id);

  const rawValues = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.raw.oiwer]));
  const awareValues = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.scriptAware.oiwer]));
  const rawErrors = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.raw.errors]));
  const rawRefWords = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.raw.refWords]));
  const awareErrors = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.scriptAware.errors]));
  const awareRefWords = clips.flatMap((clip) => (clip.wer === null ? [] : [clip.wer.scriptAware.refWords]));

  const hallucinationResults = clips.flatMap((clip) => (clip.hallucination === null ? [] : [clip.hallucination]));
  const silenceHallucination = hallucinationResults.filter(
    (entry) => entry.expectNoWords && entry.durationMs !== null,
  );
  const silenceWords = silenceHallucination.reduce((total, entry) => total + entry.wordsProduced, 0);
  const silenceDurationMs = silenceHallucination.reduce((total, entry) => total + (entry.durationMs ?? 0), 0);

  const spanWords = hallucinationResults.reduce((total, entry) => total + entry.spanWords, 0);
  const spanDurationMs = hallucinationResults.reduce((total, entry) => total + entry.spanDurationMs, 0);

  const timings = clips.flatMap((clip) => (clip.timing === null ? [] : [clip.timing]));
  const boundaryMaes = timings.flatMap((timing) =>
    timing.boundary.maeMs === null ? [] : [timing.boundary.maeMs],
  );
  const onsetMaes = timings.flatMap((timing) =>
    timing.onset.maeMs === null ? [] : [timing.onset.maeMs],
  );
  const f1At50 = timings.flatMap((timing) => {
    const entry = timing.f1.find((value) => value.toleranceMs === 50);
    return entry === undefined || entry.f1 === null ? [] : [entry.f1];
  });
  const f1At100 = timings.flatMap((timing) => {
    const entry = timing.f1.find((value) => value.toleranceMs === 100);
    return entry === undefined || entry.f1 === null ? [] : [entry.f1];
  });

  const micro = (tolerance: number): number | null => {
    let correct = 0;
    let hypWords = 0;
    let refWords = 0;
    for (const timing of timings) {
      const entry = timing.f1.find((value) => value.toleranceMs === tolerance);
      if (entry === undefined || !timing.f1Computed) continue;
      correct += entry.correct;
      hypWords += entry.hypWords;
      refWords += entry.refWords;
    }
    const precision = ratio(correct, hypWords);
    const recall = ratio(correct, refWords);
    return harmonicMean(precision, recall);
  };

  const secondsValues = clips.flatMap((clip) => (clip.seconds === null ? [] : [clip.seconds]));
  const totalSeconds = secondsValues.length === 0 ? null : secondsValues.reduce((total, value) => total + value, 0);

  const summary: Score2Summary = {
    clips: clips.length,
    scored: clips.filter((clip) => clip.scored).length,
    missing: missingClips.length,
    expectNoWords: manifest.clips.filter((clip) => clip.expectNoWords).length,
    speechClips: manifest.clips.filter((clip) => !clip.expectNoWords).length,
    werClips: rawValues.length,
    meanOiwerRaw: meanOf(rawValues),
    medianOiwerRaw: percentileOf(rawValues, 0.5),
    microOiwerRaw: rawRefWords.length === 0 ? null : rawErrors.reduce((a, b) => a + b, 0) / rawRefWords.reduce((a, b) => a + b, 0),
    meanOiwerScriptAware: meanOf(awareValues),
    medianOiwerScriptAware: percentileOf(awareValues, 0.5),
    maxOiwerScriptAware: maxOf(awareValues),
    microOiwerScriptAware:
      awareRefWords.length === 0
        ? null
        : awareErrors.reduce((a, b) => a + b, 0) / awareRefWords.reduce((a, b) => a + b, 0),
    refWords: clips.reduce((total, clip) => total + (clip.wer?.scriptAware.refWords ?? 0), 0),
    hypWords: clips.reduce((total, clip) => total + (clip.wer?.scriptAware.hypWords ?? 0), 0),
    substitutions: clips.reduce((total, clip) => total + (clip.wer?.scriptAware.substitutions ?? 0), 0),
    deletions: clips.reduce((total, clip) => total + (clip.wer?.scriptAware.deletions ?? 0), 0),
    insertions: clips.reduce((total, clip) => total + (clip.wer?.scriptAware.insertions ?? 0), 0),
    hallucinatedClips: hallucinationResults.filter((entry) => entry.expectNoWords && entry.wordsProduced > 0).length,
    hallucinatedWords: hallucinationResults
      .filter((entry) => entry.expectNoWords)
      .reduce((total, entry) => total + entry.wordsProduced, 0),
    silenceDurationMs,
    silenceWordsPerMinute: silenceDurationMs > 0 ? silenceWords / (silenceDurationMs / 60_000) : null,
    musicSpanWords: spanWords,
    musicSpanDurationMs: spanDurationMs,
    musicSpanWordsPerMinute: spanDurationMs > 0 ? spanWords / (spanDurationMs / 60_000) : null,
    timingClips: timings.length,
    meanBoundaryMaeMs: meanOf(boundaryMaes),
    meanOnsetMaeMs: meanOf(onsetMaes),
    meanF1At50: meanOf(f1At50),
    meanF1At100: meanOf(f1At100),
    microF1At50: micro(50),
    microF1At100: micro(100),
    totalSeconds,
    meanSeconds: meanOf(secondsValues),
  };

  return {
    schemaVersion: SCORE2_SCHEMA_VERSION,
    model: hypothesis.model,
    backend: hypothesis.backend,
    device: hypothesis.device,
    manifestNotes: manifest.notes ?? null,
    transliterationRuleSet: TRANSLITERATION_RULESET,
    summary,
    clips,
    missingClips,
    unknownClips,
  };
}

// ---------------------------------------------------------------- presentation

function markdownNumber(value: number | null, digits: number): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function markdownText(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function timingCell(timing: Score2Timing, tolerance: number): string {
  if (!timing.f1Computed) return "-";
  const entry = timing.f1.find((value) => value.toleranceMs === tolerance);
  if (entry === undefined || entry.f1 === null) return "-";
  return `${entry.f1.toFixed(3)} (${markdownNumber(entry.precision, 3)}/${markdownNumber(entry.recall, 3)})`;
}

/** One markdown table row. A helper keeps the cells free of the trailing-space bug a manual join invites. */
function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** Human-readable, deterministic report. The JSON report is the machine-readable contract. */
export function renderScore2Markdown(report: Score2Report): string {
  const { summary } = report;
  const lines: string[] = [];

  lines.push("# Caption score2 report (script-aware)", "");
  lines.push(`- Model: \`${markdownText(report.model)}\``);
  lines.push(`- Backend: \`${markdownText(report.backend)}\``);
  lines.push(`- Device: \`${markdownText(report.device)}\``);
  lines.push(`- Schema: ${report.schemaVersion}`);
  lines.push(`- Transliteration key: ${markdownText(report.transliterationRuleSet)}`);
  lines.push(`- Clips: ${summary.clips} total, ${summary.scored} scored, ${summary.missing} missing`);
  lines.push(
    `- WER: raw and transliteration-aware (the raw number is never hidden); timing F1 uses a Levenshtein word alignment`,
  );
  lines.push("");

  if (report.manifestNotes !== null) {
    lines.push(`> ${markdownText(report.manifestNotes)}`, "");
  }

  lines.push("## Summary", "");
  lines.push("| metric | raw | transliteration-aware |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| mean OIWER (best reference) | ${markdownNumber(summary.meanOiwerRaw, 3)} | ${markdownNumber(summary.meanOiwerScriptAware, 3)} |`,
  );
  lines.push(
    `| median OIWER | ${markdownNumber(summary.medianOiwerRaw, 3)} | ${markdownNumber(summary.medianOiwerScriptAware, 3)} |`,
  );
  lines.push(`| max OIWER | - | ${markdownNumber(summary.maxOiwerScriptAware, 3)} |`);
  lines.push(
    `| micro OIWER (total errors / total reference words) | ${markdownNumber(summary.microOiwerRaw, 3)} | ${markdownNumber(summary.microOiwerScriptAware, 3)} |`,
  );
  lines.push("");
  lines.push("| count | value |");
  lines.push("| --- | --- |");
  lines.push(`| clips with WER | ${summary.werClips} |`);
  lines.push(`| reference words | ${summary.refWords} |`);
  lines.push(`| hypothesis words | ${summary.hypWords} |`);
  lines.push(`| substitutions / deletions / insertions | ${summary.substitutions} / ${summary.deletions} / ${summary.insertions} |`);
  lines.push(`| hallucinated clips (expectNoWords) | ${summary.hallucinatedClips} |`);
  lines.push(`| hallucinated words (expectNoWords) | ${summary.hallucinatedWords} |`);
  lines.push(
    `| silence words per minute | ${markdownNumber(summary.silenceWordsPerMinute, 2)} (${summary.silenceDurationMs} ms) |`,
  );
  lines.push(
    `| music-span words per minute | ${markdownNumber(summary.musicSpanWordsPerMinute, 2)} (${summary.musicSpanWords} words in ${summary.musicSpanDurationMs} ms) |`,
  );
  lines.push(`| clips with timing | ${summary.timingClips} |`);
  lines.push(`| mean boundary MAE (ms) | ${markdownNumber(summary.meanBoundaryMaeMs, 1)} |`);
  lines.push(`| mean onset MAE (ms) | ${markdownNumber(summary.meanOnsetMaeMs, 1)} |`);
  lines.push(
    `| F1@50 ms (macro / micro) | ${markdownNumber(summary.meanF1At50, 3)} / ${markdownNumber(summary.microF1At50, 3)} |`,
  );
  lines.push(
    `| F1@100 ms (macro / micro) | ${markdownNumber(summary.meanF1At100, 3)} / ${markdownNumber(summary.microF1At100, 3)} |`,
  );
  lines.push(`| total wall time (s) | ${markdownNumber(summary.totalSeconds, 1)} |`);
  lines.push("");

  lines.push("## Clips", "");
  lines.push(
    "| clip | tags | refs | OIWER raw | OIWER aware | translit | ref/hyp words | S/D/I | silence WPM | span WPM | boundary MAE | F1@50 | F1@100 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const clip of report.clips) {
    const aware = clip.wer?.scriptAware;
    const raw = clip.wer?.raw;
    const timing = clip.timing;
    const hallucination = clip.hallucination;
    lines.push(
      row([
        markdownText(clip.id),
        markdownText(clip.tags.join(", ")),
        aware === null || aware === undefined ? "0" : String(aware.referenceWers.length),
        raw === null || raw === undefined ? "-" : markdownNumber(raw.oiwer, 3),
        aware === null || aware === undefined ? "-" : markdownNumber(aware.oiwer, 3),
        aware?.transliteration?.applied === true ? "yes" : "-",
        aware === null || aware === undefined ? "-" : `${aware.refWords}/${aware.hypWords}`,
        aware === null || aware === undefined
          ? "-"
          : `${aware.substitutions}/${aware.deletions}/${aware.insertions}`,
        markdownNumber(hallucination?.wordsPerMinute ?? null, 2),
        markdownNumber(hallucination?.spanWordsPerMinute ?? null, 2),
        timing === null ? "-" : markdownNumber(timing.boundary.maeMs, 1),
        timing === null ? "-" : timingCell(timing, 50),
        timing === null ? "-" : timingCell(timing, 100),
      ]),
    );
  }
  lines.push("");

  lines.push("## Timing (wordTimes ground truth)", "");
  lines.push(
    "| clip | text matched | unmatched | unusable | sub/del/ins | boundary MAE | onset MAE | offset bias | F1@50 (P/R) | F1@100 (P/R) |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const clip of report.clips) {
    const timing = clip.timing;
    if (timing === null) continue;
    lines.push(
      row([
        markdownText(clip.id),
        String(timing.matched),
        String(timing.unmatched),
        String(timing.unusable),
        `${timing.alignmentSubstitutions}/${timing.alignmentDeletions}/${timing.alignmentInsertions}`,
        markdownNumber(timing.boundary.maeMs, 1),
        markdownNumber(timing.onset.maeMs, 1),
        markdownNumber(timing.offsetBiasMs, 1),
        timingCell(timing, 50),
        timingCell(timing, 100),
      ]),
    );
  }
  if (report.clips.every((clip) => clip.timing === null)) {
    lines.push("| _none_ | - | - | - | - | - | - | - | - | - |");
  }
  lines.push("");

  lines.push("## Hallucination", "");
  lines.push(
    "| clip | expectNoWords | words | duration (ms) | WPM | span words | span duration (ms) | span WPM |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const clip of report.clips) {
    const hallucination = clip.hallucination;
    if (hallucination === null) continue;
    lines.push(
      row([
        markdownText(clip.id),
        hallucination.expectNoWords ? "yes" : "no",
        String(hallucination.wordsProduced),
        hallucination.durationMs === null ? "-" : String(hallucination.durationMs),
        markdownNumber(hallucination.wordsPerMinute, 2),
        String(hallucination.spanWords),
        String(hallucination.spanDurationMs),
        markdownNumber(hallucination.spanWordsPerMinute, 2),
      ]),
    );
  }
  lines.push("");

  const notes: string[] = [];
  for (const clip of report.clips) {
    for (const note of clip.notes) notes.push(`- \`${markdownText(clip.id)}\`: ${markdownText(note)}`);
  }
  if (report.unknownClips.length > 0) {
    notes.push(`- unknown hypothesis clips: ${report.unknownClips.map(markdownText).join(", ")}`);
  }
  if (notes.length > 0) {
    lines.push("## Notes", "");
    lines.push(...notes);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/** JSON for the `--out` file. No undefined/NaN/Infinity is stored, so it is valid JSON. */
export function score2ReportToJson(report: Score2Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Re-exported so a caller that already has a parsed hypotheses JSON does not need two imports. */
export function parseScore2Hypotheses(input: unknown, source = "score2 hypotheses file"): GoldHypothesis {
  return parseGoldHypothesisFile(input, source);
}
