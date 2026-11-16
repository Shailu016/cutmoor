/**
 * The smallest view of "a loaded neural-network model" that the voice detector needs. The detector is
 * written against this, not against onnxruntime-web, so tests can run it with a fake and the real
 * runtime is wired in one place (ort-session.ts).
 */

/** A tensor as the detector sees it: a flat typed array plus its shape. */
export type VadTensor =
  | { readonly type: "float32"; readonly data: Float32Array; readonly dims: readonly number[] }
  | { readonly type: "int64"; readonly data: BigInt64Array; readonly dims: readonly number[] };

export interface InferenceSessionLike {
  /** Runs the model once. Rejects if the runtime fails. */
  run(feeds: Readonly<Record<string, VadTensor>>): Promise<Record<string, VadTensor>>;
  /** Frees the model's memory. Safe to call twice. */
  release(): Promise<void>;
}
