import { applySpelling, fuzzyAllowed } from "../../lib/captioning/spelling";
import type { CaptionResult } from "../../lib/captioning/contracts";
import type { CaptionEvent, Word } from "../../lib/captioning/types";

/**
 * The visitor's own names and special words.
 *
 * The speech model does not know that a family says "Mumma" rather than "Mama", or that a
 * brand is written "Cutmoor" and not "cut more". `spelling.ts` already knows how to use a
 * glossary; this module is the thin, testable layer between the textarea and a finished
 * `CaptionResult`.
 *
 * Two rules keep it safe:
 *  - Only `text` may change. Timing, index, confidence and windowIndex are copied through
 *    untouched, and events keep their grouping, so the karaoke highlight and exports stay
 *    in step with the audio.
 *  - With no usable glossary the original object is returned as-is, not a copy. Callers can
 *    therefore use reference equality to skip re-rendering or re-layout work.
 */

/** How many entries one job accepts. Beyond this, the rest are ignored. */
export const GLOSSARY_MAX_ENTRIES = 50;

/** Longest single entry. Anything longer is not a name and is dropped. */
export const GLOSSARY_MAX_ENTRY_CHARS = 40;

/** True when the entry has at least one letter in any script. "123" and "!!!" are not names. */
const HAS_LETTER = /\p{L}/u;

const LEADING_PUNCT = /^[^\p{L}\p{N}]+/u;
const TRAILING_PUNCT = /[^\p{L}\p{N}]+$/u;
const LATIN_WORD = /^[A-Za-z]+$/;
const DIGIT = /\d/;

/**
 * Turns the textarea contents into clean glossary entries.
 *
 * Accepts commas, new lines, or both. Repeats are compared case-insensitively and the first
 * spelling wins, so "Mumma, mumma" keeps the capital M the visitor typed. Entries without a
 * letter, entries longer than 40 characters and anything past the first 50 are dropped.
 */
export function parseGlossary(text: string): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/[,\r\n]/)) {
    // Internal runs of spaces are collapsed so "Rahul  Sharma" cannot enter the list twice.
    const entry = raw.trim().replace(/\s+/g, " ");
    if (entry.length === 0) continue;
    if (entry.length > GLOSSARY_MAX_ENTRY_CHARS) continue;
    if (!HAS_LETTER.test(entry)) continue;

    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);

    if (entries.length >= GLOSSARY_MAX_ENTRIES) break;
  }

  return entries;
}

interface WordParts {
  leading: string;
  core: string;
  trailing: string;
}

/** Splits edge punctuation from a single Latin core, or returns undefined for anything else. */
function splitWordText(text: string): WordParts | undefined {
  if (text.length === 0 || DIGIT.test(text)) return undefined;
  const leading = LEADING_PUNCT.exec(text)?.[0] ?? "";
  const rest = text.slice(leading.length);
  if (rest.length === 0) return undefined;
  const trailing = TRAILING_PUNCT.exec(rest)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);
  if (!LATIN_WORD.test(core)) return undefined;
  return { leading, core, trailing };
}

/** True when a and b differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
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

/** Exact match first, then one edit for entries of 3+ letters, the same rule spelling.ts uses. */
function matchEntry(lowerCore: string, entries: readonly string[]): string | undefined {
  for (const entry of entries) {
    if (entry.toLowerCase() === lowerCore) return entry;
  }
  for (const entry of entries) {
    if (!fuzzyAllowed(lowerCore, entry.toLowerCase())) continue;
    if (withinOneEdit(lowerCore, entry.toLowerCase())) return entry;
  }
  return undefined;
}

// ---------------------------------------------------------------- sound-alike names

/**
 * A rough consonant skeleton of a Roman-script word, so that spellings that sound alike meet: "lakhanoo" and "Lucknow" both
 * become "lkn". Digraphs fold first (kh, gh, th, dh, bh, ph, sh, ch), then c/q become k, z becomes j, w becomes v, vowels go,
 * repeats collapse, and a trailing v/y/h is dropped. Deliberately crude: it is only used against names the visitor listed.
 */
