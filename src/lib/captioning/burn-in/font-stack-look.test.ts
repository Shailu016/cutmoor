import { describe, expect, it } from "vitest";
import { cssFont, cssFontFamily, resolvedFontWeight } from "./font-stack";

describe("font stack with a chosen font", () => {
  it("is unchanged without a fontKey", () => {
    const plain = { id: "clean" as const, fontFamily: '"Geist Variable"', fontWeight: 700 };
    expect(cssFont(plain, 40)).toBe('700 40px "Geist Variable", "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Kohinoor Devanagari", "Devanagari Sangam MN", "Lohit Devanagari", sans-serif');
    expect(cssFontFamily(plain)).toBe('"Geist Variable"');
    expect(resolvedFontWeight(plain)).toBe(700);
  });

  it("puts the chosen family first and keeps the Devanagari fallbacks", () => {
    const stack = cssFont({ id: "clean", fontFamily: '"Geist Variable"', fontKey: "montserrat" }, 36);
    expect(stack).toMatch(/^600 36px "Montserrat Variable", "Noto Sans Devanagari", .*sans-serif$/);
  });

  it("snaps the weight to one the chosen font ships", () => {
    expect(resolvedFontWeight({ id: "bold", fontKey: "bebas-neue" })).toBe(400);
    expect(resolvedFontWeight({ id: "clean", fontWeight: 640, fontKey: "poppins" })).toBe(600);
    expect(resolvedFontWeight({ id: "bold", fontKey: "poppins" })).toBe(800);
  });

  it("falls back to the preset family for an unknown key", () => {
    expect(cssFont({ id: "clean", fontFamily: '"Geist Variable"', fontKey: "nope" }, 40)).toMatch(/^600 40px "Geist Variable", /);
  });
});
