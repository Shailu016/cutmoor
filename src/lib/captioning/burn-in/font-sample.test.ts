// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CaptionEvent, Word } from "../types";
import { captionSampleText } from "./font-sample";

const word = (text: string, index: number): Word => ({ text, startMs: index * 100, endMs: index * 100 + 90, confidence: 1, index, windowIndex: 0 });
const event = (lines: string[][]): CaptionEvent => {
  let index = 0;
  const built = lines.map((line) => line.map((text) => word(text, index++)));
  const words = built.flat();
  return { startMs: words[0].startMs, endMs: words[words.length - 1].endMs, lines: built } as CaptionEvent;
};

describe("captionSampleText", () => {
  it("always includes the plain Latin sample", () => {
    expect(captionSampleText([])).toBe("Aa");
  });

  it("lists each character of the captions once, skipping spaces", () => {
    const text = captionSampleText([event([["Hello", "hello"]])]);
    expect([...text].sort().join("")).toBe(["A", "a", "H", "e", "l", "o", "h"].sort().join(""));
  });

  it("carries accented Latin and Devanagari so their font files are loaded too", () => {
    const text = captionSampleText([event([["café", "नमस्ते"]])]);
    expect(text).toContain("é");
    expect(text).toContain("न");
    expect(text).toContain("्");
  });

  it("stays small however long the transcript is", () => {
    const many = Array.from({ length: 400 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
    expect([...captionSampleText([event([[many]])])].length).toBeLessThanOrEqual(600);
  });
});
