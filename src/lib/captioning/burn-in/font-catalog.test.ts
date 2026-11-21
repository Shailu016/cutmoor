// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CAPTION_FONTS, captionFontFor, fontFamilyFor, nearestFontWeight } from "./font-catalog";

const require = createRequire(import.meta.url);

describe("caption font catalog", () => {
  it("has 6-8 fonts with unique keys and labels", () => {
    expect(CAPTION_FONTS.length).toBeGreaterThanOrEqual(6);
    expect(CAPTION_FONTS.length).toBeLessThanOrEqual(8);
    expect(new Set(CAPTION_FONTS.map((font) => font.key)).size).toBe(CAPTION_FONTS.length);
    expect(new Set(CAPTION_FONTS.map((font) => font.label)).size).toBe(CAPTION_FONTS.length);
  });

  it("only names font packages that are installed, and every CSS file exists", () => {
    for (const font of CAPTION_FONTS) {
      expect(font.cssFiles.length, font.key).toBeGreaterThan(0);
      for (const file of font.cssFiles) {
        expect(file.startsWith("@fontsource"), `${font.key} ${file}`).toBe(true);
        // Resolving proves the package is in node_modules; reading proves the exact file name is right.
        expect(() => require.resolve(file), `${font.key} ${file}`).not.toThrow();
      }
      expect(font.weights.length, font.key).toBeGreaterThan(0);
      expect(font.family.length, font.key).toBeGreaterThan(0);
    }
  });

  it("covers the six packages asked for", () => {
    const keys = CAPTION_FONTS.map((font) => font.key);
    expect(keys).toEqual(["geist", "inter", "montserrat", "noto-sans-devanagari", "poppins", "bebas-neue"]);
    expect(captionFontFor("bebas-neue")?.family).toBe("Bebas Neue");
    expect(captionFontFor("poppins")?.weights).toEqual([400, 600, 700, 800]);
  });

  it("falls back to the preset family for absent and unknown keys", () => {
    expect(captionFontFor(undefined)).toBeNull();
    expect(captionFontFor("comic-sans")).toBeNull();
    expect(fontFamilyFor({ fontFamily: '"Geist Variable"', fontKey: "comic-sans" })).toBe('"Geist Variable"');
    expect(fontFamilyFor({ fontFamily: '"Geist Variable"' })).toBe('"Geist Variable"');
    expect(fontFamilyFor({ fontFamily: '"Geist Variable"', fontKey: "inter" })).toBe("Inter Variable");
  });

  it("snaps a wished weight to the nearest one the font ships, ties heavier", () => {
    expect(nearestFontWeight(650, [400, 600, 800])).toBe(600);
    expect(nearestFontWeight(700, [400, 600, 800])).toBe(800);
    expect(nearestFontWeight(800, [400])).toBe(400);
    expect(nearestFontWeight(500, [])).toBe(500);
  });
});
