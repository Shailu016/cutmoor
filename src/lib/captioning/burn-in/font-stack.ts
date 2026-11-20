/**
 * Pure helpers that turn a style's font family into a full CSS font stack.
 *
 * Why a stack and not just the family: Geist (the site font) has no Devanagari glyphs. A canvas
 * falls back glyph by glyph through the list, so putting Devanagari-capable system fonts after it
 * means Hindi words render properly instead of as empty boxes. We ship no font files for this: each
 * OS already has one (Nirmala UI on Windows, Noto Sans Devanagari on Android and Linux, the Apple
 * Devanagari fonts on macOS and iOS).
 */

import type { CaptionStyle } from "../contracts";

/** System fonts that carry Devanagari, then a generic family so something always matches. */
export const DEVANAGARI_FALLBACKS: readonly string[] = [
  '"Noto Sans Devanagari"',
  '"Nirmala UI"',
  '"Mangal"',
  '"Kohinoor Devanagari"',
  '"Devanagari Sangam MN"',
  '"Lohit Devanagari"',
];

export const GENERIC_FALLBACK = "sans-serif";

/**
 * Splits "A, 'B C', D" into its families, respecting quotes, and drops empties. A style author may
 * pass a single family or a whole stack; both must work.
 */
function splitFamilies(list: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of list) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((f) => f.trim()).filter((f) => f.length > 0);
}

/** Quotes a family name unless it is already quoted or is a generic keyword. */
function quoteFamily(family: string): string {
  if (family.startsWith('"') || family.startsWith("'")) return family;
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(family)) {
    return family;
  }
  // A name holding a quote or backslash could break out of the quotes; drop those characters
  // rather than guess what was meant.
  return `"${family.replace(/["'\\]/g, "")}"`;
}

/**
 * The font stack used for drawing: the style's own families first, then the Devanagari fallbacks,
 * then a generic family. Duplicates are removed (case-insensitive) so the string stays short.
 */
export function buildFontStack(fontFamily: string): string {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (family: string) => {
    const quoted = quoteFamily(family);
    const key = quoted.replace(/["']/g, "").toLowerCase();
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    result.push(quoted);
  };
  for (const family of splitFamilies(fontFamily)) add(family);
  for (const family of DEVANAGARI_FALLBACKS) add(family);
  add(GENERIC_FALLBACK);
  return result.join(", ");
}

/** Heavier presets get heavier weights; the variable Geist font supports all of them. */
export function fontWeightFor(style: Pick<CaptionStyle, "id" | "fontWeight">): number {
  if (typeof style.fontWeight === "number" && style.fontWeight >= 100 && style.fontWeight <= 900) return style.fontWeight;
  switch (style.id) {
    case "bold":
      return 800;
    case "shorts":
      return 700;
    default:
      return 600;
  }
}

/** The CSS `font` shorthand for a pixel size. */
export function cssFont(style: Pick<CaptionStyle, "id" | "fontFamily" | "fontWeight">, fontPx: number): string {
  return `${fontWeightFor(style)} ${fontPx}px ${buildFontStack(style.fontFamily)}`;
}
