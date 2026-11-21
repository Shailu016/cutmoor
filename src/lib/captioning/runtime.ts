import { formatBytes } from "../format";
import type { CaptionRuntime, CaptionRuntimeFactory } from "../../components/captions/runtime-types";
import type { DevModelSource } from "./dev-models";
import type { CaptionPipeline, VoiceDetector } from "./contracts";
import { createCacheStore } from "./cache-store";
import { createLazyVoiceDetector } from "./lazy-vad";
import { MAX_ATTENTION_STEPS, sanitizePipelineTuning, sanitizeVadOverrides } from "./diagnostic-knobs";
import type { PipelineTuning } from "./pipeline";
import { serialQueue } from "./serial";
import { CaptionError } from "./contracts";
import { downloadModel, ModelLoadError, type LoaderDeps, type ModelFile, type ModelManifest, type ModelStore } from "./model-loader";

/**
 * Puts the real captioning parts together and hands them to the tool page. This file is deliberately tiny
 * to load: every heavy module (onnxruntime-web, the engine, mediabunny) is imported only when a job starts,
 * so the rest of the site never pays for them.
 *
 * Privacy: every byte this code downloads goes through model-loader.ts, which only contacts MODEL_ORIGINS,
 * checks a pinned SHA-256 and sends no cookies. That includes onnxruntime-web's own WebAssembly files: they are
 * fetched and verified here and handed to the library as blob: URLs, so the library never makes its own request.
 *
 * The model list ("manifest") is bundled with the site, so its fingerprints cannot be swapped by whoever serves
 * the files. Until a manifest file exists (src/lib/captioning/model-manifest.json, written by
 * scripts/models/build-manifest.mjs once the models are uploaded) there is nothing to download, and the page
 * says the tool is not available in this build.
 */

/** The only host model files may come from. Must match the Content-Security-Policy in public/_headers. */
export const MODEL_ORIGINS = ["https://models.cutmoor.com"] as const;

/** Manifest file names with a special job. Everything else belongs to the speech engine. */
export const VAD_FILE = "vad";
export const ORT_MODULE_FILE = "ort-mjs";
export const ORT_WASM_FILE = "ort-wasm";

export interface SplitManifest {
  engine: ModelManifest;
  vad: ModelManifest | null;
  ort: ModelManifest | null;
}

function subset(manifest: ModelManifest, suffix: string, files: ModelFile[]): ModelManifest | null {
  return files.length === 0 ? null : { id: `${manifest.id}-${suffix}`, version: manifest.version, files };
}

/** Splits the one manifest the visitor consents to into the three downloads the runtime performs. */
export function splitManifest(manifest: ModelManifest): SplitManifest {
  const special = new Set([VAD_FILE, ORT_MODULE_FILE, ORT_WASM_FILE]);
  return {
    engine: { id: manifest.id, version: manifest.version, files: manifest.files.filter((file) => !special.has(file.name)) },
    vad: subset(manifest, "vad", manifest.files.filter((file) => file.name === VAD_FILE)),
    ort: subset(manifest, "ort", manifest.files.filter((file) => file.name === ORT_MODULE_FILE || file.name === ORT_WASM_FILE)),
  };
}

function usable(manifest: ModelManifest | undefined): manifest is ModelManifest {
  return Boolean(manifest && Array.isArray(manifest.files) && manifest.files.length > 0);
}

/** The bundled model list, or null before any model has been published. */
export function readBundledManifest(): ModelManifest | null {
  const found = import.meta.glob<ModelManifest>("./model-manifest.json", { eager: true, import: "default" });
  const manifest = Object.values(found)[0];
  return usable(manifest) ? manifest : null;
}

/** The optional bigger, more accurate model's list. */
export function readHighAccuracyManifest(): ModelManifest | null {
  const found = import.meta.glob<ModelManifest>("./model-manifest-high.json", { eager: true, import: "default" });
  const manifest = Object.values(found)[0];
  return usable(manifest) ? manifest : null;
}

