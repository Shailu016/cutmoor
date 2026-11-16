/**
 * Song-mode reading repair: trim a junk / looping window reading instead of deleting it.
 *
 * WHY THIS EXISTS
 * In song mode one bad token at the edge of a window used to erase everything else in it. The measured failure on
 * Sajan: the 59-80.85 s English read is a long `nan` loop followed by 12 real lyric words, and the 0-30 s window read
 * 41 words of which a `nan` tail was enough for the hallucination gate's `junk-text`/`repetitive` reasons to throw the
 * whole window away (`.team/auto/r2/wpP-pipeline.md` section 3, `.team/auto/r2-gemini-gap.md`). A 30 s window that
 * contains a real lyric line is worth keeping after the junk is cut off, so song mode now trims first and drops only
 * when nothing real remains.
 *
 * WHAT THIS MODULE IS
 * Pure functions only: no audio, no engine, no pipeline state, no imports from `pipeline.ts`. The caller decides when
 * to call them (song mode only) and what to do with the result (an empty `words` array still means "drop the window").
 * Speech mode must never call these: a real "na" in a conversation is not a junk token.
 */

/** Tokens Whisper writes for audio it cannot read. Song mode only. */
export const SONG_JUNK_TOKENS: readonly string[] = ["nan", "n", "nn"];

/** Longest repeated phrase (in words) a lyric loop can have. Longer patterns are lyric lines, not decode loops. */
const MAX_LOOP_PERIOD = 4;
/** A phrase must repeat this many times before it counts as a decode loop. Two is a refrain; three is a loop. */
const MIN_LOOP_REPEATS = 3;

/** Every Devanagari codepoint. The product promises Latin letters, so such a reading is not a caption. */
const DEVANAGARI = /[\u0900-\u097F]/u;
/** A Latin letter. Digits and punctuation are excluded, so "12" and "..." are not "Latin words". */
const LATIN_LETTER = /\p{Script=Latin}/u;

