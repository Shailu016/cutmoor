import { describe, expect, it } from "vitest";
import type { CaptionStyle } from "../contracts";
import type { CaptionEvent, Word } from "../types";
import { CAPTION_STYLES } from "./styles";
import { layoutEvent, type MeasureText } from "./renderer";
import {
  SAFE_MARGIN_X,
  anchorFromOrigin,
  bottomMargin,
  captionSafeArea,
  clampAnchor,
  effectiveAnchor,
  horizontalPad,
  lineLeft,
  nudgeAnchor,
  placeBlock,
} from "./position";

const style = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...CAPTION_STYLES.clean, ...over });

const word = (text: string, startMs: number, index: number): Word => ({ text, startMs, endMs: startMs + 280, confidence: 1, index, windowIndex: 0 });

function makeEvent(lines: string[][], startMs = 1000): CaptionEvent {
  let t = startMs;
  let i = 0;
  return {
    index: 0,
    startMs,
    endMs: startMs + 5000,
    lines: lines.map((line) => line.map((text) => word(text, (t += 300) - 300, i++))),
  };
}

const measure: MeasureText = (text, fontPx) => [...text].length * 0.55 * fontPx;

describe("captionSafeArea", () => {
  it("keeps 5% sides and the preset's bottom margin, mirrored at the top", () => {
    const landscape = captionSafeArea(1000, 500);
    expect(landscape.left).toBeCloseTo(50, 6);
    expect(landscape.right).toBeCloseTo(950, 6);
    expect(landscape.bottom).toBeCloseTo(500 - bottomMargin(1000, 500), 6);
    expect(landscape.top).toBeCloseTo(bottomMargin(1000, 500), 6);

    const portrait = captionSafeArea(500, 1000);
    expect(portrait.left).toBeCloseTo(25, 6);
    expect(portrait.top).toBeCloseTo(bottomMargin(500, 1000), 6);
    expect(portrait.bottom).toBeCloseTo(1000 - bottomMargin(500, 1000), 6);
  });

  it("is vertically symmetric, so anchor 0.5 is the true middle in both orientations", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1000, 500],
      [500, 1000],
    ]) {
      const safe = captionSafeArea(w, h);
      expect((safe.top + safe.bottom) / 2).toBeCloseTo(h / 2, 6);
      expect((safe.left + safe.right) / 2).toBeCloseTo(w / 2, 6);
      expect(w * SAFE_MARGIN_X).toBeCloseTo(safe.left, 6);
    }
  });
});

describe("effectiveAnchor and clampAnchor", () => {
  it("keeps the preset position when the anchors are absent", () => {
    expect(effectiveAnchor(style({ position: "bottom" }))).toEqual({ x: 0.5, y: 1 });
    expect(effectiveAnchor(style({ position: "middle" }))).toEqual({ x: 0.5, y: 0.5 });
  });

  it("uses explicit anchors and clamps them to 0..1", () => {
    expect(effectiveAnchor(style({ anchorX: 0.25, anchorY: 0.75 }))).toEqual({ x: 0.25, y: 0.75 });
    expect(effectiveAnchor(style({ anchorX: -2, anchorY: 9 }))).toEqual({ x: 0, y: 1 });
    expect(effectiveAnchor(style({ anchorX: Number.NaN, anchorY: Number.POSITIVE_INFINITY, position: "middle" }))).toEqual({ x: 0.5, y: 0.5 });
    expect(clampAnchor(0.4, 0.5)).toBe(0.4);
  });
});

