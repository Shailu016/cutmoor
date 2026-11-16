import type { WindowAudio, WindowTranscript, WordAligner } from "../contracts";
import { CaptionError } from "../contracts";
import type { Word } from "../types";

/**
 * A word aligner that needs no model: it spreads each window's words over the window's speech in
 * proportion to their length in characters, and reports confidence 0.5.
 *
 * LIMITS, plainly: it knows nothing about the audio beyond where speech regions sit. Real words
 * are not proportional to their spelling (a long pause inside a region, a fast "hai" next to a slow
 * "zindagi"), so individual words can be off by several hundred milliseconds, and karaoke highlight
 * will visibly drift inside a long region. Region edges are right, because the voice detector
 * placed them; the sentence-level timing is therefore usable for plain SRT/VTT. It is the quality
 * floor, the fallback when a real aligner fails, and the stand-in used by tests.
 *
 * A word is never split across two regions: it is first assigned to the region its midpoint
 * falls in (counting only speech time, so the inserted silence takes no share), then the words of
 * each region are spread over that region alone.
 */
export const UNIFORM_CONFIDENCE = 0.5;

const weightOf = (text: string) => Math.max(1, Array.from(text).length);

export function uniformAlign(input: WindowAudio, transcript: WindowTranscript): Word[] {
  const { window } = input;
  const texts = transcript.words;
  if (texts.length === 0) return [];

  // Without regions there is nothing to anchor to: spread over whatever the window says it used (never more, so no word
  // ends past `usedMs`; with 0 ms used the words are zero-length at 0, which is honest: there is no audio to place them in).
  const regions =
    window.regions.length > 0
      ? window.regions.map((region) => ({ start: region.packOffsetMs, length: region.sourceEndMs - region.sourceStartMs }))
      : [{ start: 0, length: Math.max(0, window.usedMs) }];
  const speechMs = regions.reduce((sum, region) => sum + region.length, 0);

  // The model's own sureness per word when it gave one; otherwise the flat "timing is a guess" value.
  const given = transcript.wordConfidence;
  const confidenceOf = (i: number) => (given && given.length === texts.length && Number.isFinite(given[i]) ? given[i] : UNIFORM_CONFIDENCE);

  const weights = texts.map(weightOf);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const bounds: number[] = [];
  let edge = 0;
  for (const region of regions) {
    edge += region.length;
    bounds.push(edge);
  }

  // Assign each word to the region holding the middle of its share of the speech time.
  const assigned: number[][] = regions.map(() => []);
  let cumulative = 0;
  texts.forEach((_, i) => {
    const middle = ((cumulative + weights[i] / 2) / totalWeight) * speechMs;
    cumulative += weights[i];
    let r = bounds.findIndex((bound) => middle < bound);
    if (r < 0) r = regions.length - 1;
    assigned[r].push(i);
  });

  const words = new Array<Word>(texts.length);
  regions.forEach((region, r) => {
    const members = assigned[r];
    if (members.length === 0) return;
    const regionWeight = members.reduce((sum, i) => sum + weights[i], 0);
    const regionEnd = region.start + region.length;
    let before = 0;
    let previousEnd = region.start;
    members.forEach((i, position) => {
      before += weights[i];
      const isLast = position === members.length - 1;
      // Round the running total, not each word, so rounding never piles up; the last word ends exactly at the region end.
      let end = isLast ? regionEnd : region.start + Math.round((before / regionWeight) * region.length);
      end = Math.min(regionEnd, Math.max(end, previousEnd));
      words[i] = { text: texts[i], startMs: previousEnd, endMs: end, confidence: confidenceOf(i), index: i, windowIndex: window.index };
      previousEnd = end;
    });
  });
  return words;
}

export function createUniformAligner(): WordAligner {
  return {
    id: "uniform",
    async load() {
      /* nothing to download or start */
    },
    async align(input, transcript, signal) {
      if (signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.");
      return uniformAlign(input, transcript);
    },
    async release() {
      /* nothing held */
    },
  };
}
