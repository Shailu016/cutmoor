/**
 * The picture maths around the background-removal network, on plain arrays so it is tested without a browser or a
 * model: how a picture is fed in, how the mask it returns is stretched back to the picture's size and sharpened, and how
 * the mask becomes see-through pixels.
 */

/** The network sees a square of this many pixels, whatever the picture's own shape. */
export const MATTING_SIZE = 1024;

/** RGBA bytes of a `size` x `size` picture as the network's input: channels first, each value (byte / 255) - 0.5. */
export function toNetworkInput(rgba: Uint8ClampedArray, size: number = MATTING_SIZE): Float32Array {
  const pixels = size * size;
  const out = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    out[i] = rgba[i * 4] / 255 - 0.5;
    out[pixels + i] = rgba[i * 4 + 1] / 255 - 0.5;
    out[2 * pixels + i] = rgba[i * 4 + 2] / 255 - 0.5;
  }
  return out;
}

/** Stretches the mask so its lowest value is 0 and its highest is 1. A flat mask (nothing found) stays all zero. */
export function normalizeMask(mask: Float32Array): Float32Array {
  let low = Infinity;
  let high = -Infinity;
  for (const value of mask) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const out = new Float32Array(mask.length);
  const range = high - low;
  if (!(range > 1e-6)) return out;
  for (let i = 0; i < mask.length; i += 1) out[i] = (mask[i] - low) / range;
  return out;
}

/** Bilinear resize of a one-channel picture. Sample centres line up, so the mask does not drift on a large picture. */
export function resizeMask(mask: Float32Array, srcW: number, srcH: number, dstW: number, dstH: number): Float32Array {
  const out = new Float32Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const fy = Math.min(srcH - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dstW; x += 1) {
      const fx = Math.min(srcW - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = fx - x0;
      const top = mask[y0 * srcW + x0] * (1 - wx) + mask[y0 * srcW + x1] * wx;
      const bottom = mask[y1 * srcW + x0] * (1 - wx) + mask[y1 * srcW + x1] * wx;
      out[y * dstW + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

export type EdgeStyle = "soft" | "normal" | "sharp";

/** How the mask's edge is shaped: where it turns solid and how wide the soft band around it is. */
export const EDGE_STYLES: Record<EdgeStyle, { cutoff: number; band: number }> = {
  soft: { cutoff: 0.45, band: 0.9 },
  normal: { cutoff: 0.5, band: 0.5 },
  sharp: { cutoff: 0.5, band: 0.12 },
};

function smoothstep(low: number, high: number, value: number): number {
  if (value <= low) return 0;
  if (value >= high) return 1;
  const t = (value - low) / (high - low);
  return t * t * (3 - 2 * t);
}

/** Pushes mask values toward 0 or 1 around the cutoff, so a fuzzy halo becomes a clean edge. In place. */
export function shapeMask(mask: Float32Array, style: EdgeStyle): void {
  const { cutoff, band } = EDGE_STYLES[style];
  const low = Math.max(0, cutoff - band / 2);
  const high = Math.min(1, cutoff + band / 2);
  for (let i = 0; i < mask.length; i += 1) mask[i] = smoothstep(low, high, mask[i]);
}

/** Writes the mask into the picture's alpha channel (multiplying what is already there), in place. */
export function applyMask(rgba: Uint8ClampedArray, mask: Float32Array): void {
  for (let i = 0; i < mask.length; i += 1) {
    rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * Math.min(1, Math.max(0, mask[i])));
  }
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box holding every pixel whose alpha is above `threshold`, or null when nothing is left. */
export function opaqueBounds(rgba: Uint8ClampedArray, width: number, height: number, threshold = 8): Bounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** The share of the picture the cut-out covers, 0 to 1. Used to say "nothing was found" instead of returning a blank. */
export function coverage(mask: Float32Array): number {
  let sum = 0;
  for (const value of mask) sum += value;
  return mask.length === 0 ? 0 : sum / mask.length;
}