describe("placeBlock", () => {
  const frame = { w: 1000, h: 500 };
  const block = { width: 400, height: 100 };

  it("reproduces the old bottom position exactly when anchorY is absent", () => {
    const rect = placeBlock(style({ position: "bottom" }), block, frame.w, frame.h);
    expect(rect.left).toBeCloseTo((frame.w - block.width) / 2, 6);
    expect(rect.left + rect.width).toBeCloseTo(700, 6);
    expect(rect.top + rect.height).toBeCloseTo(frame.h - bottomMargin(frame.w, frame.h), 6);
  });

  it("reproduces the old middle position exactly when position is middle", () => {
    const rect = placeBlock(style({ position: "middle" }), block, frame.w, frame.h);
    expect((rect.top + rect.top + rect.height) / 2).toBeCloseTo(frame.h / 2, 6);
  });

  it("maps 0 and 1 to the safe edges and 0.5 to the centre", () => {
    const safe = captionSafeArea(frame.w, frame.h);
    const topLeft = placeBlock(style({ anchorX: 0, anchorY: 0 }), block, frame.w, frame.h);
    expect(topLeft.left).toBeCloseTo(safe.left, 6);
    expect(topLeft.top).toBeCloseTo(safe.top, 6);

    const bottomRight = placeBlock(style({ anchorX: 1, anchorY: 1 }), block, frame.w, frame.h);
    expect(bottomRight.left + bottomRight.width).toBeCloseTo(safe.right, 6);
    expect(bottomRight.top + bottomRight.height).toBeCloseTo(safe.bottom, 6);

    const middle = placeBlock(style({ anchorX: 0.5, anchorY: 0.5 }), block, frame.w, frame.h);
    expect(middle.left + middle.width / 2).toBeCloseTo(frame.w / 2, 6);
    expect(middle.top + middle.height / 2).toBeCloseTo(frame.h / 2, 6);
  });

  it("never leaves the safe area when the block fits, for any anchor in range", () => {
    const safe = captionSafeArea(frame.w, frame.h);
    for (let ax = 0; ax <= 1.0001; ax += 0.1) {
      for (let ay = 0; ay <= 1.0001; ay += 0.1) {
        const rect = placeBlock(style({ anchorX: ax, anchorY: ay }), block, frame.w, frame.h);
        expect(rect.left).toBeGreaterThanOrEqual(safe.left - 1e-9);
        expect(rect.left + rect.width).toBeLessThanOrEqual(safe.right + 1e-9);
        expect(rect.top).toBeGreaterThanOrEqual(safe.top - 1e-9);
        expect(rect.top + rect.height).toBeLessThanOrEqual(safe.bottom + 1e-9);
      }
    }
  });

  it("clamps a block bigger than the safe area to its top-left instead of pushing it out", () => {
    const rect = placeBlock(style({ anchorX: 1, anchorY: 1 }), { width: 2000, height: 2000 }, frame.w, frame.h);
    expect(rect.left).toBeCloseTo(captionSafeArea(frame.w, frame.h).left, 6);
    expect(rect.top).toBeCloseTo(captionSafeArea(frame.w, frame.h).top, 6);
  });
});

describe("lineLeft", () => {
  const block = { left: 100, top: 0, width: 400, height: 100 };
  it("places lines on the left, in the middle and on the right of the content box", () => {
    expect(lineLeft(block, 200, 10, "left")).toBeCloseTo(110, 6);
    expect(lineLeft(block, 200, 10, "center")).toBeCloseTo(200, 6);
    expect(lineLeft(block, 200, 10, "right")).toBeCloseTo(290, 6);
    expect(lineLeft(block, 200, 10)).toBeCloseTo(200, 6); // default centred
  });

  it("keeps an over-wide line at the content's left edge rather than outside the block", () => {
    expect(lineLeft(block, 500, 10, "center")).toBeCloseTo(110, 6);
    expect(lineLeft(block, 500, 10, "right")).toBeCloseTo(110, 6);
  });
});

describe("anchorFromOrigin and nudgeAnchor", () => {
  it("is the inverse of placeBlock for a block that fits", () => {
    const frameW = 1280;
    const frameH = 720;
    const safe = captionSafeArea(frameW, frameH);
    const block = { width: 420, height: 130 };
    for (const [x, y] of [
      [0, 0],
      [0.3, 0.8],
      [0.5, 0.5],
      [1, 1],
    ]) {
      const rect = placeBlock(style({ anchorX: x, anchorY: y }), block, frameW, frameH);
      expect(anchorFromOrigin(rect.left, rect.top, safe, block)).toEqual({ x: expect.closeTo(x, 6), y: expect.closeTo(y, 6) });
    }
  });

  it("clamps a pointer drag to the safe area", () => {
    const safe = captionSafeArea(1000, 500);
    const block = { width: 400, height: 100 };
    expect(anchorFromOrigin(-500, -500, safe, block)).toEqual({ x: 0, y: 0 });
    expect(anchorFromOrigin(5000, 5000, safe, block)).toEqual({ x: 1, y: 1 });
  });

  it("nudges an anchor and keeps it in range", () => {
    expect(nudgeAnchor({ x: 0.5, y: 0.5 }, 0.01, -0.02)).toEqual({ x: expect.closeTo(0.51, 6), y: expect.closeTo(0.48, 6) });
    expect(nudgeAnchor({ x: 0.99, y: 0.02 }, 0.05, -0.05)).toEqual({ x: 1, y: 0 });
  });
});

