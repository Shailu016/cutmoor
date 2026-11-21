import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Word } from "../../lib/captioning/types";
import { useCaptionEdits, type CaptionEdits } from "./useCaptionEdits";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let latest: CaptionEdits;

function Harness({ source }: { source: Word[] }) {
  latest = useCaptionEdits(source);
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function word(text: string, startMs: number, endMs: number, index: number): Word {
  return { text, startMs, endMs, confidence: 1, index, windowIndex: 0 };
}

const hinglish: Word[] = ["ek", "do", "teen", "chaar", "paanch", "chhah", "saat", "aath"].map((text, index) =>
  word(text, index * 300, index * 300 + 280, index),
);

const hindi: Word[] = ["नमस्ते", "दोस्तों", "आज", "हम", "सीखेंगे"].map((text, index) =>
  word(text, index * 400, index * 400 + 360, index),
);

function wordCounts(edits: CaptionEdits): number[] {
  return edits.events.map((event) => event.lines.flat().length);
}

function flatTexts(edits: CaptionEdits): string[] {
  return edits.events.flatMap((event) => event.lines.flat().map((item) => item.text));
}

describe("useCaptionEdits layout choices", () => {
  it("starts automatic, original, with the source words and their times", async () => {
    await act(async () => root.render(createElement(Harness, { source: hinglish })));
    expect(latest.wordsPerCaption).toBeUndefined();
    expect(latest.script).toBe("original");
    expect(latest.hasDevanagari).toBe(false);
    expect(latest.words).toEqual(hinglish);
    expect(latest.events.flatMap((event) => event.lines.flat())).toEqual(hinglish);
    expect(latest.edited).toBe(false);
  });

  it("re-lays out instantly when the word cap changes, without touching the words or history", async () => {
    await act(async () => root.render(createElement(Harness, { source: hinglish })));
    const before = latest.events;
    const sourceSnapshot = latest.words.map((item) => ({ ...item }));

    await act(async () => latest.setWordsPerCaption(2));
    expect(latest.wordsPerCaption).toBe(2);
    expect(wordCounts(latest).every((count) => count <= 2)).toBe(true);
    expect(latest.events.flatMap((event) => event.lines.flat())).toEqual(hinglish);
    // The same timed words, only regrouped.
    expect(latest.words).toEqual(sourceSnapshot);
    expect(latest.edited).toBe(false);
    expect(latest.canUndo).toBe(false);
    expect(latest.events).not.toEqual(before);

    await act(async () => latest.setWordsPerCaption(undefined));
    expect(latest.wordsPerCaption).toBeUndefined();
    expect(latest.events).toEqual(before);
  });

  it("clamps the public setter to the five choices the product offers", async () => {
    await act(async () => root.render(createElement(Harness, { source: hinglish })));
    await act(async () => latest.setWordsPerCaption(9));
    expect(latest.wordsPerCaption).toBe(5);
    await act(async () => latest.setWordsPerCaption(0));
    expect(latest.wordsPerCaption).toBe(1);
    await act(async () => latest.setWordsPerCaption(2.7));
    expect(latest.wordsPerCaption).toBe(2);
    await act(async () => latest.setWordsPerCaption(Number.NaN));
    expect(latest.wordsPerCaption).toBeUndefined();
  });

  it("keeps the original transcript when the visitor asks for Hinglish", async () => {
    await act(async () => root.render(createElement(Harness, { source: hindi })));
    expect(latest.hasDevanagari).toBe(true);
    const originalEvents = latest.events;

    await act(async () => latest.setScript("roman"));
    expect(latest.script).toBe("roman");
    // The editor still edits the recognised words; the preview and exports get the roman text.
    expect(latest.words.map((item) => item.text)).toEqual(hindi.map((item) => item.text));
    expect(flatTexts(latest)).toEqual(["namaste", "doston", "aaj", "hum", "sikhenge"]);
    const romanFlat = latest.events.flatMap((event) => event.lines.flat());
    expect(romanFlat.map((item) => [item.startMs, item.endMs])).toEqual(hindi.map((item) => [item.startMs, item.endMs]));
    expect(latest.edited).toBe(false);

    await act(async () => latest.setScript("original"));
    expect(latest.events).toEqual(originalEvents);
  });

  it("combines a word cap with the script choice", async () => {
    await act(async () => root.render(createElement(Harness, { source: hindi })));
    await act(async () => latest.setWordsPerCaption(2));
    await act(async () => latest.setScript("roman"));
    expect(wordCounts(latest).every((count) => count <= 2)).toBe(true);
    expect(flatTexts(latest)).toEqual(["namaste", "doston", "aaj", "hum", "sikhenge"]);
  });

  it("starts over for a new transcript", async () => {
    await act(async () => root.render(createElement(Harness, { source: hindi })));
    await act(async () => latest.setWordsPerCaption(3));
    await act(async () => latest.setScript("roman"));
    await act(async () => root.render(createElement(Harness, { source: hinglish })));
    expect(latest.words).toEqual(hinglish);
    expect(latest.wordsPerCaption).toBeUndefined();
    expect(latest.script).toBe("original");
    expect(latest.hasDevanagari).toBe(false);
    expect(latest.edited).toBe(false);
  });
});
