import type { VideoCodec } from "mediabunny";

/**
 * Decides the output size and codec before any frame is touched, so an unsupported setup fails fast
 * with a clear message instead of halfway through a long encode. Pure: the browser question
 * ("can this encoder do this size?") is passed in, so tests can answer it.
 */

/** MP4 holds all three. H.264 first because every phone and player decodes it. */
export const CODEC_PREFERENCE: readonly VideoCodec[] = ["avc", "vp9", "av1"];

/** If the full size cannot be encoded we try these long-side caps in order. */
export const FALLBACK_LONG_SIDES: readonly number[] = [1920, 1280];

export interface OutputPlan {
  width: number;
  height: number;
  codec: VideoCodec;
  /** True when the output is smaller than the source because the encoder could not do the full size. */
  scaledDown: boolean;
}

/** H.264 and friends need even dimensions. Rounds to the nearest even number, never below 2. */
export function evenSize(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

/** Fits (width, height) inside a long-side cap keeping the aspect ratio; unchanged if already inside. */
export function capLongSide(width: number, height: number, cap: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= cap) return { width, height };
  const scale = cap / long;
  return { width: width * scale, height: height * scale };
}

export type CanEncode = (codec: VideoCodec, width: number, height: number) => Promise<boolean>;

/**
 * Tries the source size first, then smaller caps; within a size, codecs in preference order.
 * Returns null when nothing works.
 */
export async function planOutput(displayWidth: number, displayHeight: number, canEncode: CanEncode): Promise<OutputPlan | null> {
  const candidates: { width: number; height: number; scaledDown: boolean }[] = [];
  const push = (w: number, h: number, scaledDown: boolean) => {
    const width = evenSize(w);
    const height = evenSize(h);
    if (!candidates.some((c) => c.width === width && c.height === height)) candidates.push({ width, height, scaledDown });
  };
  push(displayWidth, displayHeight, false);
  for (const cap of FALLBACK_LONG_SIDES) {
    const capped = capLongSide(displayWidth, displayHeight, cap);
    if (Math.max(capped.width, capped.height) < Math.max(displayWidth, displayHeight)) push(capped.width, capped.height, true);
  }
  for (const size of candidates) {
    for (const codec of CODEC_PREFERENCE) {
      if (await canEncode(codec, size.width, size.height)) {
        return { width: size.width, height: size.height, codec, scaledDown: size.scaledDown };
      }
    }
  }
  return null;
}
