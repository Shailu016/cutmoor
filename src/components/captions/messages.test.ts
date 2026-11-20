import { describe, expect, it } from "vitest";
import { CaptionError, type CaptionErrorCode, type PipelineProgress } from "../../lib/captioning/contracts";
import { ModelLoadError } from "../../lib/captioning/model-loader";
import { CAPTION_STYLES, CAPTION_STYLE_LABELS, CAPTION_STYLE_ORDER } from "./styles";
import { describeCaptionError, describeProgress, ERROR_COPY, monotonicProgress, toCaptionError } from "./messages";

const ALL_CODES: CaptionErrorCode[] = [
  "aborted",
  "unsupported-file",
  "no-audio",
  "no-speech",
  "model-download",
  "model-load",
  "device-lost",
  "interrupted",
  "inference",
  "export",
  "internal",
];

describe("error copy", () => {
  it("has plain words for every error code, with no raw jargon", () => {
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ALL_CODES].sort());
    for (const code of ALL_CODES) {
      const copy = describeCaptionError(new CaptionError(code, "internal detail that must not be shown"));
      expect(copy.title.length, code).toBeGreaterThan(8);
      expect(copy.detail.length, code).toBeGreaterThan(40);
      expect(`${copy.title} ${copy.detail}`, code).not.toMatch(/undefined|\[object|Error:|ONNX|WebGPU|stack|exception/i);
      expect(`${copy.title} ${copy.detail}`, code).not.toContain("internal detail");
    }
  });

  it("only offers retry where trying again can help", () => {
    expect(ERROR_COPY["no-audio"].canRetry).toBe(false);
    expect(ERROR_COPY["no-speech"].canRetry).toBe(false);
    expect(ERROR_COPY["unsupported-file"].canRetry).toBe(false);
    expect(ERROR_COPY["model-download"].canRetry).toBe(true);
  });

  it("explains an interrupted job honestly: not the visitor's stop, nothing saved, retry helps", () => {
    const copy = describeCaptionError(new CaptionError("interrupted", "raw"));
    expect(copy.title).toBe("The browser stopped the speech model");
    expect(copy.detail).toMatch(/not your stop/i);
    expect(copy.detail).toMatch(/nothing was saved/i);
    expect(copy.detail).toMatch(/still loaded/i);
    expect(copy.detail).toMatch(/again/i);
    expect(copy.canRetry).toBe(true);
  });
});

describe("toCaptionError", () => {
  it("passes CaptionError through untouched", () => {
    const error = new CaptionError("no-audio", "x");
    expect(toCaptionError(error)).toBe(error);
  });

  it("maps model loader failures to model-download, and its cancel to aborted", () => {
    expect(toCaptionError(new ModelLoadError("integrity", "bad hash")).code).toBe("model-download");
    expect(toCaptionError(new ModelLoadError("network", "down")).code).toBe("model-download");
    expect(toCaptionError(new ModelLoadError("aborted", "stop")).code).toBe("aborted");
  });

  it("treats any error after our signal fired as the visitor's cancel", () => {
    const controller = new AbortController();
    controller.abort();
    expect(toCaptionError(new DOMException("x", "AbortError"), controller.signal).code).toBe("aborted");
    expect(toCaptionError(new Error("whatever the engine threw"), controller.signal).code).toBe("aborted");
  });

  it("calls a browser AbortError with a live signal an interruption, not a cancel", () => {
    const controller = new AbortController();
    const error = toCaptionError(new DOMException("stopped by the browser", "AbortError"), controller.signal);
    expect(error.code).toBe("interrupted");
    expect(error.message).toMatch(/browser stopped the speech model/i);
    // No signal at all: nothing says the visitor asked, so it still is not a cancel.
    expect(toCaptionError(new DOMException("x", "AbortError")).code).toBe("interrupted");
  });

  it("recognises a browser AbortError the pipeline wrapped as an inference failure", () => {
    const controller = new AbortController();
    const cause = new DOMException("GPU reset", "AbortError");
    const wrapped = new CaptionError("inference", "The model failed", { cause });
    expect(toCaptionError(wrapped, controller.signal).code).toBe("interrupted");
    // Nested one level deeper, as a wrapped engine error can be.
    const nested = new CaptionError("inference", "The model failed", { cause: new CaptionError("inference", "inner", { cause }) });
    expect(toCaptionError(nested, controller.signal).code).toBe("interrupted");
  });

  it("recognises the abort shapes ORT-web uses when the name is not AbortError", () => {
    const controller = new AbortController();
    // A device loss after a GPU reset: ORT-web throws a plain Error, not a DOMException.
    expect(toCaptionError(new Error("Aborted"), controller.signal).code).toBe("interrupted");
    // The same case wrapped by the pipeline, as the engine reports it.
    const wrapped = new CaptionError("inference", "The model failed", { cause: new Error("Aborted") });
    expect(toCaptionError(wrapped, controller.signal).code).toBe("interrupted");
    // DOMException.ABORT_ERR (20), which some builds carry on a plain object instead of the name.
    expect(toCaptionError({ code: 20 }, controller.signal).code).toBe("interrupted");
    expect(toCaptionError(new CaptionError("inference", "The model failed", { cause: { code: 20 } }), controller.signal).code).toBe("interrupted");
    // A live signal only: the visitor's own stop still wins and stays the "Stopped" path.
    expect(toCaptionError(new Error("Aborted"), controller.signal).code).not.toBe("aborted");
    controller.abort();
    expect(toCaptionError(new Error("Aborted"), controller.signal).code).toBe("aborted");
    expect(toCaptionError({ code: 20 }, controller.signal).code).toBe("aborted");
  });

  it("leaves a genuine inference failure as a failure and does not invent an interruption", () => {
    const controller = new AbortController();
    const wrapped = new CaptionError("inference", "The model failed", { cause: new TypeError("bad tensor") });
    expect(toCaptionError(wrapped, controller.signal).code).toBe("inference");
    // A normal Error never becomes an interruption, whatever its code.
    expect(toCaptionError(new Error("bad tensor")).code).toBe("internal");
    expect(toCaptionError({ code: 21, message: "device lost" }).code).toBe("internal");
  });

  it("wraps unknown errors as internal and keeps the cause", () => {
    const cause = new TypeError("boom");
    const error = toCaptionError(cause);
    expect(error.code).toBe("internal");
    expect(error.cause).toBe(cause);
    expect(toCaptionError("a string").code).toBe("internal");
  });
});

