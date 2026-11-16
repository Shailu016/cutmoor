/**
 * Fakes shared by the pipeline tests (not used by production code). They are built around a GROUND
 * TRUTH transcript: a list of words with known video times. The fake engine "hears" exactly the
 * truth words that sit inside the speech a window contains, and the fake aligner places them where
 * the truth says, so any word the pipeline duplicates, loses or shifts is visible by comparing
 * the output with the truth.
 */
import type { AudioIngest, AudioSource, PcmChunk, SpeechEngine, VoiceDetector, WindowAudio, WindowTranscript, WordAligner } from "../contracts";
import { CaptionError } from "../contracts";
import type { SpeechInterval, Word } from "../types";

/** Seeded random numbers (mulberry32) so a failing fuzz case can be replayed. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pseudo-random 7-letter word. Distinct words keep the hallucination gate (rightly) quiet. */
export function randomWord(random: () => number): string {
  let out = "";
  for (let i = 0; i < 7; i += 1) out += String.fromCharCode(97 + Math.floor(random() * 26));
  return out;
}

export interface Timeline {
  speech: SpeechInterval[];
  truth: Word[];
}

/** Fills each segment with words of `wordMs` pitch (300 ms long, 100 ms apart when the pitch is 400). */
export function makeTimeline(segments: SpeechInterval[], seed = 1, wordMs = 400): Timeline {
  const random = rng(seed);
  const truth: Word[] = [];
  for (const segment of segments) {
    for (let start = segment.startMs; start + wordMs <= segment.endMs; start += wordMs) {
      truth.push({
        text: randomWord(random),
        startMs: start,
        endMs: start + wordMs - 100,
        confidence: 1,
        index: truth.length,
        windowIndex: 0,
      });
    }
  }
  return { speech: segments, truth };
}

/** The value of the audio sample at global position `n`, so a test can tell whether the right audio arrived. */
export const sampleValue = (n: number) => Math.fround(((n % 65521) + 1) / 65522);

export interface IngestProbe {
  chunksYielded: number;
  closed: number;
  opened: number;
}

export function makeIngest(options: {
  durationMs: number;
  chunkMs?: number;
  reportDuration?: boolean;
  openError?: Error;
  /** Called after each chunk is handed over. */
  onChunk?: (index: number) => void;
  probe?: IngestProbe;
}): AudioIngest {
  const probe = options.probe ?? { chunksYielded: 0, closed: 0, opened: 0 };
  const chunkMs = options.chunkMs ?? 1000;
  return {
    async open(_file, _signal) {
      if (options.openError) throw options.openError;
      probe.opened += 1;
      const source: AudioSource = {
        durationMs: options.reportDuration === false ? null : options.durationMs,
        async *chunks(signal) {
          for (let startMs = 0; startMs < options.durationMs; startMs += chunkMs) {
            if (signal?.aborted) return;
            const length = Math.min(chunkMs, options.durationMs - startMs) * 16;
            const samples = new Float32Array(length);
            const base = startMs * 16;
            for (let i = 0; i < length; i += 1) samples[i] = sampleValue(base + i);
            const chunk: PcmChunk = { startMs, samples };
            probe.chunksYielded += 1;
            yield chunk;
            options.onChunk?.(probe.chunksYielded);
            // Let other work (abort handlers, timers) run, as a real decoder would.
            await Promise.resolve();
          }
        },
        async close() {
          probe.closed += 1;
        },
      };
      return source;
    },
  };
}

