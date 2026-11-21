import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import type { CaptionEvent } from "../../lib/captioning/types";
import { CAPTION_STYLES } from "./styles";
import { KaraokePreview } from "./KaraokePreview";

vi.mock("../../lib/captioning/burn-in/font-catalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/captioning/burn-in/font-catalog")>();
  return { ...real, preloadCaptionFont: vi.fn(async () => true) };
});

vi.mock("./find-active", async (importOriginal) => {
  const real = await importOriginal<typeof import("./find-active")>();
  return { ...real, fitRect: () => ({ x: 0, y: 0, width: 640, height: 360 }) };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });

// jsdom has no canvas. The preview measures text on one (same as the burned-in renderer), so give it a
// fake whose width depends on the font size in the `font` string, like the renderer tests do.
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = {
    font: "",
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: [...text].length * 0.55 * px };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

const event: CaptionEvent = {
  index: 0,
  startMs: 0,
  endMs: 2000,
  lines: [
    [
      { text: "custom", startMs: 0, endMs: 400, confidence: 1, index: 0, windowIndex: 0 },
      { text: "look", startMs: 400, endMs: 800, confidence: 1, index: 1, windowIndex: 0 },
    ],
  ],
};

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

async function render(style: CaptionStyle) {
  await act(async () => {
    root.render(
      createElement(KaraokePreview, {
        url: null,
        fileName: null,
        events: [event],
        position: { event: 0, line: 0, word: 0 },
        style,
        videoRef: () => undefined,
        badge: null,
      }),
    );
  });
  const block = container.querySelector<HTMLElement>(".cap-block");
  if (!block) throw new Error("no caption block");
  return block;
}

describe("KaraokePreview custom look", () => {
  it("keeps the preset CSS path when no custom field is set", async () => {
    const style = CAPTION_STYLES.clean;
    const block = await render(style);
    expect(block.style.fontFamily).toBe(style.fontFamily);
    expect(block.style.fontWeight).toBe("600");
    expect(block.style.fontSize).toBe("18px"); // 360 * 0.05
    // The block never paints a box itself, and an outline preset has no box at all.
    expect(block.style.background).toBe("transparent");
    expect(container.querySelectorAll(".cap-line-box")).toHaveLength(0);
    expect(block.style.textShadow).toBe("");
    expect(block.style.webkitTextStrokeWidth).toBe("");
    expect(block.className).toContain("cap-bg-outline");
  });

  it("applies font, size, outline, shadow, box, colours and capitals", async () => {
    const block = await render({
      ...CAPTION_STYLES.clean,
      fontKey: "inter",
      sizeMul: 1.5,
      outlineWidth: 0.3,
      outlineColor: "#ff2d95",
      shadow: 0.5,
      shadowColor: "#00e5ff",
      boxOpacity: 0.5,
      boxColor: "#7a1fa2",
      uppercase: true,
    });
    expect(block.style.fontFamily).toContain('"Inter Variable"');
    expect(block.style.fontSize).toBe("27px");
    expect(block.style.webkitTextStrokeWidth).toBe("8.1px");
    expect(block.style.webkitTextStrokeColor).toBe("rgb(255, 45, 149)");
    expect(block.style.textShadow).toContain("rgba(0, 229, 255, 0.4)");
    // The custom box is one rounded box per line, hugging the row, not one block-wide background.
    expect(block.style.background).toBe("transparent");
    const lineBox = container.querySelector<HTMLElement>(".cap-line-box");
    expect(lineBox?.style.background).toBe("rgba(122, 31, 162, 0.5)");
    expect(lineBox?.style.top).toBe("0px");
    expect(lineBox?.style.bottom).toBe("0px");
    expect(block.textContent).toBe("CUSTOMLOOK");
  });

  it("outlineWidth 0 turns the preset stroke off in the preview too", async () => {
    const block = await render({ ...CAPTION_STYLES.clean, outlineWidth: 0 });
    expect(block.style.webkitTextStrokeWidth).toBe("0px");
  });

  it("draws the preset pill behind each line, exactly as the export does", async () => {
    // "Bold" is the dark-pill preset.
    await render(CAPTION_STYLES.bold);
    const boxes = container.querySelectorAll<HTMLElement>(".cap-line-box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].style.background).toBe("rgba(0, 0, 0, 0.66)");
    // The preset pill keeps its taller inset look: 4% of the row at the top and bottom.
    expect(boxes[0].style.top).not.toBe("0px");
  });

  it("boxOpacity 0 hides the preset pill but keeps the text", async () => {
    const block = await render({ ...CAPTION_STYLES.bold, boxOpacity: 0 });
    expect(block.style.background).toBe("transparent");
    expect(container.querySelectorAll(".cap-line-box")).toHaveLength(0);
    expect(block.textContent).toBe("customlook");
  });

  it("draws one box per line, so two lines of different lengths do not share a block-wide rectangle", async () => {
    const twoLines: CaptionEvent = {
      index: 0,
      startMs: 0,
      endMs: 2000,
      lines: [
        [{ text: "a", startMs: 0, endMs: 400, confidence: 1, index: 0, windowIndex: 0 }],
        [{ text: "much-longer-second-line", startMs: 400, endMs: 900, confidence: 1, index: 1, windowIndex: 0 }],
      ],
    };
    await act(async () => {
      root.render(
        createElement(KaraokePreview, {
          url: null,
          fileName: null,
          events: [twoLines],
          position: { event: 0, line: 0, word: 0 },
          style: CAPTION_STYLES.bold,
          videoRef: () => undefined,
          badge: null,
        }),
      );
    });
    expect(container.querySelectorAll(".cap-line-box")).toHaveLength(2);
  });

  it("gives an outline preset no box", async () => {
    await render(CAPTION_STYLES.shorts);
    expect(container.querySelectorAll(".cap-line-box")).toHaveLength(0);
  });
});