export function consonantSkeleton(word: string): string {
  let text = word.toLowerCase().replace(/[^a-z]/g, "");
  text = text.replace(/ck/g, "k").replace(/(kh|gh|th|dh|bh)/g, (m) => m[0]).replace(/ph/g, "f").replace(/sh/g, "s").replace(/ch/g, "c");
  text = text.replace(/[cq]/g, "k").replace(/z/g, "j").replace(/w/g, "v").replace(/[aeiou]/g, "");
  text = text.replace(/(.)+/g, "$1").replace(/[vyh]+$/, "");
  return text;
}

const lettersOf = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");

/**
 * A sound-alike rewrite only applies to words the model was NOT sure of. A confidently heard ordinary word ("makes", "nurse") must
 * never turn into a listed name ("Mukesh", "Naresh") just because the consonants line up; a mishearing ("lakhanoo", heard at 0.82 on a
 * real clip) is less sure. Ordinary words are read at 0.9 and above, so that is the line.
 */
export const SOUND_MATCH_MAX_CONFIDENCE = 0.9;

/** True when a heard word plausibly is the listed name: same skeleton, same first letter, similar length, and long enough to mean something. */
export function soundsLike(heard: string, entry: string): boolean {
  const a = lettersOf(heard);
  const b = lettersOf(entry);
  if (b.length < 5 || a.length < 4) return false;
  if (a[0] !== b[0]) return false;
  if (a.length / b.length > 1.6 || b.length / a.length > 1.6) return false;
  const skeleton = consonantSkeleton(b);
  return skeleton.length >= 3 && consonantSkeleton(a) === skeleton;
}

/**
 * Names made of one word are matched word by word; names of two or three words are matched against the same number of heard words in a
 * row (their letters joined), so "study point" can meet "Study Point" and "lakhanoo" can meet "Lucknow". Only the text changes: the
 * number of words, their times and confidences stay as they were, which is why a name is only applied to a heard run of the same length.
 */
function repairBySound(words: Word[], glossary: readonly string[]): Word[] {
  // Longest names first, so a listed full name ("Sitapur Road") is not shadowed by its own first word ("Sitapur").
  const entries = glossary
    .map((entry) => entry.trim().split(/\s+/).filter((piece) => piece.length > 0))
    .filter((pieces) => pieces.length > 0 && pieces.every((piece) => LATIN_WORD.test(piece)))
    .sort((a, b) => b.length - a.length);
  if (entries.length === 0) return words;
  const result = [...words];
  let changed = false;
  for (let start = 0; start < result.length; start += 1) {
    for (const pieces of entries) {
      const length = pieces.length;
      if (start + length > result.length) continue;
      const run = result.slice(start, start + length);
      const parts = run.map((word) => splitWordText(word.text));
      if (parts.some((part) => part === undefined)) continue;
      // Protect acronyms and emphasis typed in capitals, as spelling.ts does.
      if (parts.some((part) => part!.core.length > 1 && part!.core === part!.core.toUpperCase())) continue;
      const heardJoined = parts.map((part) => part!.core).join("");
      const entryJoined = pieces.join("");
      // Only the capitals differ ("study point" for "Study Point"): that is the visitor's spelling, applied whatever the model's confidence.
      // A different word that merely sounds alike is only changed when the model was unsure of it.
      const sameLetters = heardJoined.toLowerCase() === entryJoined.toLowerCase();
      if (!sameLetters && Math.min(...run.map((word) => word.confidence)) >= SOUND_MATCH_MAX_CONFIDENCE) continue;
      if (heardJoined.toLowerCase() === entryJoined.toLowerCase() && parts.every((part, i) => part!.core === pieces[i])) continue;
      // One word at a time for a one-word name; the joined letters for a longer one.
      const matches = length === 1 ? soundsLike(heardJoined, entryJoined) : soundsLike(heardJoined, entryJoined) && run.every((word, i) => lettersOf(parts[i]!.core)[0] === lettersOf(pieces[i])[0]);
      if (!matches) continue;
      for (let i = 0; i < length; i += 1) {
        const text = `${parts[i]!.leading}${pieces[i]}${parts[i]!.trailing}`;
        if (text !== result[start + i].text) {
          result[start + i] = { ...result[start + i], text };
          changed = true;
        }
      }
      break;
    }
  }
  return changed ? result : words;
}

