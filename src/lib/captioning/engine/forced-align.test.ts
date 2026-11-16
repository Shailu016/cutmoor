import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ForcedAlignWord, WindowAudio } from "../contracts";
import { WINDOW_SAMPLES } from "../contracts";
import type { LoaderDeps } from "../model-loader";
import type { AttentionMatrix } from "./attention";
import type { CharacterTokenRow } from "./char-align";
import { alignableWords, forcedAlignWords } from "./forced-align";
import { createWhisperEngine, type WhisperEngineOptions } from "./whisper-engine";
import { bytesAsTokens, FAKE, fakeModelFiles, FakeRuntime, FakeWorld, HOST, MemoryStore, primedStore, type FakeFiles, type FakeModelConfig, type FakeRuntimeOptions } from "./fake-model";

// ---------------------------------------------------------------- synthetic attention

/**
 * A [1, heads, rows, frames] tensor with one strong frame per query row, built the same way
 * char-align.test.ts does it so the two oracles agree.
 */
function attention(peaks: readonly number[], frames = 15, secondHead?: readonly number[]): AttentionMatrix {
  const rows = peaks.length;
  const heads = secondHead ? 2 : 1;
  const data = new Float32Array(heads * rows * frames);
  for (let head = 0; head < heads; head += 1) {
    const source = head === 0 ? peaks : (secondHead as readonly number[]);
    for (let row = 0; row < rows; row += 1) {
      const peak = source[row];
      if (!Number.isInteger(peak) || peak < 0 || peak >= frames) throw new Error(`test tensor: bad peak ${peak} for row ${row}`);
      data[(head * rows + row) * frames + peak] = 1;
    }
  }
  return { dims: [1, heads, rows, frames], data };
}

/** One token per character: the common case for Latin text. */
function oneTokenRows(count: number): CharacterTokenRow[] {
  return Array.from({ length: count }, (_, index) => ({ firstToken: index, tokenCount: 1 }));
}

/**
 * Logits [1, rows, vocab] where the row that predicts token k gives `boost[k]` extra weight to that
 * token and 0 to every other token. The log-softmax of such a row is
 * `boost - log((vocab - 1) + exp(boost))`.
 */
function logitsFor(tokenIds: readonly number[], rows: number, boost: (token: number) => number, vocab = 16): { dims: readonly number[]; data: Float32Array } {
  const data = new Float32Array(rows * vocab);
  tokenIds.forEach((id, token) => {
    const row = token; // promptRows 1 in these tests: row k predicts token k
    if (row >= rows) return;
    data[row * vocab + id] = boost(token);
  });
  return { dims: [1, rows, vocab], data };
}

const logProbOf = (boost: number, vocab = 16) => boost - Math.log(vocab - 1 + Math.exp(boost));

const ONE_HEAD = [{ layer: 0, head: 0 }];
const BASE = { usedMs: 300, promptRows: 1, heads: ONE_HEAD, medianFilterWidth: 1 } as const;

const pairs = (words: ForcedAlignWord[] | null) => words?.map((word) => [word.text, word.startMs, word.endMs]);

