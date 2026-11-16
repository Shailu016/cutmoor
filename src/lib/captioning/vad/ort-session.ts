/**
 * Adapts onnxruntime-web to the small session interface in session.ts. Nothing here touches the
 * network: the model arrives as bytes, and the runtime's own wasm files are served by the app.
 */

import type * as OrtWeb from "onnxruntime-web";
import { CaptionError } from "../contracts";
import type { InferenceSessionLike, VadTensor } from "./session";

interface OrtTensorLike {
  readonly type: string;
  readonly data: unknown;
  readonly dims: readonly number[];
}

/** The parts of the `onnxruntime-web` module this adapter uses (the module itself fits this shape). */
export interface OrtRuntime {
  InferenceSession: {
    create(
      model: Uint8Array,
      options?: { executionProviders?: string[]; graphOptimizationLevel?: "all"; intraOpNumThreads?: number },
    ): Promise<{
      run(feeds: Record<string, OrtWeb.Tensor>): Promise<Record<string, OrtTensorLike>>;
      release(): Promise<void>;
    }>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => OrtWeb.Tensor;
}

// Compile-time proof that the real module satisfies OrtRuntime. It costs nothing at run time.
export const _ortWebFitsRuntime = (ort: typeof OrtWeb): OrtRuntime => ort;

/**
 * `new ort.Tensor("int64", ...)` takes a BigInt64Array; the float and int cases are separate
 * constructor calls because the runtime's typings tie the array type to the type string.
 */
function toOrtTensor(ort: OrtRuntime, t: VadTensor): OrtWeb.Tensor {
  if (t.type === "float32") return new ort.Tensor("float32", t.data, t.dims);
  const Ctor = ort.Tensor as unknown as new (type: "int64", data: BigInt64Array, dims: readonly number[]) => OrtWeb.Tensor;
  return new Ctor("int64", t.data, t.dims);
}

function fromOrtTensor(name: string, t: OrtTensorLike): VadTensor {
  if (t.type === "float32" && t.data instanceof Float32Array) return { type: "float32", data: t.data, dims: t.dims };
  throw new CaptionError("inference", `The voice model returned "${name}" as ${t.type}, expected float32.`);
}

export async function createOrtSession(ort: OrtRuntime, model: Uint8Array): Promise<InferenceSessionLike> {
  let session;
  try {
    // One thread: the model is tiny (one frame per call), and extra threads would need a
    // cross-origin-isolated page for nothing.
    session = await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      intraOpNumThreads: 1,
    });
  } catch (cause) {
    throw new CaptionError("model-load", "The voice detection model would not start.", { cause });
  }
  let released = false;
  return {
    async run(feeds) {
      const ortFeeds: Record<string, OrtWeb.Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) ortFeeds[name] = toOrtTensor(ort, tensor);
      const outputs = await session.run(ortFeeds);
      const result: Record<string, VadTensor> = {};
      for (const [name, tensor] of Object.entries(outputs)) result[name] = fromOrtTensor(name, tensor);
      return result;
    },
    async release() {
      if (released) return;
      released = true;
      await session.release();
    },
  };
}
