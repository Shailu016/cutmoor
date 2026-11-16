import {
  BLOCKED_PHONETIC_KEYS,
  SPELLING_FAMILIES,
  type SpellingFamily,
} from "./data/hinglish-variants";
import { LEXICON } from "./normalize";
import type { Word } from "./types";

/**
 * Spelling v2: document-level Roman-Hinglish clean-up.
 *
 * The product promise is narrow and non-negotiable: this module may change the SPELLING
 * of a lowercase word, and nothing else. The returned array always has the same length
 * and every word keeps its startMs, endMs, index, windowIndex and confidence, so it is
 * safe between alignment and layout.
 *
 * Four rules, in priority order:
 *
 *  1. GLOSSARY. If the caller supplies names ("Rahul", "Cutmoor", "NASA"), a token whose
 *     core is that name (case-insensitively) or one edit away from it takes the glossary
 *     spelling and casing. Glossary matches win over the table. The user told us how to
 *     write their names; the recogniser did not.
 *  2. DOCUMENT CONSENSUS. If a word family occurs at least twice in the transcript, every
 *     lowercase occurrence is rewritten to the most frequent spelling in that transcript.
 *     A tie goes to the family's canonical spelling. This fixes the annoying "nahi/
 *     nahin/nhi" mix inside one video even when the recogniser changed its mind.
 *  3. EXACT LEXICON. The v1 lexicon in normalize.ts still canonicalises every known
 *     variant. It is applied to a single occurrence, and as a fallback for words that
 *     are not in a family at all (brands, initialisms).
 *  4. PHONETIC KEY. For a word that is not an exact variant, we compute a small,
 *     deterministic key (doubled letters, long vowels, v/w, ph/f, final h, ...). If the
 *     table lists that key AND the word is within one edit of a listed spelling, it joins
 *     that family. Anything else is returned exactly as it arrived.
 *
 * Safety rails (why the guards exist):
 *  - Capitalised and ALL-CAPS tokens are never touched. Whisper's casing of names and
 *    sentence starts is information, and "Kyun"/"Rahul"/"NASA"/"Delhi"/"Kon"/"Han" must
 *    survive a spelling pass. Only lowercase ASCII cores are eligible.
 *  - Devanagari is never touched: Romanising it is a different product decision.
 *  - Tokens containing a digit ("4K", "iPhone15") are never touched.
 *  - Leading/trailing punctuation is split off and re-attached byte-for-byte.
 *  - Idempotent: the output of one pass is a fixed point of the next pass.
 *
 * Data policy lives in data/hinglish-variants.ts, including every ambiguous word we
 * deliberately rejected (kam, nai, kia, han, kon, pagar, ...).
 */

export interface ApplySpellingOptions {
  /** User names. A name may be rewritten to the glossary's exact casing. */
  glossary?: string[];
}

/** Devanagari and Devanagari Extended. */
const DEVANAGARI = /[\u0900-\u097F\uA8E0-\uA8FF]/;
const DIGIT = /\d/;

/** Same core boundaries as normalize.ts: edge punctuation is never part of the word. */
const LEADING_PUNCT = /^[^\p{L}\p{N}]+/u;
const TRAILING_PUNCT = /[^\p{L}\p{N}]+$/u;

/**
 * Eligible cores are lowercase ASCII letters only. That single test covers the whole
 * safety policy for casing ("Kyun", "NASA", "iPhone" fail it) and for punctuation,
 * digits and Devanagari.
 */
const ELIGIBLE_CORE = /^[a-z]+$/;

/** Glossary entries must be a single Latin word; "Rahul Sharma" cannot match one token. */
const GLOSSARY_ENTRY = /^[A-Za-z]+$/;

/**
 * Builds the phonetic key used for fuzzy family matching.
 *
 * Order matters. Long vowels are folded before doubled-letter collapse, otherwise
 * "theek" -> "thek" would never meet "thik" -> "thik". The key is intentionally
 * lossy: it is a candidate generator, and the one-edit check afterwards is what
 * keeps false positives out.
 */
export function phoneticKey(spelling: string): string {
  let key = spelling.toLowerCase();
  key = key.replace(/chh/g, "ch");
  key = key.replace(/ee/g, "i");
  key = key.replace(/ii/g, "i");
  key = key.replace(/oo/g, "u");
  key = key.replace(/uu/g, "u");
  key = key.replace(/aa/g, "a");
  key = key.replace(/ph/g, "f");
  key = key.replace(/v/g, "w");
  key = key.replace(/z/g, "j");
  key = key.replace(/q/g, "k");
  key = key.replace(/(.)\1+/g, "$1");
  key = key.replace(/h$/, "");
  return key;
}

