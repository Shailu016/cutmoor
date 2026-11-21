import type { Word } from "./types";

/**
 * Offline Devanagari -> Roman-Hinglish transliteration.
 *
 * WHY this module exists: the caption engine is a Hinglish model and normally answers in Roman
 * letters, but a reading can still come back in Devanagari (the Hindi token in song mode often
 * does, and a visitor's pasted lyrics may be Devanagari). `normalize.ts` and `spelling.ts`
 * deliberately never touch Devanagari, so without this step those captions would stay unreadable
 * to a Hinglish audience. The visitor chooses "Hinglish" in the caption settings; this is the
 * pure, local conversion behind that choice. Nothing here opens a file, reads a clock or touches
 * the network.
 *
 * The output is a display spelling, not a scholarly transcription. It follows the same
 * Roman-Hinglish conventions as the rest of the product: long and short vowels are written the
 * way Hinglish captions write them (`का` -> "ka", `काम` -> "kaam", `दूध` -> "doodh"), retroflex and
 * dental consonants share a letter (`ट`/`त` -> t), nukta consonants follow Hinglish rather than
 * IAST (`ज़` -> z, `क़` -> k, `फ़` -> f, `ड़`/`ढ़` -> d/dh), and an inherent "a" is deleted
 * word-finally and before a consonant with an explicit vowel (`नमस्ते` -> "namaste",
 * `कमरा` -> "kamra"). A closed list of high-frequency words and English loanwords corrects the
 * cases the letter rules get consistently wrong (`नहीं` -> "nahi", `स्कूल` -> "school"); it is
 * deliberately small, and an unseen word falls back to the rules.
 *
 * Known weak cases (reported honestly, not hidden): the schwa heuristic gets a few Sanskrit
 * loans wrong (`क्षेत्र`, `धन्यवाद` are in the override list; `सत्य`/`नम्र` are not), long ी is
 * always "i" (`पीना` -> "pina" unless overridden), and English loanwords outside the list are
 * spelled phonetically (`कैप्शन` -> "kaipshan"). Those are display spellings, not recognition
 * errors, and the visitor can edit any word afterwards.
 */

export type CaptionScript = "original" | "roman";

/** Devanagari and Devanagari Extended. Matras, nukta and virama are inside this range. */
const DEVANAGARI = /[\u0900-\u097F\uA8E0-\uA8FF]/u;
const DEVANAGARI_CHAR = /^[\u0900-\u097F\uA8E0-\uA8FF]$/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const LEADING_PUNCT = /^[^\p{L}\p{N}\p{M}]+/u;
const TRAILING_PUNCT = /[^\p{L}\p{N}\p{M}]+$/u;

/** True when the text contains at least one Devanagari letter, mark or punctuation sign. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

// ---------------------------------------------------------------- rules tables

/**
 * Consonants. Retroflex and dental sounds share a Roman letter because Hinglish does not
 * distinguish them in writing; the aspirated forms keep their "h" (`ख` -> kh, `घ` -> gh).
 */
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
]);

/**
 * Base consonant -> Roman form when a separate nukta (U+093C) follows. Hinglish style, not
 * IAST: `क़िताब` is "kitaab", not "qitaab", and `फ़ोन` is "phone".
 */
const NUKTA_CONSONANTS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0915", "k"],
  ["\u0916", "kh"],
  ["\u0917", "g"],
  ["\u091C", "z"],
  ["\u0921", "d"],
  ["\u0922", "dh"],
  ["\u092B", "f"],
  ["\u092F", "y"],
]);

/**
 * Precomposed nukta letters (U+0958..U+095F) are composition exclusions: NFC leaves them alone
 * instead of composing base+nukta. They are decomposed up front so one parser handles both
 * spellings identically (`ज़िंदगी` typed as U+095B or as ज + nukta gives the same result).
 */
