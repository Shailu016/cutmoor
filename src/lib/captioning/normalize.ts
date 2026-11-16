import { applySpelling } from "./spelling";
import type { Word } from "./types";

/**
 * Roman-Hinglish normaliser.
 *
 * Rules, in priority order:
 *  1. Never translate, never transliterate. A token that contains Devanagari is returned exactly
 *     as it arrived: turning "नहीं" into Roman text is a different product decision.
 *  2. Only the word core changes. Leading and trailing punctuation (quotes, commas, marks) stays
 *     where it was, because captions must keep it.
 *  3. Known spelling variants and product names get one canonical spelling. Every other Roman word
 *     is returned EXACTLY as it arrived. Whisper's capitalisation of names and sentences ("Delhi",
 *     "Rahul", "NASA", "IPL") is information, not noise, and silently lowercasing it destroys it.
 *  4. Case follows the input for plain words: "Nahin" -> "Nahi", "NAHIN" -> "NAHI", "nahin" ->
 *     "nahi". Canonical spellings that carry their own casing (YouTube, WhatsApp, AI, OK, iOS, I)
 *     are always used verbatim.
 *  5. The result is idempotent: running the normaliser twice changes nothing the second time.
 *
 * Lexicon admission policy: a key is admitted only when it is not a spelling of a different word
 * in English or Hinglish, is not a common non-Hinglish abbreviation, and rewriting it cannot mangle
 * a recognisable name or brand. When a spelling is ambiguous, leave it out: an uncorrected word is
 * a cosmetic loss, a corrected wrong word is a bug. That is why "kam" (less), "nai" (new), "kia"
 * (Kia / kiya), "ig" (I guess), "tm" (TM), "id" (the id), "sb" (somebody), "yr" (year), "bhut"
 * (bhoot), "han" (Han) and "kon" (Kon) have no entry. Entries whose key is already the canonical
 * spelling ("karna", "bhai") are safe: no rewrite happens and the case pattern keeps "Karna" and
 * "Bhai" exactly as the recogniser produced them.
 *
 * Word count is never touched, which is why `normalizeWords` can sit between alignment and layout
 * without disturbing any timing.
 */

/** Devanagari and Devanagari Extended. Any token containing one of these is left alone. */
const DEVANAGARI = /[\u0900-\u097F\uA8E0-\uA8FF]/;

/** A word core starts after these and ends before these. Edge punctuation is never moved. */
const LEADING_PUNCT = /^[^\p{L}\p{N}]+/u;
const TRAILING_PUNCT = /[^\p{L}\p{N}]+$/u;

/**
 * variant -> canonical spelling. Keys are lowercase; the input core is lowercased before lookup,
 * so "NAHIN", "Nahin" and "nahin" all land on the same entry.
 *
 * A Map (not an object literal) so a token such as "constructor" can never collide with
 * Object.prototype and come back as a function.
 *
 * Exported for the lexicon-wide idempotence/policy tests. Treat it as read-only.
 */
