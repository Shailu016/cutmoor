import type { SpeechInterval, Word } from "./types";

/**
 * A hard check for the things Whisper makes up. Its confidence numbers cannot catch these, because
 * the model can be very sure of a sentence that was never said ("Thank you for watching" over
 * silence, or the same phrase looping). Each check looks at something the model cannot fake: how
 * repetitive the text is, how fast it is, where the words sit compared to where speech was heard.
 *
 * The thresholds are starting points. Whisper's own default compression-ratio limit is 2.4, and fast
 * Hinglish can pass 6 words a second, so tune them on real clips before trusting them.
 */

export interface GateInput {
  /** The transcribed words, in global time. */
  words: readonly Word[];
  /**
   * Where the voice detector heard speech, in global time. Leave it out when no detector ran: the
   * checks that need it are then skipped. An empty array means the detector ran and heard nothing,
   * so any word at all is flagged as outside speech.
   */
  speech?: readonly SpeechInterval[];
  /** The model's no-speech probability for the segment, if it gave one. */
  noSpeechProbability?: number;
}

export interface GateOptions {
  /** Flag text that compresses better than this (it repeats itself). Default 2.4. */
  maxCompressionRatio?: number;
  /** Flag fewer / more words per second of speech than this. Defaults 0.4 and 7. */
  minWordsPerSecond?: number;
  maxWordsPerSecond?: number;
  /** Flag a silence this long between words inside one stretch of speech. Default 1500 ms. */
  maxGapMs?: number;
  /** Flag a no-speech probability above this. Default 0.6 (Whisper's own default). */
  maxNoSpeechProbability?: number;
  /** Flag a word, or a short phrase, repeated this many times in a row. Default 4. */
  maxRepeats?: number;
  /** Flag when more than this share of the words sit outside any detected speech. Default 0.5. */
  maxOutsideSpeechShare?: number;
  /**
   * Words that are never a caption on their own, such as Whisper's "nan" for audio it cannot read. When every
   * word of a window is one of these, the window is flagged as junk. Empty by default, so speech is unaffected.
   */
  junkWords?: readonly string[];
}

export type GateReason = "repetitive" | "too-fast" | "too-slow" | "long-gap" | "no-speech" | "looping" | "outside-speech" | "junk-text";

export interface GateResult {
  flagged: boolean;
  reasons: GateReason[];
  metrics: {
    compressionRatio: number;
    wordsPerSecond: number;
    longestGapMs: number;
    longestRepeat: number;
    outsideSpeechShare: number;
  };
}

const DEFAULTS = {
  maxCompressionRatio: 2.4,
  minWordsPerSecond: 0.4,
  maxWordsPerSecond: 7,
  maxGapMs: 1500,
  maxNoSpeechProbability: 0.6,
  maxRepeats: 4,
  maxOutsideSpeechShare: 0.5,
  junkWords: [] as readonly string[],
} as const;

/**
 * How well the text compresses: its length divided by an estimate of its length after an LZ77-style
 * squeeze (each unmatched byte costs 1, each repeat of 3 or more bytes costs 3). Repetition makes the
 * ratio climb, like zlib's. It is an estimate, so only compare it with thresholds tuned on this function.
 */
export function compressionRatio(text: string): number {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return 1;
  const WINDOW = 4096;
  let cost = 0;
  let i = 0;
  while (i < bytes.length) {
    let bestLength = 0;
    for (let start = Math.max(0, i - WINDOW); start < i; start += 1) {
      let length = 0;
      while (i + length < bytes.length && bytes[start + length] === bytes[i + length] && length < 258) length += 1;
      if (length > bestLength) bestLength = length;
    }
    if (bestLength >= 3) {
      cost += 3;
      i += bestLength;
    } else {
      cost += 1;
      i += 1;
    }
  }
  return bytes.length / cost;
}

// Combining marks stay: dropping them would make the different Hindi words "mera" and "meri" look identical.
const normalizeWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

/** The most times any phrase of 1 to 4 words repeats back to back. */
export function longestRepeat(words: readonly string[]): number {
  const tokens = words.map(normalizeWord).filter(Boolean);
  let best = tokens.length > 0 ? 1 : 0;
  for (let size = 1; size <= 4; size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      let repeats = 1;
      while (start + (repeats + 1) * size <= tokens.length) {
        let same = true;
        for (let k = 0; k < size; k += 1) {
          if (tokens[start + k] !== tokens[start + repeats * size + k]) {
            same = false;
            break;
          }
        }
        if (!same) break;
        repeats += 1;
      }
      if (repeats > best) best = repeats;
    }
  }
  return best;
}

