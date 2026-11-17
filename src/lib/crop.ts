/**
 * The geometry of a crop box on a picture, in the picture's own pixels. Pure functions, so the dragging rules
 * (which corner stays put, how an aspect ratio is held, never leaving the picture) are tested without a browser.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Width divided by height, or null for a free shape. */
export type Ratio = number | null;

export interface AspectChoice {
  id: string;
  label: string;
  ratio: Ratio;
}

export const CROP_ASPECTS: AspectChoice[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1 square", ratio: 1 },
  { id: "4:5", label: "4:5 portrait", ratio: 4 / 5 },
  { id: "5:4", label: "5:4", ratio: 5 / 4 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "16:9", label: "16:9 wide", ratio: 16 / 9 },
  { id: "9:16", label: "9:16 story", ratio: 9 / 16 },
];

export const MIN_BOX = 16;

/** The biggest box of the given shape that fits the picture, centred. With no ratio, the whole picture. */
export function largestBox(width: number, height: number, ratio: Ratio): Box {
  if (ratio === null) return { x: 0, y: 0, w: width, h: height };
  let w = width;
  let h = w / ratio;
  if (h > height) {
    h = height;
    w = h * ratio;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Keeps a box inside the picture and no smaller than `min` (when the picture allows). */
export function clampBox(box: Box, width: number, height: number, min = MIN_BOX): Box {
  const w = Math.min(width, Math.max(Math.min(min, width), box.w));
  const h = Math.min(height, Math.max(Math.min(min, height), box.h));
  return { x: Math.min(width - w, Math.max(0, box.x)), y: Math.min(height - h, Math.max(0, box.y)), w, h };
}

/** Re-fits an existing box to a new ratio, keeping its centre where possible and staying inside the picture. */
export function refitBox(box: Box, ratio: Ratio, width: number, height: number): Box {
  if (ratio === null) return clampBox(box, width, height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let w = box.w;
  let h = w / ratio;
  if (h > box.h * 1.0001 && box.h * ratio < w) {
    h = box.h;
    w = h * ratio;
  }
  const maxW = 2 * Math.min(cx, width - cx);
  const maxH = 2 * Math.min(cy, height - cy);
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  if (w < MIN_BOX || h < MIN_BOX) return largestBox(width, height, ratio);
  return clampBox({ x: cx - w / 2, y: cy - h / 2, w, h }, width, height, 1);
}

export type Handle = "move" | "nw" | "ne" | "sw" | "se";

/**
 * Applies a drag of (dx, dy) picture pixels to `start`. A corner drag keeps the opposite corner fixed; with a ratio the
 * box keeps its shape; the box never leaves the picture.
 */
export function dragBox(start: Box, handle: Handle, dx: number, dy: number, ratio: Ratio, width: number, height: number, min = MIN_BOX): Box {
  if (handle === "move") return clampBox({ ...start, x: start.x + dx, y: start.y + dy }, width, height, 1);

  const east = handle === "ne" || handle === "se";
  const south = handle === "sw" || handle === "se";
  // The corner that stays where it is.
  const anchorX = east ? start.x : start.x + start.w;
  const anchorY = south ? start.y : start.y + start.h;
  const maxW = east ? width - anchorX : anchorX;
  const maxH = south ? height - anchorY : anchorY;

  let w = start.w + (east ? dx : -dx);
  let h = start.h + (south ? dy : -dy);
  w = Math.min(maxW, Math.max(min, w));
  h = Math.min(maxH, Math.max(min, h));

  if (ratio !== null) {
    // Follow whichever side the pointer moved further, then fit the other side to the ratio.
    const byWidth = Math.abs(w - start.w) / Math.max(1, start.w) >= Math.abs(h - start.h) / Math.max(1, start.h);
    if (byWidth) {
      h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
    } else {
      w = h * ratio;
      if (w > maxW) {
        w = maxW;
        h = w / ratio;
      }
    }
    if (w < min || h < min) {
      if (ratio >= 1) {
        h = min;
        w = h * ratio;
      } else {
        w = min;
        h = w / ratio;
      }
      w = Math.min(w, maxW);
      h = Math.min(h, maxH);
    }
  }
  return { x: east ? anchorX : anchorX - w, y: south ? anchorY : anchorY - h, w, h };
}

/** A box in picture pixels as whole pixels, never empty and never outside the picture. */
export function roundBox(box: Box, width: number, height: number): Box {
  const x = Math.min(width - 1, Math.max(0, Math.round(box.x)));
  const y = Math.min(height - 1, Math.max(0, Math.round(box.y)));
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(box.w))), h: Math.max(1, Math.min(height - y, Math.round(box.h))) };
}

/** A pointer position on the shown picture (CSS pixels) as a position on the real picture (its own pixels). */
export function toPicturePoint(clientX: number, clientY: number, shown: { left: number; top: number; width: number; height: number }, picture: { width: number; height: number }): { x: number; y: number } {
  const scaleX = picture.width / Math.max(1, shown.width);
  const scaleY = picture.height / Math.max(1, shown.height);
  return {
    x: Math.min(picture.width, Math.max(0, (clientX - shown.left) * scaleX)),
    y: Math.min(picture.height, Math.max(0, (clientY - shown.top) * scaleY)),
  };
}

/** A rectangle dragged from one point to another, as a box. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
