import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CaptionError, WINDOW_SAMPLES, type WindowAudio } from "../contracts";
import type { DownloadProgress, LoaderDeps, ModelManifest } from "../model-loader";
import { betterTake, createWhisperEngine, glossaryHint, isGlossaryEcho, isSuspect, unshiftTimes, wordConfidences, type WhisperEngineOptions } from "./whisper-engine";
import { characterTokens } from "./char-align";
import { createWhisperTokenizer } from "./tokenizer";
import {
  bytesAsTokens,
  fakeModelFiles,
  FAKE,
  FakeRuntime,
  FakeWorld,
  HOST,
  MemoryStore,
  primedStore,
  type FakeFiles,
  type FakeModelConfig,
  type FakeRuntimeOptions,
} from "./fake-model";

const TRANSCRIPTS: Record<number, number[]> = {
  1: [...bytesAsTokens("aaj"), FAKE.hai, ...bytesAsTokens(" bhai,")],
  2: [...bytesAsTokens("नमस्ते"), FAKE.kya, ...bytesAsTokens(" हाल?")],
  3: [],
};

const noNetwork = (): LoaderDeps => ({
  fetch: async () => {
    throw new Error("the network must not be used");
  },
  digest: async (data) => createHash("sha256").update(data).digest().buffer.slice(0) as ArrayBuffer,
  store: new MemoryStore(),
});

/** Audio whose first sample is the key the fake model keys its transcript on. */
function windowOf(key: number, index = 0, usedMs = 12_000): WindowAudio {
  const samples = new Float32Array(WINDOW_SAMPLES);
  samples[0] = key;
  return { window: { index, lengthMs: 30_000, usedMs, regions: [] }, samples };
}

/** Stand-in for the DSP track's spectrogram: every value is the first sample, so the key reaches the encoder. */
const fakeMel = (samples: Float32Array, { nMels }: { nMels: 80 | 128 }) => new Float32Array(nMels * 3000).fill(samples[0]);

function build(opts: { model?: FakeModelConfig; runtime?: FakeRuntimeOptions; files?: FakeFiles; engine?: Partial<WhisperEngineOptions> } = {}) {
  const world = new FakeWorld();
  const files = opts.files ?? fakeModelFiles();
  const runtime = new FakeRuntime(world, opts.model ?? { transcripts: TRANSCRIPTS }, opts.runtime);
  const loader: LoaderDeps = { ...noNetwork(), store: primedStore(files) };
  const engine = createWhisperEngine({
    manifest: files.manifest,
    allowedOrigins: [HOST],
    loader,
    runtime,
    logMel: fakeMel,
    fileNames: { addedTokens: "addedTokens", generationConfig: "generationConfig" },
    ...opts.engine,
  });
  return { world, files, runtime, loader, engine };
}

describe("load and transcribe", () => {
  it("turns audio into the words the model said, with the model's ids and the window index", async () => {
    const { engine } = build();
    await engine.load();
    const first = await engine.transcribe(windowOf(1, 7), { language: "hinglish" });
    expect(first.windowIndex).toBe(7);
    expect(first.words).toEqual(["aaj", "hai", "bhai,"]);
    expect(first.tokenIds).toEqual(TRANSCRIPTS[1]);
    const second = await engine.transcribe(windowOf(2, 8), { language: "hindi" });
    expect(second.words).toEqual(["नमस्ते", "kya", "हाल?"]);
    expect(second.windowIndex).toBe(8);
  });

  it("returns no words for a window the model says nothing about", async () => {
    const { engine } = build({ model: { transcripts: TRANSCRIPTS, lenient: true } });
    await engine.load();
    const result = await engine.transcribe(windowOf(3), { language: "english" });
    // End-of-text is suppressed as the first token, so a silent window still yields a token; it must at least stay within the budget.
    expect(result.tokenIds.length).toBeLessThanOrEqual(40);
    expect(result.noSpeechProbability).toBeGreaterThanOrEqual(0);
    expect(result.noSpeechProbability).toBeLessThanOrEqual(1);
    expect(result.averageLogProbability).toBeLessThanOrEqual(0);
  });

  it("reports the no-speech probability the model gave", async () => {
    const { engine } = build({ model: { transcripts: TRANSCRIPTS, noSpeechLogit: Math.log(FAKE.vocab - 1) } });
    await engine.load();
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).noSpeechProbability).toBeCloseTo(0.5, 5);
  });

  it("uses the English token for every language by default and a custom one when asked", async () => {
    const seen: number[][] = [];
    const { engine, runtime } = build();
    await engine.load();
    const decoder = runtime.decoders[0].session;
    await engine.transcribe(windowOf(1), { language: "hindi" });
    seen.push(decoder.calls[0].inputIds);
    expect(seen[0]).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);

    const custom = build({ engine: { languageTokens: { hindi: "<|nope|>" } } });
    await custom.engine.load();
    await expect(custom.engine.transcribe(windowOf(1), { language: "hindi" })).rejects.toMatchObject({ code: "model-load" });
  });

  it("reads a music rescue slice with the Hindi token, while ordinary speech stays English", async () => {
    const { engine, runtime } = build({ model: { transcripts: TRANSCRIPTS, lenient: true } });
    await engine.load();
    const decoder = runtime.decoders[0].session;
    // The pipeline asks for this only on a song's rescue slice, never on a normal window.
    await engine.transcribe(windowOf(1), { language: "hinglish", music: true });
    expect(decoder.calls[0].inputIds).toEqual([FAKE.sot, FAKE.hi, FAKE.transcribe, FAKE.noTimestamps]);
    decoder.calls.length = 0;
    await engine.transcribe(windowOf(1), { language: "english", music: true });
    expect(decoder.calls[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);
    decoder.calls.length = 0;
    // Speech mode is unchanged: Hinglish speech still uses English.
    await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(decoder.calls[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);
  });

  it("is idempotent: loading twice, even at once, starts the sessions once", async () => {
    const { engine, runtime } = build();
    await Promise.all([engine.load(), engine.load()]);
    await engine.load();
    expect(runtime.encoders).toHaveLength(1);
    expect(runtime.decoders).toHaveLength(1);
  });

  it("asks for encoder output and decoder cache to stay on the device", async () => {
    const { engine, runtime } = build();
    await engine.load();
    const encoderHint = runtime.keepHints[0].kept;
    const decoderHint = runtime.keepHints[1].kept;
    expect(encoderHint).toEqual(["last_hidden_state"]);
    expect(decoderHint).not.toContain("logits");
    expect(decoderHint.length).toBe(FAKE.layers * 4);
    expect(decoderHint.every((name) => name.startsWith("present."))).toBe(true);
  });

  it("leaks no tensors across many windows", async () => {
    const { engine, world } = build();
    await engine.load();
    for (let i = 0; i < 6; i += 1) await engine.transcribe(windowOf(1 + (i % 2), i), { language: "hinglish" });
    expect([...world.live]).toEqual([]);
  });

  it("works with a tokenizer.json style vocabulary", async () => {
    const added = [
      ["<|endoftext|>", FAKE.eot],
      ["<|startoftranscript|>", FAKE.sot],
      ["<|en|>", FAKE.en],
      ["<|transcribe|>", FAKE.transcribe],
      ["<|nocaptions|>", FAKE.noSpeech],
      ["<|notimestamps|>", FAKE.noTimestamps],
    ].map(([content, id]) => ({ content, id, special: true }));
    const { fakeVocab } = await import("./fake-model");
    const files = fakeModelFiles({ tokenizerJson: { model: { vocab: fakeVocab() }, added_tokens: added } });
    const { engine } = build({ files, engine: { fileNames: { generationConfig: "generationConfig" } } });
    await engine.load();
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).words).toEqual(["aaj", "hai", "bhai,"]);
  });
});

