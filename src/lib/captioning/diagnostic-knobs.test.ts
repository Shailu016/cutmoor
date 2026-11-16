import { describe, expect, it } from "vitest";
import { MAX_ATTENTION_STEPS, sanitizeOrtOverrides, sanitizePipelineTuning, sanitizeVadOverrides } from "./diagnostic-knobs";

describe("sanitizeVadOverrides", () => {
  it("keeps the named settings that are finite, non-negative numbers", () => {
    expect(sanitizeVadOverrides({ padMs: 300, mergeGapMs: 400, startThreshold: 0.4 })).toEqual({ padMs: 300, mergeGapMs: 400, startThreshold: 0.4 });
  });
  it("drops unknown keys, non-numbers, NaN, infinity, negatives and huge values", () => {
    expect(sanitizeVadOverrides({ frameMs: 1, padMs: "300", mergeGapMs: Number.NaN, minSpeechMs: Infinity, minSilenceMs: -5, maxIntervalMs: 1e12, endThreshold: 0.2 })).toEqual({ endThreshold: 0.2 });
  });
  it("drops values the voice detector would refuse, so a bad knob cannot fail a job", () => {
    expect(sanitizeVadOverrides({ startThreshold: 600_000, minSpeechMs: 600_000, maxIntervalMs: 1_000 })).toEqual({ minSpeechMs: 600_000 });
    expect(sanitizeVadOverrides({ startThreshold: 0 })).toEqual({});
    expect(sanitizeVadOverrides({ endThreshold: 1.5, mergeGapMs: 0 })).toEqual({});
  });
  it("keeps the start and end thresholds consistent: an end above the start is dropped (a lone start 0.3 would sit below the default end 0.35)", () => {
    expect(sanitizeVadOverrides({ startThreshold: 0.3 })).toEqual({});
    expect(sanitizeVadOverrides({ startThreshold: 0.3, endThreshold: 0.25 })).toEqual({ startThreshold: 0.3, endThreshold: 0.25 });
    expect(sanitizeVadOverrides({ endThreshold: 0.6 })).toEqual({});
  });
  it("returns nothing for input that is not an object", () => {
    for (const bad of [null, undefined, 5, "x", [1, 2], true]) expect(sanitizeVadOverrides(bad)).toEqual({});
  });
});

describe("sanitizeOrtOverrides", () => {
  it("allows the optimisation level and the two flags only", () => {
    expect(sanitizeOrtOverrides({ graphOptimizationLevel: "basic", enableMemPattern: false, enableCpuMemArena: true })).toEqual({ graphOptimizationLevel: "basic", enableMemPattern: false, enableCpuMemArena: true });
  });
  it("ignores the execution provider, other keys and wrong types", () => {
    expect(sanitizeOrtOverrides({ executionProviders: ["wasm"], logSeverityLevel: 0, graphOptimizationLevel: "turbo", enableMemPattern: "no" })).toEqual({});
  });
  it("returns nothing for input that is not an object", () => {
    expect(sanitizeOrtOverrides(null)).toEqual({});
    expect(sanitizeOrtOverrides([])).toEqual({});
  });
});

describe("MAX_ATTENTION_STEPS", () => {
  it("is a finite positive bound", () => {
    expect(Number.isInteger(MAX_ATTENTION_STEPS) && MAX_ATTENTION_STEPS > 0).toBe(true);
  });
});

describe("sanitizePipelineTuning", () => {
  it("keeps only the four song-mode switches, and only as booleans", () => {
    expect(sanitizePipelineTuning({ timestampRead: false, c2Time: false, reuseEncoder: false, debugReads: true })).toEqual({
      timestampRead: false,
      c2Time: false,
      reuseEncoder: false,
      debugReads: true,
    });
  });
  it("drops unknown keys and wrong value types, so a harness typo cannot change a job", () => {
    expect(sanitizePipelineTuning({ timestampRead: "no", c2Time: 0, reuseEncoder: null, debugReads: 1, readBudget: 9, maxRetainedMs: 1 })).toEqual({});
  });
  it("returns nothing for input that is not an object", () => {
    for (const bad of [null, undefined, 5, "x", [true], false]) expect(sanitizePipelineTuning(bad)).toEqual({});
  });
});