describe("forcedAlignWords", () => {
  it("places every word of the known text on its character peaks, with a token log-probability", () => {
    // "abc def ghi": 11 characters, one token each, plus one prompt row.
    const tokenIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const words = forcedAlignWords({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      tokenIds,
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]) },
      logits: logitsFor(tokenIds, 12, () => 4),
    });
    expect(pairs(words)).toEqual([
      ["abc", 0, 80],
      ["def", 80, 160],
      ["ghi", 160, 300],
    ]);
    for (const word of words ?? []) {
      expect(word.logProbability).toBeCloseTo(logProbOf(4), 6);
      expect(word.logProbability).toBeLessThan(0);
      expect(Number.isFinite(word.sharpness)).toBe(true);
      expect(word.sharpness).toBeGreaterThan(0.3);
      expect(word.sharpness).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the times and reports logProbability 0 when the logits are missing or unusable", () => {
    const base = {
      ...BASE,
      text: "abc def",
      charRows: oneTokenRows(7),
      tokenIds: [0, 1, 2, 3, 4, 5, 6],
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 0]) },
    };
    const withLogits = forcedAlignWords({ ...base, logits: logitsFor(base.tokenIds, 8, () => 3) });
    const none = forcedAlignWords(base);
    const empty = forcedAlignWords({ ...base, logits: { dims: [1, 8, 16], data: new Float32Array(0) } });
    const wrongShape = forcedAlignWords({ ...base, logits: { dims: [1, 8], data: new Float32Array(8) } });
    expect(pairs(none)).toEqual(pairs(withLogits));
    expect(pairs(empty)).toEqual(pairs(withLogits));
    expect(pairs(wrongShape)).toEqual(pairs(withLogits));
    expect(none?.every((word) => word.logProbability === 0)).toBe(true);
    expect(empty?.every((word) => word.logProbability === 0)).toBe(true);
    expect(wrongShape?.every((word) => word.logProbability === 0)).toBe(true);
    expect(withLogits?.every((word) => word.logProbability < 0)).toBe(true);
  });

  it("averages over each word's own tokens, including the extra tokens of a split character", () => {
    // "ab cd": 'b' encodes to two tokens, so "ab" owns tokens 0, 1 and 2 while "cd" owns 4 and 5.
    const tokenIds = [0, 1, 2, 3, 4, 5];
    const charRows: CharacterTokenRow[] = [
      { firstToken: 0, tokenCount: 1 },
      { firstToken: 1, tokenCount: 2 },
      { firstToken: 3, tokenCount: 1 },
      { firstToken: 4, tokenCount: 1 },
      { firstToken: 5, tokenCount: 1 },
    ];
    const words = forcedAlignWords({
      ...BASE,
      text: "ab cd",
      charRows,
      tokenIds,
      tensors: { "cross_attentions.0": attention([0, 1, 12, 3, 6, 9, 0]) },
      // Token 0 is unsure (-log 16); everything else is boosted.
      logits: logitsFor(tokenIds, 7, (token) => (token === 0 ? 0 : 2)),
    });
    expect(words?.map((word) => word.text)).toEqual(["ab", "cd"]);
    expect(words?.[0].logProbability).toBeCloseTo((logProbOf(0) + 2 * logProbOf(2)) / 3, 6);
    // A different mean from "ab", which proves the grouping was not just the whole pass.
    expect(words?.[1].logProbability).toBeCloseTo(logProbOf(2), 6);
    expect(words?.[0].logProbability).toBeLessThan(words?.[1].logProbability as number);
  });

  it("scores a concentrated attention near 1 and a flat one at 0, never NaN", () => {
    const tokenIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sharp = forcedAlignWords({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      tokenIds,
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]) },
    });
    const flat = forcedAlignWords({
      ...BASE,
      text: "abc def ghi",
      charRows: oneTokenRows(11),
      tokenIds,
      tensors: { "cross_attentions.0": attention(new Array<number>(12).fill(0)) },
    });
    for (const word of sharp ?? []) {
      expect(word.sharpness).toBeGreaterThan(0.3);
      expect(word.sharpness).toBeLessThanOrEqual(1);
    }
    for (const word of flat ?? []) {
      expect(word.sharpness).toBe(0);
      expect(Number.isNaN(word.sharpness)).toBe(false);
    }
  });

  it("returns null (never throws) when the pass cannot give one time per word", () => {
    const good = () => ({
      ...BASE,
      text: "abc def",
      charRows: oneTokenRows(7),
      tokenIds: [0, 1, 2, 3, 4, 5, 6],
      tensors: { "cross_attentions.0": attention([0, 1, 2, 3, 4, 5, 6, 0]) },
    });
    expect(forcedAlignWords(good())).not.toBeNull();
    expect(forcedAlignWords({ ...good(), text: "" })).toBeNull();
    expect(forcedAlignWords({ ...good(), text: "   " })).toBeNull();
    expect(forcedAlignWords({ ...good(), tensors: {} })).toBeNull();
    expect(forcedAlignWords({ ...good(), charRows: oneTokenRows(6) })).toBeNull();
    expect(forcedAlignWords({ ...good(), usedMs: 0 })).toBeNull();
    expect(forcedAlignWords({ ...good(), heads: [] })).toBeNull();
    expect(forcedAlignWords({ ...good(), heads: [{ layer: 0, head: 4 }] })).toBeNull();
    // No token ids only costs the log-probabilities (they degrade to 0); the times still stand.
    expect(forcedAlignWords({ ...good(), tokenIds: [] })?.every((word) => word.logProbability === 0)).toBe(true);
    expect(forcedAlignWords(undefined as never)).toBeNull();
    // Non-finite attention: refused, not scored as NaN.
    const nan = new Float32Array(8 * 15);
    nan[3 * 15 + 2] = Number.NaN;
    expect(forcedAlignWords({ ...good(), tensors: { "cross_attentions.0": { dims: [1, 1, 8, 15], data: nan } } })).toBeNull();
  });

  it("never reports a word outside the window or out of order", () => {
    const words = forcedAlignWords({
      ...BASE,
      usedMs: 120,
      text: "one two three four",
      charRows: oneTokenRows(18),
      tokenIds: Array.from({ length: 18 }, (_, index) => index),
      tensors: { "cross_attentions.0": attention(Array.from({ length: 19 }, (_, index) => index % 15)) },
    });
    expect(words).not.toBeNull();
    let previousEnd = 0;
    for (const word of words ?? []) {
      expect(word.startMs).toBeGreaterThanOrEqual(previousEnd);
      expect(word.endMs).toBeGreaterThan(word.startMs);
      expect(word.endMs).toBeLessThanOrEqual(120);
      previousEnd = word.endMs;
    }
  });
});

