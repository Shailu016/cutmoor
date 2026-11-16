import { describe, expect, it } from "vitest";
import { SAMPLE_RATE } from "../contracts";
import { createEverythingDetector, SILENCE_RMS } from "./everything-detector";

const chunk = (startMs: number, seconds: number, level = 0.1) => ({ startMs, samples: new Float32Array(Math.round(seconds * SAMPLE_RATE)).fill(level) });

describe("createEverythingDetector", () => {
  it("calls every chunk speech, covering exactly the chunk", async () => {
    const detector = createEverythingDetector();
    expect(await detector.push(chunk(0, 1))).toEqual([{ startMs: 0, endMs: 1000 }]);
    expect(await detector.push(chunk(1000, 0.5))).toEqual([{ startMs: 1000, endMs: 1500 }]);
  });
  it("closes nothing at the end and never throws on empty input or reset/release", async () => {
    const detector = createEverythingDetector();
    expect(await detector.push(chunk(2000, 0))).toEqual([]);
    expect(await detector.flush()).toEqual([]);
    detector.reset();
    await expect(detector.release()).resolves.toBeUndefined();
  });
  it("does not read practically silent chunks, but reads quiet singing above the floor", async () => {
    const detector = createEverythingDetector();
    expect(await detector.push(chunk(0, 1, 0))).toEqual([]);
    expect(await detector.push(chunk(1000, 1, SILENCE_RMS / 2))).toEqual([]);
    expect(await detector.push(chunk(2000, 1, SILENCE_RMS * 3))).toEqual([{ startMs: 2000, endMs: 3000 }]);
  });
  it("rounds to whole milliseconds", async () => {
    const detector = createEverythingDetector();
    const [interval] = await detector.push({ startMs: 10.4, samples: new Float32Array(16).fill(0.1) });
    expect(Number.isInteger(interval.startMs) && Number.isInteger(interval.endMs)).toBe(true);
    expect(interval.endMs).toBeGreaterThan(interval.startMs - 1);
  });
});
