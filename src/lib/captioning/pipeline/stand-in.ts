import { CaptionError } from "../contracts";
import type { SpeechEngine, WindowAudio, WindowTranscript } from "../contracts";

/**
 * A FAKE speech engine for development and tests. It does not listen to anything.
 *
 * It exists so the screen, the pipeline and the export can be exercised end to end before (or
 * without) a real model: for any window that has speech it returns made-up Hinglish words, about
 * one for every 420 ms of speech, always the same words for the same window.
 *
 * It must never be mistaken for a real model, so:
 *  - its id says so ("stand-in-not-a-real-model"), and that id is shown in the UI and stored in results;
 *  - it refuses to start in a production build unless the caller says `allowInProduction: true`
 *    (a preview or a demo page may do that on purpose; nothing in this repo does);
 *  - it is NOT exported from `pipeline/index.ts`, so a production bundle that never imports this
 *    file does not contain it.
 */

export const STAND_IN_ENGINE_ID = "stand-in-not-a-real-model";

// Distinct words only, so a window never repeats itself (the hallucination gate would, rightly, flag that).
const VOCABULARY = [
  "aaj", "hum", "baat", "karenge", "ek", "bahut", "important", "topic", "ke", "baare", "mein", "dosto", "pehle", "yeh", "samajh", "lijiye",
  "ki", "video", "kaise", "banta", "hai", "agar", "aapko", "pasand", "aaye", "toh", "channel", "subscribe", "zaroor", "kariye", "mera",
  "naam", "Rahul", "main", "Delhi", "se", "bol", "raha", "hoon", "bhai", "kya", "haal", "sab", "theek", "na", "chalo", "shuru", "karte",
  "phone", "mein", "camera", "bahut", "accha", "lagta", "kyunki", "light", "achhi", "milti", "lekin", "sound", "thoda", "dhyan", "dena",
  "paisa", "sirf", "do", "minute", "lagenge", "tab", "tak", "dekhte", "rahiye", "kuch", "naya", "seekhne", "ko", "milega", "samay",
  "kam", "hai", "isliye", "jaldi", "batata", "mujhe", "lagta", "yahan", "wahan", "sabse", "pehle", "step", "number", "ek", "yeh",
  "dusra", "teesra", "aakhri", "wala", "friends", "share", "comment", "mein", "batao", "aapka", "favourite", "kaun", "sa", "hai",
  "milte", "hain", "agli", "baar", "tak", "dhanyavaad", "alvida", "khayal", "rakhna", "apna", "aur", "doosron", "ka", "bhi",
];

/** The vocabulary with repeats removed, so that picking without replacement really gives distinct words. */
const POOL = Array.from(new Set(VOCABULARY.map((word) => word.toLowerCase()))).map(
  (lower) => VOCABULARY.find((word) => word.toLowerCase() === lower) ?? lower,
);

const MS_PER_WORD = 420;

/** A tiny seeded generator (mulberry32) so the same window always gets the same words. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable small integers for the made-up words, standing in for token ids. */
const tokenIdOf = (word: string) => {
  let hash = 7;
  for (const ch of word) hash = (Math.imul(hash, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash % 50_000;
};

export interface StandInOptions {
  /** Pretend each window takes this long (ms). Only useful to watch progress move in a demo. Default 0. */
  delayMs?: number;
  /** Allow use in a production build. Default false: it throws instead. */
  allowInProduction?: boolean;
}

/** Words the stand-in would produce for a window, exposed so tests can state the expected count. */
export function standInWordCount(speechMs: number): number {
  return Math.min(POOL.length, Math.max(speechMs > 0 ? 1 : 0, Math.round(speechMs / MS_PER_WORD)));
}

export function createStandInEngine(options: StandInOptions = {}): SpeechEngine {
  if (import.meta.env.PROD && !options.allowInProduction) {
    throw new CaptionError("internal", "The stand-in speech engine is a fake and cannot run in a production build.");
  }
  let loaded = false;
  return {
    id: STAND_IN_ENGINE_ID,
    async load() {
      loaded = true;
    },
    async transcribe(input: WindowAudio, call: { signal?: AbortSignal }): Promise<WindowTranscript> {
      if (call.signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.");
      if (!loaded) throw new CaptionError("model-load", "The stand-in engine was used before load().");
      if (options.delayMs && options.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (call.signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.");

      const speechMs = input.window.regions.reduce((sum, region) => sum + (region.sourceEndMs - region.sourceStartMs), 0);
      const count = standInWordCount(speechMs);
      const random = seededRandom(0x9e3779b1 ^ (input.window.index + 1));
      // Partial Fisher-Yates: the first `count` entries are a random draw without replacement.
      const deck = [...POOL];
      for (let i = 0; i < count; i += 1) {
        const j = i + Math.floor(random() * (deck.length - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const words = deck.slice(0, count);
      // Capitalise the first word and end with a full stop so the captions look like sentences.
      if (words.length > 0) {
        words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
        words[words.length - 1] = `${words[words.length - 1]}.`;
      }
      return { windowIndex: input.window.index, words, tokenIds: words.map(tokenIdOf), noSpeechProbability: 0.02, averageLogProbability: -0.25 };
    },
    async release() {
      loaded = false;
    },
  };
}
