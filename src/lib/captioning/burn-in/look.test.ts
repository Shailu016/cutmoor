import { describe, expect, it } from "vitest";
import type { CaptionStyle } from "../contracts";
import {
  MAX_SIZE_MUL,
  MIN_FONT_PX,
  MIN_SIZE_MUL,
  PRESET_PILL_COLOR,
  boxFor,
  colorWithAlpha,
  outlineFor,
  parseCssColor,
  resolvedFontPx,
  shadowFor,
  sizeMultiplier,
} from "./look";

const base: CaptionStyle = {
  id: "clean",
  fontFamily: '"Geist Variable"',
  fontScale: 0.05,
  textColor: "#ffffff",
  activeColor: "#ffd84a",
  background: "outline",
  position: "bottom",
};

describe("resolvedFontPx", () => {
  it("is exactly the old size when sizeMul is absent", () => {
    expect(resolvedFontPx({ fontScale: 0.05 }, 720)).toBe(36);
    expect(resolvedFontPx({ fontScale: 0.033 }, 1080)).toBe(36); // 35.64 rounds
    expect(resolvedFontPx({ fontScale: 0 }, 720)).toBe(36); // the old 0.05 fallback
    expect(resolvedFontPx({ fontScale: Number.NaN }, 720)).toBe(36);
    expect(resolvedFontPx({ fontScale: 0.0001 }, 100)).toBe(MIN_FONT_PX);
  });

  it("multiplies by sizeMul and clamps it to 0.5-2", () => {
    expect(resolvedFontPx({ fontScale: 0.05, sizeMul: 1.5 }, 720)).toBe(54);
    expect(resolvedFontPx({ fontScale: 0.05, sizeMul: 0.5 }, 720)).toBe(18);
    expect(resolvedFontPx({ fontScale: 0.05, sizeMul: 0.1 }, 720)).toBe(18);
    expect(resolvedFontPx({ fontScale: 0.05, sizeMul: 9 }, 720)).toBe(72);
    expect(resolvedFontPx({ fontScale: 0.05, sizeMul: Number.NaN }, 720)).toBe(36);
    expect(sizeMultiplier({ sizeMul: 0.1 })).toBe(MIN_SIZE_MUL);
    expect(sizeMultiplier({ sizeMul: 4 })).toBe(MAX_SIZE_MUL);
    expect(sizeMultiplier({})).toBe(1);
  });
});

describe("outlineFor", () => {
  it("keeps the preset 0.16 em black outline for an outline style with no custom fields", () => {
    expect(outlineFor(base, 40)).toEqual({ widthPx: 40 * 0.16, color: "#000000" });
  });

  it("has no outline for pill/none presets when the field is absent", () => {
    expect(outlineFor({ ...base, background: "pill" }, 40)).toBeNull();
    expect(outlineFor({ ...base, background: "none" }, 40)).toBeNull();
  });

  it("honours an explicit width and colour on any background, including 0 = none", () => {
    expect(outlineFor({ ...base, background: "pill", outlineWidth: 0.25, outlineColor: "#ff2d95" }, 40)).toEqual({
      widthPx: 10,
      color: "#ff2d95",
    });
    expect(outlineFor({ ...base, background: "outline", outlineWidth: 0 }, 40)).toBeNull();
    expect(outlineFor({ ...base, outlineWidth: -1 }, 40)).toBeNull();
    expect(outlineFor({ ...base, outlineWidth: Number.NaN }, 40)).toBeNull();
    expect(outlineFor({ ...base, outlineWidth: 4 }, 40)?.widthPx).toBe(40 * 0.5);
  });

  it("recolours the preset outline when only outlineColor is set", () => {
    expect(outlineFor({ ...base, outlineColor: "#00ff00" }, 40)).toEqual({ widthPx: 6.4, color: "#00ff00" });
    // A colour alone does not invent an outline on a pill.
    expect(outlineFor({ ...base, background: "pill", outlineColor: "#00ff00" }, 40)).toBeNull();
  });
});

describe("shadowFor", () => {
  it("keeps the old soft shadow for the none background and none for the others", () => {
    expect(shadowFor({ ...base, background: "none" }, 40)).toEqual({
      color: "rgba(0, 0, 0, 0.75)",
      blurPx: 40 * 0.18,
      offsetXPx: 0,
      offsetYPx: 40 * 0.05,
    });
    expect(shadowFor({ ...base, background: "pill" }, 40)).toBeNull();
    expect(shadowFor(base, 40)).toBeNull();
  });

  it("turns a custom shadow off at 0, and scales blur, offset and alpha with strength", () => {
    expect(shadowFor({ ...base, shadow: 0 }, 40)).toBeNull();
    expect(shadowFor({ ...base, background: "none", shadow: 0 }, 40)).toBeNull();
    const half = shadowFor({ ...base, shadow: 0.5, shadowColor: "#00e5ff" }, 40);
    expect(half).not.toBeNull();
    expect(half?.color).toBe("rgba(0, 229, 255, 0.4)");
    expect(half?.blurPx).toBeCloseTo(40 * 0.22 * 0.5, 9);
    expect(half?.offsetYPx).toBeCloseTo(40 * 0.06 * 0.5, 9);
    const full = shadowFor({ ...base, shadow: 2, shadowColor: "#000000" }, 40);
    expect(full?.color).toBe("rgba(0, 0, 0, 0.8)");
    expect(full?.blurPx).toBeCloseTo(40 * 0.22, 9);
  });
});

describe("boxFor", () => {
  it("keeps the exact old pill string when nothing custom is set", () => {
    expect(boxFor({ ...base, background: "pill" })).toEqual({ color: PRESET_PILL_COLOR });
    expect(boxFor(base)).toBeNull();
    expect(boxFor({ ...base, background: "none" })).toBeNull();
  });

  it("builds an rgba from boxColor and boxOpacity, on any background", () => {
    expect(boxFor({ ...base, boxOpacity: 1, boxColor: "#7a1fa2" })).toEqual({ color: "rgba(122, 31, 162, 1)" });
    expect(boxFor({ ...base, background: "none", boxOpacity: 0.5 })).toEqual({ color: "rgba(0, 0, 0, 0.5)" });
    expect(boxFor({ ...base, boxOpacity: 0 })).toBeNull();
    expect(boxFor({ ...base, boxOpacity: 2, boxColor: "#fff" })).toEqual({ color: "rgba(255, 255, 255, 1)" });
  });

  it("recolours the preset pill without changing its 0.66 alpha", () => {
    expect(boxFor({ ...base, background: "pill", boxColor: "#123456" })).toEqual({ color: "rgba(18, 52, 86, 0.66)" });
  });
});

describe("colour helpers", () => {
  it("parses hex, short hex, rgb() and rgba()", () => {
    expect(parseCssColor("#7a1fa2")).toEqual({ r: 122, g: 31, b: 162, a: 1 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(128 / 255, 6);
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseCssColor("nonsense")).toBeNull();
  });

  it("multiplies alpha and leaves unreadable colours untouched", () => {
    expect(colorWithAlpha("#000000", 0.66)).toBe("rgba(0, 0, 0, 0.66)");
    expect(colorWithAlpha("rgba(1, 2, 3, 0.5)", 0.5)).toBe("rgba(1, 2, 3, 0.25)");
    expect(colorWithAlpha("color(display-p3 1 0 0)", 0.5)).toBe("color(display-p3 1 0 0)");
  });
});