const PRECOMPOSED_NUKTA: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0958", "\u0915\u093C"],
  ["\u0959", "\u0916\u093C"],
  ["\u095A", "\u0917\u093C"],
  ["\u095B", "\u091C\u093C"],
  ["\u095C", "\u0921\u093C"],
  ["\u095D", "\u0922\u093C"],
  ["\u095E", "\u092B\u093C"],
  ["\u095F", "\u092F\u093C"],
]);

const VIRAMA = "\u094D";
const NUKTA = "\u093C";
const ANUSVARA = "\u0902";
const CANDRABINDU = "\u0901";
const VISARGA = "\u0903";
const AVAGRAHA = "\u093D";
const DANDA = "\u0964";
const DOUBLE_DANDA = "\u0965";
const OM = "\u0950";
const ZERO_WIDTH_NON_JOINER = "\u200C";
const ZERO_WIDTH_JOINER = "\u200D";

/** Independent vowels. Long/short pairs differ only by the context rule below. */
const VOWELS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0905", "a"], // अ
  ["\u0906", "aa"], // आ (shortened contextually, see `transliterateRun`)
  ["\u0907", "i"], // इ
  ["\u0908", "i"], // ई (Hinglish writes both "i": zindagi, hindi)
  ["\u0909", "u"], // उ
  ["\u090A", "oo"], // ऊ (shortened contextually)
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

/** Dependent vowel signs (matras). `ा` and `ू` are contextually shortened word-finally. */
const MATRAS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u093E", "aa"], // ा
  ["\u093F", "i"], // ि
  ["\u0940", "i"], // ी
  ["\u0941", "u"], // ु
  ["\u0942", "oo"], // ू
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

/**
 * Two-consonant conjuncts whose conventional Hinglish spelling is not just the two consonants
 * written next to each other. Every other conjunct is handled generically from the virama:
 * `स्कूल` -> s-k-oo-l, `नमस्ते` -> n-a-m-a-s-t-e.
 */
const CONJUNCTS: ReadonlyMap<string, string> = new Map<string, string>([
  ["\u0915\u094D\u0937", "ksh"], // क्ष
  ["\u091C\u094D\u091E", "gy"], // ज्ञ (the virama is included so the key is unambiguous)
  ["\u091A\u094D\u091B", "chh"], // च्छ (अच्छा -> achha, not achchha)
  ["\u0936\u094D\u0930", "shr"], // श्र
  ["\u0924\u094D\u0930", "tr"], // त्र
]);

