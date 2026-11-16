import { describe, expect, it } from "vitest";
import { CaptionError, SAMPLE_RATE } from "../contracts";
import type { SpeechInterval } from "../types";
import { createSileroVadFromSession, SILERO_CONTEXT_SAMPLES, SILERO_FRAME_SAMPLES } from "./silero";
import type { InferenceSessionLike, VadTensor } from "./session";

const FRAME = SILERO_FRAME_SAMPLES;

interface Call {
  input: Float32Array;
  inputDims: readonly number[];
  state: Float32Array;
  stateDims: readonly number[];
  sr: bigint[];
  srDims: readonly number[];
}

/**
 * A stand-in for the neural network. Its "memory" is a counter: every call returns the state it was
 * given plus one, so a test can see exactly how many calls the state travelled through. Its answer is a
 * plain loudness test on the 512 NEW samples (never the context), so the expected speech map of a
 * synthetic signal can be worked out by hand.
 */
class FakeSession implements InferenceSessionLike {
  calls: Call[] = [];
  released = 0;
  onCall: ((n: number) => void) | null = null;
  failAt: number | null = null;
  badOutput: "none" | "no-state" | "nan" | "wrong-size" = "none";

  async run(feeds: Readonly<Record<string, VadTensor>>): Promise<Record<string, VadTensor>> {
    const input = feeds.input!;
    const state = feeds.state!;
    const sr = feeds.sr!;
    if (input.type !== "float32" || state.type !== "float32" || sr.type !== "int64") throw new Error("wrong tensor types");
    // Copy now: the detector is free to reuse its arrays after the call.
    this.calls.push({
      input: Float32Array.from(input.data),
      inputDims: input.dims,
      state: Float32Array.from(state.data),
      stateDims: state.dims,
      sr: Array.from(sr.data),
      srDims: sr.dims,
    });
    const n = this.calls.length;
    this.onCall?.(n);
    if (this.failAt === n) throw new Error("boom");
    await Promise.resolve();
    let sum = 0;
    for (let i = SILERO_CONTEXT_SAMPLES; i < input.data.length; i++) sum += Math.abs(input.data[i]!);
    const loud = sum / FRAME > 0.05;
    const next = Float32Array.from(state.data, (v) => v + 1);
    const outputs: Record<string, VadTensor> = {
      output: { type: "float32", data: Float32Array.of(this.badOutput === "nan" ? NaN : loud ? 0.9 : 0.05), dims: [1, 1] },
      stateN: { type: "float32", data: this.badOutput === "wrong-size" ? new Float32Array(10) : next, dims: [2, 1, 128] },
    };
    if (this.badOutput === "no-state") delete outputs.stateN;
    return outputs;
  }

  async release(): Promise<void> {
    this.released++;
  }
}

/** Quiet audio with loud (0.5 amplitude, deterministic) stretches given in whole frames. */
function signal(totalSamples: number, loudFrames: [number, number][]): Float32Array {
  const a = new Float32Array(totalSamples);
  for (const [from, to] of loudFrames) for (let i = from * FRAME; i < Math.min(to * FRAME, totalSamples); i++) a[i] = 0.5 * Math.sin(i * 0.37 + 1) + 0.5001 * (i % 2 ? 1 : -1) * 0.1;
  return a;
}

const msOf = (samples: number) => (samples * 1000) / SAMPLE_RATE;

async function feed(
  det: ReturnType<typeof createSileroVadFromSession>,
  audio: Float32Array,
  sizes: number[],
  startMs = 0,
): Promise<SpeechInterval[]> {
  const out: SpeechInterval[] = [];
  let at = 0;
  let k = 0;
  while (at < audio.length) {
    const size = sizes[k++ % sizes.length]!;
    const piece = audio.slice(at, at + size);
    out.push(...(await det.push({ startMs: startMs + Math.round(msOf(at)), samples: piece })));
    at += piece.length;
  }
  out.push(...(await det.flush()));
  return out;
}