/** How a model differs from the default Whisper-base-sized one. */
interface TierSpec {
  id: string;
  label: string;
  nMels: 80 | 128;
  shape: { heads: number; headDim: number };
  /** Alignment heads [layer, head] when this model's decoder outputs cross-attention; null = no measured word timing. */
  alignmentHeads: readonly (readonly [number, number])[] | null;
  /** Where the decoder runs when the encoder is on the GPU (measured: the small decoder is ~8x faster on wasm, the big one ~4x faster on WebGPU). */
  decoderBackend?: "wasm";
  /**
   * Word timing from a teacher-forced pass over the transcript's characters (engine/char-align.ts).
   * Measured on tts-words (2026-11-15, real Chrome/WebGPU): High's F1@100 0.192 -> 0.231 and MAE 130.2 -> 123.8 ms;
   * on the Draft tier it was worse on every timing number (F1@100 0.462 -> 0.346, MAE 87.2 -> 97.2), so it stays off there.
   */
  characterAlignment?: boolean;
}
const FAST: TierSpec = { id: "whisper-hinglish-base", label: "Hinglish speech model", nMels: 80, shape: { heads: 8, headDim: 64 }, alignmentHeads: [[3, 1], [4, 2], [4, 3], [4, 7], [5, 1], [5, 2], [5, 4], [5, 6]], decoderBackend: "wasm" };
// Whisper large-v3-turbo size: 128 mel bands, 20 attention heads of 64.
const HIGH: TierSpec = { id: "whisper-hinglish-apex", label: "High-accuracy Hinglish speech model", nMels: 128, shape: { heads: 20, headDim: 64 }, alignmentHeads: [[2, 4], [2, 11], [3, 3], [3, 6], [3, 11], [3, 14]], characterAlignment: true };

/**
 * The dev model set, looked up once per page. Only a development build ever asks: `vite build` replaces
 * `import.meta.env.DEV` with false, which removes this function's branch and the `./dev-models` import with it, so
 * no dev loader exists in a production bundle.
 */
let devModelSource: Promise<DevModelSource | null> | null = null;

function devModels(): Promise<DevModelSource | null> {
  if (!import.meta.env.DEV) return Promise.resolve(null);
  devModelSource ??= import("./dev-models")
    .then((dev) => dev.loadDevCaptionModels())
    .catch(() => null) // a broken dev folder must never stop the tool from using the real models
    .then((source) => {
      // A missing folder is not remembered: once DEV_MODELS_DIR has files, the next job picks them up without a reload.
      if (!source) devModelSource = null;
      return source;
    });
  return devModelSource;
}

/**
 * One tier's factory. In production this is exactly `buildRuntime(...)`. In a development build it first looks for
 * `/dev-models/manifest.json`; when one exists the files it lists are downloaded from the local dev server instead,
 * and when none exists (or anything about it fails) the bundled model list is used exactly as before.
 */
function tierFactory(manifest: ModelManifest, tier: TierSpec): CaptionRuntimeFactory {
  if (!import.meta.env.DEV) return () => buildRuntime(manifest, tier);
  return async () => buildRuntime(manifest, tier, await devModels());
}

/** Registers the real runtime on the page. Returns false (and registers nothing) when there is no manifest yet. */
export function installCaptionRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const manifest = readBundledManifest();
  if (!manifest) return false;
  window.__cutmoorCaptionPipelineFactory = tierFactory(manifest, FAST);
  const high = readHighAccuracyManifest();
  if (high) {
    const total = (m: ModelManifest) => m.files.reduce((sum, file) => sum + file.bytes, 0);
    // Same formatter as the consent card, so the size promised here is the size shown there.
    const mb = (m: ModelManifest) => formatBytes(total(m));
    window.__cutmoorCaptionTiers = [
      { id: "fast", name: "Standard", detail: `Quick first pass (${mb(manifest)} download) for clear speech. It can miss words on fast, noisy or accented speech; High accuracy is the accurate one.`, factory: tierFactory(manifest, FAST) },
      { id: "high", name: "High accuracy", detail: `Larger model (${mb(high)} download, one time). Much better on fast, noisy or accented speech, but slower and needs a computer with a graphics card.`, needsGpu: true, factory: tierFactory(high, HIGH) },
    ];
  }
  // Start looking for a dev model folder now, so its one manifest request happens early rather than in the middle of a
  // job. No model bytes are fetched here, and in a production build this line is removed with the branch around it.
  if (import.meta.env.DEV) void devModels();
  return true;
}

interface CaptionDiagnostics {
  backend: string | null;
  /** The last finished job: words with timing and the pipeline statistics (for benchmarks and the gold-set runner). */
  lastResult?: { words: unknown[]; stats: unknown };
  timings: { label: string; ms: number; detail: string | null }[];
}
declare global {
  interface Window {
    __cutmoorCaptionDiag?: CaptionDiagnostics;
  }
}
function sinkNames(): string[] | null {
  const sink = (globalThis as { __cutmoorAttentionSink?: { names?: string[] } }).__cutmoorAttentionSink;
  return sink?.names && sink.names.length > 0 ? sink.names : null;
}
/** The diagnostics keep only the latest timings, so a tab left open for hours does not grow without bound. */
const MAX_DIAG_TIMINGS = 200;