/** Devanagari digits become ASCII digits, so a timestamp or price stays readable. */
const DIGITS: ReadonlyMap<string, string> = new Map<string, string>([
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

const LABIAL_CONSONANTS: ReadonlySet<string> = new Set(["p", "ph", "b", "bh", "m"]);

/**
 * High-frequency words whose Hinglish spelling is fixed by usage rather than by the letter rules.
 * Kept closed and short: every entry is either a function word whose spelling the product's own
 * lexicon uses (`नहीं` -> "nahi", `क्यों` -> "kyun") or an English loanword Hindi writes
 * phonetically (`स्कूल` -> "school"). Unseen words fall back to the rules above.
 */
const WORD_OVERRIDES: ReadonlyMap<string, string> = new Map<string, string>(
  (
    [
      // Function words and pronouns
      ["\u0924\u094B", "toh"], // तो
      ["\u0915\u094D\u092F\u094B\u0902", "kyun"], // क्यों
      ["\u0915\u0939\u093E\u0901", "kahan"], // कहाँ
      ["\u092F\u0939\u093E\u0901", "yahan"], // यहाँ
      ["\u0935\u0939\u093E\u0901", "wahan"], // वहाँ
      ["\u0928\u0939\u0940\u0902", "nahi"], // नहीं
      ["\u0939\u092E", "hum"], // हम
      ["\u0939\u092E\u0947\u0902", "humein"], // हमें
      ["\u0935\u0939", "woh"], // वह
      ["\u0935\u094B", "woh"], // वो
      ["\u092F\u0939", "yeh"], // यह
      ["\u0935\u093E\u0932\u093E", "wala"], // वाला
      ["\u0935\u093E\u0932\u0940", "wali"], // वाली
      ["\u0935\u093E\u0932\u0947", "wale"], // वाले
      ["\u0935\u093E\u0932\u094B\u0902", "walon"], // वालों
      ["\u092C\u0924\u093E\u0913", "batao"], // बताओ
      ["\u091C\u093C\u094D\u092F\u093E\u0926\u093E", "zyada"], // ज़्यादा
      ["\u0938\u093F\u0930\u094D\u092B", "sirf"], // सिर्फ
      ["\u092E\u093E\u0901", "maa"], // माँ
      ["\u092E\u093E\u0902", "maa"], // मां
      ["\u0917\u0908", "gayi"], // गई
      ["\u0939\u092E\u093E\u0930\u093E", "hamara"], // हमारा
      ["\u0939\u092E\u093E\u0930\u0940", "hamari"], // हमारी
      ["\u0939\u092E\u093E\u0930\u0947", "hamare"], // हमारे

      // Words where Hindi's schwa rule or merged long vowel would mislead the letter rules
      ["\u0928\u092E\u0938\u094D\u0915\u093E\u0930", "namaskar"], // नमस्कार
      ["\u0927\u0928\u094D\u092F\u0935\u093E\u0926", "dhanyavaad"], // धन्यवाद
      ["\u0915\u094D\u0937\u0947\u0924\u094D\u0930", "kshetra"], // क्षेत्र
      ["\u092D\u093E\u0930\u0924", "bharat"], // भारत
      ["\u092D\u093E\u0937\u093E", "bhasha"], // भाषा
      ["\u092A\u0922\u093C\u093E\u0908", "padhai"], // पढ़ाई
      ["\u0915\u0939\u093E\u0928\u0940", "kahani"], // कहानी
      ["\u0915\u0932\u094D\u092A\u0928\u093E", "kalpana"], // कल्पना
      ["\u091C\u093C\u092E\u093E\u0928\u093E", "zamana"], // ज़माना
      ["\u0939\u093F\u0928\u094D\u0926\u0941\u0938\u094D\u0924\u093E\u0928", "hindustan"], // हिन्दुस्तान
      ["\u092C\u093E\u0930\u093E\u0924", "baraat"], // बारात
      ["\u091A\u093E\u0939\u093F\u090F", "chahiye"], // चाहिए
      ["\u091A\u093E\u092F", "chai"], // चाय
      ["\u092E\u0947\u0902", "mein"], // में
      ["\u0920\u0940\u0915", "theek"], // ठीक
      ["\u092E\u0940\u0920\u093E", "meetha"], // मीठा
      ["\u092A\u0940\u0928\u093E", "peena"], // पीना
      ["\u0909\u092E\u094D\u092E\u0940\u0926", "umeed"], // उम्मीद
      ["\u0935\u0915\u093C\u094D\u0924", "waqt"], // वक़्त
      ["\u0935\u0915\u094D\u0924", "waqt"], // वक्त
      ["\u0907\u0936\u094D\u0915\u093C", "ishq"], // इश्क़
      ["\u0907\u0936\u094D\u0915", "ishq"], // इश्क
      ["\u092A\u093E\u092A\u093E", "papa"], // पापा
      ["\u092E\u092E\u094D\u092E\u0940", "mummy"], // मम्मी
      ["\u092E\u092E\u094D\u092E\u093E", "mumma"], // मम्मा
      ["\u091C\u093C\u093F\u0902\u0926\u0917\u0940", "zindagi"], // ज़िंदगी (decomposed key)
      ["\u091C\u093C\u093F\u0928\u094D\u0926\u0917\u0940", "zindagi"], // ज़िन्दगी

      // English loanwords Hindi writes phonetically (Hinglish captions use Latin spelling)
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
      ["\u0915\u0948\u092A\u094D\u0936\u0928", "caption"], // कैप्शन
      ["\u0938\u092C\u094D\u0938\u0915\u094D\u0930\u093E\u0907\u092C", "subscribe"], // सब्सक्राइब
    ] as const
  ).map(([word, roman]) => [normalizeWordKey(word), roman]),
);

// ---------------------------------------------------------------- parsing

interface ConsonantSegment {
  kind: "consonant";
  roman: string;
  /** The vowel that follows, or null for a bare consonant (virama). */
  vowel: string | null;
  /** True for the implicit "a" after a consonant with no matra; only this kind may be deleted. */
  inherent: boolean;
}

interface VowelSegment {
  kind: "vowel";
  text: string;
}

interface TextSegment {
  kind: "text";
  text: string;
}

type Segment = ConsonantSegment | VowelSegment | TextSegment;

/** Maps precomposed nukta letters to base + combining nukta, so the parser sees one spelling. */
function decomposeNukta(text: string): string {
  let output = "";
  for (const char of text) output += PRECOMPOSED_NUKTA.get(char) ?? char;
  return output;
}

/**
 * The key used for fixed spellings. Zero-width joiners are formatting, not sound, so
 * `ज़िंदगी` written with or without them must find the same override.
 */
function normalizeWordKey(text: string): string {
  return decomposeNukta(text).replace(/[\u200C\u200D]/g, "");
}

/** The Roman form of the next consonant after `from`, looking through nukta and zero-width marks. */
function nextConsonantRoman(chars: readonly string[], from: number): string | null {
  for (let index = from; index < chars.length; index += 1) {
    const char = chars[index];
    if (char === NUKTA || char === ZERO_WIDTH_NON_JOINER || char === ZERO_WIDTH_JOINER) continue;
    const base = CONSONANTS.get(char);
    if (base === undefined) return null;
    if (chars[index + 1] === NUKTA) return NUKTA_CONSONANTS.get(char) ?? base;
    return base;
  }
  return null;
}

/** True when the consonant at `index` is the last sound of the word (trailing punctuation allowed). */
function isWordFinal(segments: readonly Segment[], index: number): boolean {
  const next = segments[index + 1];
  if (next === undefined) return true;
  if (next.kind === "text") return !LETTER_OR_NUMBER.test(next.text);
  return false;
}

/**
 * Removes the inherent "a" where Hinglish does not write it. The rule is the standard Hindi
 * heuristic, not a full phonological model: word-finally, or before a consonant that carries an
 * explicit vowel once the word has already produced a vowel (`इतने` -> itne, `कमरा` -> kamra).
 * A word-initial consonant keeps its "a" (`बड़ा` -> bada, `कमल` -> kamal).
 */
function deleteInherentSchwas(segments: Segment[]): void {
  let heardVowel = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === "text") continue;
    if (segment.kind === "vowel") {
      heardVowel = true;
      continue;
    }

    if (segment.inherent) {
      let nextIndex = index + 1;
      while (nextIndex < segments.length && segments[nextIndex].kind === "text" && (segments[nextIndex] as TextSegment).text.length === 0) {
        nextIndex += 1;
      }
      if (nextIndex >= segments.length) {
        segment.vowel = null;
        segment.inherent = false;
      } else {
        const next = segments[nextIndex];
        if (next.kind === "consonant" && !next.inherent && next.vowel !== null && heardVowel) {
          segment.vowel = null;
          segment.inherent = false;
        } else if (next.kind === "text" && !LETTER_OR_NUMBER.test(next.text)) {
          segment.vowel = null;
          segment.inherent = false;
        }
      }
    }

    if (segment.vowel !== null) heardVowel = true;
  }
}