describe("Silero wrapper: how the model is fed", () => {
  const audio = signal(FRAME * 200, [[32, 96]]); // loud from 1024 ms to 3072 ms, 6.4 s total

  it("finds the burst at the right global time, padded, however the audio is chunked", async () => {
    for (const sizes of [[FRAME * 200], [FRAME], [1], [511, 513], [7, 4000, 33, 1], [100_000]]) {
      const session = new FakeSession();
      const det = createSileroVadFromSession(session);
      // Burst 1024..3072 ms, padded by 200 ms each side.
      expect(await feed(det, audio, sizes)).toEqual([{ startMs: 824, endMs: 3272 }]);
      expect(session.calls.length).toBe(200); // every frame exactly once, never twice
    }
  });

  it("shifts everything by the start time of the first chunk", async () => {
    const det = createSileroVadFromSession(new FakeSession());
    expect(await feed(det, audio, [1000], 60_000)).toEqual([{ startMs: 60_824, endMs: 63_272 }]);
  });

  it("gives the model 64 samples of the previous frame, then the 512 new samples, in a [1, 576] input", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    await feed(det, audio, [333]); // odd chunk size: partial frames cross every push
    expect(session.calls[0]!.inputDims).toEqual([1, 576]);
    expect(Array.from(session.calls[0]!.input.subarray(0, 64))).toEqual(new Array(64).fill(0)); // no context before the first frame
    for (let k = 0; k < session.calls.length; k++) {
      const call = session.calls[k]!;
      expect(call.input.length).toBe(576);
      expect(Array.from(call.input.subarray(64))).toEqual(Array.from(audio.subarray(k * FRAME, (k + 1) * FRAME)));
      if (k > 0) expect(Array.from(call.input.subarray(0, 64))).toEqual(Array.from(audio.subarray(k * FRAME - 64, k * FRAME)));
    }
  });

  it("threads the state: zeros first, then exactly what the previous call returned", async () => {
    const session = new FakeSession();
    await feed(createSileroVadFromSession(session), audio, [1000, 17]);
    session.calls.forEach((call, k) => {
      expect(call.stateDims).toEqual([2, 1, 128]);
      expect(call.state.length).toBe(256);
      expect(new Set(call.state)).toEqual(new Set([k])); // fake adds 1 per call
    });
  });

  it("passes the sample rate as an int64 scalar of 16000", async () => {
    const session = new FakeSession();
    await feed(createSileroVadFromSession(session), audio.subarray(0, FRAME * 3), [FRAME]);
    for (const call of session.calls) {
      expect(call.sr).toEqual([16000n]);
      expect(call.srDims).toEqual([]);
    }
  });

  it("does not run the model for a partial frame until it is complete", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    await det.push({ startMs: 0, samples: new Float32Array(FRAME - 1) });
    expect(session.calls.length).toBe(0);
    await det.push({ startMs: msOf(FRAME - 1), samples: new Float32Array(1) });
    expect(session.calls.length).toBe(1);
    await det.push({ startMs: msOf(FRAME), samples: new Float32Array(FRAME * 2 + 5) });
    expect(session.calls.length).toBe(3);
  });

  it("scores the last partial frame on flush, zero padded, and limits the end to the real audio", async () => {
    // 40 whole quiet frames, then 100 loud samples (a partial 41st frame): mean |x| over 512 is about 0.1 > 0.05.
    const a = new Float32Array(FRAME * 40 + 100);
    a.fill(0.5, FRAME * 40);
    const session = new FakeSession();
    const out = await feed(createSileroVadFromSession(session), a, [FRAME * 7 + 3]);
    expect(session.calls.length).toBe(41);
    expect(Array.from(session.calls[40]!.input.subarray(64 + 100))).toEqual(new Array(FRAME - 100).fill(0));
    // Frame 40 starts at 1280 ms. A single loud frame is only 32 ms, below the 250 ms minimum, so nothing is reported;
    // make the speech long enough and check the end clamp instead:
    expect(out).toEqual([]);
    const b = new Float32Array(FRAME * 40 + 100);
    b.fill(0.5, FRAME * 20); // loud from frame 20 (640 ms) to the very end
    const out2 = await feed(createSileroVadFromSession(new FakeSession()), b, [5000]);
    // Audio is 20580 samples = 1286.25 ms: the end padding stops there (rounded), not at 1280 + 32 + 200.
    expect(out2).toEqual([{ startMs: 440, endMs: Math.round(msOf(b.length)) }]);
  });

  it("is reusable after flush: the next file starts from a zero state and zero context", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    await feed(det, audio, [4096]);
    const before = session.calls.length;
    await feed(det, audio, [4096]);
    const first = session.calls[before]!;
    expect(new Set(first.state)).toEqual(new Set([0]));
    expect(Array.from(first.input.subarray(0, 64))).toEqual(new Array(64).fill(0));
  });

  it("reset() forgets a half-fed file", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    await det.push({ startMs: 0, samples: audio.slice(0, FRAME * 50 + 77) });
    det.reset();
    expect(await feed(det, audio, [4096], 1000)).toEqual([{ startMs: 1824, endMs: 4272 }]);
  });

  it("keeps call order when pushes are not awaited", async () => {
    const det = createSileroVadFromSession(new FakeSession());
    const parts: Promise<SpeechInterval[]>[] = [];
    for (let at = 0; at < audio.length; at += 5000) parts.push(det.push({ startMs: Math.round(msOf(at)), samples: audio.slice(at, at + 5000) }));
    const closed = (await Promise.all(parts)).flat();
    expect([...closed, ...(await det.flush())]).toEqual([{ startMs: 824, endMs: 3272 }]);
  });
});

