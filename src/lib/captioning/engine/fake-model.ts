/**
 * Test support: a tiny deterministic "Whisper" that speaks the same tensor interface as the real
 * ONNX export, with no weights. It is strict on purpose. Every call is checked against the protocol
 * the real decoder needs (prompt on step one, one token per later step, growing cache, encoder cache
 * kept from step one, no use of a freed tensor), so a wrong engine fails here instead of in a browser.
 *
 * What the "model" says is a pure function of the audio: the encoder passes the first spectrogram
 * value through, and the decoder looks up its transcript by that value.
 */

import { createHash } from "node:crypto";
import type { ModelFile, ModelManifest, ModelStore } from "../model-loader";
import { storeKey } from "../model-loader";
import type { EngineBackend, InferenceSessionLike, OrtRuntime, TensorData, TensorElementType, TensorLike } from "./session";

// ---------------------------------------------------------------- vocabulary

/** Canonical GPT-2 byte -> symbol table, written the long way as an independent oracle. */
export function bytesToUnicode(): string[] {
  const bs: number[] = [];
  for (let c = "!".charCodeAt(0); c <= "~".charCodeAt(0); c += 1) bs.push(c);
  for (let c = 0xa1; c <= 0xac; c += 1) bs.push(c);
  for (let c = 0xae; c <= 0xff; c += 1) bs.push(c);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b += 1) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n += 1;
    }
  }
  const out = new Array<string>(256);
  bs.forEach((b, i) => {
    out[b] = String.fromCodePoint(cs[i]);
  });
  return out;
}

export const FAKE = {
  vocab: 310,
  eot: 300,
  sot: 301,
  en: 302,
  transcribe: 303,
  noSpeech: 304,
  noTimestamps: 305,
  firstTimestamp: 306,
  startOfPrev: 307,
  /** The Hindi language token, which music mode uses for Hinglish songs. */
  hi: 308,
  /** id of the merged token "Ġhai" (space + hai). */
  hai: 256,
  /** id of the merged token "Ġkya". */
  kya: 257,
  /** The bare-space token "Ġ" is the byte token for 0x20. */
  space: 0x20,
  layers: 2,
  heads: 8,
  headDim: 64,
  encoderFrames: 1500,
} as const;

/** vocab.json content for the fake model: 256 byte tokens, two merged words, and the special tokens. */
export function fakeVocab(): Record<string, number> {
  const symbols = bytesToUnicode();
  const vocab: Record<string, number> = {};
  symbols.forEach((symbol, byte) => {
    vocab[symbol] = byte;
  });
  vocab[`${symbols[0x20]}hai`] = FAKE.hai;
  vocab[`${symbols[0x20]}kya`] = FAKE.kya;
  return vocab;
}

export function fakeAddedTokens(): Record<string, number> {
  return {
    "<|endoftext|>": FAKE.eot,
    "<|startoftranscript|>": FAKE.sot,
    "<|en|>": FAKE.en,
    "<|hi|>": FAKE.hi,
    "<|transcribe|>": FAKE.transcribe,
    "<|nocaptions|>": FAKE.noSpeech,
    "<|notimestamps|>": FAKE.noTimestamps,
    "<|startofprev|>": FAKE.startOfPrev,
  };
}

