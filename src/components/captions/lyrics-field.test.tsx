import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionPipeline, CaptionResult } from "../../lib/captioning/contracts";
import type { Word } from "../../lib/captioning/types";
import type { CaptionRuntime } from "./runtime-types";
import { SettingsCard } from "./StageCards";
import { OutputBody } from "./OutputPanel";

// jsdom cannot decode video, and reading metadata would wait for its 8 s timeout.
vi.mock("../../lib/media", () => ({
  readVideoMeta: async () => ({ duration: 6, width: 1280, height: 720, hasVideo: true }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// jsdom has no layout observers; the preview only uses one to fit its caption text.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** React reads the value from the DOM node, so set it the way a browser does and fire the event React listens for. */
function type(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("no value setter");
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function settings(props: Partial<React.ComponentProps<typeof SettingsCard>> = {}) {
  return createElement(SettingsCard, {
    modelStatus: { state: "cached", totalBytes: 100 },
    modelLabel: "Draft",
    onRemoveModel: () => undefined,
    onStart: () => undefined,
    failure: null,
    cancelled: false,
    onRetry: () => undefined,
    durationSeconds: 10,
    testDouble: false,
    ...props,
  });
}

const stats: CaptionResult["stats"] = {
  audioSeconds: 10,
  speechSeconds: 9,
  windows: 1,
  flaggedWindows: 0,
  droppedWords: 0,
  stageMs: {},
  engineId: "e",
  alignerId: "a",
};

function word(index: number): Word {
  return { text: `w${index}`, startMs: index * 500, endMs: index * 500 + 400, confidence: 1, index, windowIndex: 0 };
}

function output(result: CaptionResult, extra: { onUseLyrics?: () => void; testDouble?: boolean } = {}) {
  return createElement(OutputBody, {
    phase: "done",
    hint: "",
    testDouble: extra.testDouble ?? false,
    file: new File(["x"], "clip.mp4", { type: "video/mp4" }),
    events: [],
    result,
    wordCount: result.words.length,
    edited: false,
    styleId: "clean",
    onStyle: () => undefined,
    highlightNumbers: true,
    onHighlightNumbers: () => undefined,
    burnIn: null,
    onSeek: () => undefined,
    onStartOver: () => undefined,
    onUseLyrics: extra.onUseLyrics,
    isVideo: true,
  });
}

describe("lyrics or script box", () => {
  it("is a collapsed, optional box after the names box", async () => {
    await act(async () => root.render(settings()));
    const boxes = [...container.querySelectorAll("details.cap-glossary")];
    expect(boxes).toHaveLength(2);
    expect(boxes[1].hasAttribute("open")).toBe(false);
    const summaries = boxes.map((box) => box.querySelector("summary")?.textContent ?? "");
    expect(summaries[0]).toContain("Names and special words");
    expect(summaries[1]).toContain("Lyrics or script (optional)");
    expect([...container.querySelectorAll(".cap-glossary > summary")].every((summary) => /\(optional\)/.test(summary.textContent ?? ""))).toBe(true);
  });

  it("labels the textarea and points it at the hint", async () => {
    await act(async () => root.render(settings()));
    const field = container.querySelector<HTMLTextAreaElement>("#cap-lyrics-input");
    expect(field).not.toBeNull();
    expect(field?.tagName).toBe("TEXTAREA");
    const label = container.querySelector('label[for="cap-lyrics-input"]');
    expect(label?.textContent?.trim()).toBe("Lyrics or script");
    const describedBy = field?.getAttribute("aria-describedby");
    expect(describedBy).toBe("cap-lyrics-hint");
    expect(container.querySelector(`#${describedBy}`)?.textContent).toMatch(/never uploaded/i);
  });

  it("keeps the hint's promises: timing from the words, text stays here, no line-break promise", async () => {
    await act(async () => root.render(settings()));
    const hint = container.querySelector("#cap-lyrics-hint")?.textContent ?? "";
    expect(hint).toMatch(/lines the words up with the audio/i);
    expect(hint).toMatch(/stays in this browser/i);
    // The layout does not take a preferred break, so the hint must not promise one.
    expect(hint).not.toMatch(/new line/i);
    expect(container.textContent).toMatch(/nothing in this box is uploaded or saved/i);
  });

  it("reports every keystroke and shows the value it is given", async () => {
    const onLyrics = vi.fn();
    await act(async () => root.render(settings({ onLyrics })));
    const field = container.querySelector<HTMLTextAreaElement>("#cap-lyrics-input");
    if (!field) throw new Error("no lyrics field");
    type(field, "first line\nsecond line");
    expect(onLyrics).toHaveBeenCalledTimes(1);
    expect(onLyrics).toHaveBeenLastCalledWith("first line\nsecond line");
  });

  it("is disabled while a job is busy", async () => {
    await act(async () => root.render(settings({ busy: true })));
    expect(container.querySelector<HTMLTextAreaElement>("#cap-lyrics-input")?.disabled).toBe(true);
    await act(async () => root.render(settings({ busy: false })));
    expect(container.querySelector<HTMLTextAreaElement>("#cap-lyrics-input")?.disabled).toBe(false);
  });

  it("says timing works best with High accuracy only when Draft is chosen", async () => {
    await act(async () => root.render(settings({ tier: "fast" })));
    expect(container.textContent).toMatch(/most precise with High accuracy/i);
    expect(container.textContent).toMatch(/may fall back to ordinary captioning/i);
    await act(async () => root.render(settings({ tier: "high" })));
    expect(container.textContent).not.toMatch(/most precise with High accuracy/i);
  });
});

describe("output panel: what happened to the visitor's words", () => {
  it("says how many words were placed and lists lines that were not found", async () => {
    await act(async () =>
      root.render(
        output({
          words: [],
          events: [],
          uncoveredSpeech: [],
          stats: { ...stats, lyrics: { lines: 2, placed: 7, uncertain: 0, unmatched: 3, unmatchedLines: ["wrong line one", "wrong line two"] } },
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Your words: 7 of 10 placed.");
    expect(text).toContain("These lines were not found in the audio: \u201cwrong line one\u201d, \u201cwrong line two\u201d");
    expect(text).toMatch(/left out rather than forced in/i);
  });

  it("shows at most five unmatched lines", async () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g"];
    await act(async () =>
      root.render(
        output({ words: [], events: [], uncoveredSpeech: [], stats: { ...stats, lyrics: { lines: 7, placed: 0, uncertain: 0, unmatched: 7, unmatchedLines: lines } } }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("\u201ce\u201d");
    expect(text).not.toContain("\u201cf\u201d");
    expect(text).toContain("and more");
  });

  it("adds nothing when the visitor pasted nothing, and keeps the inferred-words note", async () => {
    await act(async () => root.render(output({ words: [], events: [], uncoveredSpeech: [], stats: { ...stats, inferredWords: 4 } })));
    expect(container.textContent).not.toContain("Your words:");
    expect(container.textContent).toMatch(/filled in from a repeated section/i);
  });

  it("says the timing is approximate for words placed without checking each one", async () => {
    await act(async () =>
      root.render(
        output({
          words: [],
          events: [],
          uncoveredSpeech: [],
          stats: { ...stats, lyrics: { lines: 2, placed: 9, uncertain: 1, unmatched: 1, unmatchedLines: ["last line"], approximate: 6 } },
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Your words: 9 of 10 placed.");
    expect(text).toContain(
      "6 of these words were placed by working out where they fall in the song, not by checking each one against the audio, so treat their timing as approximate.",
    );
    // The existing sentences are still there and the approximate one comes after them.
    expect(text).toContain("1 word is marked uncertain");
    expect(text).toContain("These lines were not found in the audio: \u201clast line\u201d");
    expect(text.indexOf("marked uncertain")).toBeLessThan(text.indexOf("of these words were placed"));
    expect(text.indexOf("of these words were placed")).toBeLessThan(text.indexOf("These lines were not found"));
  });

  it("says nothing about approximate timing when no word was placed that way", async () => {
    for (const approximate of [0, undefined]) {
      await act(async () =>
        root.render(
          output({
            words: [],
            events: [],
            uncoveredSpeech: [],
            stats: { ...stats, lyrics: { lines: 1, placed: 4, uncertain: 0, unmatched: 0, unmatchedLines: [], approximate } },
          }),
        ),
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Your words: 4 of 4 placed.");
      expect(text).not.toMatch(/working out where they fall in the song/i);
      expect(text).not.toContain("undefined");
    }
  });

  it("explains that a tier without timing support leaves the words unused", async () => {
    await act(async () =>
      root.render(
        output({
          words: [],
          events: [],
          uncoveredSpeech: [],
          stats: {
            ...stats,
            lyrics: { lines: 2, placed: 0, uncertain: 0, unmatched: 11, unmatchedLines: [], unsupported: true, approximate: 0 },
          },
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Timing from your words needs High accuracy on this device, so these captions come from the audio alone. Your words were not used.");
    expect(text).not.toContain("Your words: 0 of 11 placed.");
    expect(text).not.toMatch(/working out where they fall in the song/i);
  });
});

describe("result panel: singing that could not be read", () => {
  const message = "Some singing could not be read. If you have the lyrics, paste them in the lyrics box and Cutmoor will fill them in.";

  it("offers the lyrics box when most of the voiced seconds have no words", async () => {
    const onUseLyrics = vi.fn();
    await act(async () =>
      root.render(
        output(
          { words: [word(0)], events: [], uncoveredSpeech: [{ startMs: 0, endMs: 7000 }], stats: { ...stats } },
          { onUseLyrics },
        ),
      ),
    );
    expect(container.textContent).toContain(message);
    const note = [...container.querySelectorAll<HTMLElement>("p.cap-note")].find((element) => element.textContent?.includes(message));
    // Ordinary static text, not a live region added together with its text.
    expect(note).not.toBeUndefined();
    expect(note?.hasAttribute("role")).toBe(false);
    expect(note?.hasAttribute("aria-live")).toBe(false);
    const action = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Use the lyrics box");
    expect(action).not.toBeUndefined();
    expect(action?.tagName).toBe("BUTTON");
    expect(action?.getAttribute("type")).toBe("button");
    await act(async () => action?.click());
    expect(onUseLyrics).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the words cover most of what was heard", async () => {
    await act(async () =>
      root.render(output({ words: [word(0), word(1)], events: [], uncoveredSpeech: [{ startMs: 0, endMs: 2000 }], stats: { ...stats } })),
    );
    expect(container.textContent).not.toContain("Some singing could not be read");
  });

  it("stays quiet when the visitor's lyrics were placed", async () => {
    await act(async () =>
      root.render(
        output({
          words: [word(0)],
          events: [],
          uncoveredSpeech: [{ startMs: 0, endMs: 8000 }],
          stats: { ...stats, lyrics: { lines: 1, placed: 4, uncertain: 0, unmatched: 0, unmatchedLines: [] } },
        }),
      ),
    );
    expect(container.textContent).not.toContain("Some singing could not be read");
  });

  it("stays quiet when pasted lyrics placed nothing", async () => {
    await act(async () =>
      root.render(
        output({
          words: [],
          events: [],
          uncoveredSpeech: [{ startMs: 0, endMs: 8000 }],
          stats: { ...stats, lyrics: { lines: 2, placed: 0, uncertain: 0, unmatched: 10, unmatchedLines: ["wrong line one", "wrong line two"] } },
        }),
      ),
    );
    // The panel already explains the paste failed; the nudge must not ask for the same box again.
    expect(container.textContent).not.toContain("Some singing could not be read");
    expect(container.textContent).toContain("Your words: 0 of 10 placed.");
  });

  it("never appears on the test double", async () => {
    await act(async () =>
      root.render(output({ words: [], events: [], uncoveredSpeech: [{ startMs: 0, endMs: 9000 }], stats: { ...stats } }, { testDouble: true })),
    );
    expect(container.textContent).not.toContain("Some singing could not be read");
  });

  it("returns to the settings card and puts the cursor in the lyrics box", async () => {
    const pipeline: CaptionPipeline = {
      run: async () => ({ words: [], events: [], uncoveredSpeech: [{ startMs: 0, endMs: 9000 }], stats: { ...stats } }),
      dispose: async () => undefined,
    };
    const runtime: CaptionRuntime = { pipeline, manifest: null, store: null, burnIn: null, label: "Test model" };
    const { AutoCaptionsTool } = await import("../../tools/AutoCaptionsTool");
    await act(async () => root.render(createElement(AutoCaptionsTool, { factory: () => runtime })));
    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const start = [...container.querySelectorAll("button")].find((button) => /generate captions/i.test(button.textContent ?? ""));
    if (!start) throw new Error("no start button");
    await act(async () => {
      start.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const nudge = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Use the lyrics box");
    if (!nudge) throw new Error("no lyrics nudge");
    await act(async () => nudge.click());

    const field = container.querySelector<HTMLTextAreaElement>("#cap-lyrics-input");
    expect(field).not.toBeNull();
    expect(field?.closest("details")?.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(container.querySelector(".settings-card")).not.toBeNull();
    expect(container.querySelector(".cap-stage-editor")).toBeNull();
    // The result is kept: the panel still reports it while the settings card is shown.
    expect(container.textContent).toContain("Captions ready");

    // A second click while the settings card is already shown must still bring the cursor back to the box.
    field?.blur();
    expect(document.activeElement).not.toBe(field);
    const again = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Use the lyrics box");
    if (!again) throw new Error("no lyrics nudge after the first click");
    await act(async () => again.click());
    expect(document.activeElement).toBe(container.querySelector("#cap-lyrics-input"));
  });
});

describe("the tool passes the pasted words to the pipeline", () => {
  it("sends the typed lyrics as the run's lyrics option", async () => {
    const calls: { lyrics?: string }[] = [];
    const pipeline: CaptionPipeline = {
      run: async (_file, options) => {
        calls.push({ lyrics: options.lyrics });
        return { words: [], events: [], uncoveredSpeech: [], stats: { ...stats } };
      },
      dispose: async () => undefined,
    };
    const runtime: CaptionRuntime = { pipeline, manifest: null, store: null, burnIn: null, label: "Test model" };
    const { AutoCaptionsTool } = await import("../../tools/AutoCaptionsTool");
    await act(async () => root.render(createElement(AutoCaptionsTool, { factory: () => runtime })));
    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const field = container.querySelector<HTMLTextAreaElement>("#cap-lyrics-input");
    if (!field) throw new Error("no lyrics field");
    type(field, "pehli line\ndusri line");

    const start = [...container.querySelectorAll("button")].find((button) => /generate captions/i.test(button.textContent ?? ""));
    if (!start) throw new Error("no start button");
    await act(async () => {
      start.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].lyrics).toBe("pehli line\ndusri line");
  });
});