describe("progress", () => {
  const base: PipelineProgress = { stage: "transcribing", fraction: 0.4, message: "Transcribing 2 of 5" };

  it("shows the pipeline's own message and a whole-number percentage", () => {
    expect(describeProgress(base)).toEqual({ label: "Transcribing 2 of 5", percent: 40, detail: null });
  });

  it("clamps nonsense fractions", () => {
    expect(describeProgress({ ...base, fraction: 7 }).percent).toBe(100);
    expect(describeProgress({ ...base, fraction: -1 }).percent).toBe(0);
    expect(describeProgress({ ...base, fraction: Number.NaN }).percent).toBe(0);
  });

  it("describes a download with real byte counts", () => {
    const view = describeProgress({
      stage: "loading-model",
      fraction: 0.2,
      message: "Loading the model",
      download: { file: "enc", loadedBytes: 50 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 },
    });
    expect(view.label).toMatch(/Downloading the speech model/);
    expect(view.detail).toBe("50.0 MB of 200.0 MB");
  });

  it("stops talking about a download once every byte has arrived", () => {
    const view = describeProgress({
      stage: "loading-model",
      fraction: 0.3,
      message: "Starting the model",
      download: { file: "enc", loadedBytes: 100, totalBytes: 100 },
    });
    expect(view.label).toBe("Starting the speech model on your device");
    expect(view.detail).toMatch(/nothing is stuck/i);
  });

  it("never lets progress go backwards", () => {
    expect(monotonicProgress(0.6, base).fraction).toBe(0.6);
    expect(monotonicProgress(0.2, base)).toBe(base);
    expect(monotonicProgress(0, { ...base, fraction: Number.NaN }).fraction).toBe(0);
    expect(monotonicProgress(0.5, { ...base, fraction: 3 }).fraction).toBe(1);
  });
});

describe("caption styles", () => {
  function luminance(hex: string): number {
    const channel = (offset: number) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  }
  const contrastOnBlack = (hex: string) => (luminance(hex) + 0.05) / 0.05;
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("lists every style from the contract once, each with a label", () => {
    expect(CAPTION_STYLE_ORDER).toEqual(["clean", "shorts", "bold", "karaoke", "highlighter", "pop"]);
    expect(new Set(CAPTION_STYLE_ORDER).size).toBe(Object.keys(CAPTION_STYLES).length);
    for (const id of CAPTION_STYLE_ORDER) {
      expect(CAPTION_STYLES[id].id).toBe(id);
      expect(CAPTION_STYLE_LABELS[id].name.length).toBeGreaterThan(0);
    }
  });

  it("keeps text readable on a dark outline or pill, and the active word visibly different", () => {
    for (const style of Object.values(CAPTION_STYLES)) {
      expect(style.fontScale, style.id).toBeGreaterThan(0.02);
      expect(style.fontScale, style.id).toBeLessThan(0.12);
      expect(contrastOnBlack(style.textColor), style.id).toBeGreaterThanOrEqual(7);
      if (style.activeBox) {
        // The spoken word sits on its own box: it must read on that box, and the box on the picture.
        expect(contrast(style.activeColor, style.activeBox), style.id).toBeGreaterThanOrEqual(7);
        expect(contrastOnBlack(style.activeBox), style.id).toBeGreaterThanOrEqual(7);
      } else {
        expect(contrastOnBlack(style.activeColor), style.id).toBeGreaterThanOrEqual(7);
      }
      if (style.upcomingColor) expect(contrastOnBlack(style.upcomingColor), style.id).toBeGreaterThanOrEqual(4.5);
      // Every style colours numbers, and never in the spoken word's colour (unless that word has its own box).
      expect(style.numberColor, style.id).toBeTruthy();
      expect(contrastOnBlack(style.numberColor ?? ""), style.id).toBeGreaterThanOrEqual(7);
      if (!style.activeBox) expect(style.numberColor?.toLowerCase(), style.id).not.toBe(style.activeColor.toLowerCase());
      // Something visibly changes as words are said: the spoken word's colour, a box, or dimmed words to come.
      const changes = style.activeColor.toLowerCase() !== style.textColor.toLowerCase() || Boolean(style.activeBox) || Boolean(style.upcomingColor);
      expect(changes, style.id).toBe(true);
      expect(style.background).not.toBe("none"); // no style leaves text bare on a busy picture
    }
  });
});