/** Token ids that spell `text`, one byte per token (the worst case for UTF-8 splitting). */
export function bytesAsTokens(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

// ---------------------------------------------------------------- tensors

export class FakeTensor implements TensorLike {
  disposed = false;
  constructor(
    readonly type: string,
    readonly dims: readonly number[],
    readonly data: TensorData | null,
    private readonly world: FakeWorld,
  ) {
    world.live.add(this);
  }
  async getData(): Promise<TensorData> {
    if (this.disposed) throw new Error("read a disposed tensor");
    if (!this.data) throw new Error("this fake tensor holds no data");
    return this.data;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.live.delete(this);
  }
}

export class FakeWorld {
  live = new Set<FakeTensor>();
  tensor(type: string, dims: readonly number[], data: TensorData | null = null): FakeTensor {
    return new FakeTensor(type, dims, data, this);
  }
}

// ---------------------------------------------------------------- the model

export interface FakeModelConfig {
  /** Tokens (without the final end-of-text) the decoder says for the audio whose first mel value is `key`. */
  transcripts: Record<number, number[]>;
  /** Extra logits to add on the row being sampled, e.g. to tempt the engine with a forbidden token. */
  extraLogits?: (key: number, step: number) => [number, number][];
  /** Accept a fed token that differs from the script (the engine legitimately chose another because the scripted one was forbidden). */
  lenient?: boolean;
  /** The logit given to the chosen token. Others are 0 unless extraLogits says so. Default 10. */
  chosenLogit?: number;
  /** Logit of the no-speech token on the first row. Default 0. */
  noSpeechLogit?: number;
  /**
   * Make the decoder also output cross-attention maps `cross_attentions.<layer>` of shape [1, heads, rows, frames], with one
   * strong frame per row: `peak(step, row)` says which (rows of step 0 are the prompt). Only returned when asked for (`fetches`).
   */
  attention?: {
    layers: readonly number[];
    heads: number;
    frames: number;
    peak: (step: number, row: number, key: number) => number;
    /**
     * Peak frame for every query row of a TEACHER-FORCED pass (the prompt plus a whole transcript fed in one
     * non-cached run). Without it such a run falls back to `peak(0, row, key)`. It exists so a test can place the
     * character rows of the alignment pass exactly where it wants them, independently of the greedy steps.
     */
    fullPeak?: (ids: readonly number[], promptLength: number, key: number) => readonly number[];
  };
}

export interface StepRecord {
  step: number;
  inputIds: number[];
  useCache: boolean;
}

/** One decoder session. `calls` records every step so tests can see what was fed. */
export class FakeDecoder implements InferenceSessionLike {
  readonly inputNames: string[];
  readonly outputNames: string[];
  calls: StepRecord[] = [];
  /** Teacher-forced runs (prompt + a whole transcript in one non-cached call), recorded separately from the decode steps. */
  fullPasses: { inputIds: number[] }[] = [];
  /** The `fetches` list of the most recent run (undefined when the caller asked for everything). */
  lastFetches: readonly string[] | undefined;
  released = false;
  failWith: Error | null = null;
  onRun: (() => void) | null = null;

  constructor(
    private readonly world: FakeWorld,
    private readonly config: FakeModelConfig,
    private readonly promptLength: number,
    names?: { inputs?: string[]; outputs?: string[] },
  ) {
    const past: string[] = [];
    const present: string[] = [];
    for (let layer = 0; layer < FAKE.layers; layer += 1) {
      for (const side of ["decoder", "encoder"]) {
        for (const kind of ["key", "value"]) {
          past.push(`past_key_values.${layer}.${side}.${kind}`);
          present.push(`present.${layer}.${side}.${kind}`);
        }
      }
    }
    this.inputNames = names?.inputs ?? ["input_ids", "encoder_hidden_states", ...past, "use_cache_branch"];
    this.outputNames = names?.outputs ?? ["logits", ...present, ...(config.attention?.layers.map((layer) => `cross_attentions.${layer}`) ?? [])];
  }

  private tokenFor(key: number, step: number): number {
    const script = this.config.transcripts[key] ?? [];
    return step < script.length ? script[step] : FAKE.eot;
  }

  async run(feeds: Record<string, TensorLike>, fetches?: readonly string[]): Promise<Record<string, TensorLike>> {
    this.lastFetches = fetches;
    this.onRun?.();
    if (this.failWith) throw this.failWith;
    if (this.released) throw new Error("run on a released session");
    for (const [name, tensor] of Object.entries(feeds)) {
      if ((tensor as FakeTensor).disposed) throw new Error(`input ${name} was already disposed`);
    }
    for (const required of this.inputNames) if (!(required in feeds)) throw new Error(`missing input ${required}`);

    const ids = await feeds.input_ids.getData();
    if (!(ids instanceof BigInt64Array)) throw new Error("input_ids must be int64");
    const flag = await feeds.use_cache_branch.getData();
    const useCache = (flag as Uint8Array)[0] === 1;
    const hidden = (await feeds.encoder_hidden_states.getData()) as Float32Array;
    const key = hidden[0];
    if (feeds.input_ids.dims.length !== 2 || feeds.input_ids.dims[0] !== 1 || feeds.input_ids.dims[1] !== ids.length) throw new Error("input_ids dims wrong");
    if (feeds.use_cache_branch.type !== "bool") throw new Error("use_cache_branch must be bool");

    const decoderPast = feeds["past_key_values.0.decoder.key"];
    const pastLen = decoderPast.dims[2];
    // A teacher-forced alignment pass feeds the prompt AND the whole text in one non-cached run, exactly as the real
    // merged decoder accepts it (empty cache, `use_cache_branch = 0`).
    const teacherForced = !useCache && ids.length !== this.promptLength;
    const step = useCache ? pastLen - this.promptLength + 1 : 0;
    if (!useCache) {
      if (ids.length < this.promptLength) throw new Error(`a non-cached run needs at least the ${this.promptLength}-token prompt, got ${ids.length}`);
      if (pastLen !== 0) throw new Error("step 0 must start with an empty cache");
    } else {
      if (ids.length !== 1) throw new Error("cached steps feed exactly one token");
      const previous = this.tokenFor(key, step - 1);
      if (!this.config.lenient && Number(ids[0]) !== previous) throw new Error(`step ${step} fed token ${ids[0]}, expected the previous output ${previous}`);
      if (pastLen !== this.promptLength + step - 1) throw new Error(`step ${step} cache length ${pastLen} is wrong`);
    }
    for (const name of this.inputNames.filter((n) => n.startsWith("past_key_values."))) {
      const tensor = feeds[name];
      const want = name.includes(".encoder.") ? (useCache ? FAKE.encoderFrames : 0) : pastLen;
      if (tensor.dims[2] !== want) throw new Error(`${name} has length ${tensor.dims[2]}, expected ${want}`);
      if (tensor.dims[1] !== FAKE.heads || tensor.dims[3] !== FAKE.headDim) throw new Error(`${name} has the wrong head shape`);
    }
    if (teacherForced) this.fullPasses.push({ inputIds: [...ids].map(Number) });
    else this.calls.push({ step, inputIds: [...ids].map(Number), useCache });

    const rows = ids.length;
    const logits = new Float32Array(rows * FAKE.vocab);
    // The no-speech score sits on the start-of-transcript row: row 0 for the plain prompt, later when a names hint comes first.
    if (!useCache) logits[Math.max(0, [...ids].map(Number).indexOf(FAKE.sot)) * FAKE.vocab + FAKE.noSpeech] = this.config.noSpeechLogit ?? 0;
    const last = (rows - 1) * FAKE.vocab;
    for (const [id, value] of this.config.extraLogits?.(key, step) ?? []) logits[last + id] += value;
    logits[last + this.tokenFor(key, step)] += this.config.chosenLogit ?? 10;

    const out: Record<string, TensorLike> = { logits: this.world.tensor("float32", [1, rows, FAKE.vocab], logits) };
    for (const name of this.outputNames.filter((n) => n.startsWith("present."))) {
      const encoderSide = name.includes(".encoder.");
      // The real merged decoder returns an empty encoder cache on cached steps; the engine must keep step one's.
      const length = encoderSide ? (useCache ? 0 : FAKE.encoderFrames) : pastLen + rows;
      out[name] = this.world.tensor("float32", [1, FAKE.heads, length, FAKE.headDim]);
    }
    const attention = this.config.attention;
    if (attention) {
      // A teacher-forced pass gets its own peaks, one per query row; a decode step uses `peak`.
      const fullPeaks = teacherForced && attention.fullPeak ? attention.fullPeak([...ids].map(Number), this.promptLength, key) : undefined;
      if (fullPeaks && fullPeaks.length !== rows) throw new Error(`fullPeak returned ${fullPeaks.length} frames for ${rows} rows`);
      for (const layer of attention.layers) {
        const name = `cross_attentions.${layer}`;
        if (fetches && !fetches.includes(name)) continue;
        const data = new Float32Array(attention.heads * rows * attention.frames);
        for (let head = 0; head < attention.heads; head += 1) {
          for (let row = 0; row < rows; row += 1) {
            const peak = fullPeaks ? fullPeaks[row] : attention.peak(useCache ? step : 0, row, key);
            if (!Number.isInteger(peak) || peak < 0 || peak >= attention.frames) throw new Error(`attention peak ${peak} is outside 0..${attention.frames - 1}`);
            data[(head * rows + row) * attention.frames + peak] = 1;
          }
        }
        out[name] = this.world.tensor("float32", [1, attention.heads, rows, attention.frames], data);
      }
    }
    return out;
  }

  async release(): Promise<void> {
    this.released = true;
  }
}

export class FakeEncoder implements InferenceSessionLike {
  readonly inputNames = ["input_features"];
  readonly outputNames = ["last_hidden_state"];
  runs = 0;
  released = false;
  failWith: Error | null = null;
  constructor(
    private readonly world: FakeWorld,
    private readonly nMels = 80,
  ) {}
  async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
    if (this.failWith) throw this.failWith;
    if (this.released) throw new Error("run on a released session");
    const input = feeds.input_features;
    if (!input || (input as FakeTensor).disposed) throw new Error("no usable input_features");
    if (input.type !== "float32" || input.dims.join("x") !== `1x${this.nMels}x3000`) throw new Error(`input_features shape ${input.dims.join("x")}`);
    this.runs += 1;
    const data = (await input.getData()) as Float32Array;
    return { last_hidden_state: this.world.tensor("float32", [1, FAKE.encoderFrames, 512], Float32Array.of(data[0])) };
  }
  async release(): Promise<void> {
    this.released = true;
  }
}

