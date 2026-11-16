/**
 * "Have the lyrics or the script? Paste them." — the pure half of sliding forced alignment.
 *
 * WHAT THIS FILE IS
 * No audio, no engine, no pipeline state, no I/O. Everything here is a pure function over strings and
 * numbers so it can be unit-tested without a model, and so the pipeline can guard every call cheaply:
 *
 *   parseLyrics            pasted text -> lines + words (display form) + aligner form
 *   planLyricChunk         how many unplaced words to hand the aligner for one window
 *   acceptAlignedWords     which of the aligner's words are safe to place in this window, and where the
 *                          cursor moves to
 *   findAnchors            sound-alike anchors between the pasted words and the words the model heard
 *   reconcileWithAnchors   re-find the place after a confidence collapse, an instrumental gap, a repeat
 *
 * WHY A CURSOR
 * The aligner is teacher-forced: it is given KNOWN text and, in one pass, says where each word sits inside
 * a 30 s window. It cannot know where that window starts in the lyric. So the pipeline keeps a cursor
 * (the next unplaced word) and walks the windows in order. A window is given about the number of words it
 * can hold (1.0x), because the engine's 400-character limit means a 1.5x "headroom" chunk cannot be
 * delivered anyway: the extra words were silently cut off, and the words that WERE sent were DTW-spread
 * across the whole window, which distorted their timing (REVIEW-1 finding 2, measured on B5). When a window
 * still has room after its first chunk, the pipeline simply calls the aligner a second time on the same
 * audio with the next chunk (the engine reuses the encoder, so it is a decoder-only pass). Words the
 * aligner puts too late in the window are left for the next window: that is what "sliding" means here.
 *
 * CONFIDENCE
 * `ForcedAlignWord` carries two numbers: the mean log-probability of the word's tokens under the
 * teacher-forced pass (<= 0) and the sharpness (0..1) of its character attention. Mapping (documented in
 * `forcedWordConfidence`):
 *
 *     quality    = clamp01((logProbability + 1.6) / 1.6)   // -1.6 or worse -> 0, 0 -> 1
 *     confidence = clamp01(0.6 * quality + 0.4 * clamp01(sharpness))
 *
 * 0.6 log-probability weight because a word the model could not predict is not trustworthy even when its
 * attention is peaked, and 0.4 attention because a diffuse attention row means the timing is a guess.
 * Below `DEFAULT_UNCERTAIN_CONFIDENCE` (0.6, the editor's own "uncertain" line) the word is still placed
 * but marked uncertain. The editor already renders low-confidence words differently, so no new UI rule.
 *
 * ALIGNER TEXT VS DISPLAY TEXT
 * The visitor's spelling is what a caption must show, so `words` keeps it verbatim (only whitespace is
 * normalised, and a token with no letter or digit is not a word). Whisper's tokenizer does handle the
 * punctuation captions want, but a leading bracket or a quote immediately after a space tokenizes into
 * its own piece and shifts the teacher-forced timing, so `alignerWords` strips everything except letters,
 * digits, combining marks, apostrophes and hyphens (an internal apostrophe or hyphen belongs to the word:
 * "don't", "long-distance"). The two arrays are always the same length, so a placed word maps back to the
 * spelling the visitor typed.
 *
 * LIMITS
 * 4000 words / 20 000 characters from one paste. Anchors are bounded to 600x600 words (an O(n*m) DP of
 * ~360k cells, a few tens of milliseconds), because a pasted script can be longer than any real audio and
 * the DP must never dominate the job.
 */
import type { ForcedAlignWord } from "../contracts";
import { soundsLike } from "../../../components/captions/glossary";

// ---------------------------------------------------------------- limits