/**
 * Repairs capitalised glossary words before `applySpelling` runs.
 *
 * spelling.ts deliberately never touches a capitalised token, because Whisper's capital
 * letters are information (sentence starts, names). That rule also protects a wrongly
 * written name at the start of a sentence: "Muma went home" would keep "Muma". A glossary
 * entry is the one case where the visitor has told us the spelling explicitly, so a
 * capitalised token that matches an entry may take the entry's casing. Lowercase tokens are
 * left to `applySpelling`, which owns the rest of the spelling rules.
 */
function repairCapitalised(words: Word[], glossary: readonly string[]): Word[] {
  const entries = glossary.filter((entry) => LATIN_WORD.test(entry));
  if (entries.length === 0) return words;

  let changed = false;
  const fixed = words.map((word) => {
    const parts = splitWordText(word.text);
    if (parts === undefined) return word;
    if (!/[A-Z]/.test(parts.core)) return word;
    // ALL-CAPS words (acronyms, emphasis) are protected, as in spelling.ts.
    if (parts.core.length > 1 && parts.core === parts.core.toUpperCase()) return word;
    const spelling = matchEntry(parts.core.toLowerCase(), entries);
    if (spelling === undefined) return word;
    const text = `${parts.leading}${spelling}${parts.trailing}`;
    if (text === word.text) return word;
    changed = true;
    return { ...word, text };
  });

  return changed ? fixed : words;
}

/**
 * Rewrites the words inside caption events to match the corrected Word list.
 *
 * Events normally hold the same Word objects that `result.words` holds, so the identity map
 * covers the common case. Copied words are still handled by falling back to the global
 * `index`. Grouping is never recalculated: line breaks belong to layout, and this pass only
 * swaps text.
 */
function rebuildEvents(events: CaptionEvent[], originalWords: Word[], fixedWords: Word[]): CaptionEvent[] {
  const textByWord = new Map<Word, string>();
  const textByIndex = new Map<number, string>();
  originalWords.forEach((word, position) => {
    const text = fixedWords[position].text;
    textByWord.set(word, text);
    if (!textByIndex.has(word.index)) textByIndex.set(word.index, text);
  });

  let changed = false;
  const rebuilt = events.map((event) => ({
    ...event,
    lines: event.lines.map((line) =>
      line.map((word) => {
        const text = textByWord.get(word) ?? textByIndex.get(word.index);
        if (text === undefined || text === word.text) return word;
        changed = true;
        return { ...word, text };
      }),
    ),
  }));

  return changed ? rebuilt : events;
}

/** Applies the glossary to caption events that are not attached to a full result yet. */
export function applyGlossaryToEvents(events: CaptionEvent[], words: Word[], glossary: readonly string[]): CaptionEvent[] {
  if (events.length === 0 || words.length === 0 || glossary.length === 0) return events;
  const prepared = repairBySound(repairCapitalised(words, glossary), glossary);
  return rebuildEvents(events, words, applySpelling(prepared, { glossary: [...glossary] }));
}

/**
 * Applies the glossary to a finished result.
 *
 * The words are corrected with `applySpelling`, which keeps every field except `text` and is
 * idempotent. The events are then rebuilt from the corrected words. If nothing actually
 * changed, the original result is returned so React state does not churn for a no-op.
 */
export function applyGlossary(result: CaptionResult, glossary: readonly string[]): CaptionResult {
  if (glossary.length === 0 || result.words.length === 0) return result;

  const prepared = repairBySound(repairCapitalised(result.words, glossary), glossary);
  const words = applySpelling(prepared, { glossary: [...glossary] });
  const wordsChanged = words.some((word, position) => word.text !== result.words[position].text);
  if (!wordsChanged) return result;

  return {
    ...result,
    words,
    events: rebuildEvents(result.events, result.words, words),
  };
}
