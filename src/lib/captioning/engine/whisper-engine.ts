/**
 * The speech engine: Whisper (the Hinglish "Swift" fine-tune, ONNX) behind the `SpeechEngine` contract.
 *
 *   load()        downloads the pinned model files through model-loader (hash-checked, cached), reads the
 *                 vocabulary, and starts the encoder and decoder sessions on WebGPU, or WASM if there is none.
 *   transcribe()  log-mel spectrogram -> encoder -> greedy decode with a key/value cache -> words.
 *   alignText()   ONE teacher-forced decoder pass over KNOWN text (lyrics or script), reusing the encoder
 *                 output of the transcribe() before it when the audio is the same. See engine/forced-align.ts.
 *   release()     frees both sessions (and with them the GPU memory) so `load` can start again.
 *
 * If the GPU fails mid-job the engine reloads on the next backend (WASM) from the already-cached model
 * and retries the window once, so a lost GPU costs time, not the job.
 *
 * Calls are queued: the runtime is not re-entrant per session, and the pipeline may overlap work.
 */

import { wordTimesFromAttention, type AlignmentHead, type AttentionStep, type AttentionMatrix } from "./attention";
import { characterTokens, characterWordTimes } from "./char-align";
import { alignableWords, forcedAlignWords } from "./forced-align";
import {
  CaptionError,
  SAMPLE_RATE,
  WINDOW_MS,
  WINDOW_SAMPLES,
  type CaptionLanguage,
  type EngineLoadOptions,
  type ForcedAlignWord,
  type SpeechEngine,
  type TranscribeBounds,
  type WindowAudio,
  type WindowTranscript,
} from "../contracts";
import { downloadModel, ModelLoadError, type LoaderDeps, type ModelManifest } from "../model-loader";
import {
  checkDecoderSession,
  decodeGreedy,
  DEFAULT_DECODER_NAMES,
  WHISPER_BASE_SHAPE,
  type DecoderShape,
  type DecoderTensorNames,
  type DecodeStop,
} from "./decoder";
import type { EngineBackend, InferenceSessionLike, OrtRuntime, TensorLike } from "./session";
import { createWhisperTokenizer, splitWords, type WhisperTokenizer } from "./tokenizer";

/** Whisper always looks at 3000 spectrogram frames (30 s at a 10 ms hop). */
const MEL_FRAMES = 3000;

/**
 * Longest transcript the character-level alignment pass is offered. Characters need roughly one decoder position each
 * (three for a Devanagari letter), so a longer transcript would not fit in Whisper's 448 positions and is not worth
 * the extra pass; the default path handles it.
 */
const MAX_TRANSCRIPT_CHARACTERS = 400;

export interface WhisperFileNames {
  encoder: string;
  decoder: string;
  /** `vocab.json` or Hugging Face `tokenizer.json`. */
  tokenizer: string;
  /** Optional `added_tokens.json`. */
  addedTokens?: string;
  /** Optional `generation_config.json`, for the suppressed-token lists. */
  generationConfig?: string;
}

export interface WhisperEngineOptions {
  manifest: ModelManifest;
  allowedOrigins: readonly string[];
  loader: LoaderDeps;
  runtime: OrtRuntime;
  /** The DSP track's `logMelSpectrogram`: samples -> Float32Array of nMels * 3000. `padFrames` selects the CT2 frame-pad convention. */
  logMel: (samples: Float32Array, options: { nMels: 80 | 128; padFrames?: boolean }) => Float32Array;
  id?: string;
  fileNames?: Partial<WhisperFileNames>;
  nMels?: 80 | 128;
  /**
   * The language token put in the prompt for each caption language. The model card says to use English
   * for Hinglish, Hindi and English alike (it writes Hindi in Latin letters), so that is the default.
   */
  languageTokens?: Partial<Record<CaptionLanguage, string>>;
  /**
   * The language token used in "Song or music" mode. Songs are sung, not spoken, and on real Hindi/Hinglish tracks the
   * Hindi token reads the lyrics where the English token gives up and returns "nan" (measured on Sajan Sajan x Batman:
   * the English token read 1 window of 5, the Hindi token 3). English songs keep the English token.
   */
  musicLanguageTokens?: Partial<Record<CaptionLanguage, string>>;
  encoderNames?: { input: string; output: string };
  decoderNames?: DecoderTensorNames;
  decoderShape?: DecoderShape;
  /** Whisper's decoder can hold 448 positions. */
  maxTargetPositions?: number;
  /** Upper bound on tokens per second of speech, used to stop a runaway decode. Default 12. */
  tokensPerSecond?: number;
  /**
   * Fewest tokens per second of detected speech before the model may end a window (0 = no floor, the default).
   * Whisper sometimes ends a window after one word although speech continues; the real runtime sets about 1.2.
   */
  minTokensPerSecond?: number;
  /**
   * When a window looks cut short or stuck (the model tried to end early, looped, or was very unsure), read it a second
   * time with this much silence put in front, and keep the better of the two. Whisper is sensitive to where a window
   * starts: the same audio moved by a fraction of a second often reads correctly. 0 or absent = never retry.
   */
  retryShiftMs?: number;
  /**
   * Run the decoder on this backend even when the encoder is on the GPU. A small decoder is several times faster on
   * "wasm": each token is one tiny step, and the GPU round trip costs more than the maths. Default: same as the encoder.
   */
  decoderBackend?: EngineBackend;
  /**
   * Turns on word timing from the decoder's cross-attention (the model must output `cross_attentions.<layer>`).
   * `heads` are the model's alignment heads. Without this the transcript carries no `wordTimes`.
   */
  alignment?: { heads: readonly AlignmentHead[]; medianFilterWidth?: number };
  /**
   * Word timing from ONE teacher-forced pass over the transcript's characters instead of over the tokens the model
   * generated (arXiv 2509.09987: characters are a finer time unit than wordpieces). Off by default; when set, the pass
   * feeds `prompt + one token per character` with an empty cache and replaces `wordTimes` only when the aligned word
   * count matches the transcript exactly. Any failure (missing outputs, an aborted or failed run, a count mismatch)
   * leaves the existing times alone, so timing can never lose a word. `medianFilterWidth` defaults to Whisper's 7.
   */
  characterAlignment?: { heads: readonly AlignmentHead[]; medianFilterWidth?: number };
  /** Reads extra decoder outputs each step (cross-attention for word timing). Off by default: nothing extra is fetched. */
  attentionTap?: { names: readonly string[]; onStep: (window: number, step: number, tensors: Record<string, { data: Float32Array; dims: number[] }>, inputIds: readonly number[]) => void };
  /**
   * Song mode: allow a second read of a window with Whisper's timestamp prompt / rules (see wp-TS). The pipeline asks
   * for it per read through the song bounds (`timestampRead: true`); speech mode never does. `false` disables it for
   * this engine even when asked (the kill switch), and is also exposed as `engine.timestampRead` for the pipeline.
   */
  timestampRead?: boolean;
  /** Called with how long each step took (milliseconds): "model-files", "encoder-session", "decoder-session", "encoder-run", "decode". For benchmarks and the diagnostics hook. */
  onTiming?: (label: string, ms: number, detail?: string) => void;
  /** Told which backend ended up running, e.g. to show "GPU" or "CPU (slower)" in the UI. */
  onBackend?: (backend: EngineBackend) => void;
}