export const LEXICON: ReadonlyMap<string, string> = new Map<string, string>([
  // ---- nahi: the most common spelling drift in Roman Hinglish --------------------------------
  ["nahi", "nahi"],
  ["nahin", "nahi"],
  ["nhi", "nahi"],
  ["nahii", "nahi"],
  ["nahee", "nahi"],
  ["nahe", "nahi"],

  // ---- hai / hain: kept apart on purpose; "hain" is plural, not a misspelling of "hai" --------
  ["hai", "hai"],
  ["hae", "hai"],
  ["hain", "hain"],
  ["haien", "hain"],
  ["hainn", "hain"],

  // ---- common particles and verbs -------------------------------------------------------------
  // ---- pagal: Whisper writes the "l" as "r" in fast speech ("paagar"). Plain "pagar" (salary) is left alone. ----
  ["pagal", "pagal"],
  ["paagal", "pagal"],
  ["paagar", "pagal"],

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
  ["bhi", "bhi"],
  ["bhii", "bhi"],
  ["bahut", "bahut"],
  ["bohot", "bahut"],
  ["bahot", "bahut"],
  ["bhot", "bahut"],
  ["achha", "achha"],
  ["acha", "achha"],
  ["accha", "achha"],
  ["achcha", "achha"],
  ["theek", "theek"],
  ["thik", "theek"],
  ["matlab", "matlab"],
  ["mtlb", "matlab"],
  ["yaar", "yaar"],
  ["yar", "yaar"],
  ["bhai", "bhai"],
  ["karo", "karo"],
  ["kro", "karo"],
  ["karna", "karna"],
  ["krna", "karna"],
  ["karta", "karta"],
  ["krta", "karta"],
  ["karti", "karti"],
  ["krti", "karti"],
  ["kar", "kar"],
  ["kr", "kar"],
  ["kare", "kare"],
  ["kre", "kare"],
  ["raha", "raha"],
  ["rha", "raha"],
  ["rahi", "rahi"],
  ["rhi", "rahi"],
  ["rahe", "rahe"],
  ["rhe", "rahe"],
  ["gaya", "gaya"],
  ["gya", "gaya"],
  ["gayi", "gayi"],
  ["gyi", "gayi"],
  ["gaye", "gaye"],
  ["gye", "gaye"],
  ["kuch", "kuch"],
  ["kch", "kuch"],
  ["sab", "sab"],
  ["tum", "tum"],
  ["mera", "mera"],
  ["mra", "mera"],
  ["meri", "meri"],
  ["mri", "meri"],
  ["mujhe", "mujhe"],
  ["muje", "mujhe"],
  ["mujhey", "mujhe"],
  ["tujhe", "tujhe"],
  ["tuje", "tujhe"],
  ["yeh", "yeh"],
  ["ye", "yeh"],
  ["woh", "woh"],
  ["wo", "woh"],
  ["voh", "woh"],
  ["vo", "woh"],
  ["yahan", "yahan"],
  ["yaha", "yahan"],
  ["wahan", "wahan"],
  ["waha", "wahan"],
  ["abhi", "abhi"],
  ["abhee", "abhi"],
  ["phir", "phir"],
  ["lekin", "lekin"],
  ["lakin", "lekin"],
  ["magar", "magar"],
  ["sirf", "sirf"],
  ["thoda", "thoda"],
  ["thda", "thoda"],
  ["zyada", "zyada"],
  ["zada", "zyada"],
  ["jyada", "zyada"],
  ["pyaar", "pyaar"],
  ["pyar", "pyaar"],
  ["zindagi", "zindagi"],
  ["zindgi", "zindagi"],
  ["kaam", "kaam"],
  ["samay", "samay"],
  ["waqt", "waqt"],
  ["wakt", "waqt"],
  ["vakt", "waqt"],
  ["sahi", "sahi"],
  ["galat", "galat"],
  ["galt", "galat"],
  ["batao", "batao"],
  ["btao", "batao"],
  ["samajh", "samajh"],
  ["samj", "samajh"],
  ["samaj", "samajh"],
  ["wala", "wala"],
  ["vala", "wala"],
  ["wali", "wali"],
  ["vali", "wali"],
  ["wale", "wale"],
  ["vale", "wale"],

  // ---- English words that must keep a capital ------------------------------------------------
  ["i", "I"],
  ["i'm", "I'm"],
  ["i've", "I've"],
  ["i'll", "I'll"],
  ["i'd", "I'd"],

  // ---- initialisms: ASR mixes "ai", "Ai", "AI"; one spelling leaves the export -----------------
  ["ai", "AI"],
  ["api", "API"],
  ["gps", "GPS"],
  ["ok", "OK"],
  ["otp", "OTP"],
  ["pdf", "PDF"],
  ["sms", "SMS"],
  ["tv", "TV"],
  ["upi", "UPI"],
  ["url", "URL"],
  ["usb", "USB"],

  // ---- product and brand casing ---------------------------------------------------------------
  ["android", "Android"],
  ["chatgpt", "ChatGPT"],
  ["facebook", "Facebook"],
  ["fb", "Facebook"],
  ["gpay", "GPay"],
  ["github", "GitHub"],
  ["google", "Google"],
  ["instagram", "Instagram"],
  ["insta", "Instagram"],
  ["instgram", "Instagram"],
  ["ios", "iOS"],
  ["ipad", "iPad"],
  ["iphone", "iPhone"],
  ["linkedin", "LinkedIn"],
  ["macos", "macOS"],
  ["netflix", "Netflix"],
  ["openai", "OpenAI"],
  ["paytm", "Paytm"],
  ["phonepe", "PhonePe"],
  ["snapchat", "Snapchat"],
  ["spotify", "Spotify"],
  ["telegram", "Telegram"],
  ["tiktok", "TikTok"],
  ["twitter", "Twitter"],
  ["whatsapp", "WhatsApp"],
  ["whatsap", "WhatsApp"],
  ["watsapp", "WhatsApp"],
  ["whatssapp", "WhatsApp"],
  ["youtube", "YouTube"],
  ["youtub", "YouTube"],
  ["youtbe", "YouTube"],
  ["yt", "YouTube"],
]);

