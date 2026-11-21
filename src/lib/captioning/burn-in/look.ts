import type { CaptionStyle } from "../contracts";

/**
 * The pure maths of a custom caption look: font size, outline, shadow and box, resolved from the
 * optional `CaptionStyle` fields. Both renderers use these functions, so the live HTML preview and
 * the burned-in canvas cannot disagree about a number.
 *
 * The rule that matters most: when a field is absent, the numbers are exactly the ones the presets
 * used before custom looks existed. Every preset-without-custom-fields path below returns the old
 * literal (0.16 outline, rgba(0,0,0,0.66) pill, 0.18 em shadow blur, ...), never a recomputation.
 */

/** Below this the text is unreadable anyway; stop shrinking. */
export const MIN_FONT_PX = 6;

/** A missing or invalid `fontScale` has always meant this fraction of the frame height. */
export const DEFAULT_FONT_SCALE = 0.05;

export const MIN_SIZE_MUL = 0.5;
export const MAX_SIZE_MUL = 2;

/** The preset outline: 0.16 of the font size, black. */
export const PRESET_OUTLINE_WIDTH = 0.16;
export const PRESET_OUTLINE_COLOR = "#000000";
/** An explicit outline wider than half the font size would swallow the letters. */
const MAX_OUTLINE_WIDTH = 0.5;

/** The preset pill. Kept as the exact string the old renderer wrote. */
export const PRESET_PILL_COLOR = "rgba(0, 0, 0, 0.66)";
export const PRESET_PILL_ALPHA = 0.66;

export const DEFAULT_OUTLINE_COLOR = "#000000";
export const DEFAULT_SHADOW_COLOR = "#000000";
export const DEFAULT_BOX_COLOR = "#000000";

/** Strength at which the custom shadow is fully "on" (alpha 0.8, 0.22 em blur). */
const SHADOW_ALPHA_AT_FULL = 0.8;
const SHADOW_BLUR_AT_FULL = 0.22;
const SHADOW_OFFSET_Y_AT_FULL = 0.06;

/** How far a custom box reaches past the text on each side, as a fraction of the font size. */
export const CUSTOM_BOX_PAD = 0.3;