export interface WhisperEngine extends SpeechEngine {
  /** The backend running now, or null before load / after release. */
  readonly backend: EngineBackend | null;
  /**
   * True when this model was built with the teacher-forced character aligner (`characterAlignment`). It is the
   * tier fact the pipeline uses to pick High-tier policies without knowing about tiers or settings (High: true,
   * Draft: false). Feature-detecting `alignText` cannot do this, because every Whisper engine implements it.
   */
  readonly characterAlignment: boolean;
  /** True when the pipeline may ask for the song-mode timestamp read (engine option `timestampRead`, default true). */
  readonly timestampRead: boolean;
  /** This engine always implements forced alignment (see `SpeechEngine.alignText`); it returns null, never throws. */
  alignText: NonNullable<SpeechEngine["alignText"]>;
}

const DEFAULT_FILES: WhisperFileNames = { encoder: "encoder", decoder: "decoder", tokenizer: "tokenizer" };

interface Loaded {
  encoder: InferenceSessionLike;
  decoder: InferenceSessionLike;
  backend: EngineBackend;
  unwatch: () => void;
}

/**
 * The encoder output of one read of one window, kept so another read of the SAME audio can skip the encoder:
 * the pipeline's token vote (same window, other language token), a retried `transcribe` after a failed attempt,
 * the lyrics pass's `alignText` after the whole file was read, and a later read of a window already encoded.
 * The key is the window's own samples array (identity), its index, its usedMs and the take's shift, so a hidden
 * state can only ever be reused for the audio it was computed from. Each tensor is ≈ 3 MB for the 512 x 1500 base
 * encoder (≈ 8 MB for a larger, High-tier encoder). The cache holds the last `MAX_CACHED_ENCODERS` entries, oldest
 * first, so a lyrics job (one base window at a time, aligned only at the end) keeps every window it will need:
 * 16 x 8 MB ≈ 128 MB for High, the bound this cache is sized for. Entries are freed on release and on a backend
 * fallback; the sample arrays they point at are the pipeline's own window audio, not copies.
 */
interface CachedEncoder {
  /** The window's own samples array, NOT the shifted copy: identity is the key, and `shiftMs` tells the takes apart. */
  samples: Float32Array;
  windowIndex: number;
  usedMs: number;
  /** Silence the take was moved forward by. `alignText` only ever reuses the unshifted take (0). */
  shiftMs: number;
  /** True when the spectrogram used the CT2 frame-pad convention (only the song timestamp read does). */
  framePad: boolean;
  hidden: TensorLike;
}

/**
 * How many windows' encoder outputs are held. Two covers a shifted take; 16 is what the lyrics pass needs: it runs
 * after the entire transcript, so every base window must still be there when its alignment turn comes (a 15-minute
 * job has at most 30 windows, and past 16 the earliest ones are simply re-encoded — slower, never wrong).
 */
const MAX_CACHED_ENCODERS = 16;

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry >= 0) : [];
}

function parseGenerationConfig(bytes: Uint8Array | undefined): { suppress: number[]; suppressAtStart: number[] } {
  if (!bytes) return { suppress: [], suppressAtStart: [] };
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null) return { suppress: [], suppressAtStart: [] };
    const record = parsed as Record<string, unknown>;
    return { suppress: numberList(record.suppress_tokens), suppressAtStart: numberList(record.begin_suppress_tokens) };
  } catch (cause) {
    throw new CaptionError("model-load", "The generation config file is not valid JSON.", { cause });
  }
}

/**
 * One confidence per word: the chance the model gave its least sure token inside that word. A word starts at a
 * token whose text begins with a space. If the grouping does not match the words we split from the full text,
 * nothing is returned rather than something wrong.
 */
export function wordConfidences(tok: WhisperTokenizer, tokenIds: readonly number[], logProbs: readonly number[], wordCount: number): number[] | undefined {
  if (tokenIds.length !== logProbs.length || wordCount === 0) return undefined;
  const groups: number[][] = [];
  tokenIds.forEach((id, index) => {
    const piece = tok.decode([id]);
    if (piece.trim() === "") return; // a bare space belongs to no word
    if (groups.length === 0 || /^\s/.test(piece)) groups.push([]);
    groups[groups.length - 1].push(Math.exp(logProbs[index]));
  });
  if (groups.length !== wordCount) return undefined;
  return groups.map((probabilities) => Math.min(1, Math.max(0, Math.min(...probabilities))));
}

/** Most tokens the names hint may use; Whisper allows 223 for earlier text, and a short hint leaves room for the transcript. */
const MAX_HINT_TOKENS = 60;

/**
 * The tokens that go in front of the usual prompt: "<|startofprev|> Mumma, Lucknow, ICSE". Empty when there are no names, the
 * vocabulary has no such marker, or the names do not encode.
 */
export function glossaryHint(tok: WhisperTokenizer, glossary: readonly string[]): number[] {
  const marker = tok.special.startOfPrev;
  const names = glossary.map((name) => name.trim()).filter((name) => name.length > 0);
  if (marker === undefined || marker >= tok.vocabSize || names.length === 0) return [];
  const encoded = tok.encode(` ${names.join(", ")}`);
  if (encoded.length === 0) return [];
  return [marker, ...encoded.slice(0, MAX_HINT_TOKENS)];
}

/** Letters only, lower case: how a heard word is compared with a name. */
const letters = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");


/**
 * True when a reading is just the names read back, which a model given a names hint sometimes does over silence or music. It takes
 * three things: at least three words, every one of them from the names list, AND evidence the audio held no matching speech: either
 * the model itself says "no speech" (probability 0.5 or more) or the words are spread very thinly over the time they cover (2.5
 * seconds or more per word). A real short sentence made of names ("Mumma, Rahul, Papa", about half a second a word) is kept. When the
 * words have no times, only the model's own no-speech score counts.
 */