/**
 * Transliterates one contiguous Devanagari run. `wordStart` is true only when the run begins
 * the whitespace token: an independent आ at the start is "aa" (`आप` -> aap), but the same letter
 * after a vowel is the second half of a diphthong and stays short (`हुआ` -> hua, `दुआ` -> dua).
 */
function transliterateRun(run: string, wordStart: boolean): string {
  const chars = Array.from(decomposeNukta(run));
  const segments: Segment[] = [];

  for (let index = 0; index < chars.length; ) {
    const char = chars[index];
    if (char === ZERO_WIDTH_NON_JOINER || char === ZERO_WIDTH_JOINER) {
      index += 1;
      continue;
    }

    const consonant = CONSONANTS.get(char);
    if (consonant !== undefined) {
      let roman = consonant;
      let after = index + 1;
      if (chars[after] === NUKTA) {
        roman = NUKTA_CONSONANTS.get(char) ?? roman;
        after += 1;
      }

      if (chars[after] === VIRAMA) {
        const secondIndex = after + 1;
        const secondChar = chars[secondIndex];
        const secondConsonant = secondChar === undefined ? undefined : CONSONANTS.get(secondChar);
        if (secondConsonant !== undefined) {
          let secondAfter = secondIndex + 1;
          if (chars[secondAfter] === NUKTA) secondAfter += 1;
          const conjunct = CONJUNCTS.get(`${char}${VIRAMA}${secondChar}`);
          if (conjunct !== undefined) {
            roman = conjunct;
            after = secondAfter;
          } else {
            // Ordinary conjunct: the first consonant carries no vowel and the second is parsed
            // on its own, so `स्त` -> s + t(a) and `क्र` -> k + r(a).
            segments.push({ kind: "consonant", roman, vowel: null, inherent: false });
            index = secondIndex;
            continue;
          }
        } else {
          // A halant at the end of a word or before a non-consonant: a bare consonant.
          segments.push({ kind: "consonant", roman, vowel: null, inherent: false });
          index = after + 1;
          continue;
        }
      }

      const next = chars[after];
      const matra = next === undefined ? undefined : MATRAS.get(next);
      if (matra !== undefined) {
        segments.push({ kind: "consonant", roman, vowel: matra, inherent: false });
        index = after + 1;
        continue;
      }
      if (next === VIRAMA) {
        segments.push({ kind: "consonant", roman, vowel: null, inherent: false });
        index = after + 1;
        continue;
      }
      segments.push({ kind: "consonant", roman, vowel: "a", inherent: true });
      index = after;
      continue;
    }

    const vowel = VOWELS.get(char);
    if (vowel !== undefined) {
      let text = vowel;
      const atWordStart = wordStart && segments.length === 0;
      if (char === "\u0906") text = atWordStart ? "aa" : "a"; // आ
      else if (char === "\u090A") text = atWordStart ? "oo" : "u"; // ऊ
      segments.push({ kind: "vowel", text });
      index += 1;
      continue;
    }

    if (char === ANUSVARA || char === CANDRABINDU) {
      // Anusvara and chandrabindu both nasalise. Hinglish writes "m" before a labial
      // (`संभव` -> sambhav) and "n" elsewhere (`संसार` -> sansaar, `हैं` -> hain).
      const next = nextConsonantRoman(chars, index + 1);
      segments.push({ kind: "text", text: next !== null && LABIAL_CONSONANTS.has(next) ? "m" : "n" });
      index += 1;
      continue;
    }

    if (char === VISARGA) {
      segments.push({ kind: "text", text: "h" });
      index += 1;
      continue;
    }

    if (char === OM) {
      segments.push({ kind: "text", text: "om" });
      index += 1;
      continue;
    }

    const digit = DIGITS.get(char);
    if (digit !== undefined) {
      segments.push({ kind: "text", text: digit });
      index += 1;
      continue;
    }

    if (char === AVAGRAHA) {
      index += 1;
      continue;
    }

    if (char === DANDA || char === DOUBLE_DANDA) {
      // A Devanagari full stop becomes the Latin one, so a Roman caption keeps its sentence end.
      segments.push({ kind: "text", text: "." });
      index += 1;
      continue;
    }

    if (DEVANAGARI_CHAR.test(char)) {
      // Vedic accents and other rare signs carry no sound for a caption.
      index += 1;
      continue;
    }

    segments.push({ kind: "text", text: char });
    index += 1;
  }

  deleteInherentSchwas(segments);

  let output = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === "consonant") {
      let vowel = segment.vowel;
      // Hinglish writes a final long -ā/-ū short (बड़ा -> bada, बहू -> bahu) but keeps it in the
      // middle of a word (काम -> kaam, दूध -> doodh). A following nasal counts as a letter, so
      // `हाँ` -> haan and `हूँ` -> hoon keep the long vowel. A long ā immediately before another
      // vowel is also written short in Hinglish (भाई -> bhai, खाओ -> khao).
      const next = segments[index + 1];
      if (vowel === "aa" && (isWordFinal(segments, index) || next?.kind === "vowel")) vowel = "a";
      else if (vowel === "oo" && isWordFinal(segments, index)) vowel = "u";
      output += segment.roman + (vowel ?? "");
    } else {
      output += segment.text;
    }
  }
  return output;
}