/** A tail shorter than this many words is a normal ending, not a decoder loop. */
const COLLAPSED_TAIL_MIN_WORDS = 3;
/** No one sings faster than this: 3 words in 150 ms, 9 in 450 ms. Any faster is an alignment collapse. */
const COLLAPSED_TAIL_MS_PER_WORD = 50;
/** The collapsed copy sits at the very end of the window (a decoder loop after the real line). */
const COLLAPSED_TAIL_WINDOW_MS = 1000;

/**
 * Music only. Whisper sometimes repeats the last line of a window, and the aligner then crushes that second copy
 * into the last few milliseconds of the window: on Sajan Sajan x Batman, nine words of "Aani vaala hai jo, vah yaad
 * aa raha hai." all landed between 29.79 s and 29.93 s of the 30 s window. That is not singing, it is a loop; the
 * words are already in the transcript once. Drops only a trailing run of 3+ words squeezed into under 50 ms each,
 * so ordinary fast singing (100 ms or more per word) is never touched. Speech mode never calls this.
 */
export function dropCollapsedTail<T extends { startMs: number; endMs: number }>(words: readonly T[], usedMs: number): T[] {
  if (words.length < COLLAPSED_TAIL_MIN_WORDS) return [...words];
  let first = words.length;
  while (first > 0 && words[first - 1].startMs >= usedMs - COLLAPSED_TAIL_WINDOW_MS) first -= 1;
  const count = words.length - first;
  if (count < COLLAPSED_TAIL_MIN_WORDS) return [...words];
  const span = words[words.length - 1].endMs - words[first].startMs;
  if (span > count * COLLAPSED_TAIL_MS_PER_WORD) return [...words];
  return words.slice(0, first);
}

export function evaluateTranscript(input: GateInput, options: GateOptions = {}): GateResult {
  const limits = { ...DEFAULTS, ...options };
  const words = [...input.words].sort((a, b) => a.startMs - b.startMs);
  const hasSpeechInfo = input.speech !== undefined;
  const speech = [...(input.speech ?? [])].filter((s) => s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs);
  const reasons: GateReason[] = [];

  const text = words.map((word) => word.text).join(" ");
  const ratio = compressionRatio(text);
  // Short strings do not compress meaningfully, so only trust the ratio once there is enough text.
  if (words.length >= 8 && ratio > limits.maxCompressionRatio) reasons.push("repetitive");

  const speechMs = speech.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  // With no speech time to divide by, the rate is undefined (reported as 0, never Infinity, so it survives JSON).
  const wordsPerSecond = speechMs > 0 ? words.length / (speechMs / 1000) : 0;
  if (speechMs > 0 && words.length > 0 && wordsPerSecond > limits.maxWordsPerSecond) reasons.push("too-fast");
  if (speechMs >= 3000 && wordsPerSecond < limits.minWordsPerSecond) reasons.push("too-slow");

  // The longest stretch with no word, counted only inside detected speech.
  let longestGap = 0;
  for (const interval of speech) {
    let cursor = interval.startMs;
    for (const word of words) {
      if (word.endMs <= interval.startMs) continue;
      if (word.startMs >= interval.endMs) break;
      longestGap = Math.max(longestGap, word.startMs - cursor);
      cursor = Math.max(cursor, word.endMs);
    }
    longestGap = Math.max(longestGap, interval.endMs - cursor);
  }
  if (hasSpeechInfo && longestGap > limits.maxGapMs) reasons.push("long-gap");

  if ((input.noSpeechProbability ?? 0) > limits.maxNoSpeechProbability) reasons.push("no-speech");

  const repeat = longestRepeat(words.map((word) => word.text));
  if (repeat >= limits.maxRepeats) reasons.push("looping");

  // A window whose whole text is a junk token ("nan") is the model admitting it heard nothing. It is not a caption.
  const junk = new Set(limits.junkWords.map(normalizeWord).filter(Boolean));
  if (junk.size > 0 && words.length > 0 && words.every((word) => junk.has(normalizeWord(word.text)))) reasons.push("junk-text");

  const outside = !hasSpeechInfo ? 0 : words.filter((word) => {
    const middle = (word.startMs + word.endMs) / 2;
    return !speech.some((s) => middle >= s.startMs && middle <= s.endMs);
  }).length;
  const outsideShare = words.length > 0 ? outside / words.length : 0;
  if (words.length > 0 && outsideShare > limits.maxOutsideSpeechShare) reasons.push("outside-speech");

  return {
    flagged: reasons.length > 0,
    reasons,
    metrics: { compressionRatio: ratio, wordsPerSecond, longestGapMs: longestGap, longestRepeat: repeat, outsideSpeechShare: outsideShare },
  };
}
