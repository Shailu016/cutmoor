import { describe, expect, it, vi } from "vitest";
import { CaptionError } from "../contracts";
import type { AudioIngest, AudioSource, ForcedAlignWord, PipelineDeps, PipelineProgress, SpeechEngine, WindowAudio, WindowTranscript, WordAligner } from "../contracts";
import type { SpeechInterval, Word } from "../types";
import { borrowWholeTranscriptTiming, createCaptionPipeline, dropIsolatedLowConfidenceJunk, dropJunkInInstrumentalSpans, trimTranscriptReading } from "./pipeline";
import type { PipelineTuning } from "./pipeline";
import { makeIngest, makeTimeline, makeTruthAligner, makeTruthEngine, makeVad, rng } from "./test-kit";
import type { EngineProbe, IngestProbe } from "./test-kit";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const FILE = new File([new Uint8Array(1)], "clip.mp4", { type: "video/mp4" });
const language = "hinglish" as const;

/** A video where each segment is spoken (truth words every 400 ms) and the gaps are silent. */
function setup(
  segments: SpeechInterval[],
  options: {
    durationMs?: number;
    chunkMs?: number;
    seed?: number;
    engine?: Parameters<typeof makeTruthEngine>[1];
    aligner?: Parameters<typeof makeTruthAligner>[1];
    tuning?: PipelineTuning;
    onChunk?: (n: number) => void;
    reportDuration?: boolean;
    vadSpeech?: SpeechInterval[];
  } = {},
) {
  const timeline = makeTimeline(segments, options.seed ?? 1);
  const ingestProbe: IngestProbe = { chunksYielded: 0, closed: 0, opened: 0 };
  const engineProbe: EngineProbe = { transcribeCalls: 0, windows: [], loads: 0, releases: 0 };
  const alignerProbe = { releases: 0 };
  const durationMs = options.durationMs ?? segments[segments.length - 1].endMs + 2000;
  const vad = makeVad(options.vadSpeech ?? timeline.speech);
  const deps: PipelineDeps = {
    ingest: makeIngest({ durationMs, chunkMs: options.chunkMs, probe: ingestProbe, onChunk: options.onChunk, reportDuration: options.reportDuration }),
    vad,
    engine: makeTruthEngine(timeline.truth, { ...options.engine, probe: engineProbe }),
    aligner: makeTruthAligner(timeline.truth, { ...options.aligner, probe: alignerProbe }),
  };
  const pipeline = createCaptionPipeline(deps, options.tuning);
  return { pipeline, timeline, ingestProbe, engineProbe, alignerProbe, vad, deps };
}

const texts = (words: readonly Word[]) => words.map((w) => w.text);

/**
 * A track the vocal-activity detector can judge: a 220 Hz tone with two overtones in the voiced stretches (what
 * singing looks like to the detector), a loud 60 Hz + 3 kHz-noise bed in the instrumental stretches (no voicing),
 * and digital silence everywhere else.
 */
function track(durationMs: number, voiced: readonly SpeechInterval[], instrumental: readonly SpeechInterval[] = [], seed = 5): Float32Array {
  const random = rng(seed);
  const samples = new Float32Array(durationMs * 16);
  const inside = (spans: readonly SpeechInterval[], ms: number) => spans.some((span) => ms >= span.startMs && ms < span.endMs);
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / 16_000;
    if (inside(instrumental, i / 16)) {
      samples[i] = 0.3 * Math.sin(2 * Math.PI * 60 * t) + 0.25 * (random() * 2 - 1) * Math.sin(2 * Math.PI * 3000 * t);
    } else if (inside(voiced, i / 16)) {
      samples[i] = 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 440 * t) + 0.05 * Math.sin(2 * Math.PI * 660 * t);
    }
  }
  return samples;
}

function trackIngest(options: { durationMs: number; voiced: readonly SpeechInterval[]; instrumental?: readonly SpeechInterval[]; chunkMs?: number; probe?: IngestProbe }): AudioIngest {
  const probe = options.probe ?? { chunksYielded: 0, closed: 0, opened: 0 };
  const chunkMs = options.chunkMs ?? 1000;
  const samples = track(options.durationMs, options.voiced, options.instrumental);
  return {
    async open() {
      probe.opened += 1;
      return {
        durationMs: options.durationMs,
        async *chunks(signal) {
          for (let startMs = 0; startMs < options.durationMs; startMs += chunkMs) {
            if (signal?.aborted) return;
            const from = startMs * 16;
            probe.chunksYielded += 1;
            yield { startMs, samples: samples.subarray(from, Math.min(from + chunkMs * 16, samples.length)) };
            await Promise.resolve();
          }
        },
        async close() {
          probe.closed += 1;
        },
      };
    },
  };
}

/**
 * Places each word in even 400 ms steps from the start of the window. For engines whose words are not in a truth
 * timeline (a reading that exists only to exercise the pipeline's decisions), so the aligner cannot reject them.
 */
function evenAligner(): WordAligner {
  return {
    id: "even",
    async load() {},
    async release() {},
    async align(input, transcript) {
      return transcript.words.map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 300, confidence: 1, index: i, windowIndex: input.window.index }));
    },
  };
}

describe("createCaptionPipeline: a normal run", () => {
  it("turns packed speech back into correct global times, word for word", async () => {
    // Five separate stretches of speech that the packer glues into a single window.
    const segments = [
      { startMs: 2000, endMs: 5200 },
      { startMs: 9000, endMs: 12_400 },
      { startMs: 31_000, endMs: 33_600 },
      { startMs: 70_000, endMs: 74_000 },
      { startMs: 120_000, endMs: 121_600 },
    ];
    const { pipeline, timeline, engineProbe } = setup(segments);
    const result = await pipeline.run(FILE, { language });

    expect(engineProbe.transcribeCalls).toBe(1);
    expect(result.stats.windows).toBe(1);
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    result.words.forEach((word, i) => {
      expect(word.startMs).toBe(timeline.truth[i].startMs);
      expect(word.endMs).toBe(timeline.truth[i].endMs);
      expect(word.index).toBe(i);
    });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.flatMap((e) => e.lines.flat()).map((w) => w.text)).toEqual(texts(timeline.truth));
    expect(result.uncoveredSpeech).toEqual([]);
    expect(result.stats).toMatchObject({ engineId: "truth-engine", alignerId: "truth-aligner", flaggedWindows: 0, droppedWords: 0 });
    expect(result.stats.audioSeconds).toBeCloseTo(123.6, 1);
    expect(result.stats.speechSeconds).toBeCloseTo(3.2 + 3.4 + 2.6 + 4 + 1.6, 3);
  });

  it("hands each window the real audio at the right offsets", async () => {
    const { pipeline, engineProbe } = setup([{ startMs: 1000, endMs: 3000 }, { startMs: 8000, endMs: 9000 }]);
    await pipeline.run(FILE, { language });
    const { window, samples } = engineProbe.windows[0];
    expect(window.regions.map((r) => r.packOffsetMs)).toEqual([0, 2250]);
    // The test audio encodes its own position, so we can see which part of the file landed where.
    const at = (ms: number) => samples[ms * 16];
    expect(at(0)).toBeCloseTo(((1000 * 16) % 65521 + 1) / 65522, 6);
    expect(at(2250)).toBeCloseTo(((8000 * 16) % 65521 + 1) / 65522, 6);
    expect(at(2100)).toBe(0); // silence between regions
    expect(at(10_000)).toBe(0); // padding
  });

  it("keeps seam words exactly once when one long stretch of speech is split into overlapping windows", async () => {
    const { pipeline, timeline, engineProbe } = setup([{ startMs: 500, endMs: 100_500 }]);
    const result = await pipeline.run(FILE, { language });
    expect(engineProbe.transcribeCalls).toBeGreaterThanOrEqual(4);
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    for (let i = 1; i < result.words.length; i += 1) expect(result.words[i].startMs).toBeGreaterThanOrEqual(result.words[i - 1].endMs);
  });

  it("runs the normaliser on the way out", async () => {
    const timeline = makeTimeline([{ startMs: 0, endMs: 2000 }], 4);
    const engine = makeTruthEngine(timeline.truth, { override: () => ({ words: ["Nahin", "bohot", "ok"] }) });
    const aligner: WordAligner = {
      id: "a",
      async load() {},
      async release() {},
      async align(input, transcript) {
        return transcript.words.map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 400, confidence: 1, index: i, windowIndex: input.window.index }));
      },
    };
    const pipeline = createCaptionPipeline({ ingest: makeIngest({ durationMs: 3000 }), vad: makeVad(timeline.speech), engine, aligner });
    const result = await pipeline.run(FILE, { language });
    expect(texts(result.words)).toEqual(["Nahi", "bahut", "OK"]);
  });
});

