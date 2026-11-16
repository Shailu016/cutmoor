import { describe, expect, it } from "vitest";
import { createOrtRuntime } from "./ort-session";

/** A stand-in for the parts of onnxruntime-web the adapter touches, recording how it is called. */
function fakeOrt(options: { outputNames?: string[]; device?: { lost: Promise<{ reason?: string; message?: string }> } | null; devicePromise?: boolean } = {}) {
  const created: { opts: Record<string, unknown>; released: boolean }[] = [];
  const runs: Record<string, unknown>[] = [];
  const tensors: FakeRawTensor[] = [];

  class FakeRawTensor {
    disposed = false;
    constructor(
      readonly type: string,
      readonly data: Float32Array | BigInt64Array | Uint8Array,
      readonly dims: readonly number[],
    ) {
      tensors.push(this);
    }
    async getData() {
      return this.data;
    }
    dispose() {
      this.disposed = true;
    }
  }

  const ort = {
    Tensor: FakeRawTensor,
    InferenceSession: {
      async create(_model: Uint8Array, opts: Record<string, unknown>) {
        const record = { opts, released: false };
        created.push(record);
        return {
          inputNames: ["a"],
          outputNames: options.outputNames ?? ["logits", "present.0.decoder.key"],
          async run(feeds: Record<string, unknown>) {
            runs.push(feeds);
            return { logits: new FakeRawTensor("float32", Float32Array.of(1, 2), [1, 2]) };
          },
          async release() {
            record.released = true;
          },
        };
      },
    },
    env: { webgpu: { device: options.devicePromise ? Promise.resolve(options.device) : options.device } },
  };
  return { ort, created, runs, tensors };
}

describe("backends", () => {
  it("offers WebGPU then WASM when the browser has a GPU, and only WASM otherwise", () => {
    expect(createOrtRuntime(fakeOrt().ort, { hasWebGpu: true }).backends).toEqual(["webgpu", "wasm"]);
    expect(createOrtRuntime(fakeOrt().ort, { hasWebGpu: false }).backends).toEqual(["wasm"]);
  });
});

describe("sessions", () => {
  it("asks for the named outputs to stay on the GPU, on WebGPU only", async () => {
    const gpu = fakeOrt();
    await createOrtRuntime(gpu.ort, { hasWebGpu: true }).createSession(new Uint8Array(1), "webgpu", (name) => name.startsWith("present."));
    expect(gpu.created).toHaveLength(2); // one to learn the output names, one with the placement
    expect(gpu.created[0].released).toBe(true);
    expect(gpu.created[1].opts).toMatchObject({ executionProviders: ["webgpu"], preferredOutputLocation: { "present.0.decoder.key": "gpu-buffer" } });
    expect(gpu.created[1].opts.preferredOutputLocation).not.toHaveProperty("logits");

    const cpu = fakeOrt();
    await createOrtRuntime(cpu.ort, { hasWebGpu: true }).createSession(new Uint8Array(1), "wasm", () => true);
    expect(cpu.created).toHaveLength(1);
    expect(cpu.created[0].opts).toMatchObject({ executionProviders: ["wasm"] });
    expect(cpu.created[0].opts).not.toHaveProperty("preferredOutputLocation");
  });

  it("does not create twice when no output needs to stay on the GPU", async () => {
    const gpu = fakeOrt();
    await createOrtRuntime(gpu.ort, { hasWebGpu: true }).createSession(new Uint8Array(1), "webgpu", () => false);
    expect(gpu.created).toHaveLength(1);
  });

  it("exposes names, runs with our tensors and wraps what comes back", async () => {
    const { ort, runs, tensors } = fakeOrt();
    const runtime = createOrtRuntime(ort, { hasWebGpu: false });
    const session = await runtime.createSession(new Uint8Array(1), "wasm");
    expect(session.inputNames).toEqual(["a"]);
    expect(session.outputNames).toEqual(["logits", "present.0.decoder.key"]);

    const input = runtime.createTensor("int64", BigInt64Array.of(5n, 6n), [1, 2]);
    expect(input.type).toBe("int64");
    expect(input.dims).toEqual([1, 2]);
    const out = await session.run({ a: input });
    // The raw ort tensor, not our wrapper, is what ort receives.
    expect(runs[0].a).toBe(tensors[0]);
    expect(await out.logits.getData()).toEqual(Float32Array.of(1, 2));
    out.logits.dispose();
    expect(tensors[1].disposed).toBe(true);
    await session.release();
  });

  it("refuses to feed a tensor it did not make", async () => {
    const { ort } = fakeOrt();
    const runtime = createOrtRuntime(ort, { hasWebGpu: false });
    const session = await runtime.createSession(new Uint8Array(1), "wasm");
    const alien = { type: "float32", dims: [1], getData: async () => new Float32Array(1), dispose: () => undefined };
    await expect(session.run({ a: alien })).rejects.toThrow(/not a tensor made by this runtime/);
  });

  it("releases the underlying session", async () => {
    const { ort, created } = fakeOrt();
    const session = await createOrtRuntime(ort, { hasWebGpu: false }).createSession(new Uint8Array(1), "wasm");
    await session.release();
    expect(created[0].released).toBe(true);
  });
});

describe("GPU device loss", () => {
  for (const asPromise of [false, true]) {
    it(`tells listeners when the device is lost (device ${asPromise ? "as a promise" : "direct"})`, async () => {
      let lose!: (info: { reason?: string; message?: string }) => void;
      const lost = new Promise<{ reason?: string; message?: string }>((resolve) => {
        lose = resolve;
      });
      const { ort } = fakeOrt({ device: { lost }, devicePromise: asPromise });
      const runtime = createOrtRuntime(ort, { hasWebGpu: true });
      const heard: string[] = [];
      const stop = runtime.onDeviceLost?.("webgpu", (reason) => heard.push(reason));
      await runtime.createSession(new Uint8Array(1), "webgpu");
      lose({ reason: "unknown", message: "driver reset" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(heard).toEqual(["driver reset"]);
      stop?.();
    });
  }

  it("ignores the device being destroyed on purpose, and stops listening when told", async () => {
    let lose!: (info: { reason?: string; message?: string }) => void;
    const lost = new Promise<{ reason?: string; message?: string }>((resolve) => {
      lose = resolve;
    });
    const { ort } = fakeOrt({ device: { lost } });
    const runtime = createOrtRuntime(ort, { hasWebGpu: true });
    const heard: string[] = [];
    runtime.onDeviceLost?.("webgpu", (reason) => heard.push(reason));
    await runtime.createSession(new Uint8Array(1), "webgpu");
    lose({ reason: "destroyed", message: "released" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual([]);

    const second = fakeOrt({ device: { lost: Promise.resolve({ reason: "unknown", message: "x" }) } });
    const runtime2 = createOrtRuntime(second.ort, { hasWebGpu: true });
    const heard2: string[] = [];
    const stop = runtime2.onDeviceLost?.("webgpu", (reason) => heard2.push(reason));
    stop?.();
    await runtime2.createSession(new Uint8Array(1), "webgpu");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard2).toEqual([]);
  });

  it("copes with a runtime that exposes no device", async () => {
    const { ort } = fakeOrt({ device: null });
    await expect(createOrtRuntime(ort, { hasWebGpu: true }).createSession(new Uint8Array(1), "webgpu")).resolves.toBeDefined();
  });
});
