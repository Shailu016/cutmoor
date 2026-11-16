import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateTranscript } from "../hallucination-gate";
import type { WindowAudio } from "../contracts";
import type { PackedWindow } from "../types";
import { createStandInEngine, STAND_IN_ENGINE_ID, standInWordCount } from "./stand-in";
import { uniformAlign } from "./uniform-aligner";

const windowOf = (index: number, speechMs: number): WindowAudio => {
  const window: PackedWindow = { index, lengthMs: 30_000, usedMs: speechMs, regions: [{ sourceStartMs: 0, sourceEndMs: speechMs, packOffsetMs: 0 }] };
  return { window, samples: new Float32Array(0) };
};

afterEach(() => vi.unstubAllEnvs());

describe("stand-in engine", () => {
  it("is named so it cannot be mistaken for a real model", () => {
    const engine = createStandInEngine();
    expect(engine.id).toBe(STAND_IN_ENGINE_ID);
    expect(engine.id).toMatch(/not-a-real-model/);
  });

  it("is deterministic: the same window gives the same words, a different window different ones", async () => {
    const engine = createStandInEngine();
    await engine.load();
    const a = await engine.transcribe(windowOf(0, 12_000), { language: "hinglish" });
    const b = await engine.transcribe(windowOf(0, 12_000), { language: "hinglish" });
    const c = await engine.transcribe(windowOf(1, 12_000), { language: "hinglish" });
    expect(a).toEqual(b);
    expect(a.words).not.toEqual(c.words);
  });

  it("returns about one word per 420 ms of speech and none for no speech", async () => {
    const engine = createStandInEngine();
    await engine.load();
    expect((await engine.transcribe(windowOf(0, 4200), { language: "english" })).words).toHaveLength(10);
    expect((await engine.transcribe(windowOf(0, 0), { language: "english" })).words).toHaveLength(0);
    expect(standInWordCount(30_000)).toBeGreaterThan(60);
  });

  it("never trips the hallucination gate on its own output, for any window length", async () => {
    const engine = createStandInEngine();
    await engine.load();
    for (let index = 0; index < 60; index += 1) {
      for (const ms of [1500, 6000, 15_000, 29_000]) {
        const input = windowOf(index, ms);
        const transcript = await engine.transcribe(input, { language: "hinglish" });
        const words = uniformAlign(input, transcript);
        const gate = evaluateTranscript({ words, speech: [{ startMs: 0, endMs: ms }], noSpeechProbability: transcript.noSpeechProbability });
        expect(gate.reasons, `window ${index}, ${ms} ms`).toEqual([]);
      }
    }
  });

  it("repeats no word inside one window", async () => {
    const engine = createStandInEngine();
    await engine.load();
    const { words } = await engine.transcribe(windowOf(5, 29_000), { language: "hinglish" });
    const cleaned = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
    expect(new Set(cleaned).size).toBe(cleaned.length);
  });

  it("must be loaded first and honours a cancelled signal", async () => {
    const engine = createStandInEngine();
    await expect(engine.transcribe(windowOf(0, 1000), { language: "hindi" })).rejects.toMatchObject({ code: "model-load" });
    await engine.load();
    const controller = new AbortController();
    controller.abort();
    await expect(engine.transcribe(windowOf(0, 1000), { language: "hindi", signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
  });

  it("refuses to be created in a production build unless explicitly allowed", () => {
    vi.stubEnv("PROD", true);
    expect(() => createStandInEngine()).toThrowError(/production/);
    expect(() => createStandInEngine({ allowInProduction: true })).not.toThrow();
  });
});
