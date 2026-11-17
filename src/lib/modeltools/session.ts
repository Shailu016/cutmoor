import { createCacheStore } from "../captioning/cache-store";
import { cachedFileNames, describeDownload, downloadModel, ModelLoadError, type DownloadProgress, type LoaderDeps, type ModelManifest } from "../captioning/model-loader";
import { ORT_MODULE_FILE, ORT_WASM_FILE, withRuntime } from "./manifests";

/** The only host model files may come from. Must match the Content-Security-Policy in public/_headers. */
export const MODEL_ORIGINS = ["https://models.cutmoor.com"] as const;

/**
 * Starts a neural network on the visitor's device. The files come from the model host only, are checked against the
 * SHA-256 pinned in manifests.ts, are kept in the browser's cache (the same cache the captions tool uses, so the
 * runtime files are shared), and onnxruntime-web is handed them as blob: URLs so the library makes no request of its own.
 */

export interface TensorInput {
  data: Float32Array;
  dims: readonly number[];
}

export interface TensorOutput {
  data: Float32Array;
  dims: readonly number[];
}

export interface ModelSession {
  readonly backend: "webgpu" | "wasm";
  /** Runs the network once. `inputs` and the result are keyed by the model's own tensor names. */
  run(inputs: Record<string, TensorInput>): Promise<Record<string, TensorOutput>>;
  release(): Promise<void>;
}

function loaderDeps(): LoaderDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    digest: (data) => crypto.subtle.digest("SHA-256", data as BufferSource),
    store: createCacheStore(caches, window.location.origin),
  };
}

/** What would be downloaded now (nothing is requested): the size, the host, and whether it is all saved already. */
export async function planDownload(model: ModelManifest): Promise<{ totalBytes: number; hosts: string[]; cached: boolean }> {
  const manifest = withRuntime(model);
  try {
    const cached = await cachedFileNames(manifest, loaderDeps().store);
    const info = describeDownload(manifest, cached);
    return { totalBytes: info.totalBytes, hosts: info.hosts, cached: info.alreadyDownloaded };
  } catch {
    const info = describeDownload(manifest);
    return { totalBytes: info.totalBytes, hosts: info.hosts, cached: false };
  }
}

const blobUrls = new Map<string, string>();
function blobUrlFor(key: string, bytes: Uint8Array, type: string): string {
  let url = blobUrls.get(key);
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    blobUrls.set(key, url);
  }
  return url;
}

type OrtModule = typeof import("onnxruntime-web/webgpu");
let ortLoading: Promise<OrtModule> | null = null;

export interface OpenOptions {
  /** The network's file inside `model.files`. */
  file: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** For tests and benchmarks: skip WebGPU and run on the CPU build. */
  forceWasm?: boolean;
}

export async function openModel(model: ModelManifest, options: OpenOptions): Promise<ModelSession> {
  const manifest = withRuntime(model);
  let files: Map<string, Uint8Array>;
  try {
    files = await downloadModel(manifest, { allowedOrigins: MODEL_ORIGINS, deps: loaderDeps(), onProgress: options.onProgress, signal: options.signal });
  } catch (error) {
    if (error instanceof ModelLoadError) throw error;
    throw new Error(error instanceof Error ? error.message : "The model could not be downloaded.");
  }
  const bytes = files.get(options.file);
  const mjs = files.get(ORT_MODULE_FILE);
  const wasm = files.get(ORT_WASM_FILE);
  if (!bytes || !mjs || !wasm) throw new Error("The model files are incomplete.");

  ortLoading ??= (async () => {
    const module = await import("onnxruntime-web/webgpu");
    const runtime = manifest.files;
    const mjsKey = runtime.find((file) => file.name === ORT_MODULE_FILE)?.sha256 ?? ORT_MODULE_FILE;
    const wasmKey = runtime.find((file) => file.name === ORT_WASM_FILE)?.sha256 ?? ORT_WASM_FILE;
    module.env.wasm.wasmPaths = { mjs: blobUrlFor(mjsKey, mjs, "text/javascript"), wasm: blobUrlFor(wasmKey, wasm, "application/wasm") };
    // Threads need cross-origin isolation, which these pages' headers provide.
    module.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    module.env.wasm.proxy = false;
    // The runtime prints a warning for every unused weight in a model; those are noise in a visitor's console.
    module.env.logLevel = "error";
    return module;
  })().catch((error: unknown) => {
    ortLoading = null;
    throw error;
  });
  const ort = await ortLoading;

  const hasGpu = !options.forceWasm && Boolean((navigator as { gpu?: unknown }).gpu);
  let session: Awaited<ReturnType<typeof ort.InferenceSession.create>> | null = null;
  let backend: "webgpu" | "wasm" = "wasm";
  if (hasGpu) {
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
      backend = "webgpu";
    } catch {
      session = null; // a GPU that cannot run this network: fall back to the CPU build below
    }
  }
  session ??= await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });

  const opened = session;
  return {
    backend,
    async run(inputs) {
      const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {};
      for (const [name, tensor] of Object.entries(inputs)) feeds[name] = new ort.Tensor("float32", tensor.data, tensor.dims as number[]);
      const results = await opened.run(feeds);
      const out: Record<string, TensorOutput> = {};
      for (const [name, tensor] of Object.entries(results)) {
        out[name] = { data: (await tensor.getData(true)) as Float32Array, dims: tensor.dims };
        // Only in a build made for the real-browser checks (VITE_MODEL_TOOLS=1): what the network returned, for the report.
        if (import.meta.env.VITE_MODEL_TOOLS === "1") {
          const values = out[name].data;
          let low = Infinity;
          let high = -Infinity;
          let sum = 0;
          for (let i = 0; i < values.length; i += 1) {
            if (values[i] < low) low = values[i];
            if (values[i] > high) high = values[i];
            sum += values[i];
          }
          const sink = ((window as unknown as { __cutmoorModelDiag?: unknown[] }).__cutmoorModelDiag ??= []);
          sink.push({ backend, name, dims: [...tensor.dims], low, high, mean: sum / values.length, nan: Number.isNaN(sum) });
        }
      }
      for (const tensor of Object.values(feeds)) tensor.dispose();
      return out;
    },
    release: () => opened.release(),
  };
}

export { cachedFileNames };