/** Letters/digits/combining marks only, lowercased. */
export function songWordCore(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

export function isSongJunkWord(text: string): boolean {
  const core = songWordCore(text);
  if (SONG_JUNK_TOKENS.includes(core)) return true;
  // The tokenizer sometimes joins consecutive junk tokens into one word ("nannan.", "nannannan"). Those are still the
  // model saying it heard nothing; no real word is spelled from n/nn/nan repeated. "on" is deliberately NOT junk: it
  // is a real English/Hinglish word and KING has English lyrics.
  return /^n+$/.test(core) || /^(?:nan)+$/.test(core);
}

export interface TrimmedReading {
  /** The words to keep, in order. */
  words: string[];
  /** How many words were removed (junk runs, loop copies). */
  dropped: number;
  /** True when a repeated n-gram loop was cut (not only junk tokens). */
  cutLoop: boolean;
}

/**
 * How many extra copies a trailing n-gram loop has, for period `n`. Compares on `songWordCore` so a loop whose copies
 * differ only in case or edge punctuation (", nan. nan") is still recognised. Returns 0 when there is no loop.
 */
function trailingRepeats(cores: readonly string[], n: number): number {
  if (cores.length < n * MIN_LOOP_REPEATS) return 0;
  const period = cores.slice(cores.length - n);
  let repeats = 1;
  while (cores.length >= n * (repeats + 1)) {
    const start = cores.length - n * (repeats + 1);
    for (let index = 0; index < n; index += 1) {
      if (cores[start + index] !== period[index]) return repeats;
    }
    repeats += 1;
  }
  return repeats;
}

/**
 * Number of trailing words that make up extra loop copies, or 0 when the tail is not a loop. Picks the longest
 * trailing repeat (largest number of removable words); on a tie it prefers the shortest period, because that keeps
 * the fewest copies of a phrase that is identical either way ("a a a a a a" keeps one "a", not "a a").
 */
function trailingLoopCut(words: readonly string[]): number {
  const cores = words.map(songWordCore);
  let bestRemove = 0;
  let bestPeriod = Number.POSITIVE_INFINITY;
  for (let n = 1; n <= MAX_LOOP_PERIOD; n += 1) {
    const repeats = trailingRepeats(cores, n);
    if (repeats < MIN_LOOP_REPEATS) continue;
    // DEVIATION, deliberate (review finding): the plan says a trailing run of the same token >= 3 times is cut, but a
    // real lyric refrain sings a word or phrase three times ("aaja aaja aaja", "I mean I mean I mean" in speech). So a
    // 3-repeat is cut only when the repeated phrase is made of junk tokens; a real phrase must repeat 4 times, which
    // is the measured decoder-loop shape. This keeps ordinary talking clips (detection "everything" is the default)
    // safe from the trim.
    const period = words.slice(words.length - n);
    const junkPeriod = period.every((word) => isSongJunkWord(word));
    const needed = junkPeriod ? MIN_LOOP_REPEATS : MIN_LOOP_REPEATS + 1;
    if (repeats < needed) continue;
    const remove = (repeats - 1) * n;
    if (remove > bestRemove || (remove === bestRemove && n < bestPeriod)) {
      bestRemove = remove;
      bestPeriod = n;
    }
  }
  return bestRemove;
}

/**
 * Song mode: a window reading is trimmed instead of deleted.
 *  1. Drop leading and trailing junk-token runs (nan/n/nn). Keeping the longest interior span is
 *     required because the measured 59-80.85 s English read is a nan loop followed by real lyric.
 *  2. Then cut a TRAILING repeated n-gram loop (period n=1..4, 3 or more repeats): keep ONE copy
 *     of the n-gram and drop the extra copies, repeatedly.
 *  3. Never cut a trailing identical-token run of length exactly 3 when the token is a real word
 *     (a lyric refrain "aaja aaja aaja" is real); only cut 3+ when the token is junk, or when the
 *     run is 4 or more. Document this deviation in a comment.
 *  4. An empty result means nothing real remains (the caller drops the window).
 */
export function trimSongReading(words: readonly string[]): TrimmedReading {
  const first = words.findIndex((word) => !isSongJunkWord(word));
  if (first === -1) return { words: [], dropped: words.length, cutLoop: false };
  let last = words.length - 1;
  while (last > first && isSongJunkWord(words[last])) last -= 1;
  let kept = words.slice(first, last + 1);
  let cutLoop = false;
  for (;;) {
    const cut = trailingLoopCut(kept);
    if (cut === 0) break;
    kept = kept.slice(0, kept.length - cut);
    cutLoop = true;
  }
  return { words: kept, dropped: words.length - kept.length, cutLoop };
}

export interface SongTakeScore {
  /** Words that are real Latin-script words: not junk, at least one Latin letter, no Devanagari. English counts. */
  realLatin: number;
  /** Number of junk-family words left. */
  junk: number;
  /** Words containing Devanagari. */
  devanagari: number;
  /** All words. */
  words: number;
}

export function scoreSongWords(words: readonly string[]): SongTakeScore {
  let realLatin = 0;
  let junk = 0;
  let devanagari = 0;
  for (const word of words) {
    const isJunk = isSongJunkWord(word);
    const hasDevanagari = DEVANAGARI.test(word);
    if (isJunk) junk += 1;
    if (hasDevanagari) devanagari += 1;
    if (!isJunk && !hasDevanagari && LATIN_LETTER.test(word)) realLatin += 1;
  }
  return { realLatin, junk, devanagari, words: words.length };
}

/** True when a reading carries Devanagari but no real Latin word at all (the shape the Hindi token returns). */
function isDevanagariOnly(score: SongTakeScore): boolean {
  return score.realLatin === 0 && score.devanagari > 0;
}

/**
 * Picks the better of two readings of the same window.
 * Order: more real Latin words wins (English and Hinglish are written in Latin, so English counts); then fewer junk;
 * then (if `logProbOf` given) higher mean log-prob; then a reading with 0 realLatin and Devanagari words LOSES to one
 * with Latin words (this is already implied by realLatin, keep it explicit in the comparison); a full tie keeps `a`.
 *
 * `logProbOf` must return the mean log-probability per word of the take. A non-finite value ranks last so a broken
 * take cannot win on a NaN comparison.
 */
export function pickBetterSongReading<T>(
  a: T,
  b: T,
  wordsOf: (take: T) => readonly string[],
  logProbOf?: (take: T) => number,
): T {
  const scoreA = scoreSongWords(wordsOf(a));
  const scoreB = scoreSongWords(wordsOf(b));
  if (scoreA.realLatin !== scoreB.realLatin) return scoreA.realLatin > scoreB.realLatin ? a : b;
  if (scoreA.junk !== scoreB.junk) return scoreA.junk < scoreB.junk ? a : b;
  if (logProbOf) {
    const probA = logProbOf(a);
    const probB = logProbOf(b);
    const finiteA = Number.isFinite(probA) ? probA : Number.NEGATIVE_INFINITY;
    const finiteB = Number.isFinite(probB) ? probB : Number.NEGATIVE_INFINITY;
    if (finiteA !== finiteB) return finiteA > finiteB ? a : b;
  }
  // Explicit, even though the realLatin comparison above already decides it: a Devanagari-only reading must never beat
  // one that has Latin words. Kept so the policy is readable here rather than inferred from the score.
  if (isDevanagariOnly(scoreA) !== isDevanagariOnly(scoreB)) return isDevanagariOnly(scoreA) ? b : a;
  return a;
}