export interface FakeRuntimeOptions {
  backends?: EngineBackend[];
  /** Backends whose session creation throws. */
  failCreate?: EngineBackend[];
  promptLength?: number;
  sessionNames?: { decoderInputs?: string[]; decoderOutputs?: string[] };
}

export class FakeRuntime implements OrtRuntime {
  readonly backends: EngineBackend[];
  encoders: { backend: EngineBackend; session: FakeEncoder }[] = [];
  decoders: { backend: EngineBackend; session: FakeDecoder }[] = [];
  keepHints: { backend: EngineBackend; kept: string[] }[] = [];
  private listeners = new Set<(reason: string) => void>();
  inFlight = 0;
  maxInFlight = 0;

  constructor(
    readonly world: FakeWorld,
    private readonly config: FakeModelConfig,
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.backends = options.backends ?? ["wasm"];
  }

  async createSession(model: Uint8Array, backend: EngineBackend, keepOnDevice?: (name: string) => boolean): Promise<InferenceSessionLike> {
    if (this.options.failCreate?.includes(backend)) throw new Error(`cannot create a ${backend} session`);
    const isEncoder = model[0] === 0xe1;
    const session = isEncoder
      ? new FakeEncoder(this.world)
      : new FakeDecoder(this.world, this.config, this.options.promptLength ?? 4, { inputs: this.options.sessionNames?.decoderInputs, outputs: this.options.sessionNames?.decoderOutputs });
    this.keepHints.push({ backend, kept: session.outputNames.filter((name) => keepOnDevice?.(name)) });
    // Count overlapping runs to prove the engine serialises its work.
    const innerRun = session.run.bind(session);
    session.run = async (feeds, fetches) => {
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        await Promise.resolve();
        return await innerRun(feeds, fetches);
      } finally {
        this.inFlight -= 1;
      }
    };
    if (session instanceof FakeEncoder) this.encoders.push({ backend, session });
    else this.decoders.push({ backend, session });
    return session;
  }

  createTensor(type: TensorElementType, data: TensorData, dims: readonly number[]): TensorLike {
    return this.world.tensor(type, dims, data);
  }

  onDeviceLost(backend: EngineBackend, callback: (reason: string) => void): () => void {
    if (backend !== "webgpu") return () => undefined;
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  triggerLost(reason = "gpu lost"): void {
    for (const listener of [...this.listeners]) listener(reason);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

// ---------------------------------------------------------------- files and storage

export class MemoryStore implements ModelStore {
  map = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async put(key: string, data: Uint8Array) {
    this.map.set(key, data);
  }
  async delete(key: string) {
    return this.map.delete(key);
  }
}

export const HOST = "https://models.cutmoor.com";
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export interface FakeFiles {
  manifest: ModelManifest;
  bytes: Record<string, Uint8Array>;
}

/** Model files whose first byte tells the fake runtime which session to build. */
export function fakeModelFiles(extra: { tokenizerJson?: unknown } = {}): FakeFiles {
  const bytes: Record<string, Uint8Array> = {
    encoder: Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 0xe1 : i)),
    decoder: Uint8Array.from({ length: 96 }, (_, i) => (i === 0 ? 0xd2 : i)),
    tokenizer: jsonBytes(extra.tokenizerJson ?? fakeVocab()),
    addedTokens: jsonBytes(fakeAddedTokens()),
    generationConfig: jsonBytes({ suppress_tokens: [1, 2, 7], begin_suppress_tokens: [FAKE.space, FAKE.eot] }),
  };
  const files: ModelFile[] = Object.entries(bytes).map(([name, data]) => ({ name, url: `${HOST}/whisper/${name}.bin`, bytes: data.length, sha256: sha(data) }));
  return { manifest: { id: "fake-whisper", version: "1", files }, bytes };
}

/** A store already holding every file, so loading needs no network at all. */
export function primedStore(files: FakeFiles): MemoryStore {
  const store = new MemoryStore();
  for (const file of files.manifest.files) store.map.set(storeKey(file), files.bytes[file.name]);
  return store;
}