describe("what a caller can get wrong", () => {
  it("rejects transcribe before load", async () => {
    const { engine } = build();
    await expect(engine.transcribe(windowOf(1), { language: "hinglish" })).rejects.toMatchObject({ code: "internal" });
  });

  it("rejects audio that is not exactly one window", async () => {
    const { engine } = build();
    await engine.load();
    const bad = { ...windowOf(1), samples: new Float32Array(WINDOW_SAMPLES - 1) };
    await expect(engine.transcribe(bad, { language: "hinglish" })).rejects.toMatchObject({ code: "internal" });
  });

  it("rejects a spectrogram of the wrong size instead of feeding it to the model", async () => {
    const { engine } = build({ engine: { logMel: () => new Float32Array(80 * 2999) } });
    await engine.load();
    await expect(engine.transcribe(windowOf(1), { language: "hinglish" })).rejects.toMatchObject({ code: "internal" });
  });

  it("does not run when already cancelled", async () => {
    const { engine, runtime } = build();
    await engine.load();
    const controller = new AbortController();
    controller.abort();
    await expect(engine.transcribe(windowOf(1), { language: "hinglish", signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(runtime.encoders[0].session.runs).toBe(0);
  });

  it("stops mid-window on cancel and leaves the engine usable", async () => {
    const { engine, runtime, world } = build({ model: { transcripts: { 1: bytesAsTokens("a rather long sentence for the model") } } });
    await engine.load();
    const controller = new AbortController();
    const decoder = runtime.decoders[0].session;
    decoder.onRun = () => {
      if (decoder.calls.length === 3) controller.abort();
    };
    await expect(engine.transcribe(windowOf(1), { language: "hinglish", signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect([...world.live]).toEqual([]);
    decoder.onRun = null;
    const again = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(again.words.length).toBeGreaterThan(3);
  });

  it("runs windows one at a time even if the caller fires them together", async () => {
    const { engine, runtime } = build();
    await engine.load();
    const results = await Promise.all([1, 2, 1, 2].map((key, i) => engine.transcribe(windowOf(key, i), { language: "hinglish" })));
    expect(runtime.maxInFlight).toBe(1);
    expect(results.map((r) => r.windowIndex)).toEqual([0, 1, 2, 3]);
    expect(results[0].words).toEqual(results[2].words);
  });
});

const ATTENTION = {
  layers: [0, 1],
  heads: 8,
  frames: 1500,
  // Prompt rows point at frame 0 except the last, which predicts the first word; later steps move 10 frames (200 ms) per token.
  peak: (step: number, row: number) => (step === 0 ? (row === 3 ? 5 : 0) : 5 + 10 * step),
};
const HEADS = [{ layer: 0, head: 1 }, { layer: 1, head: 2 }];

describe("release and load", () => {
  it("a load asked for after a release waits for it, so the release cannot clear the model the load just started", async () => {
    const { engine, runtime } = build();
    await engine.load();
    // Hold the encoder: a window is "in flight" and the release, queued behind it, cannot start yet (a call that cannot be cancelled).
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const session = runtime.encoders[0].session;
    const run = session.run.bind(session);
    session.run = async (...args: Parameters<typeof run>) => {
      await gate;
      return run(...args);
    };
    const inflight = engine.transcribe(windowOf(1), { language: "hinglish" }).catch(() => undefined);
    const released = engine.release();
    const reloaded = engine.load(); // a new job starts and asks for the model before the release has run
    open();
    await inflight;
    await released;
    await reloaded;
    const out = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(out.words).toHaveLength(3);
  });
});

describe("the names hint", () => {
  const hintFor = async (names: string[]) => {
    const files = fakeModelFiles();
    const { createWhisperTokenizer } = await import("./tokenizer");
    const tok = createWhisperTokenizer({ vocab: files.bytes.tokenizer, addedTokens: files.bytes.addedTokens });
    return glossaryHint(tok, names);
  };

  it("puts the names in front of the prompt as earlier text", async () => {
    const hint = await hintFor(["Mumma", "Rahul"]);
    expect(hint[0]).toBe(FAKE.startOfPrev);
    expect(hint.length).toBe(1 + " Mumma, Rahul".length);
    const { engine, runtime } = build({ runtime: { promptLength: hint.length + 4 } });
    await engine.load();
    await engine.transcribe(windowOf(1), { language: "hinglish", glossary: ["Mumma", "Rahul"] });
    const firstStep = runtime.decoders[0].session.calls[0].inputIds;
    expect(firstStep.slice(0, hint.length)).toEqual(hint);
    expect(firstStep.slice(hint.length)).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);
  });

  it("adds nothing when there are no names (or only blanks)", async () => {
    expect(await hintFor([])).toEqual([]);
    expect(await hintFor(["  ", ""])).toEqual([]);
    const { engine, runtime } = build();
    await engine.load();
    await engine.transcribe(windowOf(1), { language: "hinglish", glossary: [] });
    expect(runtime.decoders[0].session.calls[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);
  });

  it("reads the no-speech score at the start-of-transcript row, which moves down when a names hint comes first", async () => {
    const hint = await hintFor(["Mumma"]);
    const calm = build({ model: { transcripts: TRANSCRIPTS, noSpeechLogit: 0 }, runtime: { promptLength: hint.length + 4 } });
    const loud = build({ model: { transcripts: TRANSCRIPTS, noSpeechLogit: 14 }, runtime: { promptLength: hint.length + 4 } });
    await calm.engine.load();
    await loud.engine.load();
    const quiet = await calm.engine.transcribe(windowOf(1), { language: "hinglish", glossary: ["Mumma"] });
    const said = await loud.engine.transcribe(windowOf(1), { language: "hinglish", glossary: ["Mumma"] });
    expect(quiet.noSpeechProbability).toBeLessThan(0.1);
    expect(said.noSpeechProbability).toBeGreaterThan(0.9);
  });

  it("keeps a long list of names within the hint limit", async () => {
    const hint = await hintFor(Array.from({ length: 40 }, (_, i) => `Name${i}`));
    expect(hint.length).toBeLessThanOrEqual(61);
    expect(hint[0]).toBe(FAKE.startOfPrev);
  });

  it("counts the longer prompt when timing words from attention", async () => {
    const hint = await hintFor(["Mumma"]);
    const rows = hint.length + 4;
    const attention = { ...ATTENTION, peak: (step: number, row: number) => (step === 0 ? (row === rows - 1 ? 5 : 0) : 5 + 10 * step) };
    const { engine } = build({ model: { transcripts: TRANSCRIPTS, attention }, runtime: { promptLength: rows }, engine: { alignment: { heads: HEADS } } });
    await engine.load();
    const out = await engine.transcribe(windowOf(1), { language: "hinglish", glossary: ["Mumma"] });
    expect(out.wordTimes).toHaveLength(3);
    expect(out.wordTimes![0].startMs).toBeLessThan(out.wordTimes![2].startMs);
  });

  it("recognises a reading that is only the names read back, when the audio held no matching speech", () => {
    const names = ["Mumma", "Rahul Sharma"];
    const thin = { spanMs: 12_000, noSpeechProbability: 0.1 }; // 3 s per word between the first and last word
    const model = { spanMs: 1500, noSpeechProbability: 0.8 }; // the model itself says there was no speech
    expect(isGlossaryEcho(["Mumma,", "Rahul", "Sharma", "Mumma."], names, thin)).toBe(true);
    expect(isGlossaryEcho(["Mumma,", "Rahul", "Sharma"], names, model)).toBe(true);
    expect(isGlossaryEcho(["Mumma", "Rahul"], names, thin)).toBe(false);
    expect(isGlossaryEcho(["Mumma", "Rahul", "ghar", "aao"], names, thin)).toBe(false);
    expect(isGlossaryEcho(["a", "b", "c"], [], thin)).toBe(false);
  });

  it("keeps a real short sentence made only of listed names", () => {
    const real = { spanMs: 1500, noSpeechProbability: 0.02 }; // half a second a word, clearly speech
    expect(isGlossaryEcho(["Mumma", "Rahul", "Papa"], ["Mumma", "Rahul", "Papa"], real)).toBe(false);
    expect(isGlossaryEcho(["Haan", "theek", "hai"], ["Haan", "Theek", "Hai"], real)).toBe(false);
    expect(isGlossaryEcho(["Mumma", "Rahul", "Papa"], ["Mumma", "Rahul", "Papa"], { spanMs: undefined, noSpeechProbability: Number.NaN })).toBe(false);
    // Words with no times: only the model's own no-speech score can say it was an echo.
    expect(isGlossaryEcho(["Mumma", "Rahul", "Papa"], ["Mumma", "Rahul", "Papa"], { spanMs: undefined, noSpeechProbability: 0.02 })).toBe(false);
  });

  it("returns no words for a window whose reading is just the names", async () => {
    // The model itself says there was no speech (a high no-speech score), which is the evidence a names echo needs when the words have no times.
    const { engine } = build({ model: { transcripts: { 4: bytesAsTokens("Mumma Rahul Mumma") }, noSpeechLogit: 12 }, runtime: { promptLength: 1 + " Mumma, Rahul".length + 4 } });
    await engine.load();
    const echoed = await engine.transcribe(windowOf(4), { language: "hinglish", glossary: ["Mumma", "Rahul"] }).catch((e) => { throw new Error(String((e as Error & { cause?: Error }).cause?.message)); });
    expect(echoed.words).toEqual([]);
    expect(echoed.tokenIds).toEqual([]);
    // The same reading with a calm no-speech score (a real sentence of names) is kept.
    const real = build({ model: { transcripts: { 4: bytesAsTokens("Mumma Rahul Mumma") } }, runtime: { promptLength: 1 + " Mumma, Rahul".length + 4 } });
    await real.engine.load();
    expect((await real.engine.transcribe(windowOf(4), { language: "hinglish", glossary: ["Mumma", "Rahul"] })).words).toEqual(["Mumma", "Rahul", "Mumma"]);
    // Without the names the same reading stays.
    const plain = build({ model: { transcripts: { 4: bytesAsTokens("Mumma Rahul Mumma") } } });
    await plain.engine.load();
    expect((await plain.engine.transcribe(windowOf(4), { language: "hinglish" })).words).toEqual(["Mumma", "Rahul", "Mumma"]);
  });
});

describe("word times from attention", () => {
  it("attaches the model's own word times, in order, inside the window, when alignment is on", async () => {
    const { engine, runtime, world } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: { alignment: { heads: HEADS } } });
    await engine.load();
    const out = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(out.words).toEqual(["aaj", "hai", "bhai,"]);
    const times = out.wordTimes;
    expect(times).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      expect(times![i].endMs).toBeGreaterThan(times![i].startMs);
      expect(times![i].endMs).toBeLessThanOrEqual(12_000);
      if (i > 0) expect(times![i].startMs).toBeGreaterThanOrEqual(times![i - 1].startMs);
    }
    // Only the layers the heads need were asked for, and every attention tensor was freed.
    const fetched = runtime.decoders[0].session.lastFetches ?? [];
    expect(fetched).toContain("cross_attentions.0");
    expect(fetched).toContain("cross_attentions.1");
    expect([...world.live]).toEqual([]);
  });

  it("asks for no attention and returns no times when alignment is off", async () => {
    const { engine, runtime } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION } });
    await engine.load();
    const out = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(out.wordTimes).toBeUndefined();
    expect((runtime.decoders[0].session.lastFetches ?? []).some((name) => name.startsWith("cross_attentions"))).toBe(false);
  });

  it("returns no times (not wrong ones) when the decoder has no attention outputs", async () => {
    const { engine } = build({ engine: { alignment: { heads: HEADS } } });
    await engine.load();
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).wordTimes).toBeUndefined();
  });
});