describe("createCaptionPipeline: reading everything (songs and music)", () => {
  /** A song run: the fake engine hears the truth words of the voiced stretches, and the speech detector is absent. */
  const songSetup = (options: {
    durationMs: number;
    voiced: SpeechInterval[];
    instrumental?: SpeechInterval[];
    engine?: Parameters<typeof makeTruthEngine>[1];
    aligner?: Parameters<typeof makeTruthAligner>[1];
  }) => {
    const timeline = makeTimeline(options.voiced, 21);
    const engineProbe: EngineProbe = { transcribeCalls: 0, windows: [], loads: 0, releases: 0 };
    const ingestProbe: IngestProbe = { chunksYielded: 0, closed: 0, opened: 0 };
    const vad = makeVad([]);
    const deps: PipelineDeps = {
      ingest: trackIngest({ durationMs: options.durationMs, voiced: options.voiced, instrumental: options.instrumental, probe: ingestProbe }),
      vad,
      engine: makeTruthEngine(timeline.truth, { ...options.engine, probe: engineProbe }),
      aligner: makeTruthAligner(timeline.truth, options.aligner),
    };
    return { pipeline: createCaptionPipeline(deps), timeline, engineProbe, ingestProbe, vad };
  };

  it("uses the vocal-activity detector instead of the speech detector, and reads the voiced stretches", async () => {
    const { pipeline, timeline, vad } = songSetup({ durationMs: 20_000, voiced: [{ startMs: 0, endMs: 20_000 }] });
    const pushes = vi.spyOn(vad, "push");
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(pushes).not.toHaveBeenCalled();
    expect(texts(result.words)).toEqual(texts(timeline.truth));
  });

  it("sends no instrumental audio to the model, so an all-instrumental stretch costs no model call", async () => {
    const voiced = [{ startMs: 1000, endMs: 7000 }, { startMs: 41_000, endMs: 47_000 }];
    const { pipeline, timeline, engineProbe } = songSetup({ durationMs: 50_000, voiced, instrumental: [{ startMs: 7000, endMs: 41_000 }] });
    const result = await pipeline.run(FILE, { language, detection: "everything" });

    // The packer glues both phrases into one window (it packs by total length, not by distance), and the 34 s of
    // loud instrumental audio between them is simply not in it: only the two voiced stretches are copied in.
    expect(engineProbe.transcribeCalls).toBe(1);
    expect(result.stats.windows).toBe(1);
    const regions = engineProbe.windows[0].window.regions.map((region) => [region.sourceStartMs, region.sourceEndMs]);
    expect(regions).toHaveLength(2);
    // Boundaries land within one 40 ms analysis frame of the truth.
    expect(Math.abs(regions[0][0] - 1000)).toBeLessThanOrEqual(40);
    expect(Math.abs(regions[0][1] - 7000)).toBeLessThanOrEqual(40);
    expect(Math.abs(regions[1][0] - 41_000)).toBeLessThanOrEqual(40);
    expect(Math.abs(regions[1][1] - 47_000)).toBeLessThanOrEqual(40);
    for (const [startMs, endMs] of regions) expect(endMs <= 7060 || startMs >= 40_940, `region ${startMs}-${endMs}`).toBe(true);
    for (const { window } of engineProbe.windows) {
      for (const region of window.regions) {
        expect(region.sourceEndMs <= 7100 || region.sourceStartMs >= 40_900, `region ${region.sourceStartMs}-${region.sourceEndMs}`).toBe(true);
      }
    }
    // Every word that came out is a real one from a voiced stretch, and none sits in the instrumental span.
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    expect(result.words.every((word) => (word.startMs + word.endMs) / 2 < 7100 || (word.startMs + word.endMs) / 2 > 40_900)).toBe(true);
  });

  it("re-reads a song window that is only 'nan' from a slice 10 s later, and keeps the real words", async () => {
    const timeline = makeTimeline([{ startMs: 0, endMs: 60_000 }], 9);
    const starts: number[] = [];
    const engine: SpeechEngine = {
      id: "rescue-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        const region = input.window.regions[0];
        starts.push(region.sourceStartMs);
        // The base window hears nothing; the same music moved 10 s later is readable (measured on real songs).
        if (region.sourceStartMs < 5000) {
          return { windowIndex: input.window.index, words: ["nan"], tokenIds: [1], noSpeechProbability: 0.05, averageLogProbability: -0.1 };
        }
        const words = timeline.truth
          .filter((word) => {
            const middle = (word.startMs + word.endMs) / 2;
            return middle >= region.sourceStartMs && middle < region.sourceEndMs;
          })
          .map((word) => word.text);
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({
      ingest: trackIngest({ durationMs: 60_000, voiced: [{ startMs: 0, endMs: 60_000 }] }),
      vad: makeVad([]),
      engine,
      aligner: makeTruthAligner(timeline.truth),
    });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(starts).toContain(10_000); // the rescue slice really ran
    expect(texts(result.words)).not.toContain("nan");
    expect(result.words.length).toBeGreaterThan(0);
    expect(result.words[0].startMs).toBeGreaterThanOrEqual(10_000);
  });

  it("does not rescue a song whose opening already reads cleanly, and keeps the base token", async () => {
    const musicFlags: (boolean | undefined)[] = [];
    const starts: number[] = [];
    const clean = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil", "tera", "yaar", "ab", "toh", "aa"];
    const engine: SpeechEngine = {
      id: "clean-engine",
      async load() {},
      async release() {},
      async transcribe(input, options) {
        musicFlags.push(options.music);
        starts.push(input.window.regions[0].sourceStartMs);
        return { windowIndex: input.window.index, words: clean, tokenIds: clean.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: makeTruthAligner([]) });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(result.words).toHaveLength(clean.length);
    expect(starts).not.toContain(10_000); // a clean opening needs no rescue
    expect(musicFlags).toEqual([false]); // and no second token read either
  });

  it("reads a hard song window once more with the Hindi token and keeps the reading with more real words", async () => {
    const musicFlags: (boolean | undefined)[] = [];
    const hindi = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil", "tera", "yaar", "ab", "toh", "aa"];
    const engine: SpeechEngine = {
      id: "two-token-engine",
      async load() {},
      async release() {},
      async transcribe(input, options) {
        musicFlags.push(options.music);
        const words = options.music ? hindi : ["kya", "der"];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 25_000, voiced: [{ startMs: 0, endMs: 25_000 }] }), vad: makeVad([]), engine, aligner: makeTruthAligner([]) });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(musicFlags).toEqual([false, true]);
    expect(texts(result.words)).toEqual(hindi);
  });

  it("drops Devanagari readings once a song is known to be hard (the Hindi token), so the captions stay in Latin letters", async () => {
    // Window 0 reads junk, so the rest of the song is read with the Hindi token; those readings come back in Devanagari.
    const { pipeline } = songSetup({
      durationMs: 100_500,
      voiced: [{ startMs: 0, endMs: 100_500 }],
      engine: { override: (windowIndex) => (windowIndex === 0 ? { words: ["nan"] } : { words: ["नमस्ते", "दुनिया"] }) },
    });
    const result = await pipeline.run(FILE, { language, detection: "everything" }).catch((error: unknown) => error);
    const words = result instanceof Error || !("words" in (result as object)) ? [] : (result as { words: Word[] }).words;
    expect(words.some((word) => /[ऀ-ॿ]/u.test(word.text))).toBe(false);
  });

  it("never runs the rescue on instrumental audio, even when every window reads 'nan'", async () => {
    const voiced = [{ startMs: 0, endMs: 20_000 }, { startMs: 60_000, endMs: 80_000 }];
    const requests: [number, number][] = [];
    const engine: SpeechEngine = {
      id: "all-junk-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        const first = input.window.regions[0];
        const last = input.window.regions[input.window.regions.length - 1];
        requests.push([first.sourceStartMs, last.sourceEndMs]);
        return { windowIndex: input.window.index, words: ["nan"], tokenIds: [1], noSpeechProbability: 0.05, averageLogProbability: -0.1 };
      },
    };
    const pipeline = createCaptionPipeline({
      ingest: trackIngest({ durationMs: 80_000, voiced, instrumental: [{ startMs: 20_000, endMs: 60_000 }] }),
      vad: makeVad([]),
      engine,
      aligner: makeTruthAligner([]),
    });
    await pipeline.run(FILE, { language, detection: "everything" });
    // Every window read junk, so the rescue ran: two base reads plus the +10 s / +15 s slices of both phrases.
    expect(requests.length).toBeGreaterThan(2);
    // But no request, base or rescue, reaches the 40 s the detector called instrumental.
    for (const [startMs, endMs] of requests) expect(endMs <= 20_100 || startMs >= 59_900, `request ${startMs}-${endMs} touched instrumental audio`).toBe(true);
  });

  it("makes no model call at all when the whole file is loud instrumental audio", async () => {
    const { pipeline, engineProbe } = songSetup({ durationMs: 20_000, voiced: [], instrumental: [{ startMs: 0, endMs: 20_000 }] });
    await expect(pipeline.run(FILE, { language, detection: "everything" })).rejects.toMatchObject({ code: "no-speech" });
    expect(engineProbe.transcribeCalls).toBe(0);
    expect(engineProbe.loads).toBe(0);
  });

  it("drops a music window whose only text is 'nan', instead of showing it", async () => {
    const engine: SpeechEngine = {
      id: "junk-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        return { windowIndex: input.window.index, words: ["nan."], tokenIds: [1], noSpeechProbability: 0.05, averageLogProbability: -0.1 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 40_000, voiced: [{ startMs: 0, endMs: 40_000 }] }), vad: makeVad([]), engine, aligner: makeTruthAligner([]) });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(result.words).toEqual([]);
    expect(result.stats.droppedWords).toBeGreaterThan(0);
    expect(result.stats.flaggedWindows).toBeGreaterThan(0);
  });

  it("keeps a 'nan' that sits between real words in audio the detector heard as voiced", async () => {
    // The narrow post-filter must not strip a token from a phrase the detector kept: that is how a real "nan" survives.
    const engine: SpeechEngine = {
      id: "mixed-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        return { windowIndex: input.window.index, words: ["kya", "nan", "der"], tokenIds: [1, 2, 3], noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const aligner: WordAligner = {
      id: "even",
      async load() {},
      async release() {},
      async align(input, transcript) {
        return transcript.words.map((text, i) => ({ text, startMs: 1000 + i * 500, endMs: 1350 + i * 500, confidence: 1, index: i, windowIndex: input.window.index }));
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 10_000, voiced: [{ startMs: 0, endMs: 10_000 }] }), vad: makeVad([]), engine, aligner });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(texts(result.words)).toEqual(["kya", "nan", "der"]);
  });

  it("never asks for music mode or a rescue slice in speech mode, even when every window reads 'nan'", async () => {
    const segments = [{ startMs: 0, endMs: 30_000 }];
    const musicFlags: (boolean | undefined)[] = [];
    const starts: number[] = [];
    const engine: SpeechEngine = {
      id: "junk-engine",
      async load() {},
      async release() {},
      async transcribe(input, options) {
        musicFlags.push(options.music);
        starts.push(input.window.regions[0].sourceStartMs);
        return { windowIndex: input.window.index, words: ["nan"], tokenIds: [1], noSpeechProbability: 0.05, averageLogProbability: -0.1 };
      },
    };
    const vad = makeVad(segments);
    const pushes = vi.spyOn(vad, "push");
    const pipeline = createCaptionPipeline({ ingest: makeIngest({ durationMs: 30_000 }), vad, engine, aligner: makeTruthAligner([]) });
    const result = await pipeline.run(FILE, { language });
    // Speech mode keeps "nan" as a caption (it can be a real word) and never reads a slice shifted by 10 s.
    expect(pushes).toHaveBeenCalled();
    expect(texts(result.words)).toEqual(["nan"]);
    expect(musicFlags).toEqual([false]);
    expect(starts).not.toContain(10_000);
  });

  it("drops a collapsed repeated tail in music mode, but keeps it in speech mode", async () => {
    const textsIn = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec"];
    const engine: SpeechEngine = {
      id: "loop-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        return { windowIndex: input.window.index, words: textsIn, tokenIds: textsIn.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    // The first eight words are sung normally; the repeated line is crushed into the window's last 140 ms.
    const aligner: WordAligner = {
      id: "collapsing-aligner",
      async load() {},
      async release() {},
      async align(input, transcript) {
        return transcript.words.map((text, i) =>
          i < 8
            ? { text, startMs: 2000 + i * 400, endMs: 2300 + i * 400, confidence: 0.9, index: i, windowIndex: input.window.index }
            : { text, startMs: 29_790 + (i - 8) * 15, endMs: 29_805 + (i - 8) * 15, confidence: 0.9, index: i, windowIndex: input.window.index },
        );
      },
    };
    const music = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner });
    const inMusic = await music.run(FILE, { language, detection: "everything" });
    expect(texts(inMusic.words)).toEqual(textsIn.slice(0, 8));
    expect(inMusic.stats.droppedWords).toBe(9);

    const speech = createCaptionPipeline({ ingest: makeIngest({ durationMs: 30_000 }), vad: makeVad([{ startMs: 0, endMs: 30_000 }]), engine, aligner });
    const inSpeech = await speech.run(FILE, { language });
    expect(texts(inSpeech.words)).toEqual(textsIn);
  });

  it("trims a song reading and keeps its per-word arrays aligned (O1a helper)", () => {
    const transcript: WindowTranscript = {
      windowIndex: 7,
      words: ["kya", "der", "hai,", "nan", "nan", "nan"],
      tokenIds: [1, 2, 3, 4, 4, 4],
      noSpeechProbability: 0.01,
      averageLogProbability: -0.2,
      wordConfidence: [0.9, 0.8, 0.7, 0.1, 0.1, 0.1],
      wordTimes: [
        { startMs: 0, endMs: 500 },
        { startMs: 500, endMs: 1000 },
        { startMs: 1000, endMs: 1500 },
        { startMs: 1500, endMs: 2000 },
        { startMs: 2000, endMs: 2500 },
        { startMs: 2500, endMs: 3000 },
      ],
    };
    const trimmed = trimTranscriptReading(transcript);
    expect(trimmed.dropped).toBe(3);
    expect(trimmed.transcript.words).toEqual(["kya", "der", "hai,"]);
    expect(trimmed.transcript.wordConfidence).toEqual([0.9, 0.8, 0.7]);
    expect(trimmed.transcript.wordTimes?.map((time) => time.startMs)).toEqual([0, 500, 1000]);
    // A reading that cannot be found in the original is returned untouched: a trim must never lose words.
    const untouched = trimTranscriptReading({ ...transcript, words: ["nan", "kya"] , wordConfidence: [0.1, 0.9], wordTimes: [{ startMs: 0, endMs: 1 }, { startMs: 1, endMs: 2 }] });
    expect(untouched.dropped).toBe(1);
    expect(untouched.transcript.words).toEqual(["kya"]);
  });

  it("keeps the real words of a window that ends in a 'nan' loop, instead of deleting the window (O1a)", async () => {
    const engine: SpeechEngine = {
      id: "nan-tail-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        const words = ["kya", "der", "hai", "nan", "nan", "nan", "nan"];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: makeTruthAligner([]) });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(texts(result.words)).toEqual(["kya", "der", "hai"]);
    expect(result.stats.droppedWords).toBeGreaterThanOrEqual(4);
  });

  it("retries a hard 30 s window as two independent 20 s windows on a 10 s hop (O2)", async () => {
    const engineProbe: EngineProbe = { transcribeCalls: 0, windows: [], loads: 0, releases: 0 };
    const engine: SpeechEngine = {
      id: "retry-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        engineProbe.transcribeCalls += 1;
        engineProbe.windows.push(input);
        const used = input.window.usedMs;
        // The 30 s window hears only junk; a 20 s window hears a real phrase (measured on real songs).
        const words = used <= 20_500 ? ["kya", "der", "hai"] : ["nan"];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: makeTruthAligner([]) });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    const retryWindows = engineProbe.windows.map((item) => item.window).filter((window) => window.usedMs <= 20_500);
    expect(retryWindows.length).toBeGreaterThanOrEqual(2);
    expect(retryWindows.map((window) => window.regions[0].sourceStartMs)).toEqual(expect.arrayContaining([0, 10_000]));
    expect(retryWindows.every((window) => window.regions[0].sourceEndMs - window.regions[0].sourceStartMs === window.usedMs)).toBe(true);
    expect(result.words.length).toBeGreaterThanOrEqual(3);
    expect(texts(result.words)).toContain("kya");
  });

  it("hands the base read and the token vote the same assembled audio (one encoder run in the engine)", async () => {
    const samples: Float32Array[] = [];
    const base = ["kya", "der"];
    const vote = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil", "tera", "yaar"];
    const engine: SpeechEngine = {
      id: "shared-audio-engine",
      async load() {},
      async release() {},
      async transcribe(input, options) {
        samples.push(input.samples);
        const words = options.music ? vote : base;
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 25_000, voiced: [{ startMs: 0, endMs: 25_000 }] }), vad: makeVad([]), engine, aligner: evenAligner() });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    expect(samples).toHaveLength(2); // base + the token vote, and nothing else (9 real words need no rescue)
    expect(samples[0]).toBe(samples[1]);
    expect(texts(result.words)).toEqual(vote);
  });

  it("skips the moved rescue only after the FULL retry plan ran and read nothing, never before the second retry", async () => {
    type Read = { start: number; usedMs: number; music: boolean | undefined; retry: boolean };
    const clean = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot"];
    const songRun = async (baseWords: readonly string[], retryWords: readonly string[] = ["nan", "nan"]) => {
      const reads: Read[] = [];
      const engine: SpeechEngine = {
        id: "junk-then-clean-engine",
        async load() {},
        async release() {},
        async transcribe(input, options) {
          const region = input.window.regions[0];
          const retry = options.bounds?.retryShiftMs === 0;
          reads.push({ start: region.sourceStartMs, usedMs: input.window.usedMs, music: options.music, retry });
          // A window read (`sourceStartMs` 0) hears `baseWords`; a moved rescue slice (which starts later, with the
          // other token and no retry shift) reads a line. Retry windows start later too but carry `retryShiftMs: 0`.
          const moved = region.sourceStartMs !== 0;
          const words: string[] = moved && !retry ? [...clean] : retry ? [...retryWords] : [...baseWords];
          return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
        },
      };
      const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: evenAligner() });
      return { reads, result: await pipeline.run(FILE, { language, detection: "everything" }) };
    };

    // Nothing real anywhere in the window or its two 20 s retries (two junk tokens each): the rescue must not be
    // attempted at all (this is KING win 3 / Sajan win 2-3, 100 s of zero words).
    const skipped = await songRun(["nan"]);
    expect(skipped.reads).toHaveLength(4); // base + vote + two retries, then the rescue skip
    expect(skipped.reads.some((read) => !read.retry && read.start > 0)).toBe(false);
    expect(skipped.result.words).toEqual([]);

    // A first retry that is a SINGLE junk token must NOT stop the retry plan: the second 20 s slice is the measured
    // way KING's English rap line is read (18 words from the second retry). Both retries run; the rescue is then
    // skipped because the full plan returned nothing.
    const singleJunk = await songRun(["nan"], ["nan"]);
    expect(singleJunk.reads.filter((read) => read.retry).map((read) => read.start)).toEqual([0, 10_000]);
    expect(singleJunk.reads.some((read) => !read.retry && read.start > 0)).toBe(false);
    expect(singleJunk.result.words).toEqual([]);

    // A window that already reads 3 real words is not "hard": it gets no retries, so the rescue is still the one
    // measured way to recover Sajan's 0:15-0:30 line and must still run (and win 6 words over 3). The first second
    // of a moved slice belongs to the bigger window in the overlap merge, so its first words are not captions.
    const rescued = await songRun(["kya", "der", "hai"]);
    expect(rescued.reads.map((read) => read.start)).toEqual([0, 10_000]);
    expect(texts(rescued.result.words)).toEqual(["kya", "der", "hai", "delta", "echo", "foxtrot"]);
  });

  it("tries the +15 s rescue before +10 s on the High tier only, and keeps the Draft order", async () => {
    type Read = { start: number; music: boolean | undefined };
    const two = ["alfa", "bravo"];
    const six = ["charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
    const run = async (characterAlignment: boolean | undefined) => {
      const reads: Read[] = [];
      const engine = {
        id: characterAlignment === true ? "apex-engine" : "draft-engine",
        ...(characterAlignment === undefined ? {} : { characterAlignment }),
        async load() {},
        async release() {},
        async transcribe(input: WindowAudio, options: { music?: boolean }) {
          const region = input.window.regions[0];
          reads.push({ start: region.sourceStartMs, music: options.music });
          // The window reads 3 real words (not "hard": no vote and, crucially, no 20 s retries, exactly like Sajan's
          // 0:30 window), so only the rescue runs. +10 s reads two words, +15 s reads a line.
          const words = region.sourceStartMs === 10_000 ? two : region.sourceStartMs === 15_000 ? six : ["kya", "der", "hai"];
          return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
        },
      } as SpeechEngine;
      const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: evenAligner() });
      return { reads, result: await pipeline.run(FILE, { language, detection: "everything" }) };
    };
    // High ships the teacher-forced character aligner: +15 s reads the line, so +10 s is never spent (18.5 s saved).
    const high = await run(true);
    expect(high.reads.filter((read) => read.music === true && read.start > 0).map((read) => read.start)).toEqual([15_000]);
    // The first second of a moved slice belongs to the bigger window in the overlap merge; the rest is the rescue's.
    expect(texts(high.result.words)).toEqual(["kya", "der", "hai", "foxtrot", "golf", "hotel"]);
    // Draft (no character aligner) keeps +10 s first: two words are not enough, then +15 s wins.
    const draft = await run(undefined);
    expect(draft.reads.filter((read) => read.music === true && read.start > 0).map((read) => read.start)).toEqual([10_000, 15_000]);
    expect(texts(draft.result.words)).toEqual(["kya", "der", "hai", "foxtrot", "golf", "hotel"]);
  });

  it("keeps the second retry's words with the DEFAULT budget: base + timestamp + vote + two retries all fit", async () => {
    const reads: { start: number; kind: string }[] = [];
    const engine: SpeechEngine & { timestampRead: boolean } = {
      id: "budget-five-engine",
      timestampRead: true,
      async load() {},
      async release() {},
      async transcribe(input, options) {
        const region = input.window.regions[0];
        const retry = options.bounds?.retryShiftMs === 0;
        const timestamp = (options.bounds as { timestampRead?: boolean } | undefined)?.timestampRead === true;
        reads.push({ start: region.sourceStartMs, kind: timestamp ? "timestamp" : retry ? "retry" : options.music ? "vote" : "base" });
        const words = retry ? (region.sourceStartMs === 10_000 ? ["kya", "der", "hai", "aaj"] : ["nan"]) : ["nan"];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: evenAligner() });
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    // Five reads: base, timestamp, vote, two retries. The second retry (at +10 s) is not starved by the budget.
    expect(reads.filter((read) => read.kind === "timestamp")).toHaveLength(1);
    expect(reads.filter((read) => read.kind === "retry").map((read) => read.start)).toEqual([0, 10_000]);
    expect(texts(result.words)).toEqual(expect.arrayContaining(["kya", "der", "hai"]));
  });

  it("C2 off restores R3: the second 20 s retry always runs, even when the first is one junk token", async () => {
    type Read = { start: number; retry: boolean; reuse: boolean | undefined };
    const reads: Read[] = [];
    const engine: SpeechEngine = {
      id: "r3-retry-engine",
      async load() {},
      async release() {},
      async transcribe(input, options) {
        const region = input.window.regions[0];
        const retry = options.bounds?.retryShiftMs === 0;
        reads.push({ start: region.sourceStartMs, retry, reuse: (options.bounds as { reuseEncoder?: boolean } | undefined)?.reuseEncoder });
        // The 30 s window and the first 20 s retry hear nothing; the second 20 s retry holds the real line. This is the
        // measured KING shape (the 19-word English rap line is the SECOND retry of its window).
        const words = retry ? (region.sourceStartMs === 10_000 ? ["kya", "der", "hai", "aaj"] : ["nan"]) : ["nan"];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline(
      { ingest: trackIngest({ durationMs: 30_000, voiced: [{ startMs: 0, endMs: 30_000 }] }), vad: makeVad([]), engine, aligner: evenAligner() },
      { c2Time: false, reuseEncoder: false },
    );
    const result = await pipeline.run(FILE, { language, detection: "everything" });
    // Both retry slices were read: no early break, no read budget.
    expect(reads.filter((read) => read.retry).map((read) => read.start)).toEqual([0, 10_000]);
    // The second retry's words survive; an extra read can only add words.
    expect(texts(result.words)).toEqual(expect.arrayContaining(["kya", "der", "hai"]));
    // reuseEncoder: false really reaches the engine: every song read asks for no encoder sharing.
    expect(reads.every((read) => read.reuse === false)).toBe(true);
  });

  it("prints one debug line per read when asked, and stays silent otherwise", async () => {
    const engine: SpeechEngine = {
      id: "debug-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        const words = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    const pipeline = createCaptionPipeline(
      { ingest: trackIngest({ durationMs: 20_000, voiced: [{ startMs: 0, endMs: 20_000 }] }), vad: makeVad([]), engine, aligner: evenAligner() },
      { debugReads: true },
    );
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    let lines: unknown[] = [];
    try {
      await pipeline.run(FILE, { language, detection: "everything" });
      lines = spy.mock.calls.map((call) => call[0]);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(1); // a clean window: one base read, no vote and no rescue
    expect(lines[0]).toMatch(/^\[captions\] read win=\d+ token=en kind=base raw=9 kept=9 realLatin=9 lp=-0\.200 ms=\d+ text=alfa bravo/);
  });
});

describe("createCaptionPipeline: speech mode is unchanged", () => {
  it("returns the same words and times on a speech-like clip (voiced bursts and pauses)", async () => {
    const bursts = [{ startMs: 500, endMs: 4200 }, { startMs: 6000, endMs: 9500 }, { startMs: 12_000, endMs: 16_000 }];
    const timeline = makeTimeline(bursts, 33);
    const engineProbe: EngineProbe = { transcribeCalls: 0, windows: [], loads: 0, releases: 0 };
    const vad = makeVad(timeline.speech);
    const pipeline = createCaptionPipeline({
      ingest: trackIngest({ durationMs: 18_000, voiced: bursts }),
      vad,
      engine: makeTruthEngine(timeline.truth, { probe: engineProbe }),
      aligner: makeTruthAligner(timeline.truth),
    });
    const result = await pipeline.run(FILE, { language });
    expect(engineProbe.transcribeCalls).toBe(1);
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    result.words.forEach((word, i) => {
      expect(word.startMs).toBe(timeline.truth[i].startMs);
      expect(word.endMs).toBe(timeline.truth[i].endMs);
      expect(word.index).toBe(i);
    });
    expect(result.stats).toMatchObject({ windows: 1, flaggedWindows: 0, droppedWords: 0 });
    expect(result.stats.speechSeconds).toBeCloseTo((3700 + 3500 + 4000) / 1000, 3);
  });

  it("keeps a lone 'nan', because a speech run has no instrumental spans to judge it against", async () => {
    const engine: SpeechEngine = {
      id: "nan-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        return { windowIndex: input.window.index, words: ["nan"], tokenIds: [1], noSpeechProbability: 0.05, averageLogProbability: -0.1 };
      },
    };
    const aligner: WordAligner = {
      id: "even",
      async load() {},
      async release() {},
      async align(input, transcript) {
        return transcript.words.map((text, i) => ({ text, startMs: 500 + i * 500, endMs: 900 + i * 500, confidence: 1, index: i, windowIndex: input.window.index }));
      },
    };
    const pipeline = createCaptionPipeline({ ingest: trackIngest({ durationMs: 5000, voiced: [{ startMs: 0, endMs: 5000 }] }), vad: makeVad([{ startMs: 0, endMs: 5000 }]), engine, aligner });
    const result = await pipeline.run(FILE, { language });
    expect(texts(result.words)).toEqual(["nan"]);
    expect(result.stats.droppedWords).toBe(0);
  });
});

