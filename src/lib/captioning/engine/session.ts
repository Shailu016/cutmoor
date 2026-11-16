/**
 * The smallest slice of an ONNX runtime the speech engine needs. The engine only ever talks to
 * these interfaces, so the same decoding code runs against onnxruntime-web in the page and against
 * a tiny fake "model" in tests (no weights, no GPU).
 */

export type TensorElementType = "float32" | "int64" | "bool";

/** Typed array a tensor can hold. int64 is carried as BigInt64Array, exactly as onnxruntime does. */
export type TensorData = Float32Array | BigInt64Array | Uint8Array;

export interface TensorLike {
  readonly type: string;
  readonly dims: readonly number[];
  /** Reads the values back to the CPU. For GPU-resident tensors this is the (slow) readback; call it as little as possible. */
  getData(): Promise<TensorData>;
  /** Frees the memory behind the tensor (GPU buffers do not free themselves). Safe to call twice. */
  dispose(): void;
}

export interface InferenceSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  /** `fetches` names the outputs wanted; others are not returned (and the runtime may skip computing them). Omitted = all. */
  run(feeds: Record<string, TensorLike>, fetches?: readonly string[]): Promise<Record<string, TensorLike>>;
  /** Frees the model. */
  release(): Promise<void>;
}

export type EngineBackend = "webgpu" | "wasm";

/**
 * Creates sessions and tensors for one runtime. `backends` is the order to try them in; the first
 * one that works wins, and a later one is the fallback if the first dies mid-job.
 */
export interface OrtRuntime {
  readonly backends: readonly EngineBackend[];
  /**
   * `keepOnDevice` names the outputs that are only ever fed back into another run (the encoder's
   * hidden states, the decoder's key/value cache). On the GPU they then never travel to the CPU and back.
   */
  createSession(model: Uint8Array, backend: EngineBackend, keepOnDevice?: (outputName: string) => boolean): Promise<InferenceSessionLike>;
  createTensor(type: TensorElementType, data: TensorData, dims: readonly number[]): TensorLike;
  /**
   * Calls `callback` if the GPU behind `backend` goes away. Returns a function that stops listening.
   * Optional because WASM cannot lose a device.
   */
  onDeviceLost?(backend: EngineBackend, callback: (reason: string) => void): () => void;
}