export function isGlossaryEcho(words: readonly string[], glossary: readonly string[], evidence: { spanMs: number | undefined; noSpeechProbability: number }): boolean {
  if (words.length < 3 || glossary.length === 0) return false;
  const known = new Set(glossary.flatMap((name) => name.split(/\s+/)).map(letters).filter((word) => word.length > 0));
  if (!words.every((word) => known.has(letters(word)))) return false;
  const thin = typeof evidence.spanMs === "number" && Number.isFinite(evidence.spanMs) && evidence.spanMs / words.length >= 2500;
  const noSpeech = Number.isFinite(evidence.noSpeechProbability) && evidence.noSpeechProbability >= 0.5;
  return thin || noSpeech;
}

/** One reading of a window, with what the decoder said about how it ended. */
interface Take {
  transcript: WindowTranscript;
  stop: DecodeStop;
  endBlocked: number;
}

/** Below this mean log-probability a reading is "very unsure" (Whisper's own fallback threshold). */
const UNSURE_LOG_PROBABILITY = -1;

/** True when a reading shows a sign of the known failure: an early end that had to be blocked, a loop, or very low sureness. */
export function isSuspect(take: Take): boolean {
  return take.endBlocked > 0 || take.stop === "repetition" || take.transcript.averageLogProbability < UNSURE_LOG_PROBABILITY;
}

/** Picks between two readings of the same window: a clean one beats a suspect one; otherwise the surer one wins (ties keep the first). */
export function betterTake(first: Take, second: Take): Take {
  const firstSuspect = isSuspect(first);
  const secondSuspect = isSuspect(second);
  if (firstSuspect !== secondSuspect) return firstSuspect ? second : first;
  return second.transcript.averageLogProbability > first.transcript.averageLogProbability ? second : first;
}

export function unshiftTimes(times: { startMs: number; endMs: number }[] | undefined, shiftMs: number): { startMs: number; endMs: number }[] | undefined {
  if (!times || shiftMs === 0) return times;
  // A word heard in the silence added in front is clamped to the start of the window; every other word keeps its real time.
  return times.map((time) => {
    const startMs = Math.max(0, time.startMs - shiftMs);
    return { startMs, endMs: Math.max(startMs + 1, time.endMs - shiftMs) };
  });
}

/** Word times from the collected attention, or undefined when they cannot be trusted (wrong count, bad data). */
function attentionWordTimes(
  tok: WhisperTokenizer,
  tokenIds: readonly number[],
  steps: readonly AttentionStep[],
  usedMs: number,
  wordCount: number,
  alignment: WhisperEngineOptions["alignment"],
  promptRows = 4,
): { startMs: number; endMs: number }[] | undefined {
  if (!alignment || wordCount === 0 || tokenIds.length === 0) return undefined;
  // A decode cut back after a loop has more steps than tokens: keep the steps that belong to the kept tokens.
  const kept = steps.filter((entry) => entry.step <= tokenIds.length);
  const times = wordTimesFromAttention({
    steps: kept,
    tokens: tokenIds.map((id) => ({ id, text: tok.decode([id]) })),
    usedMs,
    heads: alignment.heads,
    promptRows,
    medianFilterWidth: alignment.medianFilterWidth ?? 5,
    boundaryMode: "dtw-peak",
  });
  if (!times || times.length !== wordCount) return undefined;
  return times.map((time) => ({ startMs: time.startMs, endMs: time.endMs }));
}