describe("dropJunkInInstrumentalSpans", () => {
  const word = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs, confidence: 1, index: 0, windowIndex: 0 });
  const instrumental = [{ startMs: 10_000, endMs: 20_000 }];

  it("drops a junk token inside an instrumental span when it sits next to a real word", () => {
    const words = [word("kya", 9500, 9800), word("nan", 12_000, 12_300), word("der", 12_800, 13_000)];
    expect(dropJunkInInstrumentalSpans(words, instrumental).map((item) => item.text)).toEqual(["kya", "der"]);
  });

  it("keeps a junk token outside every instrumental span", () => {
    const words = [word("kya", 1000, 1300), word("nan", 2000, 2300), word("der", 3000, 3300)];
    expect(dropJunkInInstrumentalSpans(words, instrumental).map((item) => item.text)).toEqual(["kya", "nan", "der"]);
  });

  it("keeps a junk token inside a span when it has no real neighbour (the gate owns that case)", () => {
    const words = [word("nan", 12_000, 12_300), word("n", 13_000, 13_300)];
    expect(dropJunkInInstrumentalSpans(words, instrumental).map((item) => item.text)).toEqual(["nan", "n"]);
  });

  it("returns the words untouched when there are no instrumental spans, which is always speech mode", () => {
    const words = [word("kya", 1000, 1300), word("nan", 2000, 2300), word("der", 3000, 3300)];
    expect(dropJunkInInstrumentalSpans(words, [])).toEqual(words);
  });
});