/** Most words one paste may contribute. Past this the rest is dropped and `truncated` is true. */
export const LYRIC_MAX_WORDS = 4000;
/** Most characters one paste may contribute, counting the single space between words. */
export const LYRIC_MAX_CHARS = 20_000;
/** The engine contract limits one `alignText` call to 400 characters. */
export const MAX_ALIGN_TEXT_CHARS = 400;
/** Song lyrics are slower than speech, so fewer words fit in one 30 s window. */
export const DEFAULT_SONG_WORDS_PER_SECOND = 2.5;
/** A spoken script: about three words a second. */
export const DEFAULT_SPEECH_WORDS_PER_SECOND = 3.0;
/** How many words a window is offered, as a multiple of what it can hold. 1.0: see the file header and `planLyricChunk`. */
export const CHUNK_HEADROOM = 1;
/** Even a 1 s window gets a real chunk: eight words is the smallest useful teacher-forced run. */
const MIN_CHUNK_WORDS = 8;
/** Words whose aligned end is this close to the window end are left for the next window. */
export const DEFAULT_END_GUARD_MS = 1500;
/**
 * The guard that still applies at the very end of a file, and to the window whose chunk reaches the end of the
 * paste: only the aligner's own rounding is held back, so the last words of a file can be placed.
 */
export const END_OF_AUDIO_GUARD_MS = 60;
/** A window whose source span ends this close to the file's end is the final window (same tolerance as the guard). */
export const END_OF_FILE_EPSILON_MS = 60;
/** Below this confidence a placed word is marked uncertain (the editor's own uncertain line). */
export const DEFAULT_UNCERTAIN_CONFIDENCE = 0.6;
/** More consecutive uncertain words than this means the sliding aligner lost the place. */
export const CONFIDENCE_COLLAPSE_WORDS = 6;
/** Anchors use at most this many words from each side (O(n*m) is bounded by 600x600). */
export const ANCHOR_MAX_WORDS = 600;
/** A match only counts as an anchor when it is part of a run this long. */
const ANCHOR_MIN_RUN = 2;

// ---------------------------------------------------------------- text