/** True when the core has letters and every letter in it is uppercase. */
function isAllCaps(core: string): boolean {
  return core.toUpperCase() === core && core.toLowerCase() !== core;
}

/**
 * Gives a canonical spelling the capitalisation the recogniser used.
 *
 * A canonical form that is not all-lowercase (YouTube, WhatsApp, AI, OK, iOS, I) carries its own
 * casing and is returned untouched. A plain lowercase canonical form follows the input: all-caps
 * stays all-caps, a leading capital stays a leading capital, anything else is lowercase.
 */
function applyCasePattern(canonical: string, core: string): string {
  if (canonical !== canonical.toLowerCase()) return canonical;
  if (isAllCaps(core)) return canonical.toUpperCase();
  const first = core.charAt(0);
  if (first !== first.toLowerCase()) {
    return `${canonical.charAt(0).toUpperCase()}${canonical.slice(1)}`;
  }
  return canonical;
}

/** Canonical spelling for one bare word core (no edge punctuation). */
function normalizeCore(core: string): string {
  const canonical = LEXICON.get(core.toLowerCase());
  if (canonical === undefined) return core;
  return applyCasePattern(canonical, core);
}

/**
 * Normalises one token. Times and word counts are not this function's business.
 * A Devanagari token (or a mixed token) is returned byte-for-byte unchanged.
 */
export function normalizeToken(text: string): string {
  if (text.length === 0) return text;
  if (DEVANAGARI.test(text)) return text;

  const leading = LEADING_PUNCT.exec(text)?.[0] ?? "";
  const rest = text.slice(leading.length);
  if (rest.length === 0) return text;

  const trailing = TRAILING_PUNCT.exec(rest)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);
  if (core.length === 0) return text;

  return `${leading}${normalizeCore(core)}${trailing}`;
}

/**
 * Maps every word through the v1 token normaliser, then through spelling v2.
 *
 * v1 fixes the casing-aware single-token variants ("Nahin" -> "Nahi"). v2 then adds
 * document consensus, conservative phonetic matching and an optional glossary, without
 * ever touching an already-capitalised token.
 *
 * The array shape never changes: same length, same start/end/index/windowIndex, same
 * confidence. Only `text` can differ. A new array is returned so a caller can keep the
 * pre-normalised transcript for debugging or for a second export.
 */
export function normalizeWords(words: Word[]): Word[] {
  return applySpelling(words.map((word) => ({ ...word, text: normalizeToken(word.text) })));
}