/** Transliterates each Devanagari run in `text`; every other character is copied byte-for-byte. */
function transliterateRuns(text: string): string {
  let output = "";
  let run = "";
  let runWordStart = true;
  let sawWordCharacter = false;

  const flush = (): void => {
    if (run.length === 0) return;
    // A fixed spelling also applies inside a mixed token ("videoमें" -> "videomein").
    output += WORD_OVERRIDES.get(normalizeWordKey(run)) ?? transliterateRun(run, runWordStart);
    run = "";
  };

  for (const char of text) {
    if (DEVANAGARI_CHAR.test(char)) {
      if (run.length === 0) runWordStart = !sawWordCharacter;
      run += char;
    } else {
      flush();
      output += char;
      if (LETTER_OR_NUMBER.test(char)) sawWordCharacter = true;
    }
  }
  flush();
  return output;
}

/**
 * Transliterates one whitespace-free word, preserving leading/trailing punctuation and any Latin
 * part. Non-Devanagari text is returned exactly as it arrived (`café` keeps its accent and
 * `नमस्ते,` keeps its comma). Never changes the number of words.
 *
 * A closed override list handles the fixed spellings; every other word goes through the rules.
 */
export function transliterateWord(text: string): string {
  if (text.length === 0 || !hasDevanagari(text)) return text;
  const canonical = decomposeNukta(text);

  const leading = LEADING_PUNCT.exec(canonical)?.[0] ?? "";
  const rest = canonical.slice(leading.length);
  if (rest.length === 0) return canonical;
  const trailing = TRAILING_PUNCT.exec(rest)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);

  const override = core.length === 0 ? undefined : WORD_OVERRIDES.get(normalizeWordKey(core));
  if (override !== undefined) return `${leading}${override}${trailing}`;
  return transliterateRuns(canonical);
}

/** Transliterates a whole string, keeping whitespace and punctuation in place. */
export function transliterateDevanagari(text: string): string {
  return text
    .split(/(\s+)/u)
    .map((part) => (part.length === 0 || /^\s+$/u.test(part) ? part : transliterateWord(part)))
    .join("");
}

/**
 * Applies the visitor's script choice to a transcript. Every word is a NEW object (so callers can
 * keep the original list for the editor) and every field except `text` is copied unchanged:
 * timings, confidence, index, windowIndex and the inferred flag. "original" therefore produces
 * the same text but still a fresh array, which keeps the two paths interchangeable.
 */
export function applyScript(words: readonly Word[], script: CaptionScript): Word[] {
  return words.map((word) => ({
    ...word,
    text: script === "roman" ? transliterateWord(word.text) : word.text,
  }));
}