/** A character that makes a token a word rather than decoration. */
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
/** Everything the aligner's plain-word text may not contain. */
const NOT_IN_ALIGNER_WORD = /[^\p{L}\p{N}\p{M}'\u2019-]+/gu;
/** Leading/trailing apostrophes and hyphens are decoration, not part of a word. */
const EDGE_APOSTROPHE_HYPHEN = /^['\u2019-]+|['\u2019-]+$/g;
/** A line break as pasted from any common editor or notes app. */
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;

/** A word core: letters, digits and combining marks only, lowercased. Punctuation never reaches a comparison. */
export function lyricWordCore(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

/**
 * The form of one word that is sent to the aligner: punctuation stripped, apostrophes and hyphens kept
 * inside the word. Returns "" when nothing word-like is left (a token such as "..." or an emoji).
 */
export function alignerWord(text: string): string {
  return text.replace(NOT_IN_ALIGNER_WORD, "").replace(EDGE_APOSTROPHE_HYPHEN, "");
}

/** One pasted line. A pasted line break is a PREFERRED caption break, never a hard one. */
export interface LyricLine {
  /** The line as the visitor typed it, internal whitespace normalised to single spaces. */
  text: string;
  /** The display words of this line that survived the limits, in order. */
  words: string[];
  /** Index of this line's first word in `ParsedLyrics.words`. */
  firstWord: number;
}

export interface ParsedLyrics {
  /** Non-empty lines, in order. */
  lines: LyricLine[];
  /** Every word in reading order, in the visitor's spelling (no normaliser is applied to these). */
  words: string[];
  /** Aligner form of `words`, always the same length. */
  alignerWords: string[];
  /** Index of the line each word belongs to, always the same length as `words`. */
  lineOfWord: number[];
  /** True when the paste was cut at `LYRIC_MAX_WORDS` or `LYRIC_MAX_CHARS`. */
  truncated: boolean;
}

/**
 * Splits pasted lyrics or a script into display lines and words.
 *
 * Rules:
 *  - A line break is a preferred caption break; blank lines are ignored (they never create a line).
 *  - Internal whitespace is collapsed, leading/trailing whitespace is trimmed. Tabs count as space.
 *  - A token with no letter or digit ("...", "--", an emoji) is not a word and is dropped from both arrays.
 *  - The display word is exactly what the visitor typed; `alignerWords[i]` is the punctuation-stripped form.
 *  - 4000 words / 20 000 characters, whichever comes first; the rest is dropped and `truncated` is true.
 */
export function parseLyrics(text: string): ParsedLyrics {
  const lines: LyricLine[] = [];
  const words: string[] = [];
  const alignerWords: string[] = [];
  const lineOfWord: number[] = [];
  let truncated = false;
  if (typeof text !== "string" || text.length === 0) return { lines, words, alignerWords, lineOfWord, truncated };

  // A multi-megabyte paste costs nothing more than the cap allows: the tail is never read.
  const bounded = text.length > LYRIC_MAX_CHARS * 2 ? text.slice(0, LYRIC_MAX_CHARS * 2) : text;
  if (bounded.length < text.length) truncated = true;

  let chars = 0;
  outer: for (const rawLine of bounded.split(LINE_BREAK)) {
    if (words.length >= LYRIC_MAX_WORDS || chars >= LYRIC_MAX_CHARS) {
      truncated = true;
      break;
    }
    const lineText = rawLine.replace(/\s+/g, " ").trim();
    if (lineText.length === 0) continue;
    const tokens = lineText.split(" ").filter((token) => HAS_WORD_CHAR.test(token));
    if (tokens.length === 0) continue;

    const firstWord = words.length;
    const added: string[] = [];
    for (const token of tokens) {
      if (words.length >= LYRIC_MAX_WORDS) {
        truncated = true;
        break outer;
      }
      const aligned = alignerWord(token);
      if (aligned.length === 0) continue;
      const nextChars = chars + (words.length > 0 ? 1 : 0) + token.length;
      if (nextChars > LYRIC_MAX_CHARS) {
        truncated = true;
        break outer;
      }
      chars = nextChars;
      words.push(token);
      alignerWords.push(aligned);
      // `lines.length` is this line's index: the line is pushed after its words.
      lineOfWord.push(lines.length);
      added.push(token);
    }
    if (added.length > 0) lines.push({ text: lineText, words: added, firstWord });
  }
  return { lines, words, alignerWords, lineOfWord, truncated };
}

// ---------------------------------------------------------------- chunk planning

export interface LyricChunk {
  /** First word index in the chunk (the cursor). */
  from: number;
  /** One past the last word index; equals `from` for an empty chunk. */
  to: number;
  /** The words joined with single spaces, never longer than `MAX_ALIGN_TEXT_CHARS`. */
  text: string;
  /** `to - from`. */
  count: number;
}

/**
 * How many unplaced words one window is offered in one `alignText` call.
 *
 * The estimate is `windowMs / 1000 * rate` words (2.5/s for songs, 3.0/s for speech), times `headroom`
 * (1.0 by default), at least `MIN_CHUNK_WORDS` words, and capped by the engine's 400-character limit. The
 * headroom used to be 1.5 so a window could not run out of text, but a 1.5x chunk of a 30 s speech window
 * is ~113 words (~750 characters): the 400-character cap cut the tail off, so the extra words never
 * arrived, and the DTW spread the words that did arrive across the whole window (REVIEW-1 finding 2). At
 * 1.0x the chunk is about what the window can hold; anything left over is read by a second call on the
 * same window (see `alignLyrics` in pipeline.ts). A single word longer than 400 characters is sent alone
 * and cut to 400: a chunk that is empty would waste the decoder pass.
 */
export function planLyricChunk(
  words: readonly string[],
  cursor: number,
  windowMs: number,
  rate: number = DEFAULT_SONG_WORDS_PER_SECOND,
  headroom: number = CHUNK_HEADROOM,
): LyricChunk {
  const start = Number.isFinite(cursor) ? Math.floor(cursor) : 0;
  const from = Math.min(Math.max(0, start), words.length);
  if (from >= words.length) return { from, to: from, text: "", count: 0 };

  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SONG_WORDS_PER_SECOND;
  const safeHeadroom = Number.isFinite(headroom) && headroom > 0 ? headroom : CHUNK_HEADROOM;
  const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 0;
  const estimate = (window / 1000) * safeRate;
  const target = Math.max(MIN_CHUNK_WORDS, Math.ceil(estimate * safeHeadroom));

  let to = from;
  let text = "";
  while (to < words.length && to - from < target) {
    const word = words[to] ?? "";
    const next = text.length === 0 ? word : `${text} ${word}`;
    if (text.length > 0 && next.length > MAX_ALIGN_TEXT_CHARS) break;
    text = next.slice(0, MAX_ALIGN_TEXT_CHARS);
    to += 1;
    if (text.length >= MAX_ALIGN_TEXT_CHARS) break;
  }
  return { from, to, text, count: to - from };
}

// ---------------------------------------------------------------- acceptance

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

/**
 * The end guard for one window that still has a next chunk to protect: 1 500 ms, but never more than a quarter of a
 * short window (waiting out 1 500 ms of a 4 s window would protect a next chunk that can only be 2.5 s away).
 *
 * When there is NO next chunk — the final audio window of the file, or the window whose chunk reaches the end of the
 * pasted text — the guard is not applied at all: `acceptAlignedWords` takes `endOfAudio` instead, because the last
 * words of a recording live in its final 1 500 ms. (Measured on B5: 2 of 26 tts-words words, "your" and "file", were
 * dropped by the guard on the last window.)
 */
export function lyricEndGuardMs(windowMs: number): number {
  const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 0;
  return Math.min(DEFAULT_END_GUARD_MS, Math.round(window * 0.25));
}
/**
 * Confidence of one teacher-forced word, 0..1. See the file header for the mapping and the reasoning.
 * A missing or non-finite log-probability is treated as "no evidence" (0), and sharpness is clamped.
 */
export function forcedWordConfidence(logProbability: number, sharpness: number): number {
  const logProb = Number.isFinite(logProbability) ? logProbability : -10;
  const quality = clamp01((logProb + 1.6) / 1.6);
  return clamp01(0.6 * quality + 0.4 * clamp01(sharpness));
}

export interface AcceptedLyricWord {
  /** Index of this word in the whole lyric word list (`wordIndexOffset` + its position in the chunk). */
  wordIndex: number;
  /** The visitor's spelling (from `spellings` when given, else the aligner's echo). */
  text: string;
  /** Window-local ms, clamped to the window's start. */
  startMs: number;
  endMs: number;
  /** `forcedWordConfidence` of this word. */
  confidence: number;
  /** True when the evidence was weak; the word is still placed, so the editor can show it as a guess. */
  uncertain: boolean;
  logProbability: number;
  sharpness: number;
}

export interface LyricAcceptance {
  words: AcceptedLyricWord[];
  /** How far the cursor advances: the number of words accepted, so a rejected word is retried next window. */
  advance: number;
  /** How many of `words` are uncertain. */
  uncertain: number;
  /** Why acceptance stopped: the window's safe end, the end of the list, or an empty/bad result. */
  stoppedBy: "end" | "exhausted" | "empty";
}

export interface AcceptAlignedOptions {
  /** Display form for each aligned word. Defaults to the aligner's own `text`. */
  spellings?: readonly string[];
  /** Index of `aligned[0]` in the whole lyric word list. Defaults to 0. */
  wordIndexOffset?: number;
  /** Words whose aligned end is at or past `windowEndMs - endGuardMs` are left for the next window. */
  endGuardMs?: number;
  /**
   * True for a window that holds the end of the audio or the end of the pasted text: there is no next chunk to
   * protect, so a word may end at `windowEndMs` (up to `END_OF_AUDIO_GUARD_MS` past it; the character aligner clamps
   * its last word's end to the window end). The end guard is then not applied.
   */
  endOfAudio?: boolean;
  /** Below this confidence a placed word is marked uncertain. */
  uncertainConfidence?: number;
  /** Most words to consider (normally the planned chunk length). */
  maxWords?: number;
}

/**
 * Decides which of one window's aligned words are safe to place.
 *
 * Rules, in order:
 *  - Only the first `maxWords` entries are considered (the planner's chunk).
 *  - A word with non-finite or impossible times, or whose aligned end is not strictly BEFORE
 *    `windowEndMs - endGuardMs`, stops the acceptance: the next window starts at this word instead.
 *  - A word starting before `windowStartMs` is clamped to it (an aligner can lead the speech a little).
 *  - Confidence never stops acceptance; a low-confidence word is placed and marked `uncertain`. The
 *    caller watches the run of uncertain words to decide that the aligner lost the place.
 */
export function acceptAlignedWords(
  aligned: readonly ForcedAlignWord[],
  windowStartMs: number,
  windowEndMs: number,
  options: AcceptAlignedOptions = {},
): LyricAcceptance {
  const empty: LyricAcceptance = { words: [], advance: 0, uncertain: 0, stoppedBy: "empty" };
  if (aligned.length === 0) return empty;

  const limit = Math.min(aligned.length, Math.max(0, options.maxWords ?? aligned.length));
  if (limit === 0) return empty;
  const guard = Math.max(0, options.endGuardMs ?? DEFAULT_END_GUARD_MS);
  const safeEnd = windowEndMs - guard;
  const uncertainBelow = options.uncertainConfidence ?? DEFAULT_UNCERTAIN_CONFIDENCE;
  const offset = Math.max(0, Math.floor(options.wordIndexOffset ?? 0));
  const start = Number.isFinite(windowStartMs) ? windowStartMs : 0;

  const words: AcceptedLyricWord[] = [];
  let uncertain = 0;
  let stoppedBy: LyricAcceptance["stoppedBy"] = "exhausted";
  const endOfAudio = options.endOfAudio === true;
  for (let i = 0; i < limit; i += 1) {
    const word = aligned[i];
    const startMs = Number.isFinite(word.startMs) ? word.startMs : Number.NaN;
    const endMs = Number.isFinite(word.endMs) ? word.endMs : Number.NaN;
    // At the end of the audio (or of the paste) only a word that runs PAST the window is refused: the last word of
    // a teacher-forced pass ends exactly at the window end and is a real word of the file.
    const late = endOfAudio ? endMs > windowEndMs + END_OF_AUDIO_GUARD_MS : endMs >= safeEnd;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || late) {
      stoppedBy = "end";
      break;
    }
    const confidence = forcedWordConfidence(word.logProbability, word.sharpness);
    const isUncertain = confidence < uncertainBelow;
    words.push({
      wordIndex: offset + i,
      text: options.spellings?.[i] ?? word.text,
      startMs: Math.max(start, startMs),
      endMs,
      confidence,
      uncertain: isUncertain,
      logProbability: word.logProbability,
      sharpness: word.sharpness,
    });
    if (isUncertain) uncertain += 1;
  }
  return { words, advance: words.length, uncertain, stoppedBy };
}

// ---------------------------------------------------------------- anchors

export interface LyricAnchor {
  /** Index in the lyric word list. */
  lyricIndex: number;
  /** Index in the heard word list findAnchors was given. */
  heardIndex: number;
}

export interface Anchors {
  /** Every matched pair that belongs to a run of two or more adjacent matches, in reading order. */
  anchors: LyricAnchor[];
  /** The runs themselves, so a caller can tell one repeated line from three anchors. */
  runs: LyricAnchor[][];
  /** True when one of the inputs was cut to the word limit. */
  trimmed: boolean;
}

/** True when two words are the same word for anchoring purposes: same core, or close enough by sound. */
export function sameWord(a: string, b: string): boolean {
  const left = lyricWordCore(a);
  const right = lyricWordCore(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;
  return soundsLike(left, right);
}

/**
 * Global monotonic DP over the pasted words and the words the model actually heard, keeping only runs of
 * two or more adjacent matches. The DP maximises (matches + a bonus for continuing an adjacent run), so
 * two consecutive matches beat two isolated ones; a single sound-alike word is never an anchor.
 *
 * Both lists are trimmed to `ANCHOR_MAX_WORDS` (600), which bounds the DP at 601*601 cells. The returned
 * indices always refer to the arrays as given, so trimming only ever loses anchors at the tail.
 *
 * Used for: re-finding the place after a confidence collapse, skipping an instrumental gap (no anchor in
 * this window, the next anchor is later), and spotting a repeated line.
 */
export function findAnchors(
  lyricWords: readonly string[],
  heardWords: readonly string[],
  options: { maxWords?: number; minRun?: number } = {},
): Anchors {
  const max = Math.max(2, Math.floor(options.maxWords ?? ANCHOR_MAX_WORDS));
  // 2 by default: an isolated sound-alike is a coincidence, not an anchor. A caller that only uses
  // exact matches (the global lyric planner) may ask for 1 to get every monotonic match, then filter.
  const minRun = Math.max(1, Math.floor(options.minRun ?? ANCHOR_MIN_RUN));
  const n = Math.min(lyricWords.length, max);
  const m = Math.min(heardWords.length, max);
  const trimmed = lyricWords.length > n || heardWords.length > m;
  if (n === 0 || m === 0) return { anchors: [], runs: [], trimmed };

  const lyricCores = lyricWords.slice(0, n).map(lyricWordCore);
  const heardCores = heardWords.slice(0, m).map(lyricWordCore);
  const width = m + 1;
  /** Best score reaching a cell. Float32 is enough: 600 words x 2.5 points. */
  const score = new Float32Array((n + 1) * width);
  /** 1 = skip a lyric word, 2 = skip a heard word, 3 = a match (diagonal). */
  const dir = new Uint8Array((n + 1) * width);
  const endsWithMatch = new Uint8Array((n + 1) * width);
  const MATCH = 1;
  const RUN_BONUS = 1.5;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const up = (i - 1) * width + j;
      const left = i * width + (j - 1);
      const here = i * width + j;
      let best = score[up];
      let direction = 1;
      let matched = endsWithMatch[up];
      if (score[left] > best) {
        best = score[left];
        direction = 2;
        matched = endsWithMatch[left];
      }
      if (matchCore(lyricCores[i - 1], heardCores[j - 1])) {
        const diagonal = score[up - 1] + MATCH + (endsWithMatch[up - 1] !== 0 ? RUN_BONUS : 0);
        // On a tie the match wins, which is what turns isolated coincidences into a run when one exists.
        if (diagonal >= best) {
          best = diagonal;
          direction = 3;
          matched = 1;
        }
      }
      score[here] = best;
      dir[here] = direction;
      endsWithMatch[here] = matched;
    }
  }

  const pairs: LyricAnchor[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const direction = dir[i * width + j];
    if (direction === 3) {
      pairs.push({ lyricIndex: i - 1, heardIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (direction === 1) {
      i -= 1;
    } else if (direction === 2) {
      j -= 1;
    } else {
      break;
    }
  }
  pairs.reverse();

  const runs: LyricAnchor[][] = [];
  let run: LyricAnchor[] = [];
  for (const pair of pairs) {
    const previous = run[run.length - 1];
    const adjacent =
      previous !== undefined && pair.lyricIndex === previous.lyricIndex + 1 && pair.heardIndex === previous.heardIndex + 1;
    if (adjacent) run.push(pair);
    else {
      if (run.length >= minRun) runs.push(run);
      run = [pair];
    }
  }
  if (run.length >= minRun) runs.push(run);
  return { anchors: runs.flat(), runs, trimmed };
}

/** A match for anchoring: same core, or a sound-alike of the pasted (longer) word. */
function matchCore(lyricCore: string, heardCore: string): boolean {
  if (lyricCore.length === 0 || heardCore.length === 0) return false;
  if (lyricCore === heardCore) return true;
  return soundsLike(heardCore, lyricCore);
}

// ---------------------------------------------------------------- reconciliation

export interface ReconcileInput {
  /** The next unplaced lyric word according to the sliding pass. */
  cursor: number;
  /** Lyric word indices already placed. A word is never placed twice. */
  placed: readonly number[];
  /** Anchors from `findAnchors`, in reading order. */
  anchors: readonly LyricAnchor[];
  /** Global start of the window about to be aligned. */
  windowStartMs: number;
  /** Global end of the window about to be aligned. */
  windowEndMs: number;
  /**
   * Global middle time of every heard word, indexed like the heard list `findAnchors` saw. Without it
   * every anchor counts as support, which is only useful for tests.
   */
  heardTimes?: readonly number[];
  /** Largest forward jump allowed in one step, so wrong lyrics cannot throw the cursor to the end. */
  maxJumpWords?: number;
}

export interface ReconcileResult {
  /** The cursor to use for this window: never a word already placed, never behind the first unplaced word. */
  cursor: number;
  /** Anchors whose heard word falls inside this window (or all anchors when no times were given). */
  support: LyricAnchor[];
  /** Lyric word indices the jump skipped over: they have no audio support and are not forced in. */
  skipped: number[];
  /** True when the cursor moved. */
  jumped: boolean;
}

const DEFAULT_MAX_JUMP_WORDS = 400;

/**
 * Pulls the sliding cursor back onto the anchor sequence.
 *
 *  - A word already placed is never the cursor (it would be placed twice).
 *  - If this window holds anchor support, the cursor goes to the earliest supported word, so a collapse
 *    of confidence cannot leave the aligner reading a phrase that the heard words prove is elsewhere.
 *  - If this window holds no support and the next anchor is LATER than this window, the words before it
 *    belong to an instrumental gap: they are skipped (not placed, reported as unmatched) and the cursor
 *    moves to the anchor.
 *  - A jump larger than `maxJumpWords` is refused: the anchors are then not about this stretch of audio.
 */
export function reconcileWithAnchors(input: ReconcileInput): ReconcileResult {
  const placed = new Set(input.placed);
  const advancePastPlaced = (value: number): number => {
    let next = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    // Finite by construction: `placed` holds a finite number of indices.
    while (placed.has(next)) next += 1;
    return next;
  };
  const cursor = advancePastPlaced(input.cursor);
  const ahead = input.anchors.filter((anchor) => anchor.lyricIndex >= cursor);
  const times = input.heardTimes;
  const inWindow = (anchor: LyricAnchor): boolean => {
    if (times === undefined) return true;
    const at = times[anchor.heardIndex];
    return typeof at === "number" && at >= input.windowStartMs && at < input.windowEndMs;
  };
  const support = ahead.filter(inWindow);
  let target: number | null = null;
  if (support.length > 0) {
    target = Math.min(...support.map((anchor) => anchor.lyricIndex));
  } else if (times !== undefined) {
    const later = ahead.find((anchor) => {
      const at = times[anchor.heardIndex];
      return typeof at === "number" && at >= input.windowEndMs;
    });
    if (later !== undefined) target = later.lyricIndex;
  }
  if (target === null || target <= cursor) return { cursor, support, skipped: [], jumped: false };
  if (target - cursor > Math.max(1, Math.floor(input.maxJumpWords ?? DEFAULT_MAX_JUMP_WORDS))) {
    return { cursor, support, skipped: [], jumped: false };
  }
  const skipped: number[] = [];
  for (let index = cursor; index < target; index += 1) if (!placed.has(index)) skipped.push(index);
  const moved = advancePastPlaced(target);
  return { cursor: moved, support, skipped, jumped: moved !== cursor };
}

// ---------------------------------------------------------------- reporting

/** Longest unmatched line shown in the panel, so one long script line cannot break the layout. */
export const UNMATCHED_LINE_MAX_CHARS = 90;
/** How many unmatched lines the panel is given. */
export const UNMATCHED_LINES_MAX = 8;

/**
 * Lines of the pasted text with no placed word, in the visitor's spelling, for the panel's "these lines
 * were not found in the audio". Bounded: at most `UNMATCHED_LINES_MAX` lines, each at most
 * `UNMATCHED_LINE_MAX_CHARS` characters (longer ones are cut and end in an ellipsis).
 */
export function unmatchedLyricLines(parsed: ParsedLyrics, placed: ReadonlySet<number>): string[] {
  const out: string[] = [];
  for (const line of parsed.lines) {
    if (out.length >= UNMATCHED_LINES_MAX) break;
    const supported = line.words.some((_word, offset) => placed.has(line.firstWord + offset));
    if (supported) continue;
    out.push(line.text.length > UNMATCHED_LINE_MAX_CHARS ? `${line.text.slice(0, UNMATCHED_LINE_MAX_CHARS - 1)}…` : line.text);
  }
  return out;
}