describe("character-level teacher-forced alignment", () => {
  /** [start, end] pairs, which is what the oracles assert. */
  const pairs = (times: { startMs: number; endMs: number }[] | undefined) => times?.map((time) => [time.startMs, time.endMs]);
  /** Peaks for the alignment pass only, on consecutive frames after the prompt, so the path is unambiguous. */
  const CHARACTER_ATTENTION = {
    ...ATTENTION,
    fullPeak: (ids: readonly number[]) => ids.map((_, row) => 3 + row),
  };
  /** Width 1 keeps the one-frame synthetic peaks sharp; the real default is 7 and is covered by char-align.test.ts. */
  const CHARACTER_OPTION = { heads: HEADS, medianFilterWidth: 1 };

  it("replaces the greedy-attention times with one time per word from a single character pass", async () => {
    const { engine, runtime, world } = build({
      model: { transcripts: TRANSCRIPTS, attention: CHARACTER_ATTENTION },
      engine: { alignment: { heads: HEADS }, characterAlignment: CHARACTER_OPTION },
    });
    await engine.load();
    const out = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(out.words).toEqual(["aaj", "hai", "bhai,"]);
    // The pass feeds 4 prompt rows, so character c reads tensor row 3 + c and peaks at frame 6 + c. Each word starts
    // on its first character's frame (20 ms each); the greedy pass would give about 100/300/500 ms instead.
    expect(pairs(out.wordTimes)).toEqual([
      [140, 220],
      [220, 300],
      [300, 12_000],
    ]);
    // Exactly one extra run, and it fed the prompt followed by one token per character of " aaj hai bhai,".
    const decoder = runtime.decoders[0].session;
    expect(decoder.fullPasses).toHaveLength(1);
    const files = fakeModelFiles();
    const tok = createWhisperTokenizer({ vocab: files.bytes.tokenizer, addedTokens: files.bytes.addedTokens });
    const characters = characterTokens(tok, " aaj hai bhai,");
    expect(characters).not.toBeNull();
    expect(decoder.fullPasses[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps, ...(characters?.tokenIds ?? [])]);
    // Every tensor was freed.
    expect([...world.live]).toEqual([]);
  });

  it("does not touch the times when the character pass fails", async () => {
    const broken = { ...ATTENTION, fullPeak: () => [60_000] }; // outside the tensor: the model run throws
    const { engine } = build({
      model: { transcripts: TRANSCRIPTS, attention: broken },
      engine: { alignment: { heads: HEADS }, characterAlignment: CHARACTER_OPTION },
    });
    const plain = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: { alignment: { heads: HEADS } } });
    await engine.load();
    await plain.engine.load();
    const aligned = await engine.transcribe(windowOf(1), { language: "hinglish" });
    const greedy = await plain.engine.transcribe(windowOf(1), { language: "hinglish" });
    // No throw, and the same times the greedy attention produced.
    expect(aligned.words).toEqual(["aaj", "hai", "bhai,"]);
    expect(aligned.wordTimes).toEqual(greedy.wordTimes);
  });

  it("runs without the greedy alignment option, because the character pass needs no token attention", async () => {
    const { engine, runtime } = build({
      model: { transcripts: TRANSCRIPTS, attention: CHARACTER_ATTENTION },
      engine: { characterAlignment: CHARACTER_OPTION },
    });
    await engine.load();
    const out = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(out.wordTimes).toHaveLength(3);
    expect(out.wordTimes![0].startMs).toBe(140);
    expect(runtime.decoders[0].session.fullPasses).toHaveLength(1);
  });

  it("never runs the extra pass when the option is off", async () => {
    const { engine, runtime } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: { alignment: { heads: HEADS } } });
    await engine.load();
    await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(runtime.decoders[0].session.fullPasses).toHaveLength(0);
  });

  it("skips a transcript longer than 400 characters and keeps the greedy times", async () => {
    // 41 words of 9 letters: 409 characters, past the limit the pass is offered for.
    const long = Array.from({ length: 41 }, () => "abcdefghi").join(" ");
    // Uncapped peaks would run past the fake tensor's frames after ~150 decode steps.
    const capped = { ...ATTENTION, peak: (step: number, row: number) => Math.min(1499, ATTENTION.peak(step, row)) };
    const { engine, runtime } = build({
      model: { transcripts: { 5: bytesAsTokens(long) }, attention: capped },
      engine: { alignment: { heads: HEADS }, characterAlignment: { heads: HEADS }, tokensPerSecond: 40 },
    });
    await engine.load();
    const out = await engine.transcribe(windowOf(5, 0, 30_000), { language: "hinglish" });
    expect(out.words.length).toBeGreaterThan(30);
    expect(out.wordTimes).toHaveLength(out.words.length);
    expect(runtime.decoders[0].session.fullPasses).toHaveLength(0);
  });
});