function diagnostics(): CaptionDiagnostics {
  return (window.__cutmoorCaptionDiag ??= { backend: null, timings: [] });
}

/**
 * The onnxruntime files are handed to the library as blob: URLs. One URL per file (by its pinned fingerprint) is made for the whole
 * page and reused by every runtime, so switching model or reopening the tool does not leave another 29 MB copy alive each time.
 */
const blobUrls = new Map<string, string>();
function blobUrlFor(files: readonly ModelFile[], name: string, bytes: Uint8Array, type: string): string {
  const key = files.find((file) => file.name === name)?.sha256 ?? `${name}:${bytes.length}`;
  let url = blobUrls.get(key);
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    blobUrls.set(key, url);
  }
  return url;
}

/** A download or start-up failure as the error the page explains to the visitor, instead of a generic "internal" one. */
export function modelStartError(error: unknown): CaptionError {
  if (error instanceof CaptionError) return error;
  if (error instanceof ModelLoadError) {
    return new CaptionError(error.code === "aborted" ? "aborted" : "model-download", error.message, { cause: error });
  }
  return new CaptionError("model-load", error instanceof Error ? error.message : "The speech model could not be started.", { cause: error });
}

/** Remembers the last result in the diagnostics object; changes nothing else. */
function withDiagnostics(pipeline: CaptionPipeline): CaptionPipeline {
  return {
    ...pipeline,
    async run(file, options) {
      const result = await pipeline.run(file, options);
      diagnostics().lastResult = { words: result.words, stats: result.stats };
      return result;
    },
    dispose: async () => {
      if (window.__cutmoorCaptionDiag) window.__cutmoorCaptionDiag.lastResult = undefined;
      await pipeline.dispose();
    },
  };
}

/** A split part of the model set (engine, voice detector, onnxruntime) plus the way its files are fetched. */
interface ModelPartSource {
  manifest: ModelManifest;
  download: (manifest: ModelManifest) => Promise<Map<string, Uint8Array>>;
  /** Extra origins its files may come from. Set for a dev part only: the local dev folder. */
  allowedOrigins?: readonly string[];
  /**
   * The loader a part uses when it fetches its own files. The speech engine does that (`whisper-engine` calls
   * `downloadModel`), so a dev part hands it an in-memory store: verified dev bytes are never written to the
   * visitor's model cache.
   */
  loader?: LoaderDeps;
}

/** Verified bytes for this page only, never in the visitor's model cache. */
function memoryStore(): ModelStore {
  const files = new Map<string, Uint8Array>();
  return {
    async get(key) {
      return files.get(key) ?? null;
    },
    async put(key, data) {
      files.set(key, data);
    },
    async delete(key) {
      return files.delete(key);
    },
  };
}

/**
 * Which files each download uses. Normally every part comes from the bundled list, unchanged. In a development build
 * a `/dev-models/manifest.json` may cover some or all of the parts: a part it lists is downloaded from that folder
 * instead, and a part it does not list keeps the bundled files (so a new engine file can be tried without mirroring
 * the 30 MB onnxruntime files locally). `manifest` is what the visitor is told will be downloaded, so the size on the
 * consent card is the size of the real download.
 */