describe("layoutEvent uses the shared position", () => {
  const cases: { id: string; style: CaptionStyle; event: CaptionEvent; w: number; h: number }[] = [];
  const event = makeEvent([["Hello", "world"], ["again"]]);
  const single = makeEvent([["Hi"]]);
  for (const preset of Object.values(CAPTION_STYLES)) {
    for (const [w, h] of [
      [1280, 720],
      [720, 1280],
    ]) {
      cases.push({ id: `${preset.id}-${w}`, style: preset, event, w, h });
    }
  }
  for (const align of ["left", "center", "right"] as const) {
    for (const [ax, ay] of [
      [0, 0],
      [0.25, 0.75],
      [0.5, 0.5],
      [0.5, 1],
      [1, 1],
    ]) {
      cases.push({ id: `${align}-${ax}-${ay}`, style: style({ anchorX: ax, anchorY: ay, align }), event, w: 1000, h: 500 });
    }
  }

  it("gives exactly the block rectangle that placeBlock computes, with a fake measure", () => {
    for (const item of cases) {
      const layout = layoutEvent(item.event, measure, item.style, item.w, item.h);
      const size = { width: layout.bounds.right - layout.bounds.left, height: layout.bounds.bottom - layout.bounds.top };
      const expected = placeBlock(item.style, size, item.w, item.h);
      const label = item.id;
      expect(layout.bounds.left, label).toBeCloseTo(expected.left, 6);
      expect(layout.bounds.top, label).toBeCloseTo(expected.top, 6);
      expect(layout.bounds.right, label).toBeCloseTo(expected.left + expected.width, 6);
      expect(layout.bounds.bottom, label).toBeCloseTo(expected.top + expected.height, 6);
    }
  });

  it("places each line with lineLeft and keeps every word in order", () => {
    for (const item of cases) {
      const layout = layoutEvent(item.event, measure, item.style, item.w, item.h);
      const rect = placeBlock(item.style, { width: layout.bounds.right - layout.bounds.left, height: layout.bounds.bottom - layout.bounds.top }, item.w, item.h);
      for (const line of layout.lines) {
        expect(line.x, item.id).toBeCloseTo(lineLeft(rect, line.width, layout.padX, item.style.align ?? "center"), 6);
        for (let i = 1; i < line.words.length; i += 1) {
          expect(line.words[i].x, item.id).toBeGreaterThan(line.words[i - 1].x + line.words[i - 1].width - 1e-6);
        }
      }
    }
  });

  it("keeps the preset look exactly: no anchors, centred, at the old bottom or middle", () => {
    const bottom = layoutEvent(event, measure, style({ position: "bottom" }), 1280, 720);
    expect(bottom.bounds.bottom).toBeCloseTo(720 - bottomMargin(1280, 720), 6);
    expect((bottom.bounds.left + bottom.bounds.right) / 2).toBeCloseTo(640, 6);

    const middle = layoutEvent(event, measure, style({ position: "middle" }), 1280, 720);
    expect((middle.bounds.top + middle.bounds.bottom) / 2).toBeCloseTo(360, 6);
  });

  it("moves the text within the same block when align changes", () => {
    const twoLines = makeEvent([["longword"], ["hi"]]);
    const left = layoutEvent(twoLines, measure, style({ anchorX: 0.5, align: "left", background: "none" }), 1000, 500);
    const right = layoutEvent(twoLines, measure, style({ anchorX: 0.5, align: "right", background: "none" }), 1000, 500);
    const width = (layout: typeof left) => layout.bounds.right - layout.bounds.left;
    expect(width(left)).toBeCloseTo(width(right), 6);
    expect(left.bounds.left).toBeCloseTo(right.bounds.left, 6);
    // The long line fills the block; the short line hugs the chosen side.
    for (const line of left.lines) expect(line.x).toBeCloseTo(left.bounds.left, 6);
    for (const line of right.lines) expect(line.x + line.width).toBeCloseTo(right.bounds.right, 6);
    expect(right.lines[1].x).toBeGreaterThan(right.lines[0].x);
  });

  it("accounts for pill and active-box padding in the block width", () => {
    const plain = layoutEvent(single, measure, style({ background: "none" }), 1000, 500);
    const pill = layoutEvent(single, measure, style({ background: "pill" }), 1000, 500);
    const font = plain.fontPx;
    expect(pill.padX).toBeCloseTo(horizontalPad(style({ background: "pill" }), font), 6);
    expect(pill.bounds.right - pill.bounds.left).toBeCloseTo(plain.bounds.right - plain.bounds.left + 2 * pill.padX, 6);
    expect(horizontalPad(style({ background: "none", activeBox: "#fff" }), font)).toBeCloseTo(font * 0.14, 6);
  });
});