describe("dropIsolatedLowConfidenceJunk", () => {
  const word = (text: string, confidence: number): Word => ({ text, startMs: 0, endMs: 100, confidence, index: 0, windowIndex: 0 });

  it("drops an unsure junk token that sits between real words (the measured KING case)", () => {
    const words = [word("de.", 0.8), word("nan?", 0.23), word("Tum", 0.7)];
    expect(dropIsolatedLowConfidenceJunk(words).map((item) => item.text)).toEqual(["de.", "Tum"]);
  });

  it("keeps a junk token the model was sure about: a confident word is never removed", () => {
    const words = [word("de.", 0.8), word("nan", 0.9), word("Tum", 0.7)];
    expect(dropIsolatedLowConfidenceJunk(words).map((item) => item.text)).toEqual(["de.", "nan", "Tum"]);
  });

  it("keeps a run of junk words with no real neighbour (the junk-text gate owns that window)", () => {
    const words = [word("nan", 0.1), word("n", 0.1)];
    expect(dropIsolatedLowConfidenceJunk(words).map((item) => item.text)).toEqual(["nan", "n"]);
  });

  it("drops a whole run of unsure junk tokens between real words, not just the first", () => {
    const words = [word("kya", 0.8), word("nan", 0.2), word("n", 0.1), word("nan", 0.2), word("der", 0.7)];
    expect(dropIsolatedLowConfidenceJunk(words).map((item) => item.text)).toEqual(["kya", "der"]);
  });

  it("never touches real words, with or without a junk neighbour", () => {
    const words = [word("kya", 0.2), word("der", 0.1)];
    expect(dropIsolatedLowConfidenceJunk(words)).toEqual(words);
  });
});

describe("createCaptionPipeline: prewarm and unload", () => {
  const speech = [{ startMs: 500, endMs: 4000 }];

  it("prewarm starts the engine without opening any audio, and the run after it still works", async () => {
    const { pipeline, engineProbe, ingestProbe, timeline } = setup(speech);
    await pipeline.prewarm?.();
    expect(engineProbe.loads).toBe(1);
    expect(ingestProbe.opened).toBe(0);
    const result = await pipeline.run(FILE, { language });
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    // The run asks the engine to load again; the real engine's load() returns at once when it is already loaded.
    expect(engineProbe.loads).toBe(2);
  });

  it("prewarm never throws, even when the engine fails to start", async () => {
    const { pipeline, deps } = setup(speech);
    deps.engine.load = async () => {
      throw new Error("no gpu");
    };
    await expect(pipeline.prewarm?.()).resolves.toBeUndefined();
  });

  it("prewarm and unload do nothing after dispose", async () => {
    const { pipeline, engineProbe } = setup(speech);
    await pipeline.dispose();
    await pipeline.prewarm?.();
    await pipeline.unloadModels?.();
    expect(engineProbe.loads).toBe(0);
    expect(engineProbe.releases).toBe(1); // only dispose's own release
  });

  it("unloadModels frees the engine and the voice detector, and the next run still works", async () => {
    const { pipeline, engineProbe, vad, timeline } = setup(speech);
    const release = vi.spyOn(vad, "release");
    await pipeline.run(FILE, { language });
    await pipeline.unloadModels?.();
    expect(engineProbe.releases).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
    const again = await pipeline.run(FILE, { language });
    expect(texts(again.words)).toEqual(texts(timeline.truth));
    expect(engineProbe.loads).toBe(2); // started again for the second run
  });

  it("a run that starts while the models are being unloaded (after a prewarm) still works", async () => {
    const { pipeline, deps, timeline } = setup(speech);
    const inner = deps.engine;
    let loaded = false;
    let loading: Promise<void> | null = null;
    // Behaves like the real engine: load() shares one in-flight load, release() waits for it and then clears, transcribe needs a loaded model.
    deps.engine = {
      ...inner,
      load: () => (loaded ? Promise.resolve() : (loading ??= sleep(30).then(() => { loaded = true; loading = null; }))),
      release: async () => {
        if (loading) await loading;
        loaded = false;
      },
      transcribe: (input, options) => {
        if (!loaded) throw new CaptionError("internal", "The speech engine is not loaded.");
        return inner.transcribe(input, options);
      },
    };
    const rebuilt = createCaptionPipeline(deps);
    void rebuilt.prewarm?.();
    await sleep(5); // the prewarm's load is now in flight
    void rebuilt.unloadModels?.();
    const result = await rebuilt.run(FILE, { language });
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    void pipeline; // the first pipeline is unused: only the rebuilt one runs against the stateful engine
  });

  it("unloadModels does nothing while a job is running", async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    const { pipeline, engineProbe } = setup(speech, { onChunk: () => started() });
    const job = pipeline.run(FILE, { language });
    await running;
    await pipeline.unloadModels?.();
    expect(engineProbe.releases).toBe(0);
    await job;
  });
});

describe("createCaptionPipeline: streaming and progress", () => {
  const segments = Array.from({ length: 6 }, (_, i) => ({ startMs: i * 30_000, endMs: i * 30_000 + 24_000 }));

  it("shows the first captions before the file has been read, in order", async () => {
    const seen: { chunks: number; words: Word[]; events: number }[] = [];
    const { pipeline, ingestProbe, timeline } = setup(segments);
    const result = await pipeline.run(FILE, {
      language,
      onPartial: (events, words) => seen.push({ chunks: ingestProbe.chunksYielded, words, events: events.length }),
    });
    const totalChunks = ingestProbe.chunksYielded;
    expect(seen.length).toBe(6); // one per window
    expect(seen[0].chunks).toBeLessThan(totalChunks / 2); // arrived while the file was still being read
    for (let i = 1; i < seen.length; i += 1) expect(seen[i].words.length).toBeGreaterThan(seen[i - 1].words.length);
    // Every partial is a true prefix of the final transcript: earlier captions never change under the viewer.
    for (const partial of seen) expect(texts(partial.words)).toEqual(texts(timeline.truth).slice(0, partial.words.length));
    expect(texts(seen[5].words)).toEqual(texts(result.words));
  });

  it("reports progress that never goes backwards, from reading to 100 %, with plain messages", async () => {
    const progress: PipelineProgress[] = [];
    const { pipeline } = setup(segments);
    await pipeline.run(FILE, { language, onProgress: (p) => progress.push(p) });
    expect(progress[0].stage).toBe("reading-audio");
    expect(progress[progress.length - 1]).toMatchObject({ stage: "finishing", fraction: 1 });
    for (let i = 1; i < progress.length; i += 1) expect(progress[i].fraction).toBeGreaterThanOrEqual(progress[i - 1].fraction);
    expect(progress.every((p) => p.fraction >= 0 && p.fraction <= 1 && p.message.length > 0)).toBe(true);
    const stages = progress.map((p) => p.stage);
    expect(stages.indexOf("loading-model")).toBeGreaterThan(-1);
    expect(stages.indexOf("loading-model")).toBeLessThan(stages.indexOf("transcribing"));
    const messages = progress.filter((p) => p.stage === "transcribing").map((p) => p.message);
    expect(messages).toContain("Transcribing part 1"); // total unknown while the file is still being read
    expect(messages[messages.length - 1]).toMatch(/^Transcribing [0-9] of 6$/); // known once reading is done
    // It must have moved: not stuck at the start until the very end.
    expect(progress.filter((p) => p.fraction > 0.1 && p.fraction < 0.9).length).toBeGreaterThan(3);
  });

  it("works when the container does not report a duration", async () => {
    const progress: PipelineProgress[] = [];
    const { pipeline, timeline } = setup(segments, { reportDuration: false });
    const result = await pipeline.run(FILE, { language, onProgress: (p) => progress.push(p) });
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    for (let i = 1; i < progress.length; i += 1) expect(progress[i].fraction).toBeGreaterThanOrEqual(progress[i - 1].fraction);
  });

  it("passes model download progress through, and survives a throwing callback", async () => {
    const timeline = makeTimeline([{ startMs: 0, endMs: 4000 }], 2);
    const baseEngine = makeTruthEngine(timeline.truth);
    const engine: SpeechEngine = {
      ...baseEngine,
      async load(options) {
        options?.onDownload?.({ file: "encoder.onnx", loadedBytes: 5, totalBytes: 10 });
      },
    };
    const pipeline = createCaptionPipeline({ ingest: makeIngest({ durationMs: 5000 }), vad: makeVad(timeline.speech), engine, aligner: makeTruthAligner(timeline.truth) });
    const progress: PipelineProgress[] = [];
    const result = await pipeline.run(FILE, {
      language,
      onProgress: (p) => {
        progress.push(p);
        throw new Error("screen bug");
      },
      onPartial: () => {
        throw new Error("screen bug");
      },
    });
    expect(result.words.length).toBe(timeline.truth.length);
    expect(progress.find((p) => p.download)?.download).toEqual({ file: "encoder.onnx", loadedBytes: 5, totalBytes: 10 });
  });

  it("records time per stage using the injected clock", async () => {
    let clock = 0;
    const { deps } = setup([{ startMs: 0, endMs: 4000 }]);
    const pipeline = createCaptionPipeline({ ...deps, now: () => (clock += 10) });
    const result = await pipeline.run(FILE, { language });
    for (const stage of ["reading-audio", "finding-speech", "loading-model", "transcribing", "aligning", "finishing"] as const) {
      expect(result.stats.stageMs[stage], stage).toBeGreaterThan(0);
    }
  });
});

