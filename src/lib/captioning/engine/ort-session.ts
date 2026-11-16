/**
 * Adapter from onnxruntime-web to the engine's small runtime interface (session.ts).
 *
 * The caller passes the ort module in (`import * as ort from "onnxruntime-web/webgpu"`), so this file
 * never imports the heavy runtime itself and can be tested with a stand-in. The structural types
 * below are the only parts of ort we use.
 */

import { sanitizeOrtOverrides } from "../diagnostic-knobs";
import type { EngineBackend, InferenceSessionLike, OrtRuntime, TensorData, TensorElementType, TensorLike } from "./session";

interface OrtTensorRaw {
  readonly type: string;
  readonly dims: readonly number[];
  getData(releaseData?: boolean): Promise<unknown>;
  dispose(): void;
}

interface OrtSessionRaw {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensorRaw>, fetches?: string[]): Promise<Record<string, OrtTensorRaw>>;
  release(): Promise<void>;
}

interface OrtSessionOptionsRaw {
  executionProviders: string[];
  graphOptimizationLevel: "all" | "basic" | "disabled";
  preferredOutputLocation?: Record<string, "gpu-buffer">;
}

/** The parts of the `onnxruntime-web` module we call. The real module is assignable to this (checked in the test). */
export interface OrtModuleLike {
  Tensor: unknown;
  InferenceSession: unknown;
  env: unknown;
}

interface GpuDeviceLike {
  lost?: Promise<{ reason?: string; message?: string }>;
}

export interface OrtRuntimeOptions {
  /** True when this browser has WebGPU. Defaults to checking `navigator.gpu`. */
  hasWebGpu?: boolean;
}

function webGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as { gpu?: unknown }).gpu);
}

export function createOrtRuntime(ort: OrtModuleLike, options: OrtRuntimeOptions = {}): OrtRuntime {
  const gpu = options.hasWebGpu ?? webGpuAvailable();
  const sessionApi = ort.InferenceSession as { create(model: Uint8Array, options: OrtSessionOptionsRaw): Promise<OrtSessionRaw> };
  const TensorCtor = ort.Tensor as new (type: string, data: TensorData, dims: readonly number[]) => OrtTensorRaw;
  const lostListeners = new Set<(reason: string) => void>();
  const watched = new WeakSet<object>();
  /** Our wrapper back to the raw ort tensor, so a tensor from one run can be fed into the next. */
  const rawOf = new WeakMap<TensorLike, OrtTensorRaw>();

  const wrapTensor = (raw: OrtTensorRaw): TensorLike => {
    const wrapped: TensorLike = {
      type: raw.type,
      dims: raw.dims,
      async getData() {
        const data = await raw.getData();
        if (data instanceof Float32Array || data instanceof BigInt64Array || data instanceof Uint8Array) return data;
        throw new Error(`Unsupported tensor data for type ${raw.type}.`);
      },
      dispose() {
        raw.dispose();
      },
    };
    rawOf.set(wrapped, raw);
    return wrapped;
  };

  /** ort exposes the GPU device either directly or as a promise, depending on version. */
  const watchDevice = async () => {
    try {
      const device = (await (ort.env as { webgpu?: { device?: unknown } }).webgpu?.device) as GpuDeviceLike | undefined;
      if (!device || typeof device !== "object" || !device.lost || watched.has(device)) return;
      watched.add(device);
      void device.lost.then((info) => {
        // "destroyed" is us releasing the model on purpose, not a failure.
        if (info?.reason === "destroyed") return;
        for (const listener of [...lostListeners]) listener(info?.message || "The GPU stopped responding.");
      });
    } catch {
      /* no device to watch: a failed run will still surface as an error */
    }
  };

  return {
    backends: gpu ? ["webgpu", "wasm"] : ["wasm"],

    async createSession(model, backend, keepOnDevice): Promise<InferenceSessionLike> {
      // `__cutmoorOrtSessionOverrides` is a diagnostics-only knob for benchmarks (scripts/verify/captions-real.mjs --ort=...); nothing sets it in production.
      const overrides = sanitizeOrtOverrides((globalThis as { __cutmoorOrtSessionOverrides?: unknown }).__cutmoorOrtSessionOverrides);
      const base = { executionProviders: [backend], graphOptimizationLevel: "all", ...overrides } as OrtSessionOptionsRaw;
      let raw = await sessionApi.create(model, base);
      if (backend === "webgpu" && keepOnDevice) {
        // Output names are only known once the model is parsed, so the GPU-resident outputs are chosen after a first create.
        const wanted = raw.outputNames.filter(keepOnDevice);
        if (wanted.length > 0) {
          await raw.release();
          raw = await sessionApi.create(model, { ...base, preferredOutputLocation: Object.fromEntries(wanted.map((name) => [name, "gpu-buffer" as const])) });
        }
      }
      if (backend === "webgpu") await watchDevice();
      const session = raw;
      return {
        inputNames: session.inputNames,
        outputNames: session.outputNames,
        async run(feeds, fetches) {
          const raws: Record<string, OrtTensorRaw> = {};
          for (const [name, tensor] of Object.entries(feeds)) {
            const unwrapped = rawOf.get(tensor);
            if (!unwrapped) throw new Error(`Input "${name}" is not a tensor made by this runtime.`);
            raws[name] = unwrapped;
          }
          const out = fetches ? await session.run(raws, [...fetches]) : await session.run(raws);
          return Object.fromEntries(Object.entries(out).map(([name, tensor]) => [name, wrapTensor(tensor)]));
        },
        release: () => session.release(),
      };
    },

    createTensor(type: TensorElementType, data: TensorData, dims: readonly number[]): TensorLike {
      return wrapTensor(new TensorCtor(type, data, dims));
    },

    onDeviceLost(backend: EngineBackend, callback) {
      if (backend !== "webgpu") return () => undefined;
      lostListeners.add(callback);
      return () => {
        lostListeners.delete(callback);
      };
    },
  };
}
