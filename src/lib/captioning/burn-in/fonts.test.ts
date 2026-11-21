// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FontFaceLike } from "./fonts";

const h = vi.hoisted(() => ({
  load: vi.fn(async () => undefined as void),
  queries: [] as string[],
  texts: [] as string[],
  declared: [] as string[],
}));

vi.mock("./font-catalog", () => ({
  captionFontFor: (key: string | undefined) =>
    key === "fake"
      ? { key: "fake", label: "Fake", family: "Fake Sans", weights: [400, 700], cssFiles: [], load: h.load }
      : null,
}));

const { loadCaptionFonts } = await import("./fonts");

const env = () => ({
  fonts: {
    add: (_face: FontFaceLike) => undefined,
    load: async (font: string, text?: string) => {
      h.queries.push(font);
      h.texts.push(text ?? "");
      return h.declared.some((family) => font.includes(`"${family}"`)) ? [{}] : [];
    },
    ready: Promise.resolve(),
  },
});

describe("loadCaptionFonts with a chosen bundled font", () => {
  it("imports the font CSS first, then waits for that family at the weights it ships", async () => {
    h.load.mockClear();
    h.queries.length = 0;
    h.declared = ["Fake Sans"];
    const report = await loadCaptionFonts({ fontKey: "fake", env: env() });
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.queries).toEqual([
      '400 32px "Fake Sans", "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Kohinoor Devanagari", "Devanagari Sangam MN", "Lohit Devanagari", sans-serif',
      '700 32px "Fake Sans", "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Kohinoor Devanagari", "Devanagari Sangam MN", "Lohit Devanagari", sans-serif',
    ]);
    expect(report).toEqual({ loaded: ["Fake Sans"], failed: [] });
  });

  it("asks the browser for the real caption text, so every script file of the font is loaded", async () => {
    h.load.mockClear();
    h.queries.length = 0;
    h.texts.length = 0;
    h.declared = ["Fake Sans"];
    await loadCaptionFonts({ fontKey: "fake", text: "Aaéन", env: env() });
    expect(h.texts.length).toBeGreaterThan(0);
    expect(h.texts.every((text) => text === "Aaéन")).toBe(true);
  });

  it("falls back to the Latin sample when no text is given", async () => {
    h.load.mockClear();
    h.queries.length = 0;
    h.texts.length = 0;
    h.declared = ["Fake Sans"];
    await loadCaptionFonts({ fontKey: "fake", env: env() });
    expect(h.texts.every((text) => text === "Aa")).toBe(true);
  });

  it("uses the site font unchanged for an unknown key", async () => {
    h.load.mockClear();
    h.queries.length = 0;
    h.declared = ["Geist Variable"];
    const report = await loadCaptionFonts({ fontKey: "nope", env: env() });
    expect(h.load).not.toHaveBeenCalled();
    expect(h.queries.every((query) => query.includes('"Geist Variable"'))).toBe(true);
    expect(report.loaded).toEqual(["Geist Variable"]);
  });

  it("reports a failed import but still lets drawing continue with fallbacks", async () => {
    h.load.mockReset();
    h.load.mockRejectedValue(new Error("chunk failed"));
    h.queries.length = 0;
    h.declared = [];
    const report = await loadCaptionFonts({ fontKey: "fake", env: env() });
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].family).toBe("Fake Sans");
    expect(report.failed[0].reason).toContain("chunk failed");
  });
});