describe("alignableWords", () => {
  it("keeps the user's spelling and collapses line breaks and runs of spaces", () => {
    expect(alignableWords("  aaj   hai\nbhai,  ")).toEqual(["aaj", "hai", "bhai,"]);
    expect(alignableWords("")).toEqual([]);
    expect(alignableWords(" \n\t ")).toEqual([]);
  });
});

// ---------------------------------------------------------------- the engine's alignText

const TRANSCRIPTS: Record<number, number[]> = {
  1: [...bytesAsTokens("aaj"), FAKE.hai, ...bytesAsTokens(" bhai,")],
  2: [...bytesAsTokens("नमस्ते"), FAKE.kya, ...bytesAsTokens(" हाल?")],
};

const ATTENTION = {
  layers: [0, 1],
  heads: 8,
  frames: 1500,
  peak: (step: number, row: number) => (step === 0 ? (row === 3 ? 5 : 0) : 5 + 10 * step),
  // One distinct peak per query row of the teacher-forced pass, so every word lands on its own frame.
  fullPeak: (ids: readonly number[]) => ids.map((_, row) => 3 + row),
};
const HEADS = [
  { layer: 0, head: 1 },
  { layer: 1, head: 2 },
];

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

const ALIGNING = { characterAlignment: { heads: HEADS, medianFilterWidth: 1 } } as const;