describe("createCaptionPipeline: cancellation and errors", () => {
  const segments = Array.from({ length: 6 }, (_, i) => ({ startMs: i * 40_000, endMs: i * 40_000 + 25_000 }));

  it("stops after a cancel in the middle: no more windows, source closed, models released", async () => {
    const controller = new AbortController();
    const { pipeline, engineProbe, ingestProbe, alignerProbe } = setup(segments);
    let callsAtAbort = -1;
    let partials = 0;
    const run = pipeline.run(FILE, {
      language,
      signal: controller.signal,
      onPartial: () => {
        partials += 1;
        if (partials === 2) {
          callsAtAbort = engineProbe.transcribeCalls;
          controller.abort();
        }
      },
    });
    await expect(run).rejects.toMatchObject({ name: "CaptionError", code: "aborted" });
    const chunksAtReject = ingestProbe.chunksYielded;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engineProbe.transcribeCalls).toBe(callsAtAbort); // nothing ran after the abort
    expect(ingestProbe.chunksYielded).toBe(chunksAtReject); // and the file stopped being read
    expect(partials).toBe(2);
    expect(ingestProbe.closed).toBe(1);
    expect(engineProbe.releases).toBeGreaterThanOrEqual(1);
    expect(alignerProbe.releases).toBeGreaterThanOrEqual(1);
  });

  it("rejects promptly even when the engine ignores the abort signal", async () => {
    const controller = new AbortController();
    const { pipeline } = setup(segments, { engine: { hangOn: () => true } });
    const run = pipeline.run(FILE, { language, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const began = Date.now();
    await expect(run).rejects.toMatchObject({ code: "aborted" });
    expect(Date.now() - began).toBeLessThan(1000);
  });

  it("rejects at once when the signal is already cancelled, without opening the file", async () => {
    const controller = new AbortController();
    controller.abort();
    const { pipeline, ingestProbe } = setup(segments);
    await expect(pipeline.run(FILE, { language, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(ingestProbe.opened).toBe(0);
  });

  it("retries a failed window once and carries on", async () => {
    const { pipeline, engineProbe, timeline } = setup(segments, { engine: { failOn: (index, attempt) => (index === 2 && attempt === 1 ? new Error("gpu hiccup") : null) } });
    const result = await pipeline.run(FILE, { language });
    expect(engineProbe.transcribeCalls).toBe(7);
    expect(texts(result.words)).toEqual(texts(timeline.truth));
  });

  it("fails the job with 'inference' when a window fails twice, and releases everything", async () => {
    const { pipeline, engineProbe, ingestProbe } = setup(segments, { engine: { failOn: (index) => (index === 1 ? new Error("out of memory") : null) } });
    const partials = vi.fn();
    await expect(pipeline.run(FILE, { language, onPartial: partials })).rejects.toMatchObject({ code: "inference" });
    expect(partials).toHaveBeenCalledTimes(1); // window 0 was shown before window 1 failed
    expect(engineProbe.transcribeCalls).toBe(3);
    expect(engineProbe.releases).toBeGreaterThanOrEqual(1);
    expect(ingestProbe.closed).toBe(1);
  });

  it("keeps a CaptionError from the engine as it is (device-lost stays device-lost)", async () => {
    const { pipeline } = setup(segments, { engine: { failOn: () => new CaptionError("device-lost", "GPU gone") } });
    await expect(pipeline.run(FILE, { language })).rejects.toMatchObject({ code: "device-lost" });
  });

  it("maps a model that will not start to 'model-load'", async () => {
    const { deps } = setup(segments);
    const engine: SpeechEngine = { ...deps.engine, async load() { throw new Error("no memory"); } };
    await expect(createCaptionPipeline({ ...deps, engine }).run(FILE, { language })).rejects.toMatchObject({ code: "model-load" });
  });

  it("throws 'no-speech' when the detector hears nothing, and never loads the model", async () => {
    const { pipeline, engineProbe } = setup([{ startMs: 0, endMs: 5000 }], { vadSpeech: [] });
    await expect(pipeline.run(FILE, { language })).rejects.toMatchObject({ code: "no-speech" });
    expect(engineProbe.loads).toBe(0);
  });

  it("passes the ingest's own errors through and wraps unknown ones as 'unsupported-file'", async () => {
    const timeline = makeTimeline([{ startMs: 0, endMs: 3000 }]);
    const base = { vad: makeVad(timeline.speech), engine: makeTruthEngine(timeline.truth), aligner: makeTruthAligner(timeline.truth) };
    const noAudio = createCaptionPipeline({ ...base, ingest: makeIngest({ durationMs: 1000, openError: new CaptionError("no-audio", "silent file") }) });
    await expect(noAudio.run(FILE, { language })).rejects.toMatchObject({ code: "no-audio" });
    const weird = createCaptionPipeline({ ...base, ingest: makeIngest({ durationMs: 1000, openError: new TypeError("boom") }) });
    await expect(weird.run(FILE, { language })).rejects.toMatchObject({ code: "unsupported-file" });
  });

  it("refuses a second job while one is running, and can run again afterwards", async () => {
    const { pipeline } = setup([{ startMs: 0, endMs: 4000 }]);
    const first = pipeline.run(FILE, { language });
    await expect(pipeline.run(FILE, { language })).rejects.toMatchObject({ code: "internal" });
    await first;
    await expect(pipeline.run(FILE, { language })).resolves.toBeTruthy();
  });

  it("dispose cancels a running job and frees the models", async () => {
    const { pipeline, engineProbe } = setup(segments);
    const run = pipeline.run(FILE, { language, onPartial: () => void pipeline.dispose() });
    await expect(run).rejects.toMatchObject({ code: "aborted" });
    expect(engineProbe.releases).toBeGreaterThanOrEqual(1);
    await expect(pipeline.run(FILE, { language })).rejects.toMatchObject({ code: "internal" });
  });
});

describe("createCaptionPipeline: hallucination handling", () => {
  const segments = Array.from({ length: 4 }, (_, i) => ({ startMs: i * 40_000, endMs: i * 40_000 + 20_000 }));

  it("drops a window that loops, counts it, never aligns it, and reports its speech as uncovered", async () => {
    const aligner = vi.fn();
    const loop = Array.from({ length: 12 }, () => ["Thank", "you", "for", "watching."]).flat();
    const { deps, timeline } = setup(segments, { engine: { override: (index) => (index === 1 ? { words: loop } : null) } });
    const spying: WordAligner = {
      ...deps.aligner,
      async align(input, transcript, signal) {
        aligner(input.window.index);
        return deps.aligner.align(input, transcript, signal);
      },
    };
    const result = await createCaptionPipeline({ ...deps, aligner: spying }).run(FILE, { language });

    expect(aligner.mock.calls.map((c) => c[0])).toEqual([0, 2, 3]);
    const expected = timeline.truth.filter((w) => w.startMs < 40_000 || w.startMs >= 80_000);
    expect(texts(result.words)).toEqual(texts(expected));
    expect(result.stats.flaggedWindows).toBe(1);
    expect(result.stats.droppedWords).toBe(48);
    expect(result.uncoveredSpeech).toEqual([{ startMs: 40_000, endMs: 60_000 }]);
  });

  it("drops a window the model itself says is probably not speech", async () => {
    const { pipeline } = setup(segments, { engine: { override: (index) => (index === 3 ? { noSpeechProbability: 0.93 } : null) } });
    const result = await pipeline.run(FILE, { language });
    expect(result.stats.flaggedWindows).toBe(1);
    expect(result.words.every((w) => w.startMs < 120_000)).toBe(true);
  });

  it("drops a window whose aligned words fall in the padding, but keeps one that is merely slow", async () => {
    const timeline = makeTimeline(segments, 5);
    const lateAligner: WordAligner = {
      id: "late",
      async load() {},
      async release() {},
      async align(input, transcript) {
        // Window 0: every word placed after the used part of the window (an aligner that lost the plot).
        const shift = input.window.index === 0 ? input.window.usedMs + 2000 : 0;
        return transcript.words.map((text, i) => ({ text, startMs: shift + i * 300, endMs: shift + i * 300 + 250, confidence: 0.2, index: i, windowIndex: 0 }));
      },
    };
    const deps: PipelineDeps = { ingest: makeIngest({ durationMs: 165_000 }), vad: makeVad(timeline.speech), engine: makeTruthEngine(timeline.truth), aligner: lateAligner };
    const result = await createCaptionPipeline(deps).run(FILE, { language });
    expect(result.stats.flaggedWindows).toBe(1);
    expect(result.words.every((w) => w.startMs >= 40_000)).toBe(true);
    expect(result.words.length).toBeGreaterThan(0);
  });

  it("keeps the words of a window that is only 'too slow' (missing words, not invented ones)", async () => {
    const { pipeline } = setup([{ startMs: 0, endMs: 20_000 }], { engine: { override: () => ({ words: ["haan"] }) } });
    const result = await pipeline.run(FILE, { language });
    expect(result.stats.flaggedWindows).toBe(1);
    expect(texts(result.words)).toEqual(["haan"]);
  });
});

describe("createCaptionPipeline: the aligner", () => {
  const segments = Array.from({ length: 3 }, (_, i) => ({ startMs: i * 40_000, endMs: i * 40_000 + 20_000 }));

  it("falls back to uniform timing for a window the aligner cannot do, keeping its words", async () => {
    const { pipeline, timeline } = setup(segments, { aligner: { failOn: (index) => index === 1 } });
    const result = await pipeline.run(FILE, { language });
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    const middle = result.words.filter((w) => w.startMs >= 40_000 && w.startMs < 80_000);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every((w) => w.confidence === 0.5)).toBe(true);
    expect(result.words.filter((w) => w.startMs < 40_000).every((w) => w.confidence === 0.9)).toBe(true);
    // The uniform timing still fills the speech exactly at its edges.
    expect(middle[0].startMs).toBe(40_000);
    expect(middle[middle.length - 1].endMs).toBe(60_000);
  });

  it("uses the model-free aligner for the whole job when the real one will not load", async () => {
    const { deps, timeline } = setup(segments);
    const aligner: WordAligner = { ...deps.aligner, async load() { throw new CaptionError("model-download", "offline"); } };
    const result = await createCaptionPipeline({ ...deps, aligner }).run(FILE, { language });
    expect(result.stats.alignerId).toBe("uniform");
    expect(texts(result.words)).toEqual(texts(timeline.truth));
  });

  it("treats an aligner that returns the wrong number of words as failed", async () => {
    const { deps, timeline } = setup(segments);
    const aligner: WordAligner = { ...deps.aligner, async align() { return []; } };
    const result = await createCaptionPipeline({ ...deps, aligner }).run(FILE, { language });
    expect(texts(result.words)).toEqual(texts(timeline.truth));
  });
});

describe("createCaptionPipeline: long files", () => {
  it("processes a 3 hour timeline holding at most a couple of windows of audio", async () => {
    const segments = Array.from({ length: 180 }, (_, i) => ({ startMs: i * 60_000, endMs: i * 60_000 + 20_000 }));
    let peak = 0;
    const { pipeline, timeline } = setup(segments, { durationMs: 3 * 3600_000, tuning: { onRetained: (ms) => (peak = Math.max(peak, ms)) } });
    const result = await pipeline.run(FILE, { language });
    expect(result.stats.windows).toBe(180);
    expect(result.words).toHaveLength(timeline.truth.length);
    expect(result.stats.audioSeconds).toBe(10_800);
    expect(peak).toBeGreaterThan(0);
    // Window = 30 s. The whole file is 10 800 s; we hold the audio from the first unfinished window on.
    expect(peak).toBeLessThanOrEqual(100_000);
  }, 120_000);

  it("keeps memory bounded through ten minutes of unbroken speech and still loses no word", async () => {
    // The detector cuts speech into contiguous 10 s pieces; the packer re-joins and re-splits them.
    const pieces = Array.from({ length: 60 }, (_, i) => ({ startMs: i * 10_000, endMs: (i + 1) * 10_000 }));
    let peak = 0;
    const { pipeline, timeline, engineProbe } = setup(pieces, { tuning: { onRetained: (ms) => (peak = Math.max(peak, ms)) } });
    const result = await pipeline.run(FILE, { language });
    expect(engineProbe.transcribeCalls).toBeGreaterThan(18);
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    expect(peak).toBeLessThanOrEqual(110_000);
  }, 60_000);

  it("lets go of old audio when the detector never closes anything, instead of growing without limit", async () => {
    // A detector that hears nothing until the very end: all audio would be kept. The cap protects the tab.
    let peak = 0;
    const timeline = makeTimeline([{ startMs: 0, endMs: 4000 }], 1);
    const vad = makeVad([{ startMs: 0, endMs: 4000 }], 10 * 60_000);
    const probe: EngineProbe = { transcribeCalls: 0, windows: [], loads: 0, releases: 0 };
    const pipeline = createCaptionPipeline(
      { ingest: makeIngest({ durationMs: 120_000 }), vad, engine: makeTruthEngine(timeline.truth, { probe }), aligner: makeTruthAligner(timeline.truth) },
      { maxRetainedMs: 30_000, onRetained: (ms) => (peak = Math.max(peak, ms)) },
    );
    await pipeline.run(FILE, { language });
    expect(peak).toBeLessThanOrEqual(31_000);
    // The 0-4 s speech was let go before it closed, so the model is given silence for it (a real model
    // then returns no words, and the stretch shows up in `uncoveredSpeech`) rather than wrong audio.
    expect(probe.windows[0].samples.every((v) => v === 0)).toBe(true);
  }, 60_000);
});

/** Resolves with how a promise ended, or "pending" if it had not ended after `ms`. Never hangs the test. */
async function outcomeWithin(promise: Promise<unknown>, ms: number): Promise<string> {
  return Promise.race([
    promise.then(
      () => "resolved",
      (error: unknown) => (error instanceof CaptionError ? `rejected:${error.code}` : "rejected:other"),
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}


describe("createCaptionPipeline: regressions found in review", () => {
  const segments = Array.from({ length: 6 }, (_, i) => ({ startMs: i * 40_000, endMs: i * 40_000 + 25_000 }));

  it("#1 cancel rejects 'aborted' promptly although engine.release() never settles, and still tries to release", async () => {
    const { deps } = setup(segments, { engine: { hangOn: () => true } });
    const stuck = new Promise<void>(() => undefined);
    let releases = 0;
    let alignerReleases = 0;
    const engine: SpeechEngine = { ...deps.engine, async release() { releases += 1; await stuck; } };
    const aligner: WordAligner = { ...deps.aligner, async release() { alignerReleases += 1; await stuck; } };
    const pipeline = createCaptionPipeline({ ...deps, engine, aligner }, { cleanupTimeoutMs: 40 });
    const controller = new AbortController();
    const run = pipeline.run(FILE, { language, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    expect(await outcomeWithin(run, 250)).toBe("rejected:aborted");
    await sleep(250);
    expect(releases).toBe(1);
    expect(alignerReleases).toBe(1);
  });

  it("#1 dispose() also returns although every release hangs", async () => {
    const { deps } = setup(segments, { engine: { hangOn: () => true } });
    const stuck = new Promise<void>(() => undefined);
    const engine: SpeechEngine = { ...deps.engine, async release() { await stuck; } };
    const vad = { ...deps.vad, release: () => stuck };
    const pipeline = createCaptionPipeline({ ...deps, engine, vad }, { cleanupTimeoutMs: 40 });
    const run = pipeline.run(FILE, { language });
    void run.catch(() => undefined);
    await sleep(30);
    expect(await outcomeWithin(pipeline.dispose(), 600)).toBe("resolved");
    expect(await outcomeWithin(run, 100)).toBe("rejected:aborted");
  });

  /** An ingest whose source is hand-made so a test can make it misbehave. */
  function customIngest(make: (probe: { closed: number }) => Promise<AudioSource>): { ingest: AudioIngest; probe: { closed: number } } {
    const probe = { closed: 0 };
    return { ingest: { open: () => make(probe) }, probe };
  }
  const baseDeps = () => {
    const timeline = makeTimeline([{ startMs: 0, endMs: 5000 }]);
    return { vad: makeVad(timeline.speech), engine: makeTruthEngine(timeline.truth), aligner: makeTruthAligner(timeline.truth) };
  };

  it("#2 a chunks() iterator stuck in next() does not stop cancel, and the source is still closed", async () => {
    const { ingest, probe } = customIngest(async (p) => ({
      durationMs: 5000,
      async *chunks() {
        await new Promise<never>(() => undefined);
        yield { startMs: 0, samples: new Float32Array(0) };
      },
      async close() { p.closed += 1; },
    }));
    const pipeline = createCaptionPipeline({ ...baseDeps(), ingest });
    const controller = new AbortController();
    const run = pipeline.run(FILE, { language, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await outcomeWithin(run, 250)).toBe("rejected:aborted");
    expect(probe.closed).toBe(1);
  });

  it("#3 a source that finishes opening after the cancel is closed, not leaked", async () => {
    const { ingest, probe } = customIngest(async (p) => {
      await sleep(60);
      return { durationMs: 5000, async *chunks() {}, async close() { p.closed += 1; } };
    });
    const pipeline = createCaptionPipeline({ ...baseDeps(), ingest });
    const controller = new AbortController();
    const run = pipeline.run(FILE, { language, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toMatchObject({ code: "aborted" });
    await sleep(150);
    expect(probe.closed).toBe(1);
  });

  it("#4 a chunks() that throws at once closes the source and is reported as 'unsupported-file'", async () => {
    const { ingest, probe } = customIngest(async (p) => ({
      durationMs: 5000,
      chunks(): AsyncIterable<never> { throw new Error("decoder could not start"); },
      async close() { p.closed += 1; },
    }));
    const pipeline = createCaptionPipeline({ ...baseDeps(), ingest });
    await expect(pipeline.run(FILE, { language })).rejects.toMatchObject({ code: "unsupported-file" });
    expect(probe.closed).toBe(1);
  });

  it("#5 a run() started from inside onProgress is refused and does not disturb the first job", async () => {
    const { pipeline, timeline } = setup([{ startMs: 0, endMs: 5000 }]);
    let nested: Promise<unknown> | null = null;
    const result = await pipeline.run(FILE, {
      language,
      onProgress: () => {
        nested ??= pipeline.run(FILE, { language });
      },
    });
    expect(texts(result.words)).toEqual(texts(timeline.truth));
    expect(await outcomeWithin(nested ?? Promise.resolve(), 100)).toBe("rejected:internal");
  });

  it("#5 dispose() called from the very first onProgress cancels that job", async () => {
    const { pipeline } = setup(segments);
    let called = false;
    const run = pipeline.run(FILE, {
      language,
      onProgress: () => {
        if (!called) {
          called = true;
          void pipeline.dispose();
        }
      },
    });
    expect(await outcomeWithin(run, 500)).toBe("rejected:aborted");
  });

  it("#7 onPartial fires once per finished window, including a window that heard nothing", async () => {
    const two = [{ startMs: 0, endMs: 25_000 }, { startMs: 40_000, endMs: 65_000 }];
    const { pipeline, timeline } = setup(two, { engine: { override: (index) => (index === 0 ? { words: [] } : null) } });
    const partials: Word[][] = [];
    const result = await pipeline.run(FILE, { language, onPartial: (_events, words) => partials.push(words) });
    expect(result.stats.windows).toBe(2);
    expect(partials).toHaveLength(2);
    expect(partials[0]).toEqual([]);
    expect(texts(partials[1])).toEqual(texts(result.words));
    expect(timeline.truth.length).toBeGreaterThan(result.words.length); // window 0's words really were lost
  });

  it("#7 onPartial also fires for a window the hallucination gate dropped", async () => {
    const two = [{ startMs: 0, endMs: 25_000 }, { startMs: 40_000, endMs: 65_000 }];
    const { pipeline } = setup(two, { engine: { override: (index) => (index === 0 ? { noSpeechProbability: 0.99 } : null) } });
    const partials = vi.fn();
    const result = await pipeline.run(FILE, { language, onPartial: partials });
    expect(result.stats.flaggedWindows).toBe(1);
    expect(partials).toHaveBeenCalledTimes(2);
  });

  it("#6 a preview never changes a word it already showed, even when overlapping windows time it differently", async () => {
    // One unbroken 100 s stretch is cut into overlapping windows. Each window times the same word a
    // few ms differently (a real aligner does this), which used to rewrite the earlier preview.
    const timeline = makeTimeline([{ startMs: 300, endMs: 100_300 }], 25);
    const truthAligner = makeTruthAligner(timeline.truth);
    const jitter = (windowIndex: number, text: string, salt: number) => {
      let h = 2166136261 ^ (windowIndex * 31 + salt);
      for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return (Math.abs(h) % 61) - 30;
    };
    const aligner: WordAligner = {
      ...truthAligner,
      async align(input, transcript, signal) {
        const words = await truthAligner.align(input, transcript, signal);
        return words.map((w) => ({
          ...w,
          startMs: Math.max(0, w.startMs + jitter(input.window.index, w.text, 1)),
          endMs: w.endMs + jitter(input.window.index, w.text, 2),
        }));
      },
    };
    const deps: PipelineDeps = {
      ingest: makeIngest({ durationMs: 102_000 }),
      vad: makeVad(timeline.speech),
      engine: makeTruthEngine(timeline.truth),
      aligner,
    };
    const partials: Word[][] = [];
    const result = await createCaptionPipeline(deps).run(FILE, { language, onPartial: (_e, words) => partials.push(words) });
    expect(partials.length).toBeGreaterThan(3);
    partials.forEach((partial, n) => {
      expect(partial, `partial ${n + 1} of ${partials.length}`).toEqual(result.words.slice(0, partial.length));
    });
    expect(partials[partials.length - 1]).toEqual(result.words); // the last preview is the whole answer
  });
});

describe("createCaptionPipeline: pasted lyrics (forced alignment)", () => {
  /**
   * A fake engine that also implements the optional teacher-forced aligner. `heard` is what the transcript
   * heard in every window; `heardFor` lets a multi-window file hear different words per window (the global
   * planner anchors a paste on the words the transcript actually read, so a test that wants placement must
   * give it words that sound like the paste).
   */
  function lyricsEngine(options: {
    heard?: readonly string[];
    heardFor?: (windowIndex: number) => readonly string[];
    align?: (text: string, usedMs: number, windowIndex: number) => ForcedAlignWord[] | null;
    hideAligner?: boolean;
    characterAlignment?: boolean;
  } = {}) {
    const calls: { text: string; usedMs: number; windowIndex: number; samples: Float32Array }[] = [];
    const engine: SpeechEngine = {
      id: "lyrics-engine",
      async load() {},
      async release() {},
      async transcribe(input) {
        const words = [...(options.heardFor?.(input.window.index) ?? options.heard ?? ["alpha", "bravo"])];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
    if (options.characterAlignment !== undefined) {
      (engine as SpeechEngine & { characterAlignment?: boolean }).characterAlignment = options.characterAlignment;
    }
    if (!options.hideAligner) {
      engine.alignText = async (input, text) => {
        calls.push({ text, usedMs: input.window.usedMs, windowIndex: input.window.index, samples: input.samples });
        const words = options.align ? options.align(text, input.window.usedMs, input.window.index) : null;
        return words === null ? null : { words };
      };
    }
    return { engine, calls };
  }

  const evenAligner: WordAligner = {
    id: "even",
    async load() {},
    async release() {},
    async align(input, transcript) {
      return transcript.words.map((text, i) => ({
        text,
        startMs: 500 + i * 300,
        endMs: 700 + i * 300,
        confidence: 1,
        index: i,
        windowIndex: input.window.index,
      }));
    },
  };

  const pipelineFor = (engine: SpeechEngine, durationMs: number, options: { speech?: SpeechInterval[]; aligner?: WordAligner } = {}) =>
    createCaptionPipeline({
      ingest: makeIngest({ durationMs }),
      vad: makeVad(options.speech ?? [{ startMs: 0, endMs: durationMs }]),
      engine,
      aligner: options.aligner ?? evenAligner,
    });

  /**
   * Puts each heard word at a GLOBAL time (the "measured" transcript timing), mapped onto its window's
   * packed timeline the way the pipeline's own alignment does. The map is by text, so every fixture's words
   * must be distinct.
   */
  const timesAligner = (times: Record<string, readonly [number, number]>): WordAligner => ({
    id: "times",
    async load() {},
    async release() {},
    async align(input, transcript) {
      return transcript.words.map((text, i) => {
        const [startMs, endMs] = times[text] ?? [500 + i * 300, 700 + i * 300];
        const region = input.window.regions.find((item) => startMs >= item.sourceStartMs && startMs < item.sourceEndMs);
        const at = (ms: number) => (region === undefined ? ms : region.packOffsetMs + (ms - region.sourceStartMs));
        return { text, startMs: at(startMs), endMs: at(endMs), confidence: 1, index: i, windowIndex: input.window.index };
      });
    },
  });

  /** Places each word of the text in order, starting at 1 s, 1 s apart. */
  const spaced = (text: string, logProbability: (index: number) => number = () => -0.15): ForcedAlignWord[] =>
    text.split(" ").map((word, i) => ({
      text: word,
      startMs: 1000 + i * 1000,
      endMs: 1800 + i * 1000,
      logProbability: logProbability(i),
      sharpness: 0.9,
    }));

  it("gives anchored words the visitor's spelling and the transcript's measured times", async () => {
    // The planner learns the song's shape from the words the transcript actually heard: "kya der hai zindagi"
    // anchor the paste, so those four words keep the visitor's spelling AND the measured transcript intervals.
    const { engine, calls } = lyricsEngine({ heard: ["kya", "der", "hai", "zindagi"], align: () => null });
    const times = timesAligner({ kya: [3000, 3400], der: [4000, 4400], hai: [5000, 5400], zindagi: [6000, 6400] });
    const result = await pipelineFor(engine, 20_000, { aligner: times }).run(FILE, {
      language,
      lyrics: "Kya der hai\nzindagi mera",
    });

    expect(calls).toHaveLength(1); // one window, one verification pass; it returns null and the plan still stands
    expect(calls[0].text).toBe("Kya der hai zindagi mera");
    expect(texts(result.words)).toEqual(["Kya", "der", "hai", "zindagi", "mera"]);
    const byText = new Map(result.words.map((word) => [word.text, word]));
    // The visitor's spelling, the transcript's measured timing.
    expect(byText.get("Kya")).toMatchObject({ startMs: 3000, endMs: 3400 });
    expect(byText.get("der")).toMatchObject({ startMs: 4000, endMs: 4400 });
    expect(byText.get("hai")).toMatchObject({ startMs: 5000, endMs: 5400 });
    expect(byText.get("zindagi")).toMatchObject({ startMs: 6000, endMs: 6400 });
    // The one word with no anchor is predicted right after the last anchor and marked uncertain.
    expect(byText.get("mera")).toMatchObject({ startMs: 6400, endMs: 6800, uncertain: true });
    // The heard copy is replaced, never shown beside the pasted word.
    expect(texts(result.words).filter((text) => text === "kya")).toEqual([]);
    expect(result.stats.lyrics).toMatchObject({
      lines: 2,
      placed: 5,
      uncertain: 1,
      unmatched: 0,
      unmatchedLines: [],
      returned: 0,
      accepted: 5,
      nullWindows: 1,
      passes: 1,
      timingBorrowed: 4,
      // `approximate` counts only placed words with NO measured timing: the four anchors are measured, "mera" is not.
      approximate: 1,
    });
    expect(result.events.flatMap((event) => event.lines.flat()).map((word) => word.text)).toEqual(texts(result.words));
  });

  it("places unanchored words between two anchors inside voiced audio, never in a gap or after the singing", async () => {
    // One window holds two voiced stretches with a 3 s instrumental gap between them. Only the words the
    // transcript heard ("ek", "do", "chhe", "saat") are anchors; "teen char paanch" must be distributed in
    // the voiced audio between them, and can never land in the gap or past the last voiced millisecond.
    const { engine } = lyricsEngine({ heard: ["ek", "do", "chhe", "saat"], align: () => null });
    const result = await pipelineFor(engine, 20_000, {
      speech: [{ startMs: 0, endMs: 6000 }, { startMs: 9000, endMs: 15_000 }],
      aligner: timesAligner({ ek: [1000, 1400], do: [1800, 2200], chhe: [12_500, 12_900], saat: [13_500, 13_900] }),
    }).run(FILE, { language, lyrics: "ek do\nteen char paanch\nchhe saat" });

    expect(texts(result.words)).toEqual(["ek", "do", "teen", "char", "paanch", "chhe", "saat"]);
    for (const word of result.words) {
      const inGap = word.endMs > 6000 && word.startMs < 9000;
      expect(inGap, `${word.text} must not be placed in the 6-9 s instrumental gap`).toBe(false);
      // Nothing after the last voiced interval (the file runs to 20 s).
      expect(word.startMs).toBeLessThan(15_000);
      expect(word.endMs).toBeLessThanOrEqual(15_000);
    }
    // The three unanchored words sit inside the second voiced stretch, between the "do" and "chhe" anchors.
    for (const text of ["teen", "char", "paanch"]) {
      const word = result.words.find((item) => item.text === text);
      expect(word?.startMs).toBeGreaterThanOrEqual(9000);
      expect(word?.endMs).toBeLessThanOrEqual(12_400);
    }
    expect(result.stats.lyrics).toMatchObject({
      lines: 3,
      placed: 7,
      uncertain: 3, // teen, char, paanch are the predicted (non-anchor) words
      unmatched: 0,
      returned: 0,
      nullWindows: 1,
      passes: 1,
      // Only the three structure estimates (teen, char, paanch) are approximate; the four anchors are measured.
      approximate: 3,
    });
  });

  it("makes one alignment pass per window, and a null pass in one window still leaves the plan and later lines placed", async () => {
    // Two windows: 0-20 s and 40-55 s. Window 0's pass returns null (the aligner cannot read that stretch);
    // the global plan already predicts both lines, so window 1 is still verified and placed, and no cursor has
    // to recover. Exactly one call per window: the removed cursor could re-read a chunk or slide twice.
    const { engine, calls } = lyricsEngine({
      heardFor: (index) => (index === 0 ? ["ek", "do"] : ["saat", "aath"]),
      align: (text, _usedMs, windowIndex) => {
        if (windowIndex === 0) return null;
        return text
          .split(" ")
          .map((word, i) => ({ text: word, startMs: 500 + i * 1000, endMs: 900 + i * 1000, logProbability: -0.2, sharpness: 0.85 }));
      },
    });
    const result = await pipelineFor(engine, 60_000, {
      speech: [{ startMs: 0, endMs: 20_000 }, { startMs: 40_000, endMs: 55_000 }],
      aligner: timesAligner({ ek: [1000, 1400], do: [1800, 2200], saat: [40_500, 40_900], aath: [41_500, 41_900] }),
    }).run(FILE, { language, lyrics: "ek do teen char\nsaat aath" });

    expect(calls).toHaveLength(2); // one pass per window, even for the window the aligner could not read
    expect(calls.map((call) => call.text)).toEqual(["ek do teen char", "saat aath"]);
    expect(texts(result.words)).toEqual(["ek", "do", "teen", "char", "saat", "aath"]);
    const byText = new Map(result.words.map((word) => [word.text, word]));
    // Window 0's plan words are placed although its alignment was null.
    expect(byText.get("ek")).toMatchObject({ startMs: 1000, endMs: 1400 });
    expect(byText.get("do")).toMatchObject({ startMs: 1800, endMs: 2200 });
    expect(byText.get("teen")?.confidence).toBe(0.25); // predicted by the plan, not verified: uncertainty is the low confidence
    // The later line is placed at its measured anchors by window 1's verified pass.
    expect(byText.get("saat")).toMatchObject({ startMs: 40_500, endMs: 40_900 });
    expect(byText.get("aath")).toMatchObject({ startMs: 41_500, endMs: 41_900 });
    expect(result.stats.lyrics).toMatchObject({
      lines: 2,
      placed: 6,
      uncertain: 2,
      unmatched: 0,
      unmatchedLines: [],
      returned: 2,
      accepted: 6,
      nullWindows: 1,
      passes: 2,
      timingBorrowed: 4,
      // teen and char are structure estimates; saat and aath are measured anchors (verified as well).
      approximate: 2,
    });
  });

  it("encodes each window once: the transcription's encoder output is reused by the alignment pass", async () => {
    // The engine's encoder cache, as the real one behaves: keyed on the samples object itself (identity), the window
    // index and usedMs. Only a read that asked to keep the output (`bounds.reuseEncoder`) fills it. A lyrics job must
    // therefore pay N encoder runs for N windows, not 2N (B5: `aligning` = windows x 9-11 s of encoder work).
    const encoded = new Map<string, string>();
    const ids = new WeakMap<Float32Array, number>();
    let nextId = 1;
    const runs: { source: string; window: number }[] = [];
    const keyOf = (input: { samples: Float32Array; window: { index: number; usedMs: number } }) => {
      let id = ids.get(input.samples);
      if (id === undefined) {
        id = nextId;
        nextId += 1;
        ids.set(input.samples, id);
      }
      return `${id}:${input.window.index}:${input.window.usedMs}`;
    };
    const encode = (input: { samples: Float32Array; window: { index: number; usedMs: number } }, source: string) => {
      const key = keyOf(input);
      if (!encoded.has(key)) {
        encoded.set(key, source);
        runs.push({ source, window: input.window.index });
      }
      return key;
    };
    const seenAlignSamples = new Map<number, Float32Array>();
    const seenTranscribeSamples = new Map<number, Float32Array>();
    let transcribeCalls = 0;
    let alignCalls = 0;
    const engine: SpeechEngine = {
      id: "encoder-cache-engine",
      async load() {},
      async release() {},
      async transcribe(input, opts) {
        transcribeCalls += 1;
        seenTranscribeSamples.set(input.window.index, input.samples);
        if ((opts.bounds as { reuseEncoder?: boolean } | undefined)?.reuseEncoder === true) encode(input, "transcribe");
        // Each window hears the first words of its own stretch of the paste, so the planner has anchors to trust.
        // The last window hears the paste's tail: every window then holds words of its own.
        const first = 1 + input.window.index * 10;
        const words = input.window.index === 3 ? ["w28", "w29", "w30"] : [`w${first}`, `w${first + 1}`, `w${first + 2}`];
        return { windowIndex: input.window.index, words, tokenIds: [0, 1, 2], noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
      async alignText(input, text) {
        alignCalls += 1;
        seenAlignSamples.set(input.window.index, input.samples);
        encode(input, "align"); // a miss means the aligner paid its own encoder run
        // Only ten words fit in one window, so a 30-word paste needs several windows.
        return {
          words: text
            .split(" ")
            .slice(0, 10)
            .map((word, i) => ({ text: word, startMs: 1000 + i * 2000, endMs: 1600 + i * 2000, logProbability: -0.2, sharpness: 0.85 })),
        };
      },
    };
    const lyricWords = Array.from({ length: 30 }, (_, i) => `w${i + 1}`);
    const result = await pipelineFor(engine, 90_000).run(FILE, { language, lyrics: lyricWords.join(" ") });

    // Every window was encoded exactly once, by its transcription; the alignment pass added no encoder run at all.
    expect(alignCalls).toBe(transcribeCalls); // exactly one pass per window (the 90 s region packs into four)
    expect(alignCalls).toBe(4);
    expect(runs).toHaveLength(transcribeCalls);
    expect(runs.every((run) => run.source === "transcribe")).toBe(true);
    // The alignment pass was handed the very array the transcription used, or the cache key would never match.
    for (const [index, samples] of seenAlignSamples) expect(seenTranscribeSamples.get(index)).toBe(samples);
    expect(result.stats.lyrics).toMatchObject({ placed: 30, unmatched: 0, passes: 4 });
  });

  it("returns the transcript and reports every line when the paste is a different song", async () => {
    // The heard words share nothing with the paste (no anchors) and the teacher-forced aligner is unsure
    // (log-probability -3 collapses the confidence): the wrong-lyrics guard must return the transcript untouched.
    const { engine } = lyricsEngine({
      heard: ["alpha", "bravo", "charlie", "delta"],
      align: (text) =>
        text.split(" ").map((word, i) => ({ text: word, startMs: 1000 + i * 1000, endMs: 1400 + i * 1000, logProbability: -3, sharpness: 0.1 })),
    });
    const result = await pipelineFor(engine, 20_000, {
      aligner: timesAligner({ alpha: [1000, 1400], bravo: [2000, 2400], charlie: [3000, 3400], delta: [4000, 4400] }),
    }).run(FILE, { language, lyrics: "Kya der hai\nAaj Sajan Mera" });

    expect(texts(result.words)).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(result.stats.lyrics).toMatchObject({
      lines: 2,
      placed: 0,
      uncertain: 0,
      unmatched: 6,
      unmatchedLines: ["Kya der hai", "Aaj Sajan Mera"],
      // The aligner DID return six words; the weak-evidence guard threw them away.
      returned: 6,
      accepted: 0,
      nullWindows: 0,
      passes: 1,
      timingBorrowed: 0,
    });
  });

  it("changes nothing when no lyrics were pasted, even when the engine has an aligner", async () => {
    const withAligner = lyricsEngine();
    const withoutAligner = lyricsEngine({ hideAligner: true });
    const plain = await pipelineFor(withoutAligner.engine, 20_000).run(FILE, { language });
    const withOptional = await pipelineFor(withAligner.engine, 20_000).run(FILE, { language });

    expect(withAligner.calls).toEqual([]); // the aligner is never called without lyrics
    expect(plain.stats.lyrics).toBeUndefined();
    expect(withOptional.stats.lyrics).toBeUndefined();
    expect(withOptional.words).toEqual(plain.words);
    expect(withOptional.events).toEqual(plain.events);
    expect(texts(withOptional.words)).toEqual(["alpha", "bravo"]);
    expect(withOptional.words.map((word) => [word.startMs, word.endMs, word.confidence])).toEqual(
      plain.words.map((word) => [word.startMs, word.endMs, word.confidence]),
    );
  });

  it("keeps the transcript when the aligner throws", async () => {
    const { engine } = lyricsEngine({
      heard: ["alpha", "bravo"],
      align: () => {
        throw new Error("aligner exploded");
      },
    });
    const result = await pipelineFor(engine, 20_000).run(FILE, { language, lyrics: "Kya der hai\nAaj Sajan Mera" });

    expect(texts(result.words)).toEqual(["alpha", "bravo"]);
    expect(result.stats.lyrics?.placed).toBe(0);
    expect(result.stats.lyrics?.unmatched).toBe(6);
  });

  it("places the words from the plan on a tier with no aligner, marks them uncertain and no longer calls the paste unsupported", async () => {
    // Draft has no teacher-forced aligner: either no `alignText` at all, or the real Draft engine's method with
    // `characterAlignment: false` (which must not be called). The plan alone must still place every word.
    const draft = lyricsEngine({ heard: ["kya", "der", "hai", "zindagi"], hideAligner: true });
    const flagged = lyricsEngine({
      heard: ["kya", "der", "hai", "zindagi"],
      characterAlignment: false,
      align: () => {
        throw new Error("Draft has no aligner: alignText must never be called");
      },
    });
    const times = timesAligner({ kya: [3000, 3400], der: [4000, 4400], hai: [5000, 5400], zindagi: [6000, 6400] });
    const lyrics = "Kya der hai\nzindagi mera gaao";
    const results = await Promise.all([
      pipelineFor(draft.engine, 20_000, { aligner: times }).run(FILE, { language, lyrics }),
      pipelineFor(flagged.engine, 20_000, { aligner: times }).run(FILE, { language, lyrics }),
    ]);

    expect([...draft.calls, ...flagged.calls]).toHaveLength(0);
    for (const result of results) {
      expect(texts(result.words)).toEqual(["Kya", "der", "hai", "zindagi", "mera", "gaao"]);
      const byText = new Map(result.words.map((word) => [word.text, word]));
      expect(byText.get("zindagi")).toMatchObject({ startMs: 6000, endMs: 6400 });
      // No verification pass at all, so the two words without an anchor carry the plan's low confidence.
      expect(byText.get("mera")?.confidence).toBe(0.25);
      expect(byText.get("gaao")?.confidence).toBe(0.25);
      expect(result.stats.lyrics).toMatchObject({
        lines: 2,
        placed: 6,
        uncertain: 2,
        unmatched: 0,
        unmatchedLines: [],
        returned: 0,
        accepted: 6,
        nullWindows: 0,
        passes: 0,
        timingBorrowed: 4,
        // No verification pass exists on Draft, but the four anchors are still measured; only "mera" and "gaao" are estimates.
        approximate: 2,
      });
      expect(result.stats.lyrics?.unsupported).toBeUndefined();
    }
  });

  it("makes one pass per window even when the paste is longer than the aligner's 400-character limit, and keeps plan times for the rest", async () => {
    // 80 pasted words in one 30 s window. The engine's contract allows 400 characters per call, so the pass
    // gets the longest prefix that fits (58 six/seven-character words). The words beyond it are still placed
    // from the global plan; there is no second call and no cursor.
    const lyricWords = Array.from({ length: 80 }, (_, i) => `word${i}`);
    const { engine, calls } = lyricsEngine({
      align: (text) =>
        // The aligner puts the n-th pasted word at n * 375 ms, exactly where the plan also predicts it.
        text.split(" ").map((word) => {
          const n = Number(word.slice(4));
          return { text: word, startMs: n * 375, endMs: n * 375 + 300, logProbability: -0.2, sharpness: 0.85 };
        }),
    });
    const result = await pipelineFor(engine, 30_000).run(FILE, { language, lyrics: lyricWords.join(" ") });

    expect(calls).toHaveLength(1); // exactly one pass for the one window, however many words it holds
    expect(calls[0].text.length).toBeLessThanOrEqual(400);
    expect(calls[0].text.split(" ")).toHaveLength(58); // the longest prefix under the character limit
    expect(texts(result.words)).toEqual(lyricWords);
    expect(result.stats.lyrics).toMatchObject({
      lines: 1,
      placed: 80,
      uncertain: 22, // the 22 words past the character limit keep the plan's predicted times
      unmatched: 0,
      returned: 58,
      accepted: 80,
      nullWindows: 0,
      passes: 1,
      approximate: 22,
    });
    // The verified prefix is strictly ordered and every pasted word appears exactly once.
    for (let i = 1; i < result.words.length; i += 1) expect(result.words[i].startMs).toBeGreaterThanOrEqual(result.words[i - 1].endMs);
  });

  it("replaces a heard word inside a placed word's claim and keeps heard words outside every claim", async () => {
    // The claims are each placed word +-500 ms. "before" (1.3 s) and "after" (16.3 s) are outside the four
    // placed words (3.0-7.4 s) and survive; "noise" (mid 6.7 s) falls in "teen"'s claim and is replaced.
    const heardTimes: Record<string, readonly [number, number]> = {
      before: [1000, 1600],
      ek: [3000, 3400],
      do: [5000, 5400],
      teen: [6000, 6400],
      noise: [6500, 6900],
      char: [7000, 7400],
      after: [16_000, 16_600],
    };
    const placedTimes = [
      [3000, 3400],
      [5000, 5400],
      [6000, 6400],
      [7000, 7400],
    ] as const;
    const { engine } = lyricsEngine({
      heard: ["before", "ek", "do", "teen", "noise", "char", "after"],
      align: (text) =>
        // Confident, exactly on the anchors: every pasted word is verified and then takes the heard timing.
        text.split(" ").map((word, i) => ({
          text: word,
          startMs: placedTimes[i]?.[0] ?? 1000,
          endMs: placedTimes[i]?.[1] ?? 1400,
          logProbability: -0.2,
          sharpness: 0.85,
        })),
    });
    const result = await pipelineFor(engine, 20_000, { aligner: timesAligner(heardTimes) }).run(FILE, {
      language,
      lyrics: "ek do teen char",
    });

    expect(texts(result.words)).toEqual(["before", "ek", "do", "teen", "char", "after"]);
    expect(texts(result.words)).not.toContain("noise");
    const byText = new Map(result.words.map((word) => [word.text, word]));
    expect(byText.get("before")).toMatchObject({ startMs: 1000, endMs: 1600 });
    expect(byText.get("after")).toMatchObject({ startMs: 16_000, endMs: 16_600 });
    expect(byText.get("teen")).toMatchObject({ startMs: 6000, endMs: 6400 });
    expect(result.stats.lyrics).toMatchObject({ placed: 4, uncertain: 0, unmatched: 0, timingBorrowed: 4 });
  });

  it("gives every word the transcript's interval when the paste is the transcript (whole-transcript borrow)", async () => {
    // Guidance [02:28] item 4: pasting lyrics must never make timing worse. When the paste is what the model
    // heard, every placed word takes the heard interval - even though the aligner gave different (verified) times.
    const { engine } = lyricsEngine({
      heard: ["kya", "der", "hai"],
      align: (text) =>
        // 300 ms after the transcript's own times, still inside the plan's 4 s verification guard.
        text.split(" ").map((word, i) => ({ text: word, startMs: 3300 + i * 1000, endMs: 3700 + i * 1000, logProbability: -0.2, sharpness: 0.85 })),
    });
    const result = await pipelineFor(engine, 20_000, {
      aligner: timesAligner({ kya: [3000, 3400], der: [4000, 4400], hai: [5000, 5400] }),
    }).run(FILE, { language, lyrics: "Kya der hai" });

    expect(texts(result.words)).toEqual(["Kya", "der", "hai"]); // the visitor's spelling
    expect(result.words.map((word) => [word.startMs, word.endMs])).toEqual([
      [3000, 3400],
      [4000, 4400],
      [5000, 5400],
    ]);
    expect(result.stats.lyrics?.timingBorrowed).toBe(result.stats.lyrics?.placed);
    expect(result.stats.lyrics).toMatchObject({
      lines: 1,
      placed: 3,
      uncertain: 0,
      unmatched: 0,
      returned: 3,
      nullWindows: 0,
      passes: 1,
      timingBorrowed: 3,
      approximate: 0,
    });
  });

  it("works in song mode, where the repeat pass also runs, and reports no inferred words when there is no repeat", async () => {
    const { engine, calls } = lyricsEngine({ heard: ["Kya", "der", "hai"], align: (text) => spaced(text) });
    const pipeline = createCaptionPipeline({
      ingest: trackIngest({ durationMs: 20_000, voiced: [{ startMs: 0, endMs: 20_000 }] }),
      vad: makeVad([]),
      engine,
      aligner: evenAligner,
    });
    const result = await pipeline.run(FILE, { language, detection: "everything", lyrics: "Kya der hai" });

    expect(calls).toHaveLength(1); // song mode still gets exactly one pass for the one window
    expect(texts(result.words)).toEqual(["Kya", "der", "hai"]);
    expect(result.stats.lyrics).toEqual({
      lines: 1,
      placed: 3,
      uncertain: 0,
      unmatched: 0,
      unmatchedLines: [],
      returned: 3,
      accepted: 3,
      nullWindows: 0,
      passes: 1,
      timingBorrowed: 3, // the paste is what the song heard: every word takes the measured interval
      approximate: 0,
    });
    // 20 s of audio cannot hold the shortest repeat the tracker searches for (8 s block, 20 s minimum lag).
    expect(result.stats.inferredWords).toBe(0);
  });

  it("skips alignment entirely (and says so) when the file is longer than the budget", async () => {
    const { engine, calls } = lyricsEngine({ align: (text) => spaced(text) });
    const result = await pipelineFor(engine, 16 * 60_000).run(FILE, { language, lyrics: "Kya der hai" });

    expect(calls).toEqual([]);
    expect(result.stats.audioSeconds).toBe(960);
    expect(result.stats.lyrics).toEqual({ lines: 1, placed: 0, uncertain: 0, unmatched: 3, unmatchedLines: [] });
  }, 30_000);
});

describe("borrowWholeTranscriptTiming", () => {
  const word = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs, confidence: 0.5, index: 0, windowIndex: -1 });
  const times = (words: readonly Word[]) => words.map((item) => [item.startMs, item.endMs]);

  it("gives every placed word the heard interval when the paste is the transcript", () => {
    const placed = [word("Kya", 1000, 1400), word("der", 2000, 2400), word("hai", 3000, 3400)];
    const heard = [word("kya", 1250, 1650), word("der", 2250, 2650), word("hai", 3250, 3650)];

    expect(borrowWholeTranscriptTiming(placed, heard)).toBe(3);
    expect(times(placed)).toEqual([[1250, 1650], [2250, 2650], [3250, 3650]]);
    // Only the boundaries move; the placed word's own text and confidence are kept.
    expect(placed.map((item) => item.text)).toEqual(["Kya", "der", "hai"]);
    expect(placed.every((item) => item.confidence === 0.5)).toBe(true);
  });

  it("borrows nothing and restores the predicted times when the paste is a different text", () => {
    const placed = [word("Kya", 1000, 1400), word("zzz", 2000, 2400), word("qqq", 3000, 3400)];
    const before = times(placed);
    // One word matches, so the function mutates that word before deciding the paste is not the transcript; the
    // snapshot must put every time back, or the caller would borrow locally from a half-rewritten list.
    const heard = [word("kya", 1250, 1650), word("alpha", 2250, 2650), word("bravo", 3250, 3650)];

    expect(borrowWholeTranscriptTiming(placed, heard)).toBe(0);
    expect(times(placed)).toEqual(before);
  });

  it("accepts a 0.75 count ratio but rejects 1.34", () => {
    // 3 placed / 4 heard = 0.75: within the band, and all three agree, so all three borrow.
    const shorter = [word("ek", 3000, 3400), word("do", 4000, 4400), word("teen", 5000, 5400)];
    const longer = [word("ek", 3100, 3500), word("do", 4100, 4500), word("teen", 5100, 5500), word("char", 6100, 6500)];
    expect(borrowWholeTranscriptTiming(shorter, longer)).toBe(3);
    expect(times(shorter)).toEqual([[3100, 3500], [4100, 4500], [5100, 5500]]);

    // 4 placed / 3 heard = 1.333...: over the 1.33 ceiling, so the paste is not the transcript and nothing moves.
    const morePlaced = [word("ek", 3000, 3400), word("do", 4000, 4400), word("teen", 5000, 5400), word("char", 6000, 6400)];
    const before = times(morePlaced);
    const fewerHeard = [word("ek", 3100, 3500), word("do", 4100, 4500), word("teen", 5100, 5500)];
    expect(borrowWholeTranscriptTiming(morePlaced, fewerHeard)).toBe(0);
    expect(times(morePlaced)).toEqual(before);
  });
});

describe("createCaptionPipeline: the song-mode timestamp read (wp-TS)", () => {
  type TimestampEngine = SpeechEngine & { timestampRead: boolean };

  function timestampEngine(baseWords: readonly string[], timestampWords: readonly string[], calls: string[]): TimestampEngine {
    return {
      id: "timestamp-engine",
      timestampRead: true,
      async load() {},
      async release() {},
      async transcribe(input, options) {
        const isTimestamp = (options.bounds as { timestampRead?: boolean } | undefined)?.timestampRead === true;
        calls.push(isTimestamp ? "timestamp" : "base");
        const words = isTimestamp ? [...timestampWords] : [...baseWords];
        return { windowIndex: input.window.index, words, tokenIds: words.map((_, i) => i), noSpeechProbability: 0.01, averageLogProbability: -0.2 };
      },
    };
  }

  // A full 30 s song window: the only kind of window the timestamp read runs on (TIMESTAMP_READ_MIN_USED_MS).
  const runSong = async (engine: SpeechEngine, tuning?: Parameters<typeof createCaptionPipeline>[1], durationMs = 30_000) => {
    const pipeline = createCaptionPipeline(
      { ingest: trackIngest({ durationMs, voiced: [{ startMs: 0, endMs: durationMs }] }), vad: makeVad([]), engine, aligner: evenAligner() },
      tuning,
    );
    return pipeline.run(FILE, { language, detection: "everything" });
  };

  it("never runs the timestamp read on a short window (a short noisy speech clip keeps its normal reading)", async () => {
    // Measured: on the 15 s "mumma" speech clip the timestamp reading was longer (30 words) but invented, and won on count.
    const base = ["mama", "mujhe", "pata", "hai", "kar", "banna", "hai", "kyun", "nahi", "pata", "hai", "kyun"];
    const timestamp = [...base, "main", "bhi", "hoon", "bhaiya", "hoon", "haan", "tum", "vah", "nahi", "gae", "bharo"];
    const calls: string[] = [];
    const result = await runSong(timestampEngine(base, timestamp, calls), undefined, 15_000);
    expect(calls).not.toContain("timestamp");
    expect(texts(result.words)).toEqual(base);
  });

  it("keeps the timestamp reading when it has more real Latin words, and skips the token vote for a 3+ win", async () => {
    const base = ["kya", "der", "hai"];
    const timestamp = ["kya", "der", "hai", "aaj", "sajan", "mera", "dil", "tera", "yaar", "ab", "toh", "aa"];
    const calls: string[] = [];
    const result = await runSong(timestampEngine(base, timestamp, calls));
    expect(texts(result.words)).toEqual(timestamp);
    expect(calls).toEqual(["base", "timestamp"]);
  });

  it("does not keep a timestamp reading made of junk or a decode loop", async () => {
    const base = ["kya", "der", "hai"];
    for (const bad of [new Array<string>(12).fill("nan"), ["aaja", "aaja", "aaja", "aaja", "aaja", "aaja", "aaja", "aaja", "aaja", "aaja", "aaja", "aaja"]]) {
      const calls: string[] = [];
      const result = await runSong(timestampEngine(base, bad, calls));
      expect(calls).toContain("timestamp"); // the read ran
      expect(texts(result.words)).toEqual(base); // but never replaced a clean shorter reading
    }
  });

  it("never runs the timestamp read in speech mode, and a tuning switch disables it in song mode", async () => {
    const base = ["kya", "der", "hai"];
    const timestamp = [...base, "aaj", "sajan", "mera", "dil"];
    const speechCalls: string[] = [];
    const speech = createCaptionPipeline({
      ingest: makeIngest({ durationMs: 25_000 }),
      vad: makeVad([{ startMs: 0, endMs: 25_000 }]),
      engine: timestampEngine(base, timestamp, speechCalls),
      aligner: evenAligner(),
    });
    await speech.run(FILE, { language });
    expect(speechCalls).not.toContain("timestamp");

    const songCalls: string[] = [];
    await runSong(timestampEngine(base, timestamp, songCalls), { timestampRead: false });
    expect(songCalls).not.toContain("timestamp");
  });
});