/** Closes an interval once `hangoverMs` of audio has passed after it, like a real detector. */
export function makeVad(speech: SpeechInterval[], hangoverMs = 300): VoiceDetector & { resets: number } {
  let emitted = 0;
  let audioEnd = 0;
  const sorted = [...speech].sort((a, b) => a.startMs - b.startMs);
  const vad = {
    resets: 0,
    async push(chunk: PcmChunk) {
      audioEnd = Math.max(audioEnd, chunk.startMs + chunk.samples.length / 16);
      const closed: SpeechInterval[] = [];
      while (emitted < sorted.length && sorted[emitted].endMs + hangoverMs <= audioEnd) closed.push({ ...sorted[emitted++] });
      return closed;
    },
    async flush() {
      const rest = sorted.slice(emitted).map((item) => ({ startMs: item.startMs, endMs: Math.min(item.endMs, audioEnd) }));
      emitted = sorted.length;
      return rest.filter((item) => item.endMs > item.startMs);
    },
    reset() {
      emitted = 0;
      audioEnd = 0;
      vad.resets += 1;
    },
    async release() {},
  };
  return vad;
}

export interface EngineProbe {
  transcribeCalls: number;
  windows: WindowAudio[];
  loads: number;
  releases: number;
}

/** Truth words whose midpoint lies inside one of the window's regions, as the model would hear them. */
function heardBy(audio: WindowAudio, truth: readonly Word[]): Word[] {
  return truth.filter((word) => {
    const middle = (word.startMs + word.endMs) / 2;
    return audio.window.regions.some((region) => middle >= region.sourceStartMs && middle < region.sourceEndMs);
  });
}

export function makeTruthEngine(
  truth: readonly Word[],
  hooks: {
    probe?: EngineProbe;
    /** Replace what window `index` hears; return null to use the truth. */
    override?: (windowIndex: number, attempt: number) => Partial<WindowTranscript> | null;
    /** Throw for this window and attempt (1-based). */
    failOn?: (windowIndex: number, attempt: number) => Error | null;
    /** Never resolve for this window (an engine that ignores the abort signal). */
    hangOn?: (windowIndex: number) => boolean;
  } = {},
): SpeechEngine {
  const probe = hooks.probe ?? { transcribeCalls: 0, windows: [], loads: 0, releases: 0 };
  const attempts = new Map<number, number>();
  return {
    id: "truth-engine",
    async load() {
      probe.loads += 1;
    },
    async transcribe(input, options) {
      probe.transcribeCalls += 1;
      probe.windows.push(input);
      const index = input.window.index;
      const attempt = (attempts.get(index) ?? 0) + 1;
      attempts.set(index, attempt);
      if (options.signal?.aborted) throw new CaptionError("aborted", "cancelled");
      if (hooks.hangOn?.(index)) await new Promise<never>(() => undefined);
      const failure = hooks.failOn?.(index, attempt);
      if (failure) throw failure;
      const words = heardBy(input, truth).map((word) => word.text);
      const base: WindowTranscript = { windowIndex: index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      return { ...base, ...(hooks.override?.(index, attempt) ?? {}) };
    },
    async release() {
      probe.releases += 1;
    },
  };
}

/** Places each word where the truth says it is, translated into window-local time. */
export function makeTruthAligner(truth: readonly Word[], hooks: { failOn?: (windowIndex: number) => boolean; probe?: { releases: number } } = {}): WordAligner {
  const byText = new Map(truth.map((word) => [word.text, word]));
  return {
    id: "truth-aligner",
    async load() {},
    async align(input, transcript) {
      if (hooks.failOn?.(input.window.index)) throw new CaptionError("inference", "aligner broke");
      return transcript.words.map((text, i) => {
        const word = byText.get(text);
        if (!word) throw new Error(`unknown word ${text}`);
        const middle = (word.startMs + word.endMs) / 2;
        const region = input.window.regions.find((r) => middle >= r.sourceStartMs && middle < r.sourceEndMs);
        if (!region) throw new Error("word outside the window");
        const local = (ms: number) => region.packOffsetMs + (Math.min(Math.max(ms, region.sourceStartMs), region.sourceEndMs) - region.sourceStartMs);
        return { text, startMs: local(word.startMs), endMs: Math.max(local(word.startMs) + 1, local(word.endMs)), confidence: 0.9, index: i, windowIndex: input.window.index };
      });
    },
    async release() {
      if (hooks.probe) hooks.probe.releases += 1;
    },
  };
}