/** True when a and b differ by at most one insertion, deletion or substitution. */
function isWithinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const long = a.length >= b.length ? a : b;
  const short = a.length >= b.length ? b : a;
  if (long.length - short.length > 1) return false;

  let longIndex = 0;
  let shortIndex = 0;
  let edits = 0;
  while (longIndex < long.length && shortIndex < short.length) {
    if (long.charAt(longIndex) === short.charAt(shortIndex)) {
      longIndex += 1;
      shortIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (long.length === short.length) {
      longIndex += 1;
      shortIndex += 1;
    } else {
      longIndex += 1;
    }
  }
  if (longIndex < long.length) edits += 1;
  return edits <= 1;
}

/** spelling -> family. Built once; the table is static. */
const FAMILY_BY_SPELLING = new Map<string, SpellingFamily>();
/** phonetic key -> family. Ambiguous and blocked keys are left out. */
const FAMILY_BY_KEY = new Map<string, SpellingFamily>();

{
  const blockedKeys = new Set(BLOCKED_PHONETIC_KEYS);
  const collisions = new Set<string>();

  for (const family of SPELLING_FAMILIES) {
    const spellings = [family.canonical, ...family.variants];
    for (const spelling of spellings) {
      if (!FAMILY_BY_SPELLING.has(spelling)) FAMILY_BY_SPELLING.set(spelling, family);

      const key = phoneticKey(spelling);
      if (blockedKeys.has(key)) continue;
      const owner = FAMILY_BY_KEY.get(key);
      if (owner === undefined) {
        FAMILY_BY_KEY.set(key, family);
      } else if (owner !== family) {
        // Two families claim one key: neither may use it, because guessing would be a
        // coin flip in production. Exact spellings from both families still work.
        collisions.add(key);
      }
    }
  }
  for (const key of collisions) FAMILY_BY_KEY.delete(key);
}

interface TokenParts {
  leading: string;
  core: string;
  trailing: string;
}

/** Splits a token into edge punctuation and an eligible lowercase core, or returns undefined. */
function splitToken(text: string): TokenParts | undefined {
  if (text.length === 0) return undefined;
  if (DEVANAGARI.test(text)) return undefined;
  if (DIGIT.test(text)) return undefined;

  const leading = LEADING_PUNCT.exec(text)?.[0] ?? "";
  const rest = text.slice(leading.length);
  if (rest.length === 0) return undefined;

  const trailing = TRAILING_PUNCT.exec(rest)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);
  if (!ELIGIBLE_CORE.test(core)) return undefined;

  return { leading, core, trailing };
}

interface GlossaryEntry {
  lower: string;
  spelling: string;
}

/**
 * Normalises the user's glossary once per call. Duplicate spellings are de-duplicated
 * case-insensitively and the first spelling wins, so a caller cannot make the result
 * depend on Map ordering.
 */
function buildGlossary(entries: readonly string[] | undefined): GlossaryEntry[] {
  const seen = new Set<string>();
  const glossary: GlossaryEntry[] = [];
  for (const raw of entries ?? []) {
    if (typeof raw !== "string") continue;
    const spelling = raw.trim();
    if (!GLOSSARY_ENTRY.test(spelling)) continue;
    const lower = spelling.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    glossary.push({ lower, spelling });
  }
  return glossary;
}

/**
 * Finds the glossary spelling for a core. An exact, case-insensitive match always wins.
 * One-edit matching is limited to entries of 3+ letters: with "Al" and one edit allowed,
 * half the transcript would become "Al".
 */
/**
 * One-edit matching of a glossary entry. Entries under 3 letters never match fuzzily. For an entry of up to 4 letters, a heard word
 * that is SHORTER than the entry does not match: that would turn a short ordinary word into a name ("did" -> "Didi"). A heard word
 * that is the same length or longer (a stretched or doubled spelling: "didii", "achha") still matches.
 */
export function fuzzyAllowed(heard: string, entry: string): boolean {
  if (entry.length < 3) return false;
  return entry.length >= 5 || heard.length >= entry.length;
}

