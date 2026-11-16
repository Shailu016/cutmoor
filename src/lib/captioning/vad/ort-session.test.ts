// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import type { SpeechInterval } from "../types";
import { createOrtSession, type OrtRuntime } from "./ort-session";

/**
 * A real-runtime check with a tiny model built byte by byte here (no weights, no network):
 *   output = mean of `input` over its 576 values   -> [1, 1]
 *   stateN = state                                 -> [2, 1, 128]   (and `sr` is accepted but unused)
 * It proves what a fake cannot: that the adapter hands onnxruntime-web the right tensor types and shapes
 * (including the int64 scalar) and reads float32 results back.
 */
function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}
const field = (no: number, wire: number) => varint(no * 8 + wire);
const lenField = (no: number, bytes: number[]) => [...field(no, 2), ...varint(bytes.length), ...bytes];
const strField = (no: number, s: string) => lenField(no, Array.from(new TextEncoder().encode(s)));
const intField = (no: number, n: number) => [...field(no, 0), ...varint(n)];

function valueInfo(name: string, elemType: number, dims: number[]): number[] {
  const shape = dims.flatMap((d) => lenField(1, intField(1, d)));
  const tensorType = [...intField(1, elemType), ...lenField(2, shape)];
  return [...strField(1, name), ...lenField(2, lenField(1, tensorType))];
}

function node(op: string, inputs: string[], outputs: string[], attrs: number[][] = []): number[] {
  return [
    ...inputs.flatMap((i) => strField(1, i)),
    ...outputs.flatMap((o) => strField(2, o)),
    ...strField(4, op),
    ...attrs.flatMap((a) => lenField(5, a)),
  ];
}

function tinyVadModel(): Uint8Array {
  const axes = [...strField(1, "axes"), ...intField(20, 7), ...intField(8, 1)]; // ints = [1], type INTS
  const graph = [
    ...lenField(1, node("ReduceMean", ["input"], ["output"], [axes])),
    ...lenField(1, node("Identity", ["state"], ["stateN"])),
    ...strField(2, "tiny"),
    ...lenField(11, valueInfo("input", 1, [1, 576])),
    ...lenField(11, valueInfo("state", 1, [2, 1, 128])),
    ...lenField(11, valueInfo("sr", 7, [])),
    ...lenField(12, valueInfo("output", 1, [1, 1])),
    ...lenField(12, valueInfo("stateN", 1, [2, 1, 128])),
  ];
  const model = [...intField(1, 8), ...lenField(8, intField(2, 13)), ...lenField(7, graph)];
  return Uint8Array.from(model);
}

describe("ort-session adapter against the real onnxruntime-web (wasm, in Node)", () => {
  it("runs a model with float32 input, float32 state and an int64 scalar, and reads float32 back", async () => {
    const ort = (await import("onnxruntime-web")) as unknown as OrtRuntime;
    const session = await createOrtSession(ort, tinyVadModel());
    const input = new Float32Array(576).fill(0.25);
    const state = Float32Array.from({ length: 256 }, (_, i) => i / 10);
    const out = await session.run({
      input: { type: "float32", data: input, dims: [1, 576] },
      state: { type: "float32", data: state, dims: [2, 1, 128] },
      sr: { type: "int64", data: BigInt64Array.of(16000n), dims: [] },
    });
    expect(out.output!.type).toBe("float32");
    expect(out.output!.dims).toEqual([1, 1]);
    expect(out.output!.data[0]).toBeCloseTo(0.25, 6);
    expect(out.stateN!.type).toBe("float32");
    expect(Array.from(out.stateN!.data as Float32Array)).toEqual(Array.from(state));
    expect(out.stateN!.dims).toEqual([2, 1, 128]);
    await session.release();
    await session.release(); // twice is fine
  });

  it("reports bytes the runtime cannot load as a model-load CaptionError", async () => {
    const ort = (await import("onnxruntime-web")) as unknown as OrtRuntime;
    const err = await createOrtSession(ort, new Uint8Array([1, 2, 3, 4])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaptionError);
    expect((err as CaptionError).code).toBe("model-load");
  });
});

describe("createSileroVad with the real runtime and the tiny stand-in model", () => {
  it("turns a DC offset (mean 0.9) into speech and silence into none, end to end", async () => {
    const { createSileroVad } = await import("./silero");
    const ort = (await import("onnxruntime-web")) as unknown as OrtRuntime;
    const vad = await createSileroVad({ model: tinyVadModel(), ort });
    // 6 s of audio at 16 kHz; samples 1.0 s .. 3.0 s sit at 0.9, the rest at 0. The stand-in model scores each
    // frame by the mean of its 576 inputs, so frames fully inside the burst score 0.9 and quiet ones 0.
    const audio = new Float32Array(96_000);
    audio.fill(0.9, 16_000, 48_000);
    const out: SpeechInterval[] = [];
    for (let at = 0; at < audio.length; at += 3000) out.push(...(await vad.push({ startMs: at / 16, samples: audio.slice(at, at + 3000) })));
    out.push(...(await vad.flush()));
    expect(out.length).toBe(1);
    // Burst is 1000..3000 ms; frame edges and the 64-sample context blur it by one frame at most, padding adds 200 ms.
    expect(out[0]!.startMs).toBeGreaterThanOrEqual(1000 - 200 - 32);
    expect(out[0]!.startMs).toBeLessThanOrEqual(1000 - 200 + 32);
    expect(out[0]!.endMs).toBeGreaterThanOrEqual(3000 + 200 - 32);
    expect(out[0]!.endMs).toBeLessThanOrEqual(3000 + 200 + 32);
    await vad.release();
  });
});