export function createWhisperEngine(options: WhisperEngineOptions): WhisperEngine {
  const files = { ...DEFAULT_FILES, ...options.fileNames };
  const nMels = options.nMels ?? 80;
  const encoderNames = options.encoderNames ?? { input: "input_features", output: "last_hidden_state" };
  const decoderNames = options.decoderNames ?? DEFAULT_DECODER_NAMES;
  const shape = options.decoderShape ?? WHISPER_BASE_SHAPE;
  const maxTargetPositions = options.maxTargetPositions ?? 448;
  const tokensPerSecond = options.tokensPerSecond ?? 12;
  const languageTokens: Record<CaptionLanguage, string> = { hinglish: "<|en|>", hindi: "<|en|>", english: "<|en|>", ...options.languageTokens };
  const musicLanguageTokens: Record<CaptionLanguage, string> = { hinglish: "<|hi|>", hindi: "<|hi|>", english: "<|en|>", ...options.musicLanguageTokens };
  const { runtime } = options;
  // The merged decoder always lists the key/value cache as inputs; the empty ones below are how a single-shot pass starts.
  const pastInput = new RegExp(`^${decoderNames.pastPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.(decoder|encoder)\\.(key|value)$`);

  let loaded: Loaded | null = null;
  let loading: Promise<void> | null = null;
  let tokenizer: WhisperTokenizer | null = null;
  let suppress = new Set<number>();
  let suppressAtStart = new Set<number>();
  let gpuLost = false;
  /** Backends already given up on this load, so a retry moves on instead of looping. */
  const failedBackends = new Set<EngineBackend>();
  let queue: Promise<unknown> = Promise.resolve();
  /**
   * Set by the first `alignText` call, or by a read that carries the pipeline's `reuseEncoder` hint. Then the encoder
   * output of a `transcribe` is kept for the alignment pass; a job that never asks for forced alignment and passes no
   * hint frees it at the end of every window, exactly as before (that path is unchanged, byte for byte).
   * `release`/`releaseLoaded` clear it: the flag describes one job, never the engine's life, so a speech job that
   * starts after a lyrics job does not silently keep an encoder tensor alive.
   */
  let reuseEncoder = false;
  /** The encoder outputs held for a later read or the alignment pass, oldest first, bounded (see CachedEncoder). */
  let encoderCache: CachedEncoder[] = [];

  /** Frees every held encoder output. Called on release and on a backend fallback. */
  const dropEncoderCache = () => {
    const held = encoderCache;
    encoderCache = [];
    for (const entry of held) entry.hidden.dispose();
  };

  /** True when the entry was computed from exactly this audio (same object, window index and usedMs). */
  const sameWindow = (entry: CachedEncoder, samples: Float32Array, windowIndex: number, usedMs: number) =>
    entry.samples === samples && entry.windowIndex === windowIndex && entry.usedMs === usedMs;

  /** The held encoder output for exactly this audio, shift and mel convention, or null. */
  const cachedEncoder = (samples: Float32Array, windowIndex: number, usedMs: number, shiftMs: number, framePad: boolean): TensorLike | null => {
    for (const entry of encoderCache) if (entry.shiftMs === shiftMs && entry.framePad === framePad && sameWindow(entry, samples, windowIndex, usedMs)) return entry.hidden;
    return null;
  };

  /**
   * Holds `hidden` for a later read of the same audio. Another window's output ADDS an entry instead of replacing the
   * cache: the lyrics pass runs after the whole file and must still find every base window it is about to align.
   * A window re-assembled into new samples, or the same audio at another shift, is another entry (bounded, so a long
   * job's oldest windows are evicted and encoded again if they are needed; correctness never depends on a hit).
   */
  const storeEncoderCache = (samples: Float32Array, windowIndex: number, usedMs: number, shiftMs: number, framePad: boolean, hidden: TensorLike) => {
    const existing = encoderCache.find(
      (entry) => entry.shiftMs === shiftMs && entry.framePad === framePad && sameWindow(entry, samples, windowIndex, usedMs),
    );
    if (existing) {
      if (existing.hidden !== hidden) existing.hidden.dispose();
      existing.hidden = hidden;
      return;
    }
    while (encoderCache.length >= MAX_CACHED_ENCODERS) encoderCache.shift()?.hidden.dispose();
    encoderCache.push({ samples, windowIndex, usedMs, shiftMs, framePad, hidden });
  };

  /** Runs jobs one at a time, in order, and keeps the chain alive after a failure. */
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  const fetchFiles = async (signal: AbortSignal | undefined, onDownload: EngineLoadOptions["onDownload"]) => {
    try {
      return await downloadModel(options.manifest, { allowedOrigins: options.allowedOrigins, deps: options.loader, signal, onProgress: onDownload });
    } catch (error) {
      if (error instanceof ModelLoadError) {
        if (error.code === "aborted") throw new CaptionError("aborted", "Loading the speech model was cancelled.", { cause: error });
        throw new CaptionError("model-download", error.message, { cause: error });
      }
      throw error;
    }
  };

  const need = (map: Map<string, Uint8Array>, name: string): Uint8Array => {
    const bytes = map.get(name);
    if (bytes) return bytes;
    // A large file may be listed in pieces ("encoder-p0", "encoder-p1", ...) because the host limits upload size.
    // Each piece is hash-checked on its own; they are joined here and the pieces are let go.
    const pieces: Uint8Array[] = [];
    for (let index = 0; map.has(`${name}-p${index}`); index += 1) pieces.push(map.get(`${name}-p${index}`) as Uint8Array);
    if (pieces.length === 0) throw new CaptionError("model-load", `The model list has no file named "${name}".`);
    const joined = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
    let offset = 0;
    pieces.forEach((piece, index) => {
      joined.set(piece, offset);
      offset += piece.length;
      map.delete(`${name}-p${index}`);
    });
    map.set(name, joined);
    return joined;
  };

  const releaseLoaded = async () => {
    const current = loaded;
    loaded = null;
    // The held encoder output came from the sessions being freed (and from this device): let it go with them.
    dropEncoderCache();
    // The keep flag belonged to the job whose alignment pass set it. A speech job that runs after this release
    // must start from "hold nothing", exactly like a fresh engine (a lyrics job sets it again on its first alignText).
    reuseEncoder = false;
    if (!current) return;
    current.unwatch();
    // Release both even if the first one throws, so nothing stays allocated.
    await Promise.allSettled([current.encoder.release(), current.decoder.release()]);
  };

  const startSessions = async (map: Map<string, Uint8Array>, skip: ReadonlySet<EngineBackend>): Promise<Loaded> => {
    const encoderBytes = need(map, files.encoder);
    const decoderBytes = need(map, files.decoder);
    let lastError: unknown = null;
    for (const backend of runtime.backends) {
      if (skip.has(backend)) continue;
      let encoder: InferenceSessionLike | null = null;
      let decoder: InferenceSessionLike | null = null;
      try {
        const startedEncoder = performance.now();
        const decoderBackend = options.decoderBackend && runtime.backends.includes(options.decoderBackend) ? options.decoderBackend : backend;
        // The encoder's output stays on the GPU only when the decoder is there too.
        encoder = await runtime.createSession(encoderBytes, backend, (name) => decoderBackend === backend && name === encoderNames.output);
        options.onTiming?.("encoder-session", performance.now() - startedEncoder, backend);
        if (!encoder.inputNames.includes(encoderNames.input) || !encoder.outputNames.includes(encoderNames.output)) {
          throw new CaptionError("model-load", `The encoder must have input "${encoderNames.input}" and output "${encoderNames.output}"; it has [${encoder.inputNames.join(", ")}] and [${encoder.outputNames.join(", ")}].`);
        }
        const startedDecoder = performance.now();
        decoder = await runtime.createSession(decoderBytes, decoderBackend, (name) => name.startsWith(`${decoderNames.presentPrefix}.`));
        options.onTiming?.("decoder-session", performance.now() - startedDecoder, decoderBackend);
        checkDecoderSession(decoder, decoderNames);
        const unwatch =
          runtime.onDeviceLost?.(backend, () => {
            gpuLost = true;
          }) ?? (() => undefined);
        return { encoder, decoder, backend, unwatch };
      } catch (error) {
        lastError = error;
        await Promise.allSettled([encoder?.release(), decoder?.release()]);
        // A model that does not fit our expectations will not fit on another backend either.
        if (error instanceof CaptionError && error.code === "model-load" && !/memory|alloc/i.test(error.message)) throw error;
      }
    }
    throw new CaptionError("model-load", "The speech model could not be started on this device.", { cause: lastError });
  };

  /** The release that was asked for last and has not finished yet (it may be queued behind a call that cannot be cancelled). */
  let releasing: Promise<unknown> | null = null;

  const load = (loadOptions: EngineLoadOptions = {}): Promise<void> => {
    // A release asked for before this load must finish first: otherwise it would run after the load and clear the new model.
    if (releasing) {
      const waiting = releasing;
      return waiting.then(() => load(loadOptions), () => load(loadOptions));
    }
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    const attempt = (async () => {
      const startedFiles = performance.now();
      const map = await fetchFiles(loadOptions.signal, loadOptions.onDownload);
      options.onTiming?.("model-files", performance.now() - startedFiles);
      if (loadOptions.signal?.aborted) throw new CaptionError("aborted", "Loading the speech model was cancelled.");
      const vocab = need(map, files.tokenizer);
      const created = createWhisperTokenizer({ vocab, addedTokens: files.addedTokens ? need(map, files.addedTokens) : undefined });
      const generation = parseGenerationConfig(files.generationConfig ? need(map, files.generationConfig) : undefined);
      const space = created.tokenId("Ġ");
      suppress = new Set(generation.suppress);
      suppressAtStart = new Set([...generation.suppressAtStart, created.special.eot, ...(space === undefined ? [] : [space])]);
      failedBackends.clear();
      gpuLost = false;
      const started = await startSessions(map, failedBackends);
      if (loadOptions.signal?.aborted) {
        loaded = started;
        await releaseLoaded();
        throw new CaptionError("aborted", "Loading the speech model was cancelled.");
      }
      tokenizer = created;
      loaded = started;
      options.onBackend?.(started.backend);
    })();
    loading = attempt.finally(() => {
      loading = null;
    });
    return loading;
  };

  /** Moves to the next backend after the current one failed: reload from the cached model (no network). */
  const fallBack = async (signal: AbortSignal | undefined): Promise<boolean> => {
    const current = loaded;
    if (!current) return false;
    failedBackends.add(current.backend);
    if (runtime.backends.every((backend) => failedBackends.has(backend))) return false;
    await releaseLoaded();
    const map = await fetchFiles(signal, undefined);
    try {
      loaded = await startSessions(map, failedBackends);
    } catch {
      return false;
    }
    gpuLost = false;
    options.onBackend?.(loaded.backend);
    return true;
  };

  /**
   * Word times from one teacher-forced pass over the transcript's characters, or `undefined` to keep whatever times
   * the caller already has.
   *
   * The pass is the same decoder the greedy loop uses, fed differently: the prompt plus every character token in one
   * non-cached run (`use_cache_branch = 0`, empty past tensors) returns `cross_attentions.<layer>` with one query row
   * per input token. The row before a token predicts that token, so the row before the first character is the LAST
   * PROMPT ROW and every character reads the row before its own first token (char-align.ts does that shift). One pass
   * therefore gives a [character x frame] matrix with no second model and no second encoder run.
   *
   * Every failure path returns `undefined` rather than throwing: a missing attention output, a readback failure, a
   * run that throws, a text that cannot be spelled, or an alignment that does not produce one time per word. The
   * caller keeps the times it already had, so timing never loses words.
   */
  const characterAlignedTimes = async (
    session: Loaded,
    tok: WhisperTokenizer,
    encoderHiddenStates: TensorLike,
    prompt: readonly number[],
    words: readonly string[],
    usedMs: number,
    signal: AbortSignal | undefined,
  ): Promise<{ startMs: number; endMs: number }[] | undefined> => {
    const option = options.characterAlignment;
    if (!option || !Array.isArray(option.heads) || option.heads.length === 0) return undefined;
    if (words.length === 0 || signal?.aborted) return undefined;
    // The same text Whisper would have generated: one leading space, words separated by single spaces. Grouping is by
    // THIS text, never by token text, so the word count is the caller's word count by construction.
    const text = ` ${words.join(" ")}`;
    if (text.length - 1 > MAX_TRANSCRIPT_CHARACTERS) return undefined;
    const encoded = characterTokens(tok, text);
    if (!encoded) return undefined;
    if (prompt.length + encoded.tokenIds.length > maxTargetPositions) return undefined;
    const layers = [...new Set(option.heads.map((head) => `cross_attentions.${head.layer}`))].filter((name) => session.decoder.outputNames.includes(name));
    if (layers.length === 0) return undefined;
    // A merged decoder always lists the key/value cache as inputs; empty ones are how a single-shot pass starts.
    const pastNames = session.decoder.inputNames.filter((name) => pastInput.test(name));
    if (pastNames.length === 0) return undefined;
    const started = performance.now();

    const ids = runtime.createTensor(
      "int64",
      BigInt64Array.from([...prompt, ...encoded.tokenIds], (id) => BigInt(id)),
      [1, prompt.length + encoded.tokenIds.length],
    );
    const flag = runtime.createTensor("bool", Uint8Array.of(0), [1]);
    const feeds: Record<string, TensorLike> = {
      [decoderNames.inputIds]: ids,
      [decoderNames.encoderHiddenStates]: encoderHiddenStates,
      [decoderNames.useCacheBranch]: flag,
    };
    const emptyPast: TensorLike[] = [];
    for (const name of pastNames) {
      // Same empty cache the greedy loop's first step uses: length 0 on the sequence axis.
      const empty = runtime.createTensor("float32", new Float32Array(0), [1, shape.heads, 0, shape.headDim]);
      emptyPast.push(empty);
      feeds[name] = empty;
    }

    // Only the alignment layers are asked for; the logits and the cache this pass produces are not needed.
    let outputs: Record<string, TensorLike> | undefined;
    try {
      outputs = await session.decoder.run(feeds, layers);
    } catch {
      // An alignment pass that cannot run must not fail the window.
      return undefined;
    } finally {
      ids.dispose();
      flag.dispose();
      for (const empty of emptyPast) empty.dispose();
    }

    const tensors: Record<string, AttentionMatrix> = {};
    try {
      for (const name of layers) {
        const tensor = outputs?.[name];
        if (!tensor) return undefined;
        const data = await tensor.getData();
        if (!(data instanceof Float32Array)) return undefined;
        // Copied to the CPU heap because the tensor is freed below; this is the pass's main memory cost.
        tensors[name] = { dims: [...tensor.dims], data: data.slice() };
      }
    } catch {
      return undefined;
    } finally {
      for (const tensor of Object.values(outputs ?? {})) tensor.dispose();
    }
    options.onTiming?.("character-align", performance.now() - started, `${encoded.tokenIds.length} tokens`);

    const aligned = characterWordTimes({
      tensors,
      charRows: encoded.rows,
      text,
      usedMs,
      heads: option.heads,
      promptRows: prompt.length,
      medianFilterWidth: option.medianFilterWidth,
    });
    // A different word count means the text and the transcript disagree: keep the old times instead.
    if (!aligned || aligned.length !== words.length) return undefined;
    return aligned.map((word) => ({ startMs: word.startMs, endMs: word.endMs }));
  };

  const runOnce = async (
    input: WindowAudio,
    language: CaptionLanguage,
    signal: AbortSignal | undefined,
    shiftMs = 0,
    glossary: readonly string[] = [],
    music = false,
    bounds?: TranscribeBounds,
  ): Promise<Take> => {
    const session = loaded;
    const tok = tokenizer;
    if (!session || !tok) throw new CaptionError("internal", "The speech engine is not loaded.");
    const chosenTokens = music ? musicLanguageTokens : languageTokens;
    const languageId = tok.tokenId(chosenTokens[language]);
    if (languageId === undefined) throw new CaptionError("model-load", `The vocabulary has no language token "${chosenTokens[language]}".`);
    // Song-mode timestamp read: the pipeline asks for it on the same window after the normal read. The hint is only
    // ever set by the pipeline's song branch, so speech mode can never reach it.
    const timestampRead = (bounds as { timestampRead?: boolean } | undefined)?.timestampRead === true && options.timestampRead !== false;
    // Names and special words go in first as "earlier text" (Whisper's own hint mechanism), so the model expects those spellings.
    const hint = glossaryHint(tok, glossary);
    const prompt = [...hint, tok.special.sot, languageId, tok.special.transcribe, ...(timestampRead ? [] : [tok.special.noTimestamps])];

    // A second take reads the same audio moved later by `shiftMs` (silence in front, the tail cut off).
    const shiftSamples = Math.min(input.samples.length, Math.round((shiftMs / 1000) * SAMPLE_RATE));
    let samples = input.samples;
    if (shiftSamples > 0) {
      samples = new Float32Array(input.samples.length);
      samples.set(input.samples.subarray(0, input.samples.length - shiftSamples), shiftSamples);
    }
    const usedMs = Math.min(WINDOW_MS, input.window.usedMs + shiftMs);
    // A timestamp read of a short window needs the CT2 frame-pad mel, which changes the encoder input; a full 30 s
    // window is identical under both conventions, so it reuses the normal read's hidden state without a second run.
    const framePad = timestampRead && usedMs < WINDOW_MS;
    // The caller can ask for the encoder output to be kept for another read of the SAME window: the pipeline's
    // token vote (same audio, other language token) and a read retried after a failure both pass this hint. Only
    // then is the cache consulted, so speech mode and song retries (no hint) stay byte-identical to before.
    const shareEncoder = (bounds as { reuseEncoder?: boolean } | undefined)?.reuseEncoder === true;
    const reusedHidden = shareEncoder ? cachedEncoder(input.samples, input.window.index, input.window.usedMs, shiftMs, framePad) : null;

    let hidden: TensorLike | undefined;
    /** True when `hidden` is now owned by the encoder cache instead of this call. */
    let hiddenCached = false;
    let features: TensorLike | undefined;
    try {
      if (reusedHidden !== null) {
        // The same audio with the same shift was already encoded: reuse the hidden states. No spectrogram and no
        // `encoder-run` timing, which is what makes the sharing measurable in a benchmark.
        hidden = reusedHidden;
        hiddenCached = true;
      } else {
        const mel = options.logMel(samples, { nMels, ...(framePad ? { padFrames: true } : {}) });
        if (mel.length !== nMels * MEL_FRAMES) throw new CaptionError("internal", `The spectrogram has ${mel.length} values, expected ${nMels * MEL_FRAMES}.`);
        features = runtime.createTensor("float32", mel, [1, nMels, MEL_FRAMES]);
        let encoded: Record<string, TensorLike>;
        try {
          const startedRun = performance.now();
          encoded = await session.encoder.run({ [encoderNames.input]: features });
          options.onTiming?.("encoder-run", performance.now() - startedRun, session.backend);
        } catch (cause) {
          if (signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.", { cause });
          throw new CaptionError("inference", "The speech model failed on the encoder.", { cause });
        }
        hidden = encoded[encoderNames.output];
        for (const [name, tensor] of Object.entries(encoded)) if (name !== encoderNames.output) tensor.dispose();
        if (!hidden) throw new CaptionError("inference", `The encoder did not return "${encoderNames.output}".`);
        // After the first alignText call, hold this output for the alignment pass of the same audio; a read that
        // asked to share holds it for the next read. The key is the window's own samples array (plus index, usedMs
        // and shift), so a take of other audio or another shift can never be mistaken for this one.
        if (reuseEncoder || shareEncoder) {
          storeEncoderCache(input.samples, input.window.index, input.window.usedMs, shiftMs, framePad, hidden);
          hiddenCached = true;
        }
      }

      const usedSeconds = Math.max(0, usedMs) / 1000;
      // The timestamp read's prompt has one fewer token and its first generated token is a timestamp, so the row that
      // predicts the first TEXT token is one later (wp-TS §5).
      const promptRows = timestampRead ? prompt.length + 1 : prompt.length;
      // A per-call `tokensPerSecond` (song mode's bounded read) replaces the configured default for this take only.
      const maxNewTokens = Math.max(
        1,
        Math.min(maxTargetPositions - prompt.length - 1, Math.max(16, Math.ceil(usedSeconds * (bounds?.tokensPerSecond ?? tokensPerSecond)) + 8)),
      );
      // Word timing: collect the alignment layers' attention at every step (see engine/attention.ts).
      const alignmentNames = options.alignment ? [...new Set(options.alignment.heads.map((head) => `cross_attentions.${head.layer}`))].filter((name) => session.decoder.outputNames.includes(name)) : [];
      const tapNames = options.attentionTap?.names ?? [];
      const extraNames = [...new Set([...alignmentNames, ...tapNames])];
      const steps: AttentionStep[] = [];
      const startedDecode = performance.now();
      const decoded = await decodeGreedy({
        session: session.decoder,
        runtime,
        encoderHiddenStates: hidden,
        prompt,
        special: tok.special,
        suppress,
        suppressAtStart,
        maxNewTokens,
        // The caller's own loop guard replaces the decoder default only when it is given; an empty list disables it.
        ...(bounds?.repetitionRules ? { repetitionRules: bounds.repetitionRules } : {}),
        // Speech found by the detector never produces fewer than about one token per second; fewer means an early stop.
        extra:
          extraNames.length > 0
            ? {
                names: extraNames,
                onStep: (step, tensors, inputIds) => {
                  if (alignmentNames.length > 0) steps.push({ step, inputIds, tensors });
                  options.attentionTap?.onStep(input.window.index, step, tensors, inputIds);
                },
              }
            : undefined,
        minNewTokens: timestampRead ? 0 : Math.min(Math.floor(usedSeconds * (options.minTokensPerSecond ?? 0)), Math.max(0, maxNewTokens - 1)),
        shape,
        names: decoderNames,
        signal,
        ...(timestampRead ? { timestampRules: true, maxInitialTimestampIndex: 50 } : {}),
      });
      options.onTiming?.("decode", performance.now() - startedDecode, `${decoded.tokenIds.length} tokens`);
      const heard = splitWords(tok.decode(decoded.tokenIds));
      const heardTimes = alignmentNames.length > 0 ? attentionWordTimes(tok, decoded.tokenIds, steps, usedMs, heard.length, options.alignment, promptRows) : undefined;
      // A reading that is only the names read back is not speech: drop it. "Thinly spread" is judged by the time the words themselves
      // cover (first word start to last word end), not by the window's length: three names said in two seconds are speech even in a 30 s window.
      const spanMs = heardTimes && heardTimes.length > 0 ? heardTimes[heardTimes.length - 1].endMs - heardTimes[0].startMs : undefined;
      const echo = isGlossaryEcho(heard, glossary, { spanMs, noSpeechProbability: decoded.noSpeechProbability });
      const words = echo ? [] : heard;
      const shifted = echo ? undefined : heardTimes;
      // Character-level teacher-forced alignment (off by default): its times win only when it produced exactly one
      // time per word; otherwise the greedy-attention times above are used, and without either the pipeline falls
      // back to even spacing.
      const characterTimes = echo || timestampRead ? undefined : await characterAlignedTimes(session, tok, hidden, prompt, words, usedMs, signal);
      const transcript: WindowTranscript = {
        windowIndex: input.window.index,
        words,
        wordConfidence: echo ? undefined : wordConfidences(tok, decoded.tokenIds, decoded.tokenLogProbs, words.length),
        // Times were measured on the moved audio: move them back, and drop them if that pushes a word off the front.
        wordTimes: unshiftTimes(characterTimes ?? shifted, shiftMs),
        tokenIds: echo ? [] : decoded.tokenIds,
        noSpeechProbability: decoded.noSpeechProbability,
        averageLogProbability: decoded.averageLogProbability,
      };
      return { transcript, stop: decoded.stop, endBlocked: decoded.endBlocked };
    } finally {
      features?.dispose();
      // When the cache owns it, it lives until evicted, a release or a backend fallback.
      if (!hiddenCached) hidden?.dispose();
    }
  };

  /**
   * Reads a window, and when the result looks cut short or stuck, reads it once more shifted and keeps the better one.
   * `music` makes both takes use the token for sung Hindi; the pipeline only asks for that on a music rescue slice.
   */
  const bestTake = async (
    input: WindowAudio,
    language: CaptionLanguage,
    signal: AbortSignal | undefined,
    glossary: readonly string[] = [],
    music = false,
    bounds?: TranscribeBounds,
  ): Promise<WindowTranscript> => {
    const first = await runOnce(input, language, signal, 0, glossary, music, bounds);
    const shiftMs = bounds?.retryShiftMs ?? options.retryShiftMs ?? 0;
    if (shiftMs <= 0 || !isSuspect(first)) return first.transcript;
    // Both takes see the same per-call bounds: a retry must not read more freely than the first attempt.
    const second = await runOnce(input, language, signal, shiftMs, glossary, music, bounds);
    const chosen = betterTake(first, second);
    options.onTiming?.("retry", 0, chosen === second ? "second take kept" : "first take kept");
    return chosen.transcript;
  };

  /**
   * Places KNOWN text (the visitor's lyrics or script) on the window: one teacher-forced decoder pass over
   * the prompt plus one token per character, returning one word per word of `text`.
   *
   * Nothing here may fail the job, so every doubtful case returns `null` (never throws): the engine is not
   * loaded, the text is blank or over 400 characters, the vocabulary cannot spell it, the prompt plus the
   * text does not fit in the decoder's positions, the decoder returns no cross-attention, the signal was
   * aborted, the alignment does not produce exactly one time per word, or any runtime call throws. The
   * pipeline then keeps its normal transcription.
   *
   * The encoder output of the `transcribe` that just ran on the same audio is reused when it is still held
   * (see `CachedEncoder`): the first window of a job pays one extra encoder run, every later window that
   * transcribes before it aligns reuses the one it already paid for. The language token comes from
   * `languageTokens` only -- never `musicLanguageTokens`: the visitor supplied the words, so this is not a
   * rescue guess at sung Hindi.
   */
  const alignText: NonNullable<SpeechEngine["alignText"]> = (input, text, opts) =>
    enqueue(async () => {
      const started = performance.now();
      const signal = opts?.signal;
      try {
        const session = loaded;
        const tok = tokenizer;
        const option = options.characterAlignment;
        if (!session || !tok || !option || !Array.isArray(option.heads) || option.heads.length === 0) return null;
        if (signal?.aborted) return null;
        if (typeof text !== "string") return null;
        const trimmed = text.trim();
        if (trimmed.length === 0 || trimmed.length > MAX_TRANSCRIPT_CHARACTERS) return null;
        const words = alignableWords(trimmed);
        if (words.length === 0) return null;
        // From here on, keep the encoder output for the next window's alignment pass.
        reuseEncoder = true;
        const language = opts?.language ?? "hinglish";
        const languageToken = languageTokens[language];
        const languageId = tok.tokenId(languageToken);
        if (languageId === undefined) return null;
        const prompt = [tok.special.sot, languageId, tok.special.transcribe, tok.special.noTimestamps];
        // The text Whisper would have generated: one leading space, single spaces between words.
        const fed = ` ${words.join(" ")}`;
        const encoded = characterTokens(tok, fed);
        // Diagnostic only, and only in a development build (the same switch as the pipeline's per-window line).
        const debugAlign =
          import.meta.env.DEV && Boolean((globalThis as { __cutmoorDebugLyrics?: unknown }).__cutmoorDebugLyrics);
        const alignFail = (why: string, detail = "") => {
          if (debugAlign) console.debug(`[captions] alignText null: ${why} ${detail}`);
          return null;
        };
        if (!encoded) return alignFail("tokenize", `chars=${fed.length} words=${words.length}`);
        if (prompt.length + encoded.tokenIds.length > maxTargetPositions) return alignFail("positions", `tokens=${encoded.tokenIds.length}`);
        const layers = [...new Set(option.heads.map((head) => `cross_attentions.${head.layer}`))].filter((name) => session.decoder.outputNames.includes(name));
        if (layers.length === 0) return null;
        // A merged decoder always lists the key/value cache as inputs; empty ones are how a single-shot pass starts.
        const pastNames = session.decoder.inputNames.filter((name) => pastInput.test(name));
        if (pastNames.length === 0) return null;
        if (signal?.aborted) return null;

        // The encoder output of the transcribe() that just ran on this exact audio (the unshifted take only), or a
        // fresh run. A shifted take's entry is keyed by its shift and is never used for the visitor's words.
        const cached = cachedEncoder(input.samples, input.window.index, input.window.usedMs, 0, false);
        const reused = cached !== null;
        let hidden: TensorLike;
        if (cached !== null) {
          hidden = cached;
        } else {
          const mel = options.logMel(input.samples, { nMels });
          if (mel.length !== nMels * MEL_FRAMES) return null;
          let features: TensorLike | undefined;
          try {
            features = runtime.createTensor("float32", mel, [1, nMels, MEL_FRAMES]);
            const startedRun = performance.now();
            const encodedAudio = await session.encoder.run({ [encoderNames.input]: features });
            options.onTiming?.("encoder-run", performance.now() - startedRun, session.backend);
            const output = encodedAudio[encoderNames.output];
            for (const [name, tensor] of Object.entries(encodedAudio)) if (name !== encoderNames.output) tensor.dispose();
            if (!output) return null;
            storeEncoderCache(input.samples, input.window.index, input.window.usedMs, 0, false, output);
            hidden = output;
          } catch {
            return null;
          } finally {
            features?.dispose();
          }
        }
        if (signal?.aborted) return null;

        const ids = runtime.createTensor(
          "int64",
          BigInt64Array.from([...prompt, ...encoded.tokenIds], (id) => BigInt(id)),
          [1, prompt.length + encoded.tokenIds.length],
        );
        const flag = runtime.createTensor("bool", Uint8Array.of(0), [1]);
        const feeds: Record<string, TensorLike> = {
          [decoderNames.inputIds]: ids,
          [decoderNames.encoderHiddenStates]: hidden,
          [decoderNames.useCacheBranch]: flag,
        };
        const emptyPast: TensorLike[] = [];
        for (const name of pastNames) {
          const empty = runtime.createTensor("float32", new Float32Array(0), [1, shape.heads, 0, shape.headDim]);
          emptyPast.push(empty);
          feeds[name] = empty;
        }

        // Cross-attention for the timing and the logits for the confidence, in the SAME run.
        const wants = [...new Set([decoderNames.logits, ...layers])];
        let outputs: Record<string, TensorLike> | undefined;
        try {
          outputs = await session.decoder.run(feeds, wants);
        } catch (error) {
          return alignFail("decoder-run", String(error).slice(0, 160));
        } finally {
          ids.dispose();
          flag.dispose();
          for (const empty of emptyPast) empty.dispose();
        }

        let result: ForcedAlignWord[] | null = null;
        let badAttention = 0;
        let frames = 0;
        try {
          const tensors: Record<string, AttentionMatrix> = {};
          for (const name of layers) {
            const tensor = outputs?.[name];
            if (!tensor) return alignFail("no-attention-tensor", name);
            const data = await tensor.getData();
            if (!(data instanceof Float32Array)) return alignFail("attention-not-float32", name);
            // Copied to the CPU heap because the tensor is freed below; this is the pass's main memory cost.
            tensors[name] = { dims: [...tensor.dims], data: data.slice() };
            if (debugAlign) {
              frames = Math.max(frames, tensor.dims[3] ?? 0);
              for (let i = 0; i < data.length; i += 1) if (!Number.isFinite(data[i])) badAttention += 1;
            }
          }
          // Not copied: the logits are read while the tensor is alive (a full-vocabulary copy would be tens of MB).
          let logits: { dims: readonly number[]; data: ArrayLike<number> } | undefined;
          const logitsTensor = outputs?.[decoderNames.logits];
          if (logitsTensor) {
            const data = await logitsTensor.getData();
            if (data instanceof Float32Array) logits = { dims: [...logitsTensor.dims], data };
          }
          result = forcedAlignWords({
            tensors,
            charRows: encoded.rows,
            text: fed,
            tokenIds: encoded.tokenIds,
            usedMs: input.window.usedMs,
            logits,
            promptRows: prompt.length,
            heads: option.heads,
            medianFilterWidth: option.medianFilterWidth,
          });
        } catch (error) {
          return alignFail("forced-align-throw", String(error).slice(0, 160));
        } finally {
          for (const tensor of Object.values(outputs ?? {})) tensor.dispose();
        }
        options.onTiming?.(
          "forced-align",
          performance.now() - started,
          `${reused ? "encoder reused" : "encoder run"}, ${encoded.tokenIds.length} tokens`,
        );
        // A prefix is accepted: the character aligner stops when the last word cannot be timed inside the window, and
        // those timed words are real. The pipeline advances its cursor by the prefix and retries the rest next window,
        // instead of discarding the whole window (the sajan 47-59 defect).
        if (!result || result.length === 0 || result.length > words.length) {
          return alignFail("forced-align-null", `result=${result === null ? "null" : result.length} words=${words.length} bad=${badAttention} frames=${frames} used=${input.window.usedMs}`);
        }
        if (signal?.aborted) return null;
        // The user's own spelling wins over the text slice (identical except for whitespace).
        return { words: result.map((word, index) => ({ ...word, text: words[index] })), languageToken };
      } catch (error) {
        // Forced alignment is an extra: an unexpected failure costs the lyrics pass, never the job.
        if (import.meta.env.DEV && Boolean((globalThis as { __cutmoorDebugLyrics?: unknown }).__cutmoorDebugLyrics)) {
          console.debug(`[captions] alignText throw: ${String(error).slice(0, 160)}`);
        }
        return null;
      }
    });

  const transcribe: SpeechEngine["transcribe"] = (input, opts) =>
    enqueue(async () => {
      const { signal, language, glossary, music, bounds } = opts;
      if (signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.");
      if (input.samples.length !== WINDOW_SAMPLES) {
        throw new CaptionError("internal", `A window must be ${WINDOW_SAMPLES} samples, got ${input.samples.length}.`);
      }
      if (!loaded) throw new CaptionError("internal", "The speech engine is not loaded. Call load() first.");
      try {
        return await bestTake(input, language, signal, glossary, music, bounds);
      } catch (error) {
        if (!(error instanceof CaptionError) || error.code === "aborted" || error.code !== "inference" || loaded?.backend !== "webgpu") throw error;
        // The GPU path failed. Try once more on the next backend before giving up on the window.
        const wasLost = gpuLost;
        if (!(await fallBack(signal))) {
          throw wasLost ? new CaptionError("device-lost", "The graphics device was lost and there is no fallback.", { cause: error }) : error;
        }
        return bestTake(input, language, signal, glossary, music, bounds);
      }
    });

  return {
    id: options.id ?? "whisper-swift-base-hinglish",
    get backend() {
      return loaded?.backend ?? null;
    },
    characterAlignment: Boolean(options.characterAlignment && Array.isArray(options.characterAlignment.heads) && options.characterAlignment.heads.length > 0),
    timestampRead: options.timestampRead !== false,
    load,
    transcribe,
    alignText,
    release: () => {
      const job = enqueue(async () => {
        if (loading) await loading.catch(() => undefined);
        await releaseLoaded();
        tokenizer = null;
        gpuLost = false;
        reuseEncoder = false;
      });
      releasing = job;
      const done = () => {
        if (releasing === job) releasing = null;
      };
      job.then(done, done);
      return job;
    },
  };
}