function modelSources(bundled: ModelManifest, dev: DevModelSource | null, loader: LoaderDeps) {
  const parts = splitManifest(bundled);
  const fromBundled = (part: ModelManifest) => downloadModel(part, { allowedOrigins: MODEL_ORIGINS, deps: loader });
  const bundledSource = (part: ModelManifest): ModelPartSource => ({ manifest: part, download: fromBundled });
  if (!dev) {
    const source = (part: ModelManifest | null): ModelPartSource | null => (part ? bundledSource(part) : null);
    return { engine: bundledSource(parts.engine), vad: source(parts.vad), ort: source(parts.ort), manifest: bundled };
  }
  const alt = splitManifest(dev.manifest);
  const devLoader: LoaderDeps = { ...loader, store: memoryStore() };
  const devSource = (part: ModelManifest): ModelPartSource => ({
    manifest: part,
    download: (listed) => dev.load(listed),
    // The voice detector and onnxruntime files are fetched by `download` above. The speech engine fetches its own
    // files through model-loader, so it also needs the dev folder's origin: listed here, and only a development build
    // accepts an http localhost /dev-models URL at all (see model-loader.isLocalDevModelFile).
    allowedOrigins: [...new Set([...MODEL_ORIGINS, ...part.files.map((file) => new URL(file.url).origin)])],
    loader: devLoader,
  });
  const pick = (bundledPart: ModelManifest | null, devPart: ModelManifest | null): ModelPartSource | null => {
    if (devPart && devPart.files.length > 0) return devSource(devPart);
    return bundledPart ? bundledSource(bundledPart) : null;
  };
  const engine = pick(parts.engine, alt.engine) ?? bundledSource(parts.engine);
  const vad = pick(parts.vad, alt.vad);
  const ort = pick(parts.ort, alt.ort);
  const files = [...engine.manifest.files, ...(vad?.manifest.files ?? []), ...(ort?.manifest.files ?? [])];
  return { engine, vad, ort, manifest: { id: dev.manifest.id, version: dev.manifest.version, files } };
}