describe("Silero wrapper: gaps and repeats in the input", () => {
  it("fills a gap in the chunks with silence and keeps later times right", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    const burst = signal(FRAME * 64, [[0, 64]]); // 2 s of loud
    const out: SpeechInterval[] = [];
    out.push(...(await det.push({ startMs: 0, samples: new Float32Array(FRAME * 32) }))); // 1024 ms of quiet
    // The reader lost about 2 s: the next chunk says it starts at 3000 ms (the frame grid is at 1024 ms).
    out.push(...(await det.push({ startMs: 3000, samples: burst })));
    out.push(...(await det.flush()));
    // The 1976 ms gap becomes 62 whole silent frames (1984 ms), so the burst lands on the grid at 3008 ms, 8 ms
    // after the 3000 ms the reader reported: gaps are rounded to whole frames. The end is the real audio end.
    expect(out).toEqual([{ startMs: 2808, endMs: 5056 }]);
    // The silent frames cost no model calls.
    expect(session.calls.length).toBe(32 + 64);
  });

  it("skips audio it has already seen when a chunk starts too early", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    const audio = signal(FRAME * 100, [[40, 80]]);
    const out: SpeechInterval[] = [];
    out.push(...(await det.push({ startMs: 0, samples: audio.slice(0, FRAME * 60) })));
    // Second chunk repeats the last 10 frames (320 ms) before continuing.
    out.push(...(await det.push({ startMs: msOf(FRAME * 50), samples: audio.slice(FRAME * 50) })));
    out.push(...(await det.flush()));
    expect(session.calls.length).toBe(100);
    expect(out).toEqual([{ startMs: 1080, endMs: 2760 }]); // loud 1280..2560 ms, padded by 200
  });

  it("tolerates a few milliseconds of rounding in startMs without treating it as a gap", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    for (let k = 0; k < 20; k++) {
      // startMs rounded to whole ms (up to 1 ms off) as a real reader would report it
      await det.push({ startMs: Math.round(msOf(k * 1000)), samples: new Float32Array(1000) });
    }
    await det.flush();
    expect(session.calls.length).toBe(Math.ceil(20_000 / FRAME));
  });
});

