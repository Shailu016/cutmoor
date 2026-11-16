import type { WindowAudio, WindowTranscript, WordAligner } from "../contracts";
import type { Word } from "../types";
import { uniformAlign } from "./uniform-aligner";

/**
 * Word timing from the speech model's own attention, with even spacing as the fallback.
 *
 * The engine attaches `wordTimes` to a transcript when the model can say where it heard each word
 * (see engine/attention.ts). This aligner uses them after checking they are sane; anything doubtful
 * falls back to the even spacing of uniform-aligner.ts for that window, so a bad attention map can make timing
 * less exact but never breaks a job.
 */

/** A single word longer than this is a timing mistake (attention drifting into silence), not speech. */
const LONGEST_WORD_MS = 2000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Returns the model's word times as Words, or null when they cannot be used. Exported for tests. */
export function wordsFromModelTimes(input: WindowAudio, transcript: WindowTranscript): Word[] | null {
  const times = transcript.wordTimes;
  const texts = transcript.words;
  if (!times || times.length !== texts.length || texts.length === 0) return null;
  const usedMs = Math.max(0, input.window.usedMs);
  let previousStart = -1;
  for (const time of times) {
    if (!Number.isFinite(time.startMs) || !Number.isFinite(time.endMs)) return null;
    if (time.startMs < 0 || time.endMs <= time.startMs || time.startMs < previousStart || time.startMs >= usedMs || time.endMs > usedMs + 1) return null;
    previousStart = time.startMs;
  }
  // Attention sometimes holds a word until the next one starts, across a pause. Cap such a word at a length real words have:
  // twice the usual word here, and never more than two seconds.
  const usual = median(times.map((time) => time.endMs - time.startMs));
  const cap = Math.min(LONGEST_WORD_MS, Math.max(700, Math.round(usual * 2)));
  const fallback = transcript.wordConfidence;
  return texts.map((text, index) => {
    const startMs = Math.round(times[index].startMs);
    const endMs = Math.min(Math.round(times[index].endMs), startMs + cap, usedMs);
    const confidence = fallback && fallback.length === texts.length && Number.isFinite(fallback[index]) ? fallback[index] : 0.5;
    return { text, startMs, endMs: Math.max(endMs, startMs + 1), confidence, index, windowIndex: input.window.index };
  });
}

export function createAttentionAligner(): WordAligner {
  return {
    id: "whisper-attention",
    async load() {},
    async align(input, transcript) {
      return wordsFromModelTimes(input, transcript) ?? uniformAlign(input, transcript);
    },
    async release() {},
  };
}
