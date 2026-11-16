import { describe, expect, it } from "vitest";
import { describeLowSpeech } from "./low-speech";

const stats = (audioSeconds: number, speechSeconds: number) => ({ audioSeconds, speechSeconds });

describe("describeLowSpeech", () => {
  it("explains a 2-minute song that produced 2 words", () => {
    const note = describeLowSpeech(2, stats(125, 10), true);
    expect(note?.title).toBe("Very little speech was recognised");
    expect(note?.detail).toMatch(/2 words/);
    expect(note?.detail).toMatch(/125 seconds/);
    expect(note?.detail).toMatch(/High accuracy/);
  });
  it("says 'No speech' for zero words and leaves out the model hint on High accuracy", () => {
    const note = describeLowSpeech(0, stats(60, 0), false);
    expect(note?.title).toBe("No speech was recognised");
    expect(note?.detail).not.toMatch(/High accuracy/);
    expect(note?.detail).toMatch(/0 words/);
  });
  it("uses the singular for one word", () => {
    expect(describeLowSpeech(1, stats(60, 5), false)?.detail).toMatch(/Only 1 word /);
  });
  it("stays quiet for short clips, normal talk and a file that is mostly speech", () => {
    expect(describeLowSpeech(3, stats(10, 4), true)).toBeNull();
    expect(describeLowSpeech(22, stats(15, 14), true)).toBeNull();
    expect(describeLowSpeech(300, stats(120, 100), true)).toBeNull();
  });
  it("speaks up when the detector found little speech even if some words came out", () => {
    expect(describeLowSpeech(40, stats(300, 20), true)).not.toBeNull();
  });
  it("never throws on odd numbers", () => {
    expect(describeLowSpeech(5, stats(Number.NaN, 1), true)).toBeNull();
    expect(describeLowSpeech(5, stats(100, Number.NaN), true)).not.toBeNull();
  });

  it("never claims the whole file produced text, and never asks the visitor to change a setting", () => {
    const detail = describeLowSpeech(2, stats(125, 125), false)?.detail ?? "";
    expect(detail).not.toMatch(/whole file was read/i);
    expect(detail).not.toMatch(/choose|setting/i);
  });
});