/** The old soft shadow used by the "none" background. */
export const PRESET_SOFT_SHADOW = {
  color: "rgba(0, 0, 0, 0.75)",
  blurEm: 0.18,
  offsetYEm: 0.05,
} as const;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const NAMED: Readonly<Record<string, Rgba>> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseChannel(text: string): number | null {
  const value = text.trim();
  if (value.endsWith("%")) {
    const percent = Number(value.slice(0, -1));
    return Number.isFinite(percent) ? byte((percent / 100) * 255) : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? byte(number) : null;
}

/**
 * Reads the colour formats the app itself produces (hex, rgb(), rgba(), a few names). Anything
 * else returns null; callers then keep the colour untouched instead of turning it into black.
 */
export function parseCssColor(color: string): Rgba | null {
  const text = color.trim().toLowerCase();
  const named = NAMED[text];
  if (named) return { ...named };

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[1].split(/[,/]/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length < 3 || parts.length > 4) return null;
  const r = parseChannel(parts[0]);
  const g = parseChannel(parts[1]);
  const b = parseChannel(parts[2]);
  if (r === null || g === null || b === null) return null;
  let a = 1;
  if (parts.length === 4) {
    const raw = parts[3];
    const value = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (!Number.isFinite(value)) return null;
    a = Math.min(1, Math.max(0, value));
  }
  return { r, g, b, a };
}

/**
 * The same colour with its alpha multiplied by `alpha`. Unreadable colour strings are returned
 * unchanged: a browser may still understand them, and black would be a worse guess.
 */
export function colorWithAlpha(color: string, alpha: number): string {
  const rgba = parseCssColor(color);
  const factor = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  if (!rgba) return color;
  const a = Math.round(rgba.a * factor * 1000) / 1000;
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${a})`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The size multiplier, clamped. Absent or nonsensical means 1 (the preset size). */
export function sizeMultiplier(style: Pick<CaptionStyle, "sizeMul">): number {
  if (style.sizeMul === undefined || !Number.isFinite(style.sizeMul)) return 1;
  return Math.min(MAX_SIZE_MUL, Math.max(MIN_SIZE_MUL, style.sizeMul));
}

/** The font size in pixels, before the layout shrinks it to fit. Absent custom fields = old maths. */
export function resolvedFontPx(style: Pick<CaptionStyle, "fontScale" | "sizeMul">, frameHeight: number): number {
  const scale = Number.isFinite(style.fontScale) && style.fontScale > 0 ? style.fontScale : DEFAULT_FONT_SCALE;
  return Math.max(MIN_FONT_PX, Math.round(scale * sizeMultiplier(style) * frameHeight));
}

export interface ResolvedOutline {
  widthPx: number;
  color: string;
}

/**
 * The text outline: an explicit width (0 = none) wins; otherwise the preset's outline applies only
 * to the "outline" background. An explicit colour alone recolours that preset outline.
 */
export function outlineFor(style: Pick<CaptionStyle, "background" | "outlineWidth" | "outlineColor">, fontPx: number): ResolvedOutline | null {
  if (style.outlineWidth !== undefined) {
    if (!Number.isFinite(style.outlineWidth)) return null;
    const width = Math.min(MAX_OUTLINE_WIDTH, Math.max(0, style.outlineWidth));
    if (width === 0) return null;
    return { widthPx: fontPx * width, color: style.outlineColor ?? DEFAULT_OUTLINE_COLOR };
  }
  if (style.background === "outline") {
    return { widthPx: fontPx * PRESET_OUTLINE_WIDTH, color: style.outlineColor ?? PRESET_OUTLINE_COLOR };
  }
  return null;
}

export interface ResolvedShadow {
  color: string;
  blurPx: number;
  offsetXPx: number;
  offsetYPx: number;
}

/**
 * The text shadow. Explicit strength 0 switches every shadow off (including the preset soft one);
 * explicit strength scales blur, offset and alpha together. With no strength field, the old
 * "none" background keeps its soft shadow and every other background keeps none.
 */
export function shadowFor(style: Pick<CaptionStyle, "background" | "shadow" | "shadowColor">, fontPx: number): ResolvedShadow | null {
  if (style.shadow !== undefined) {
    if (!Number.isFinite(style.shadow)) {
      // A broken value behaves like an absent one; fall through to the preset rule below.
    } else {
      const strength = clamp01(style.shadow);
      if (strength === 0) return null;
      return {
        color: colorWithAlpha(style.shadowColor ?? DEFAULT_SHADOW_COLOR, SHADOW_ALPHA_AT_FULL * strength),
        blurPx: fontPx * SHADOW_BLUR_AT_FULL * strength,
        offsetXPx: 0,
        offsetYPx: fontPx * SHADOW_OFFSET_Y_AT_FULL * strength,
      };
    }
  }
  if (style.background === "none") {
    return {
      color: PRESET_SOFT_SHADOW.color,
      blurPx: fontPx * PRESET_SOFT_SHADOW.blurEm,
      offsetXPx: 0,
      offsetYPx: fontPx * PRESET_SOFT_SHADOW.offsetYEm,
    };
  }
  return null;
}

export interface ResolvedBox {
  /** An rgba() string ready for canvas `fillStyle` and CSS `background`. */
  color: string;
}

/**
 * The box behind the text. An explicit opacity wins (0 = no box); without it the preset pill shows
 * at the old 0.66 black, and a `boxColor` only recolours that pill. Other backgrounds have no box
 * until an opacity asks for one.
 */
export function boxFor(style: Pick<CaptionStyle, "background" | "boxOpacity" | "boxColor">): ResolvedBox | null {
  if (style.boxOpacity !== undefined && Number.isFinite(style.boxOpacity)) {
    const opacity = clamp01(style.boxOpacity);
    if (opacity === 0) return null;
    return { color: colorWithAlpha(style.boxColor ?? DEFAULT_BOX_COLOR, opacity) };
  }
  if (style.background === "pill") {
    return { color: style.boxColor ? colorWithAlpha(style.boxColor, PRESET_PILL_ALPHA) : PRESET_PILL_COLOR };
  }
  return null;
}
