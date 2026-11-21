import type { CaptionStyle } from "../contracts";
import { MIN_FONT_PX, resolvedFontPx } from "./look";

/**
 * Where a caption block sits on the frame. Pure: no canvas, no DOM.
 *
 * The burned-in renderer and the HTML preview both call `placeBlock`, so a drag in the
 * preview lands the MP4 caption in the same place. The shared "safe area" is the frame
 * inside the side margin and the bottom margin the presets already respected; the top
 * margin mirrors the bottom one so an anchor of 0.5 is the true middle of the picture.
 *
 * When `anchorX`/`anchorY` are absent the effective anchor is the old preset behaviour:
 * horizontally centred, and vertically at the bottom margin or the middle of the frame.
 */

/** Sides stay 5% from the frame edge. */
export const SAFE_MARGIN_X = 0.05;
/** Block height never exceeds 40% of the frame so captions cannot swallow the picture. */
export const MAX_BLOCK_HEIGHT = 0.4;
/** Below this the text is unreadable anyway; stop shrinking. Defined once, in look.ts. */
export { MIN_FONT_PX };
/** Line-box height as a multiple of the font size. The HTML preview uses the same value. */
export const LINE_HEIGHT = 1.3;
/** How far the spoken-word box reaches past the word on each side, as a fraction of the font size. */
export const ACTIVE_BOX_PAD = 0.14;
/** Pill padding on each side, as a fraction of the font size. */
export const PILL_PAD_X = 0.4;

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The part of the frame a caption may use, in frame pixels. */
export interface SafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Fractions of the safe area: 0 is the left/top edge, 1 the right/bottom edge. */
export interface Anchor {
  x: number;
  y: number;
}

/** Font size before the fit-to-frame shrink. A number that cannot be used falls back to 5% of the height. */
export function baseFontPx(style: Pick<CaptionStyle, "fontScale" | "sizeMul">, frameHeight: number): number {
  return resolvedFontPx(style, frameHeight);
}

/** Distance from the frame bottom to the block's bottom edge. Portrait video leaves more room for app UI overlays. */
export function bottomMargin(frameWidth: number, frameHeight: number): number {
  return frameHeight * (frameHeight > frameWidth ? 0.16 : 0.07);
}

/**
 * The area the old presets already stayed inside. The top margin mirrors the bottom one,
 * which keeps anchor 0.5 at the exact middle of the picture on both landscape and portrait video.
 */
export function captionSafeArea(frameWidth: number, frameHeight: number): SafeArea {
  const marginX = frameWidth * SAFE_MARGIN_X;
  const marginY = bottomMargin(frameWidth, frameHeight);
  return { left: marginX, top: marginY, right: frameWidth - marginX, bottom: frameHeight - marginY };
}

/** Clamps an anchor to 0..1; a non-finite value uses `fallback`. */
export function clampAnchor(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** The anchor a style actually draws with. Absent fields reproduce the preset's old position. */
export function effectiveAnchor(style: Pick<CaptionStyle, "position" | "anchorX" | "anchorY">): Anchor {
  const fallbackY = style.position === "middle" ? 0.5 : 1;
  return {
    x: clampAnchor(style.anchorX ?? 0.5, 0.5),
    y: clampAnchor(style.anchorY ?? fallbackY, fallbackY),
  };
}

/** Horizontal room a style needs around its text: a pill, or the box behind the spoken word. */
export function horizontalPad(style: Pick<CaptionStyle, "background" | "activeBox">, fontPx: number): number {
  if (style.background === "pill") return fontPx * PILL_PAD_X;
  return style.activeBox ? fontPx * ACTIVE_BOX_PAD : 0;
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The block's full drawn rectangle (text plus any pill/box padding) for a frame.
 * The block is kept inside the safe area: anchor 0 puts its left/top edge on the safe edge,
 * anchor 1 its right/bottom edge. A block larger than the safe area starts at the safe edge
 * and lets the renderer's shrink step deal with the rest.
 */
export function placeBlock(
  style: Pick<CaptionStyle, "position" | "anchorX" | "anchorY">,
  block: Size,
  frameWidth: number,
  frameHeight: number,
): Rect {
  const safe = captionSafeArea(frameWidth, frameHeight);
  const anchor = effectiveAnchor(style);
  const width = finite(block.width);
  const height = finite(block.height);
  const travelX = safe.right - safe.left - width;
  const travelY = safe.bottom - safe.top - height;
  return {
    left: travelX >= 0 ? safe.left + anchor.x * travelX : safe.left,
    top: travelY >= 0 ? safe.top + anchor.y * travelY : safe.top,
    width,
    height,
  };
}

/** Left edge of one line of text inside the block. `align` defaults to centred. */
export function lineLeft(block: Rect, lineWidth: number, padX: number, align: CaptionStyle["align"] = "center"): number {
  const left = block.left + padX;
  const contentWidth = Math.max(0, block.width - 2 * padX);
  if (align === "left") return left;
  if (align === "right") return Math.max(left, left + contentWidth - lineWidth);
  // Centred, but never start left of the content edge even if the line is wider than the block.
  return Math.max(left, left + (contentWidth - lineWidth) / 2);
}

/** The anchor that puts a block's top-left corner at `left`/`top`. Used when dragging. */
export function anchorFromOrigin(left: number, top: number, safe: SafeArea, block: Size): Anchor {
  const travelX = safe.right - safe.left - block.width;
  const travelY = safe.bottom - safe.top - block.height;
  return {
    x: travelX > 0 ? clampAnchor((left - safe.left) / travelX, 0) : 0,
    y: travelY > 0 ? clampAnchor((top - safe.top) / travelY, 0) : 0,
  };
}

/** Moves an anchor by a fraction of the safe area, clamped. Arrow keys and fine sliders use this. */
export function nudgeAnchor(anchor: Anchor, dx: number, dy: number): Anchor {
  return {
    x: clampAnchor(anchor.x + dx, anchor.x),
    y: clampAnchor(anchor.y + dy, anchor.y),
  };
}
