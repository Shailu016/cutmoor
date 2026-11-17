/**
 * Enlarging a picture with a network that takes one fixed-size square (128 by 128 pixels in, 512 by 512 out): the picture
 * is cut into overlapping squares, each is enlarged, and only the middle of each result is kept, so no seam shows.
 * All of this is on plain arrays, so the cutting plan and the copying are tested without a browser or a model.
 */

export const TILE = 128;
export const MARGIN = 8;
export const SCALE = 4;

export interface Tile {
  /** The part of the picture this tile is responsible for. */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  /** Where the 128-pixel square starts in the picture. It can start outside it; the missing edge is mirrored in. */
  sx: number;
  sy: number;
}

/** The tiles that cover a `width` x `height` picture exactly once (their cores do not overlap and leave no gap). */
export function planTiles(width: number, height: number, tile: number = TILE, margin: number = MARGIN): Tile[] {
  const step = tile - 2 * margin;
  if (step < 1) throw new Error("The margin is too big for the tile.");
  const tiles: Tile[] = [];
  for (let cy = 0; cy < height; cy += step) {
    for (let cx = 0; cx < width; cx += step) {
      tiles.push({ cx, cy, cw: Math.min(step, width - cx), ch: Math.min(step, height - cy), sx: cx - margin, sy: cy - margin });
    }
  }
  return tiles;
}

/** A position outside 0..n-1 mirrored back inside (so the edge of a picture continues naturally past its border). */
export function reflect(index: number, n: number): number {
  if (n <= 1) return 0;
  const period = 2 * (n - 1);
  let i = ((index % period) + period) % period;
  if (i >= n) i = period - i;
  return i;
}

/** The square starting at (sx, sy) as the network's input: channels first, values 0 to 1, edges mirrored. */
export function extractPatch(rgba: Uint8ClampedArray, width: number, height: number, sx: number, sy: number, size: number = TILE): Float32Array {
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < size; y += 1) {
    const row = reflect(sy + y, height) * width;
    for (let x = 0; x < size; x += 1) {
      const at = (row + reflect(sx + x, width)) * 4;
      const i = y * size + x;
      out[i] = rgba[at] / 255;
      out[plane + i] = rgba[at + 1] / 255;
      out[2 * plane + i] = rgba[at + 2] / 255;
    }
  }
  return out;
}

/**
 * Copies the middle of one enlarged square into the output picture (RGBA bytes, `outWidth` wide). `patch` is the network's
 * output for the tile: channels first, (size*scale) squared, values about 0 to 1 (clamped here).
 */
export function writeCore(out: Uint8ClampedArray, outWidth: number, patch: Float32Array, tile: Tile, size: number = TILE, margin: number = MARGIN, scale: number = SCALE): void {
  const side = size * scale;
  const plane = side * side;
  const offset = margin * scale;
  const rows = tile.ch * scale;
  const cols = tile.cw * scale;
  for (let y = 0; y < rows; y += 1) {
    const from = (offset + y) * side + offset;
    const to = ((tile.cy * scale + y) * outWidth + tile.cx * scale) * 4;
    for (let x = 0; x < cols; x += 1) {
      const r = patch[from + x];
      const g = patch[plane + from + x];
      const b = patch[2 * plane + from + x];
      const o = to + x * 4;
      out[o] = Math.min(255, Math.max(0, Math.round(r * 255)));
      out[o + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
      out[o + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
      out[o + 3] = 255;
    }
  }
}

/** The output size for an enlargement. `factor` 2 means the 4x result is scaled back down to twice the size. */
export function outputSize(width: number, height: number, factor: 2 | 4): { width: number; height: number } {
  return { width: width * factor, height: height * factor };
}

/** The most pixels a browser canvas can hold (see image.ts). */
export const CANVAS_PIXELS = 16_777_216;
export const CANVAS_EDGE = 16_384;

export function fitsCanvas(width: number, height: number, factor: 2 | 4): boolean {
  const size = outputSize(width, height, factor);
  return size.width <= CANVAS_EDGE && size.height <= CANVAS_EDGE && size.width * size.height <= CANVAS_PIXELS;
}

/** How many network runs an enlargement takes. */
export function tileCount(width: number, height: number): number {
  return planTiles(width, height).length;
}