describe("Silero wrapper: cancellation, errors, release", () => {
  const audio = signal(FRAME * 200, [[32, 96]]);

  it("rejects with code aborted when the signal is already aborted, and leaves the detector clean", async () => {
    const det = createSileroVadFromSession(new FakeSession());
    const ac = new AbortController();
    ac.abort();
    await expect(det.push({ startMs: 0, samples: audio }, ac.signal)).rejects.toMatchObject({ name: "CaptionError", code: "aborted" });
    expect(await feed(det, audio, [9000])).toEqual([{ startMs: 824, endMs: 3272 }]);
  });

  it("stops promptly mid-chunk when aborted, then starts clean", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    const ac = new AbortController();
    session.onCall = (n) => {
      if (n === 5) ac.abort();
    };
    await expect(det.push({ startMs: 0, samples: audio }, ac.signal)).rejects.toMatchObject({ code: "aborted" });
    expect(session.calls.length).toBe(5); // no more model calls after the abort
    session.onCall = null;
    session.calls = [];
    expect(await feed(det, audio, [9000])).toEqual([{ startMs: 824, endMs: 3272 }]);
    expect(new Set(session.calls[0]!.state)).toEqual(new Set([0])); // not the half-used state from before
  });

  it("turns a runtime failure into an inference CaptionError and recovers", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    session.failAt = 3;
    const err = await det.push({ startMs: 0, samples: audio }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaptionError);
    expect((err as CaptionError).code).toBe("inference");
    expect((err as CaptionError).cause).toBeInstanceOf(Error);
    session.failAt = null;
    expect(await feed(det, audio, [9000])).toEqual([{ startMs: 824, endMs: 3272 }]);
  });

  for (const bad of ["no-state", "nan", "wrong-size"] as const) {
    it(`rejects a malformed model answer (${bad}) instead of guessing`, async () => {
      const session = new FakeSession();
      session.badOutput = bad;
      const det = createSileroVadFromSession(session);
      await expect(det.push({ startMs: 0, samples: audio })).rejects.toMatchObject({ code: "inference" });
    });
  }

  it("releases the session once, however many times release is called, and refuses further use", async () => {
    const session = new FakeSession();
    const det = createSileroVadFromSession(session);
    await det.release();
    await det.release();
    expect(session.released).toBe(1);
    await expect(det.push({ startMs: 0, samples: audio })).rejects.toMatchObject({ code: "internal" });
    await expect(det.flush()).rejects.toMatchObject({ code: "internal" });
  });

  it("flush with nothing pushed returns nothing", async () => {
    expect(await createSileroVadFromSession(new FakeSession()).flush()).toEqual([]);
  });
});

describe("Silero wrapper: reset ordering", () => {
  it("finding 3: a model call still running when reset() happens cannot leak its state or context into the next file", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const session = new FakeSession();
    const realRun = session.run.bind(session);
    let first = true;
    session.run = async (feeds) => {
      const out = await realRun(feeds);
      if (first) {
        first = false;
        await gate; // hold the first call open across the reset
      }
      return out;
    };
    const det = createSileroVadFromSession(session);
    const old = det.push({ startMs: 0, samples: new Float32Array(FRAME).fill(0.5) });
    await Promise.resolve();
    await Promise.resolve();
    det.reset();
    release();
    expect(await old).toEqual([]);
    await det.push({ startMs: 0, samples: new Float32Array(FRAME) });
    const next = session.calls[1]!;
    expect(Array.from(next.state).every((v) => v === 0)).toBe(true);
    expect(Array.from(next.input.subarray(0, SILERO_CONTEXT_SAMPLES)).every((v) => v === 0)).toBe(true);
  });

  it("finding 5: a push queued before reset() is discarded, not fed into the next file", async () => {
    const det = createSileroVadFromSession(new FakeSession());
    const a = det.push({ startMs: 0, samples: new Float32Array(FRAME * 20).fill(0.5) });
    det.reset();
    const b = det.push({ startMs: 0, samples: new Float32Array(FRAME * 20) });
    const parts = await Promise.all([a, b]);
    expect([...parts.flat(), ...(await det.flush())]).toEqual([]);
  });

  it("a flush queued before reset() is discarded as well", async () => {
    const det = createSileroVadFromSession(new FakeSession());
    await det.push({ startMs: 0, samples: new Float32Array(FRAME * 3).fill(0.5) });
    const f = det.flush();
    det.reset();
    expect(await f).toEqual([]);
  });
});