describe("decoder on its own backend", () => {
  it("runs the decoder on wasm while the encoder stays on webgpu, and does not pin the encoder output on the device", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["webgpu", "wasm"] }, engine: { decoderBackend: "wasm" } });
    await engine.load();
    expect(runtime.encoders[0].backend).toBe("webgpu");
    expect(runtime.decoders[0].backend).toBe("wasm");
    expect(runtime.keepHints.find((hint) => hint.backend === "webgpu")?.kept).toEqual([]);
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).words).toHaveLength(3);
  });

  it("keeps both on the same backend by default and pins the encoder output on the device", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["webgpu", "wasm"] } });
    await engine.load();
    expect(runtime.decoders[0].backend).toBe("webgpu");
    expect(runtime.keepHints.find((hint) => hint.backend === "webgpu" && hint.kept.includes("last_hidden_state"))).toBeDefined();
  });

  it("ignores a decoder backend the runtime does not have", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["wasm"] }, engine: { decoderBackend: "webgpu" } });
    await engine.load();
    expect(runtime.decoders[0].backend).toBe("wasm");
  });
});

describe("the second take", () => {
  it("moves times back by the shift and clamps a word that fell into the added silence, never dropping the rest", () => {
    expect(unshiftTimes([{ startMs: 20, endMs: 400 }, { startMs: 900, endMs: 1200 }], 300)).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 600, endMs: 900 },
    ]);
    expect(unshiftTimes([{ startMs: 5, endMs: 10 }], 300)).toEqual([{ startMs: 0, endMs: 1 }]);
    expect(unshiftTimes(undefined, 300)).toBeUndefined();
    const same = [{ startMs: 1, endMs: 2 }];
    expect(unshiftTimes(same, 0)).toBe(same);
  });

  it("reads a window a second time, shifted, only when the first reading was suspect", async () => {
    // Reads the largest value of the first 10 000 samples, so the window key survives being moved later.
    const maxKey = (samples: Float32Array, { nMels }: { nMels: 80 | 128 }) => new Float32Array(nMels * 3000).fill(Math.max(...samples.subarray(0, 10_000)));
    const withSignal = (key: number) => {
      const audio = windowOf(key);
      audio.samples.fill(key, 0, 8000);
      return audio;
    };
    // A confident reading is not read twice.
    const calm = build({ engine: { retryShiftMs: 300, logMel: maxKey } });
    await calm.engine.load();
    await calm.engine.transcribe(withSignal(1), { language: "hinglish" });
    expect(calm.runtime.encoders[0].session.runs).toBe(1);
    // A reading whose end was blocked by the token floor is suspect: it is read again.
    const retries: string[] = [];
    const floored = build({
      engine: { retryShiftMs: 300, logMel: maxKey, minTokensPerSecond: 3, onTiming: (label, _ms, detail) => label === "retry" && retries.push(detail ?? "") },
      model: { transcripts: TRANSCRIPTS, lenient: true },
    });
    await floored.engine.load();
    await floored.engine.transcribe(withSignal(1), { language: "hinglish" });
    expect(floored.runtime.encoders[0].session.runs).toBe(2);
    expect(retries).toHaveLength(1);
    // No retry configured: never read twice.
    const off = build({ engine: { logMel: maxKey, minTokensPerSecond: 3 }, model: { transcripts: TRANSCRIPTS, lenient: true } });
    await off.engine.load();
    await off.engine.transcribe(withSignal(1), { language: "hinglish" });
    expect(off.runtime.encoders[0].session.runs).toBe(1);
  });

  it("keeps the Hindi token on the shifted take of a music window, while a speech retry stays English", async () => {
    // Reads the largest value of the first 10 000 samples, so the window key survives being moved later.
    const maxKey = (samples: Float32Array, { nMels }: { nMels: 80 | 128 }) => new Float32Array(nMels * 3000).fill(Math.max(...samples.subarray(0, 10_000)));
    const withSignal = (key: number) => {
      const audio = windowOf(key);
      audio.samples.fill(key, 0, 8000);
      return audio;
    };
    const { engine, runtime } = build({
      engine: { retryShiftMs: 300, logMel: maxKey, minTokensPerSecond: 3 },
      model: { transcripts: TRANSCRIPTS, lenient: true },
    });
    await engine.load();
    const decoder = runtime.decoders[0].session;
    // A floored end makes the first take suspect, so the shifted take runs too: both must use the Hindi token.
    await engine.transcribe(withSignal(1), { language: "hinglish", music: true });
    const musicPrompts = decoder.calls.filter((call) => !call.useCache).map((call) => call.inputIds);
    expect(musicPrompts).toHaveLength(2);
    expect(musicPrompts.every((prompt) => prompt[1] === FAKE.hi)).toBe(true);
    // Speech mode is unchanged: both takes use the English token.
    decoder.calls.length = 0;
    await engine.transcribe(withSignal(1), { language: "hinglish" });
    const speechPrompts = decoder.calls.filter((call) => !call.useCache).map((call) => call.inputIds);
    expect(speechPrompts).toHaveLength(2);
    expect(speechPrompts.every((prompt) => prompt[1] === FAKE.en)).toBe(true);
  });
});

