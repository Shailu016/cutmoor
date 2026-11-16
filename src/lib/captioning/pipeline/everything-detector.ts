import type { PcmChunk, VoiceDetector } from "../contracts";
import type { SpeechInterval } from "../types";
import { SAMPLE_RATE } from "../contracts";

/**
 * A "voice detector" that calls every moment speech. Used for songs and other music: the real detector is built for talking and
 * often misses singing over a loud track, which silently drops the lyrics. Everything is then read in windows; the checks that
 * throw away invented text (loops, words in silence) still apply, so a stretch with no singing is dropped later, not here.
 *
* Each chunk becomes one interval; touching intervals are joined by the packer, so the file reads as one long stretch.
 *
 * One exception: a chunk that is practically silent (digital silence, or noise far below anything audible) is not read. The model
 * invents words for pure silence ("thank you", a web address), and nothing a visitor means to caption is that quiet.
 */
export const SILENCE_RMS = 0.002;

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function createEverythingDetector(): VoiceDetector {
  return {
    async push(chunk: PcmChunk): Promise<SpeechInterval[]> {
      const lengthMs = (chunk.samples.length / SAMPLE_RATE) * 1000;
      if (!(lengthMs > 0) || rms(chunk.samples) < SILENCE_RMS) return [];
      return [{ startMs: Math.round(chunk.startMs), endMs: Math.round(chunk.startMs + lengthMs) }];
    },
    async flush(): Promise<SpeechInterval[]> {
      return [];
    },
    reset(): void {},
    async release(): Promise<void> {},
  };
}