function matchGlossary(core: string, glossary: readonly GlossaryEntry[]): string | undefined {
  const lower = core.toLowerCase();
  for (const entry of glossary) {
    if (entry.lower === lower) return entry.spelling;
  }
  for (const entry of glossary) {
    if (!fuzzyAllowed(lower, entry.lower)) continue;
    if (isWithinOneEdit(lower, entry.lower)) return entry.spelling;
  }
  return undefined;
}

/** Exact family membership first, then the conservative phonetic-key + one-edit path. */
function familyFor(core: string): SpellingFamily | undefined {
  const exact = FAMILY_BY_SPELLING.get(core);
  if (exact !== undefined) return exact;

  const family = FAMILY_BY_KEY.get(phoneticKey(core));
  if (family === undefined) return undefined;

  if (isWithinOneEdit(core, family.canonical)) return family;
  for (const variant of family.variants) {
    if (isWithinOneEdit(core, variant)) return family;
  }
  return undefined;
}

interface Resolution extends TokenParts {
  glossarySpelling?: string;
  family?: SpellingFamily;
}

/**
 * Most frequent spelling wins. On a tie the family's canonical spelling wins, even when
 * that spelling does not occur in the transcript: the canonical form is the one we are
 * willing to defend, and choosing it keeps a second pass stable.
 */
function pickWinner(spellings: ReadonlyMap<string, number>, canonical: string): string {
  let bestCount = -1;
  const best: string[] = [];
  for (const [spelling, count] of spellings) {
    if (count > bestCount) {
      bestCount = count;
      best.length = 0;
      best.push(spelling);
    } else if (count === bestCount) {
      best.push(spelling);
    }
  }
  if (best.length === 1) return best[0];
  return canonical;
}

/**
 * Applies spelling v2 to a merged transcript.
 *
 * @param words global-time words (see types.ts)
 * @param options optional `glossary` of user names
 * @returns a new array; same length, same timing/confidence/index fields, only `text` can differ
 */
export function applySpelling(words: Word[], options: ApplySpellingOptions = {}): Word[] {
  if (words.length === 0) return [];

  const glossary = buildGlossary(options.glossary);

  const resolutions: Array<Resolution | undefined> = words.map((word) => {
    const parts = splitToken(word.text);
    if (parts === undefined) return undefined;

    const glossarySpelling = matchGlossary(parts.core, glossary);
    if (glossarySpelling !== undefined) {
      // Glossary tokens are kept out of consensus: the user's spelling must not be
      // outvoted by the recogniser's variants.
      return { ...parts, glossarySpelling };
    }

    return { ...parts, family: familyFor(parts.core) };
  });

  // Count spellings per family over the whole document. Only eligible, non-glossary
  // occurrences take part; capitalised and Devanagari tokens are not evidence.
  const counts = new Map<SpellingFamily, Map<string, number>>();
  for (const resolution of resolutions) {
    if (resolution?.family === undefined) continue;
    let familyCounts = counts.get(resolution.family);
    if (familyCounts === undefined) {
      familyCounts = new Map<string, number>();
      counts.set(resolution.family, familyCounts);
    }
    familyCounts.set(resolution.core, (familyCounts.get(resolution.core) ?? 0) + 1);
  }

  const winners = new Map<SpellingFamily, string>();
  for (const [family, familyCounts] of counts) {
    let total = 0;
    for (const count of familyCounts.values()) total += count;
    // A single occurrence is handled by the exact lexicon / family canonical below.
    // Consensus is only meaningful when the recogniser actually varied its spelling.
    if (total < 2) continue;
    winners.set(family, pickWinner(familyCounts, family.canonical));
  }

  return words.map((word, position) => {
    const resolution = resolutions[position];
    if (resolution === undefined) return { ...word };

    let core: string;
    if (resolution.glossarySpelling !== undefined) {
      core = resolution.glossarySpelling;
    } else if (resolution.family !== undefined) {
      const winner = winners.get(resolution.family);
      if (winner !== undefined) {
        core = winner;
      } else {
        // One occurrence: use the v1 lexicon when it knows this spelling, otherwise the
        // family's canonical form. Both are fixed points of this module.
        core = LEXICON.get(resolution.core) ?? resolution.family.canonical;
      }
    } else {
      // Not a Hinglish family at all: still let the v1 lexicon fix brands and initialisms.
      core = LEXICON.get(resolution.core) ?? resolution.core;
    }

    return {
      ...word,
      text: `${resolution.leading}${core}${resolution.trailing}`,
    };
  });
}
