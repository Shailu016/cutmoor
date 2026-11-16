import { describe, expect, it } from "vitest";
import type { PcmChunk, VoiceDetector } from "./contracts";
import { createLazyVoiceDetector } from "./lazy-vad";

const chunk = (startMs = 0): PcmChunk => ({ startMs, samples: new Float32Array(160) });

function fakeDetector() {
  const calls: string[] = [];
  const detector: VoiceDetector = {
    async push(c) {
      calls.push(`push@${c.startMs}`);
      return [{ startMs: c.startMs, endMs: c.startMs + 100 }];
    },
    async flush() {
      calls.push("flush");
      return [{ startMs: 1, endMs: 2 }];
    },
    reset() {
      calls.push("reset");
    },
    async release() {
      calls.push("release");
    },
  };
  return { detector, calls };
}

describe("createLazyVoiceDetector", () => {
  it("builds nothing until audio arrives", async () => {
    let builds = 0;
    const { detector } = fakeDetector();
    const lazy = createLazyVoiceDetector(async () => (builds += 1, detector));
    lazy.reset();
    expect(await lazy.flush()).toEqual([]);
    await lazy.release();
    expect(builds).toBe(0);
  });

  it("builds once and delegates", async () => {
    let builds = 0;
    const { detector, calls } = fakeDetector();
    const lazy = createLazyVoiceDetector(async () => (builds += 1, detector));
    expect(await lazy.push(chunk(0))).toEqual([{ startMs: 0, endMs: 100 }]);
    await lazy.push(chunk(1000));
    expect(await lazy.flush()).toEqual([{ startMs: 1, endMs: 2 }]);
    lazy.reset();
    expect(builds).toBe(1);
    expect(calls).toEqual(["push@0", "push@1000", "flush", "reset"]);
  });

  it("builds only once when two pushes race", async () => {
    let builds = 0;
    const { detector } = fakeDetector();
    const lazy = createLazyVoiceDetector(async () => {
      builds += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return detector;
    });
    await Promise.all([lazy.push(chunk(0)), lazy.push(chunk(32))]);
    expect(builds).toBe(1);
  });

  it("retries after a failed build instead of caching the failure", async () => {
    let builds = 0;
    const { detector } = fakeDetector();
    const lazy = createLazyVoiceDetector(async () => {
      builds += 1;
      if (builds === 1) throw new Error("model download failed");
      return detector;
    });
    await expect(lazy.push(chunk())).rejects.toThrow("model download failed");
    await expect(lazy.push(chunk())).resolves.toHaveLength(1);
    expect(builds).toBe(2);
  });

  it("releases the built detector, and builds a new one afterwards", async () => {
    let builds = 0;
    const { detector, calls } = fakeDetector();
    const lazy = createLazyVoiceDetector(async () => (builds += 1, detector));
    await lazy.push(chunk());
    await lazy.release();
    expect(calls).toContain("release");
    await lazy.push(chunk());
    expect(builds).toBe(2);
  });

  it("releases a detector that was still being built", async () => {
    const { detector, calls } = fakeDetector();
    const lazy = createLazyVoiceDetector(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return detector;
    });
    const pending = lazy.push(chunk());
    await lazy.release();
    await pending.catch(() => undefined);
    expect(calls).toContain("release");
  });
});