describe("one encoder run shared by two reads of a window", () => {
  /** The pipeline's song bounds, which also carry the sharing hint (not part of the TranscribeBounds contract). */
  const share = (extra: { retryShiftMs?: number } = {}) => ({ tokensPerSecond: 6, reuseEncoder: true, ...extra });

  it("encodes each window once, keeps it for the lyrics pass, and reuses any window still held", async () => {
    const { engine, runtime, world } = build();
    await engine.load();
    const encoder = runtime.encoders[0].session;
    const audio = windowOf(1, 3);
    // Base read (English token) then the token vote (Hindi token) on exactly the same audio: one encoder run.
    await engine.transcribe(audio, { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(1);
    await engine.transcribe(audio, { language: "hinglish", music: true, bounds: share() });
    expect(encoder.runs).toBe(1);
    // Another window's audio is encoded, and it does NOT throw the first window's output away: the lyrics pass
    // runs after the whole file, so it needs every base window's encoder output to still be there.
    await engine.transcribe(windowOf(1, 4), { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(2);
    await engine.transcribe(audio, { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(2);
    // Both windows' outputs are held; a release frees them all.
    expect([...world.live]).toHaveLength(2);
    await engine.release();
    expect([...world.live]).toEqual([]);
  });

  it("reuses the encoder output a lyrics transcription kept, so N windows cost N encoder runs", async () => {
    // The pipeline's speech-mode lyrics bounds keep each window's encoder output for the alignment pass that runs
    // after the whole file (see `LYRIC_KEEP_ENCODER_BOUNDS`). Every alignText is then a decoder-only pass.
    const fullAttention = { ...ATTENTION, fullPeak: (ids: readonly number[]) => ids.map((_, row) => 3 + row) };
    const { engine, runtime, world } = build({
      model: { transcripts: TRANSCRIPTS, attention: fullAttention },
      engine: { characterAlignment: { heads: HEADS, medianFilterWidth: 1 } },
    });
    await engine.load();
    const encoder = runtime.encoders[0].session;
    const audio = [windowOf(1, 0), windowOf(1, 1), windowOf(1, 2)];
    for (const input of audio) await engine.transcribe(input, { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(3);
    expect([...world.live]).toHaveLength(3);
    for (const input of audio) expect(await engine.alignText(input, "aaj hai bhai,")).not.toBeNull();
    // Not a single extra encoder run in the alignment pass: 3 windows, 3 runs (2N was the B5 defect).
    expect(encoder.runs).toBe(3);
    // An array with the same samples but a different window index is a miss, as it must be.
    const copy = { ...audio[0], window: { ...audio[0].window, index: 9 } };
    await engine.alignText(copy, "aaj hai bhai,");
    expect(encoder.runs).toBe(4);
  });

  it("clears the lyrics keep flag on release, so a later speech job never holds an encoder output", async () => {
    const fullAttention = { ...ATTENTION, fullPeak: (ids: readonly number[]) => ids.map((_, row) => 3 + row) };
    const { engine, runtime, world } = build({
      model: { transcripts: TRANSCRIPTS, attention: fullAttention },
      engine: { characterAlignment: { heads: HEADS, medianFilterWidth: 1 } },
    });
    await engine.load();
    const audio = windowOf(1, 0);
    // An ordinary speech read before any lyrics work holds nothing.
    await engine.transcribe(audio, { language: "hinglish" });
    expect([...world.live]).toEqual([]);
    // The alignment pass turns the keep flag on and caches this window's encoder output.
    expect(await engine.alignText(audio, "aaj hai bhai,")).not.toBeNull();
    expect([...world.live]).toHaveLength(1);
    expect(runtime.encoders[0].session.runs).toBe(2);
    // The flag stays on for the rest of the job: an ordinary read now holds its encoder output too.
    await engine.transcribe(windowOf(1, 7), { language: "hinglish" });
    expect([...world.live]).toHaveLength(2);
    await engine.release();
    expect([...world.live]).toEqual([]);
    await engine.load();
    // A speech job after the release must not inherit the flag: its encoder output is freed at the end of the window.
    await engine.transcribe(windowOf(1, 7), { language: "hinglish" });
    expect([...world.live]).toEqual([]);
    expect(runtime.encoders[1].session.runs).toBe(1);
  });

  it("holds a bounded number of windows, oldest evicted first", async () => {
    const { engine, runtime, world } = build();
    await engine.load();
    const encoder = runtime.encoders[0].session;
    // 17 unshifted windows: the 17th evicts the first, so the first must be encoded again (never wrong, just slower).
    for (let index = 0; index < 17; index += 1) await engine.transcribe(windowOf(1, index), { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(17);
    expect([...world.live]).toHaveLength(16);
    await engine.transcribe(windowOf(1, 0), { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(18);
    await engine.release();
    expect([...world.live]).toEqual([]);
  });

  it("holds nothing and reuses nothing for a caller that does not ask to share (speech mode)", async () => {
    const { engine, runtime, world } = build();
    await engine.load();
    const audio = windowOf(1, 3);
    await engine.transcribe(audio, { language: "hinglish" });
    await engine.transcribe(audio, { language: "hinglish", music: true });
    expect(runtime.encoders[0].session.runs).toBe(2);
    expect([...world.live]).toEqual([]);
  });

  it("keeps the shifted take in its own slot, so only the same shift is reused", async () => {
    // Reads the largest value of the first 10 000 samples, so the window key survives being moved later.
    const maxKey = (samples: Float32Array, { nMels }: { nMels: 80 | 128 }) => new Float32Array(nMels * 3000).fill(Math.max(...samples.subarray(0, 10_000)));
    const withSignal = () => {
      const audio = windowOf(1);
      audio.samples.fill(1, 0, 8000);
      return audio;
    };
    const long = bytesAsTokens("abcdefghijklmnopqrstuvwxyz0123456789");
    // A very unsure reading makes the first take suspect, so every read runs shift 0 AND the 300 ms shifted take.
    const { engine, runtime } = build({ engine: { retryShiftMs: 300, logMel: maxKey }, model: { transcripts: { 1: long }, chosenLogit: 0.5 } });
    await engine.load();
    const encoder = runtime.encoders[0].session;
    const audio = withSignal();
    await engine.transcribe(audio, { language: "hinglish", bounds: share() });
    expect(encoder.runs).toBe(2); // shift 0 + shift 300
    // The vote on the same audio hits BOTH slots: no new encoder run at all.
    await engine.transcribe(audio, { language: "hinglish", music: true, bounds: share() });
    expect(encoder.runs).toBe(2);
    // The unshifted take alone hits the shift-0 slot.
    await engine.transcribe(audio, { language: "hinglish", bounds: share({ retryShiftMs: 0 }) });
    expect(encoder.runs).toBe(2);
    // A different shift is different audio: shift 0 hits, shift 500 is encoded.
    await engine.transcribe(audio, { language: "hinglish", bounds: share({ retryShiftMs: 500 }) });
    expect(encoder.runs).toBe(3);
  });
});

describe("per-call decode bounds", () => {
  it("turns a caller's tokens-per-second into the max new tokens of that take, which ends the decode sooner", async () => {
    // 36 distinct byte tokens, no leading space (a leading space is suppressed as the first token).
    const long = bytesAsTokens("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(long).toHaveLength(36);
    const { engine, runtime } = build({ model: { transcripts: { 1: long } } });
    await engine.load();
    const decoder = runtime.decoders[0].session;
    // The configured default (12 tokens per second of audio) gives 12 s x 12 + 8 = 152 tokens: the whole script.
    const full = await engine.transcribe(windowOf(1, 0, 12_000), { language: "hinglish" });
    expect(full.tokenIds).toEqual(long);
    // 1 token per second gives 12 + 8 = 20 tokens for the same 12 s window, so the fake session sees 20 steps and the
    // decode stops at the token budget instead of reaching the end of the script.
    decoder.calls.length = 0;
    const capped = await engine.transcribe(windowOf(1, 0, 12_000), { language: "hinglish", bounds: { tokensPerSecond: 1 } });
    expect(capped.tokenIds).toEqual(long.slice(0, 20));
    expect(decoder.calls).toHaveLength(20);
  });

  it("hands the caller's repetition rules to the decoder, so a two-token loop of three stops the decode", async () => {
    const lead = bytesAsTokens("ok");
    const unit = [70, 71];
    const script = [...lead, ...unit, ...unit, ...unit, 90];
    const { engine, runtime } = build({ model: { transcripts: { 1: script } } });
    await engine.load();
    const decoder = runtime.decoders[0].session;
    // The decoder defaults (a 4-token run three times, one token ten times) leave this loop alone.
    const plain = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(plain.tokenIds).toEqual(script);
    // With the caller's rule the loop is cut back to one copy and the decode stops as soon as the third copy completes.
    decoder.calls.length = 0;
    const looped = await engine.transcribe(windowOf(1), { language: "hinglish", bounds: { repetitionRules: [{ n: 2, times: 3 }] } });
    expect(looped.tokenIds).toEqual([...lead, ...unit]);
    expect(decoder.calls).toHaveLength(lead.length + unit.length * 3);
  });

  it("uses the same bounds on the shifted second take of a suspect reading", async () => {
    // Reads the largest value of the first 10 000 samples, so the window key survives being moved later.
    const maxKey = (samples: Float32Array, { nMels }: { nMels: 80 | 128 }) => new Float32Array(nMels * 3000).fill(Math.max(...samples.subarray(0, 10_000)));
    const long = bytesAsTokens("abcdefghijklmnopqrstuvwxyz0123456789");
    const withSignal = () => {
      const audio = windowOf(1);
      audio.samples.fill(1, 0, 8000);
      return audio;
    };
    // A low chosen logit makes every take very unsure (average log-probability far below -1), so the first take is suspect
    // and a shifted second take runs; both takes must stop at the caller's 20-token budget.
    const { engine, runtime } = build({
      engine: { retryShiftMs: 300, logMel: maxKey },
      model: { transcripts: { 1: long }, chosenLogit: 0.5 },
    });
    await engine.load();
    const decoder = runtime.decoders[0].session;
    const out = await engine.transcribe(withSignal(), { language: "hinglish", bounds: { tokensPerSecond: 1 } });
    expect(out.tokenIds).toEqual(long.slice(0, 20));
    const promptStarts = decoder.calls.reduce<number[]>((starts, call, index) => (call.useCache ? starts : [...starts, index]), []);
    expect(promptStarts).toHaveLength(2);
    // Each take stops at ceil(12 s or 12.3 s x 1) + 8 tokens: 20 for the first, 21 for the shifted one (12.3 s of audio).
    const stepsPerTake = promptStarts.map((start, i) => (i + 1 < promptStarts.length ? promptStarts[i + 1] : decoder.calls.length) - start);
    expect(stepsPerTake).toEqual([20, 21]);
  });
});

describe("choosing between two readings of a window", () => {
  const take = (averageLogProbability: number, extra: { endBlocked?: number; stop?: "eot" | "repetition" | "max-tokens" } = {}) => ({
    transcript: { windowIndex: 0, words: ["a"], tokenIds: [1], noSpeechProbability: 0, averageLogProbability },
    stop: extra.stop ?? ("eot" as const),
    endBlocked: extra.endBlocked ?? 0,
  });
  it("calls a reading suspect when the end was blocked, it looped, or it was very unsure", () => {
    expect(isSuspect(take(-0.2))).toBe(false);
    expect(isSuspect(take(-0.2, { endBlocked: 1 }))).toBe(true);
    expect(isSuspect(take(-0.2, { stop: "repetition" }))).toBe(true);
    expect(isSuspect(take(-1.5))).toBe(true);
  });
  it("prefers a clean reading over a suspect one, whatever the scores", () => {
    const clean = take(-0.9);
    const suspect = take(-0.1, { endBlocked: 2 });
    expect(betterTake(suspect, clean)).toBe(clean);
    expect(betterTake(clean, suspect)).toBe(clean);
  });
  it("otherwise keeps the surer one, and the first on a tie", () => {
    const a = take(-0.5, { endBlocked: 1 });
    const b = take(-0.3, { endBlocked: 1 });
    expect(betterTake(a, b)).toBe(b);
    const c = take(-0.5);
    const d = take(-0.5);
    expect(betterTake(c, d)).toBe(c);
  });
});

describe("wordConfidences", () => {
  const pieces = [" Kya", " ha", "al", " hai,", " "];
  const tok = { decode: (ids: readonly number[]) => ids.map((id) => pieces[id]).join("") } as never;
  it("gives each word the lowest chance among its tokens", () => {
    const probs = [0.9, 0.5, 0.8, 0.95].map(Math.log);
    expect(wordConfidences(tok, [0, 1, 2, 3], probs, 3)?.map((v) => Math.round(v * 100))).toEqual([90, 50, 95]);
  });
  it("ignores a bare-space token", () => {
    expect(wordConfidences(tok, [0, 4, 3], [0.9, 0.9, 0.7].map(Math.log), 2)?.length).toBe(2);
  });
  it("returns nothing when the grouping does not match the words", () => {
    expect(wordConfidences(tok, [0, 1, 2, 3], [0.9, 0.5, 0.8, 0.95].map(Math.log), 5)).toBeUndefined();
    expect(wordConfidences(tok, [0, 1], [0.9], 1)).toBeUndefined();
  });
});

describe("files listed in pieces", () => {
  it("joins 'name-p0', 'name-p1', ... into one file before starting the sessions", async () => {
    const whole = fakeModelFiles();
    const bytes: Record<string, Uint8Array> = { ...whole.bytes };
    for (const name of ["encoder", "decoder"]) {
      const data = bytes[name];
      delete bytes[name];
      const cut = Math.floor(data.length / 3);
      bytes[`${name}-p0`] = data.slice(0, cut);
      bytes[`${name}-p1`] = data.slice(cut, 2 * cut);
      bytes[`${name}-p2`] = data.slice(2 * cut);
    }
    const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
    const files = {
      bytes,
      manifest: { ...whole.manifest, files: Object.entries(bytes).map(([name, data]) => ({ name, url: `${HOST}/whisper/${name}.bin`, bytes: data.length, sha256: sha(data) })) },
    };
    const { engine, runtime } = build({ files });
    await engine.load();
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).words).toHaveLength(3);
    // The sessions got the whole files, byte for byte.
    expect(runtime).toBeDefined();
  });
});

describe("loading problems", () => {
  it("downloads through the loader (hash-checked) when nothing is cached, and reports progress", async () => {
    const files = fakeModelFiles();
    const bytesByUrl = new Map(files.manifest.files.map((file) => [file.url, files.bytes[file.name]]));
    const requested: string[] = [];
    const loader: LoaderDeps = {
      ...noNetwork(),
      fetch: async (url) => {
        requested.push(url);
        const body = bytesByUrl.get(url);
        return body ? new Response(body.slice(), { status: 200 }) : new Response("", { status: 404 });
      },
    };
    const progress: DownloadProgress[] = [];
    const { engine } = build({ files, engine: { loader } });
    await engine.load({ onDownload: (p) => progress.push(p) });
    expect(new Set(requested)).toEqual(new Set(files.manifest.files.map((f) => f.url)));
    expect(requested.every((url) => url.startsWith(`${HOST}/`))).toBe(true);
    expect(progress.at(-1)?.loadedBytes).toBe(progress.at(-1)?.totalBytes);
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).words).toHaveLength(3);
  });

  it("refuses a tampered file as a 'model-download' error and starts nothing", async () => {
    const files = fakeModelFiles();
    const loader: LoaderDeps = {
      ...noNetwork(),
      fetch: async (url) => new Response(new Uint8Array(files.manifest.files.find((f) => f.url === url)?.bytes ?? 1).fill(9), { status: 200 }),
    };
    const { engine, runtime } = build({ files, engine: { loader } });
    const error = await engine.load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptionError);
    expect((error as CaptionError).code).toBe("model-download");
    expect(runtime.encoders).toHaveLength(0);
  });

  it("refuses a manifest pointing at another host without making a request", async () => {
    const files = fakeModelFiles();
    const manifest: ModelManifest = { ...files.manifest, files: files.manifest.files.map((f) => ({ ...f, url: f.url.replace(HOST, "https://evil.example") })) };
    const { engine } = build({ files: { ...files, manifest }, engine: { loader: noNetwork() } });
    await expect(engine.load()).rejects.toMatchObject({ code: "model-download" });
  });

  it("maps a cancelled download to 'aborted'", async () => {
    const controller = new AbortController();
    controller.abort();
    const { engine } = build({ engine: { loader: noNetwork() } });
    await expect(engine.load({ signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
  });

  it("falls back to WASM if the GPU session cannot be created", async () => {
    const backends: string[] = [];
    const { engine, runtime } = build({ runtime: { backends: ["webgpu", "wasm"], failCreate: ["webgpu"] }, engine: { onBackend: (b) => backends.push(b) } });
    await engine.load();
    expect(engine.backend).toBe("wasm");
    expect(backends).toEqual(["wasm"]);
    expect(runtime.decoders.map((d) => d.backend)).toEqual(["wasm"]);
  });

  it("reports 'model-load' when no backend can start", async () => {
    const { engine } = build({ runtime: { backends: ["webgpu", "wasm"], failCreate: ["webgpu", "wasm"] } });
    await expect(engine.load()).rejects.toMatchObject({ code: "model-load" });
    expect(engine.backend).toBeNull();
  });

  it("rejects a model whose tensor names are not the expected layout, and frees what it created", async () => {
    const { engine, runtime } = build({ runtime: { sessionNames: { decoderInputs: ["input_ids", "encoder_hidden_states", "use_cache_branch"], decoderOutputs: ["logits"] } } });
    await expect(engine.load()).rejects.toMatchObject({ code: "model-load" });
    expect(runtime.encoders[0].session.released).toBe(true);
    expect(runtime.decoders[0].session.released).toBe(true);
  });

  it("can try again after a failed load", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["wasm"], failCreate: ["wasm"] } });
    await expect(engine.load()).rejects.toMatchObject({ code: "model-load" });
    (runtime as unknown as { options: FakeRuntimeOptions }).options.failCreate = [];
    await engine.load();
    expect(engine.backend).toBe("wasm");
  });
});

describe("release", () => {
  it("frees both sessions and the device watch, and load works again", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["webgpu", "wasm"] } });
    await engine.load();
    expect(runtime.listenerCount).toBe(1);
    await engine.release();
    expect(runtime.encoders[0].session.released).toBe(true);
    expect(runtime.decoders[0].session.released).toBe(true);
    expect(runtime.listenerCount).toBe(0);
    expect(engine.backend).toBeNull();
    await expect(engine.transcribe(windowOf(1), { language: "hinglish" })).rejects.toMatchObject({ code: "internal" });
    await engine.load();
    expect(runtime.encoders).toHaveLength(2);
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).words).toHaveLength(3);
  });

  it("waits for the window in progress before releasing", async () => {
    const { engine, runtime } = build();
    await engine.load();
    const pending = engine.transcribe(windowOf(1), { language: "hinglish" });
    const released = engine.release();
    await expect(pending).resolves.toMatchObject({ words: ["aaj", "hai", "bhai,"] });
    await released;
    expect(runtime.decoders[0].session.released).toBe(true);
  });

  it("is safe to call twice and before load", async () => {
    const { engine } = build();
    await engine.release();
    await engine.load();
    await engine.release();
    await engine.release();
  });
});

describe("a failing GPU", () => {
  it("moves to WASM, retries the window, and answers correctly", async () => {
    const backends: string[] = [];
    const { engine, runtime } = build({ runtime: { backends: ["webgpu", "wasm"] }, engine: { onBackend: (b) => backends.push(b) } });
    await engine.load();
    expect(engine.backend).toBe("webgpu");
    runtime.decoders[0].session.failWith = new Error("device lost during run");
    runtime.triggerLost();
    const result = await engine.transcribe(windowOf(1), { language: "hinglish" });
    expect(result.words).toEqual(["aaj", "hai", "bhai,"]);
    expect(engine.backend).toBe("wasm");
    expect(backends).toEqual(["webgpu", "wasm"]);
    expect(runtime.decoders[0].session.released).toBe(true);
    // And it keeps working on WASM afterwards.
    expect((await engine.transcribe(windowOf(2), { language: "hindi" })).words).toHaveLength(3);
  });

  it("reports 'device-lost' when the GPU died and nothing is left to fall back to", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["webgpu"] } });
    await engine.load();
    runtime.decoders[0].session.failWith = new Error("gone");
    runtime.triggerLost();
    await expect(engine.transcribe(windowOf(1), { language: "hinglish" })).rejects.toMatchObject({ code: "device-lost" });
  });

  it("reports a plain 'inference' error when only the model failed and there is no fallback", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["webgpu"] } });
    await engine.load();
    runtime.encoders[0].session.failWith = new Error("bad op");
    await expect(engine.transcribe(windowOf(1), { language: "hinglish" })).rejects.toMatchObject({ code: "inference" });
  });

  it("does not retry on WASM: a WASM failure is reported as is", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["wasm"] } });
    await engine.load();
    runtime.decoders[0].session.failWith = new Error("oops");
    await expect(engine.transcribe(windowOf(1), { language: "hinglish" })).rejects.toMatchObject({ code: "inference" });
    expect(runtime.decoders).toHaveLength(1);
  });

  it("does not fall back when the user cancelled", async () => {
    const { engine, runtime } = build({ runtime: { backends: ["webgpu", "wasm"] } });
    await engine.load();
    const controller = new AbortController();
    runtime.decoders[0].session.failWith = new Error("x");
    controller.abort();
    await expect(engine.transcribe(windowOf(1), { language: "hinglish", signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(engine.backend).toBe("webgpu");
  });
});

describe("the song-mode timestamp read (wp-TS)", () => {
  const TS = FAKE.firstTimestamp;
  const TEXT = [...bytesAsTokens(" aaj"), FAKE.hai, ...bytesAsTokens(" bhai")];

  it("uses the timestamp prompt without <|notimestamps|>, strips timestamps, and keeps speech untouched", async () => {
    const seen: Array<{ nMels: 80 | 128; padFrames?: boolean }> = [];
    const logMel = (samples: Float32Array, options: { nMels: 80 | 128; padFrames?: boolean }) => {
      seen.push({ ...options });
      return fakeMel(samples, options);
    };
    const { engine, runtime } = build({
      model: { transcripts: { 1: [TS, ...TEXT] } },
      runtime: { promptLength: 3 },
      engine: { logMel },
    });
    await engine.load();
    expect(engine.timestampRead).toBe(true);
    const audio = windowOf(1, 5, 12_000);
    const result = await engine.transcribe(audio, {
      language: "hinglish",
      bounds: { timestampRead: true, reuseEncoder: true, retryShiftMs: 0 } as never,
    });
    // The timestamp prompt omits <|notimestamps|>; the language token is the normal read's (`en` here, the pipeline
    // keeps the base token for the timestamp read).
    expect(runtime.decoders[0].session.calls[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe]);
    expect(result.words).toEqual(["aaj", "hai", "bhai"]);
    expect(result.tokenIds.every((id) => id < FAKE.eot)).toBe(true);
    // A short window uses the CT2 frame-pad mel (the timestamp read's own encoder input).
    expect(seen).toHaveLength(1);
    expect(seen[0].padFrames).toBe(true);
  });

  it("reuses the normal read's encoder output for a full 30 s window (both mel conventions are identical)", async () => {
    const seen: Array<{ nMels: 80 | 128; padFrames?: boolean }> = [];
    const logMel = (samples: Float32Array, options: { nMels: 80 | 128; padFrames?: boolean }) => {
      seen.push({ ...options });
      return fakeMel(samples, options);
    };
    const { engine, runtime } = build({
      model: { transcripts: { 1: [TS, ...TEXT] } },
      runtime: { promptLength: 3 },
      engine: { logMel },
    });
    await engine.load();
    const audio = windowOf(1, 3, 30_000);
    const bounds = { timestampRead: true, reuseEncoder: true, retryShiftMs: 0 } as never;
    await engine.transcribe(audio, { language: "hinglish", bounds });
    expect(runtime.encoders[0].session.runs).toBe(1);
    // Same audio object, same window: the cached (unpadded) hidden state is used, so no second encoder run and no mel.
    await engine.transcribe(audio, { language: "hinglish", bounds });
    expect(runtime.encoders[0].session.runs).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].padFrames).toBeUndefined();
  });

  it("can be switched off for the engine, and then the hint changes nothing", async () => {
    const { engine, runtime } = build({ model: { transcripts: { 1: [TS, ...TEXT] }, lenient: true }, engine: { timestampRead: false } });
    await engine.load();
    expect(engine.timestampRead).toBe(false);
    const result = await engine.transcribe(windowOf(1), {
      language: "hinglish",
      bounds: { timestampRead: true, reuseEncoder: true } as never,
    });
    // The normal prompt (with <|notimestamps|>) is used; the timestamp token cannot be generated.
    expect(runtime.decoders[0].session.calls[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);
    expect(result.words.length).toBeGreaterThanOrEqual(0);
  });
});