describe("alignText", () => {
  it("places the visitor's words from one teacher-forced pass that asks for logits and attention together", async () => {
    const { engine, runtime, world } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await engine.load();
    const audio = windowOf(1);
    const result = await engine.alignText(audio, "aaj hai bhai,");
    expect(result).not.toBeNull();
    expect(result?.languageToken).toBe("<|en|>");
    expect(result?.words.map((word) => word.text)).toEqual(["aaj", "hai", "bhai,"]);
    // The same times the transcript path's character pass produces: character c sits on frame 6 + c.
    expect(result?.words.map((word) => [word.startMs, word.endMs])).toEqual([
      [140, 220],
      [220, 300],
      [300, 12_000],
    ]);
    // The fake model gives every row but the last the same logits, so every word sees -log(vocab).
    for (const word of result?.words ?? []) {
      expect(word.logProbability).toBeCloseTo(-Math.log(FAKE.vocab), 5);
      expect(word.sharpness).toBeGreaterThanOrEqual(0);
      expect(word.sharpness).toBeLessThanOrEqual(1);
    }
    // Exactly one teacher-forced run, and it fetched the logits and the two attention layers in that one run.
    const decoder = runtime.decoders[0].session;
    expect(decoder.fullPasses).toHaveLength(1);
    const fetches = decoder.lastFetches ?? [];
    expect(fetches).toContain("logits");
    expect(fetches).toContain("cross_attentions.0");
    expect(fetches).toContain("cross_attentions.1");
    // The pass fed the prompt plus one token per character of " aaj hai bhai,".
    const characters = (await import("./char-align")).characterTokens(
      (await import("./tokenizer")).createWhisperTokenizer({ vocab: fakeModelFiles().bytes.tokenizer, addedTokens: fakeModelFiles().bytes.addedTokens }),
      " aaj hai bhai,",
    );
    expect(decoder.fullPasses[0].inputIds).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps, ...(characters?.tokenIds ?? [])]);
    // The only tensor left alive is the encoder output held for the next window's alignment pass.
    expect([...world.live]).toHaveLength(1);
    await engine.release();
    expect([...world.live]).toEqual([]);
  });

  it("keeps the user's spelling (line breaks and extra spaces) and returns one word per word", async () => {
    const { engine } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await engine.load();
    const result = await engine.alignText(windowOf(1), "  aaj\n hai   bhai, ");
    expect(result?.words.map((word) => word.text)).toEqual(["aaj", "hai", "bhai,"]);
  });

  it("uses the language token for the requested language and never the music token", async () => {
    const { engine, runtime } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await engine.load();
    await engine.alignText(windowOf(1), "aaj hai bhai,");
    expect(runtime.decoders[0].session.fullPasses[0].inputIds.slice(0, 4)).toEqual([FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps]);
    await engine.alignText(windowOf(1), "aaj hai bhai,", { language: "hindi" });
    expect(runtime.decoders[0].session.fullPasses[1].inputIds[1]).toBe(FAKE.en);
  });

  it("returns null (never throws) before load, for blank or over-long text, and when aborted", async () => {
    const { engine, runtime } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    expect(await engine.alignText(windowOf(1), "aaj hai")).toBeNull();
    await engine.load();
    const decoder = runtime.decoders[0].session;
    expect(await engine.alignText(windowOf(1), "")).toBeNull();
    expect(await engine.alignText(windowOf(1), "   \n ")).toBeNull();
    expect(await engine.alignText(windowOf(1), "a".repeat(401))).toBeNull();
    const controller = new AbortController();
    controller.abort();
    expect(await engine.alignText(windowOf(1), "aaj hai", { signal: controller.signal })).toBeNull();
    expect(decoder.fullPasses).toHaveLength(0);
    expect(runtime.encoders[0].session.runs).toBe(0);
  });

  it("returns null when the decoder has no cross-attention outputs", async () => {
    const { engine, runtime } = build({ engine: ALIGNING });
    await engine.load();
    expect(await engine.alignText(windowOf(1), "aaj hai bhai,")).toBeNull();
    expect(runtime.decoders[0].session.fullPasses).toHaveLength(0);
  });

  it("returns null on a runtime error and leaves the engine usable", async () => {
    const { engine, runtime, world } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await engine.load();
    const decoder = runtime.decoders[0].session;
    decoder.failWith = new Error("bad op");
    expect(await engine.alignText(windowOf(1), "aaj hai bhai,")).toBeNull();
    decoder.failWith = null;
    expect((await engine.transcribe(windowOf(1), { language: "hinglish" })).words).toEqual(["aaj", "hai", "bhai,"]);
    // The encoder failure path is also silent.
    const second = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await second.engine.load();
    second.runtime.encoders[0].session.failWith = new Error("bad op");
    expect(await second.engine.alignText(windowOf(1), "aaj hai bhai,")).toBeNull();
    // The first engine's cache is all that is left; a release frees it.
    await engine.release();
    expect([...world.live]).toEqual([]);
  });

  it("reuses the encoder output of the transcribe() before it on the same audio, and runs the encoder otherwise", async () => {
    const { engine, runtime } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await engine.load();
    const encoder = runtime.encoders[0].session;
    const audio = windowOf(1);

    // The first alignText of a job has no cached output to reuse (transcribe did not know yet that one would be asked for).
    await engine.transcribe(audio, { language: "hinglish" });
    expect(encoder.runs).toBe(1);
    const first = await engine.alignText(audio, "aaj hai bhai,");
    expect(encoder.runs).toBe(2);

    // From now on the transcribe() before each alignment pass leaves its encoder output in place.
    await engine.transcribe(audio, { language: "hinglish" });
    expect(encoder.runs).toBe(3);
    const second = await engine.alignText(audio, "aaj hai bhai,");
    expect(encoder.runs).toBe(3);
    expect(second).toEqual(first);

    // A different window index (or a different samples array) is not a cache hit.
    await engine.alignText(windowOf(1, 1), "aaj hai bhai,");
    expect(encoder.runs).toBe(4);
    const other = windowOf(1);
    await engine.transcribe(other, { language: "hinglish" });
    expect(encoder.runs).toBe(5);
    const third = await engine.alignText(windowOf(1, 0), "aaj hai bhai,");
    expect(encoder.runs).toBe(6);
    expect(third?.words.map((word) => word.text)).toEqual(["aaj", "hai", "bhai,"]);
  });

  it("frees the held encoder output on release, and transcribe stays byte-identical when alignText is never called", async () => {
    const { engine, world } = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await engine.load();
    const audio = windowOf(1);
    await engine.transcribe(audio, { language: "hinglish" });
    await engine.alignText(audio, "aaj hai bhai,");
    await engine.transcribe(audio, { language: "hinglish" });
    // The cached encoder output is the one thing allowed to be alive between calls.
    expect([...world.live]).toHaveLength(1);
    await engine.release();
    expect([...world.live]).toEqual([]);

    // Never calling alignText keeps the old behaviour: nothing held, nothing extra decoded.
    const plain = build({ model: { transcripts: TRANSCRIPTS, attention: ATTENTION }, engine: ALIGNING });
    await plain.engine.load();
    for (let i = 0; i < 4; i += 1) await plain.engine.transcribe(windowOf(1, i), { language: "hinglish" });
    expect([...plain.world.live]).toEqual([]);
  });
});