async function buildRuntime(manifest: ModelManifest, tier: TierSpec, dev: DevModelSource | null = null): Promise<CaptionRuntime> {
  /**
   * Development builds only: the song-mode pipeline switches, from `window.__cutmoorPipelineTuning` (set by
   * `scripts/verify/captions-real.mjs --tuning=...`) or a `?__tune={"c2Time":false}` query parameter. This exists so
   * the real-browser A/B can turn one R4 change off at a time. `import.meta.env.DEV` is false in a production bundle,
   * so this function and the query parsing are compiled out and there is no end-user path to these switches.
   */
  const devPipelineTuning = (): PipelineTuning => {
    if (!import.meta.env.DEV) return {};
    const fromQuery = new URLSearchParams(window.location.search).get("__tune");
    let raw: unknown = (globalThis as { __cutmoorPipelineTuning?: unknown }).__cutmoorPipelineTuning;
    if (fromQuery) {
      try {
        raw = JSON.parse(fromQuery);
      } catch {
        /* a malformed query is ignored, exactly like a malformed global */
      }
    }
    return sanitizePipelineTuning(raw);
  };
  const store = createCacheStore(caches, window.location.origin);
  const loader: LoaderDeps = {
    fetch: (url, init) => fetch(url, init),
    digest: (data) => crypto.subtle.digest("SHA-256", data as BufferSource),
    store,
  };
  const sources = modelSources(manifest, dev, loader);

  // onnxruntime-web, loaded and configured only when the first model session is created (after the visitor agreed).
  type OrtModule = typeof import("onnxruntime-web/webgpu");
  let ort: OrtModule | null = null;
  let ortLoading: Promise<OrtModule> | null = null;
  const loadOrt = (): Promise<OrtModule> => {
    if (!ortLoading) {
      ortLoading = (async () => {
        const module = await import("onnxruntime-web/webgpu");
        if (sources.ort) {
          const files = await sources.ort.download(sources.ort.manifest);
          const mjs = files.get(ORT_MODULE_FILE);
          const wasm = files.get(ORT_WASM_FILE);
          if (!mjs || !wasm) throw new Error("The speech engine's runtime files are missing from the model list.");
          module.env.wasm.wasmPaths = { mjs: blobUrlFor(sources.ort.manifest.files, ORT_MODULE_FILE, mjs, "text/javascript"), wasm: blobUrlFor(sources.ort.manifest.files, ORT_WASM_FILE, wasm, "application/wasm") };
        }
        // Threads need cross-origin isolation, which only this page's headers provide.
        module.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
        module.env.wasm.proxy = false;
        ort = module;
        return module;
      })().catch((error: unknown) => {
        // A failed start (a dropped connection, say) must not be remembered: the next try starts again.
        ortLoading = null;
        throw modelStartError(error);
      });
    }
    return ortLoading;
  };

  const oneSessionAtATime = serialQueue();

  // A stand-in module shape: sessions are created through it (which loads onnxruntime-web first), and tensors
  // only exist after a session does, so the real classes are always ready by the time they are used.
  const lazyOrt = {
    InferenceSession: {
      // One session is created at a time: the speech model, started early while a file is read, and the voice detector must not
      // start together (onnxruntime-web can stall when two sessions are created at once).
      create: (model: Uint8Array, options?: unknown) => oneSessionAtATime(async () => (await loadOrt()).InferenceSession.create(model, options as never)),
    },
    Tensor: function LazyTensor(this: unknown, type: string, data: unknown, dims: readonly number[]) {
      if (!ort) throw new Error("A tensor was created before the speech engine started.");
      return new (ort.Tensor as unknown as new (t: string, d: unknown, s: readonly number[]) => unknown)(type, data, dims);
    },
    env: {},
  };

  const [{ createCaptionPipeline, createAttentionAligner }, { createAudioIngest }, { createSileroVad }, { createWhisperEngine }, { createOrtRuntime }, { logMelSpectrogram }, { burnInExporter }] =
    await Promise.all([
      import("./pipeline"),
      import("./audio/ingest"),
      import("./vad"),
      import("./engine/whisper-engine"),
      import("./engine/ort-session"),
      import("./dsp/mel"),
      import("./burn-in"),
    ]);

  const engine = createWhisperEngine({
    manifest: sources.engine.manifest,
    allowedOrigins: sources.engine.allowedOrigins ?? MODEL_ORIGINS,
    loader: sources.engine.loader ?? loader,
    runtime: createOrtRuntime(lazyOrt as never),
    logMel: logMelSpectrogram,
    id: tier.id,
    fileNames: { generationConfig: "generation" },
    nMels: tier.nMels,
    decoderShape: tier.shape,
    minTokensPerSecond: 1.2,
    retryShiftMs: 300,
    decoderBackend: tier.decoderBackend,
    alignment: tier.alignmentHeads ? { heads: tier.alignmentHeads.map(([layer, head]) => ({ layer, head })) } : undefined,
    // Measured on tts-words (2026-11-15): see TierSpec.characterAlignment. High's character pass improves F1@100 and
    // MAE; the Draft tier keeps the generated-token DTW because the character pass was worse there on every number.
    characterAlignment: tier.characterAlignment && tier.alignmentHeads ? { heads: tier.alignmentHeads.map(([layer, head]) => ({ layer, head })) } : undefined,
    // Diagnostics for benchmarks and bug reports: which backend ran and how long each step took. Nothing is sent anywhere.
    onBackend: (backend) => {
      diagnostics().backend = backend;
    },
    // Diagnostics only: a benchmark page may set `__cutmoorAttentionSink` to record cross-attention maps (see captions-real.mjs --attention-out).
    attentionTap: sinkNames()
      ? {
          names: sinkNames() as string[],
          onStep: (window_, step, tensors, inputIds) => {
            const sink = (globalThis as { __cutmoorAttentionSink?: { steps: unknown[] } }).__cutmoorAttentionSink;
            if (sink && Array.isArray(sink.steps) && sink.steps.length < MAX_ATTENTION_STEPS) sink.steps.push({ window: window_, step, tensors, inputIds });
          },
        }
      : undefined,
    onTiming: (label, ms, detail) => {
      const diag = diagnostics();
      diag.timings.push({ label, ms: Math.round(ms), detail: detail ?? null });
      if (diag.timings.length > MAX_DIAG_TIMINGS) diag.timings.splice(0, diag.timings.length - MAX_DIAG_TIMINGS);
    },
  });

  const vad: VoiceDetector = createLazyVoiceDetector(async () => {
    try {
      if (!sources.vad) throw new Error("The voice detector is missing from the model list.");
      const files = await sources.vad.download(sources.vad.manifest);
      const model = files.get(VAD_FILE);
      if (!model) throw new Error("The voice detector is missing from the model list.");
      await loadOrt();
      // Whisper reads best with a little natural lead-in and short pauses left in; cutting speech tight (200 ms) made it end early or mishear.
      // `__cutmoorVadOverrides` is a diagnostics-only knob for benchmark sweeps (captions-real.mjs --vad=...); nothing sets it in production.
      const overrides = sanitizeVadOverrides((globalThis as { __cutmoorVadOverrides?: unknown }).__cutmoorVadOverrides);
      return await createSileroVad({ model, ort: lazyOrt as never, segmenter: { padMs: 500, mergeGapMs: 600, ...overrides } });
    } catch (error) {
      // A failed download is reported as one, not as an "internal" error.
      throw modelStartError(error);
    }
  });

  return {
    pipeline: withDiagnostics(createCaptionPipeline({ ingest: createAudioIngest(), vad, engine, aligner: createAttentionAligner() }, devPipelineTuning())),
    manifest: sources.manifest,
    store,
    burnIn: burnInExporter,
    label: tier.label,
  };
}
