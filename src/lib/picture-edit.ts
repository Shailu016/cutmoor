import type { Box } from "./crop";

/**
 * Picture editing on plain pixel data (RGBA bytes), so the rules are tested without a canvas: how big a rotated picture
 * is, how a region is pixelated, blurred, or blacked out. The tool pages copy a region out of a canvas, call these,
 * and put it back.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// ---- rotate ---------------------------------------------------------------------------------------------

/** The smallest canvas that holds a `width` x `height` picture turned by `degrees`. */
export function rotatedSize(width: number, height: number, degrees: number): { width: number; height: number } {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  // Tiny float noise (cos 90 degrees is 6e-17) must not add a pixel.
  const clean = (value: number) => Math.round(value * 1e6) / 1e6;
  return { width: Math.max(1, Math.ceil(clean(width * cos + height * sin))), height: Math.max(1, Math.ceil(clean(width * sin + height * cos))) };
}

/**
 * Draws a picture turned clockwise by `degrees` (any angle), then mirrored, on a canvas just big enough to hold it.
 * `background` fills the corners a turn leaves empty; null leaves them transparent (for PNG and WebP).
 */
export function drawTurned(
  source: CanvasImageSource,
  width: number,
  height: number,
  { degrees, flipH, flipV, background }: { degrees: number; flipH: boolean; flipV: boolean; background: string | null },
): HTMLCanvasElement {
  const size = rotatedSize(width, height, degrees);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not create a canvas. Try a smaller picture or a different browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
  }
  context.translate(size.width / 2, size.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  context.drawImage(source, -width / 2, -height / 2, width, height);
  return canvas;
}

// ---- redact ---------------------------------------------------------------------------------------------

export type RedactMode = "blur" | "pixelate" | "blackout";

/** Replaces each `block` x `block` square with its average colour. Square edges at the picture border are smaller. */
export function pixelate(pixels: Pixels, block: number): void {
  const size = Math.max(1, Math.round(block));
  const { data, width, height } = pixels;
  for (let by = 0; by < height; by += size) {
    for (let bx = 0; bx < width; bx += size) {
      const w = Math.min(size, width - bx);
      const h = Math.min(size, height - by);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = ((by + y) * width + bx + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
        }
      }
      const n = w * h;
      const ar = Math.round(r / n);
      const ag = Math.round(g / n);
      const ab = Math.round(b / n);
      const aa = Math.round(a / n);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = ((by + y) * width + bx + x) * 4;
          data[i] = ar;
          data[i + 1] = ag;
          data[i + 2] = ab;
          data[i + 3] = aa;
        }
      }
    }
  }
}

/** One pass of a box blur along rows (`horizontal`) or columns, edges repeated. Runs in time proportional to the pixel count. */
function blurPass(source: Uint8ClampedArray, target: Uint8ClampedArray, width: number, height: number, radius: number, horizontal: boolean): void {
  const length = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const stride = horizontal ? 4 : width * 4;
  const lineStep = horizontal ? width * 4 : 4;
  const window = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStep;
    for (let channel = 0; channel < 4; channel += 1) {
      const at = (position: number) => source[base + Math.min(length - 1, Math.max(0, position)) * stride + channel];
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += at(k);
      for (let position = 0; position < length; position += 1) {
        target[base + position * stride + channel] = Math.round(sum / window);
        sum += at(position + radius + 1) - at(position - radius);
      }
    }
  }
}

/** A soft blur: three box-blur passes in each direction, which is close to a Gaussian. */
export function blur(pixels: Pixels, radius: number): void {
  const r = Math.max(1, Math.round(radius));
  const scratch = new Uint8ClampedArray(pixels.data.length);
  for (let pass = 0; pass < 3; pass += 1) {
    blurPass(pixels.data, scratch, pixels.width, pixels.height, r, true);
    blurPass(scratch, pixels.data, pixels.width, pixels.height, r, false);
  }
}

/** Covers every pixel with solid black (alpha kept at 255). This cannot be undone, unlike a blur. */
export function blackout(pixels: Pixels): void {
  const { data } = pixels;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
}

/** Strength 1 to 10 as a blur radius or block size that grows with the region, so a big region is hidden as well as a small one. */
export function redactAmount(mode: Exclude<RedactMode, "blackout">, strength: number, region: Box): number {
  const s = Math.min(10, Math.max(1, Math.round(strength)));
  const longSide = Math.max(region.w, region.h);
  if (mode === "pixelate") return Math.max(4, Math.round((longSide * s) / 40));
  return Math.max(3, Math.round((longSide * s) / 30));
}

export function redact(pixels: Pixels, mode: RedactMode, amount: number): void {
  if (mode === "blackout") blackout(pixels);
  else if (mode === "pixelate") pixelate(pixels, amount);
  else blur(pixels, amount);
}

/** Applies a redaction to each box of a canvas, in place. Boxes are in the canvas's own pixels. */
export function redactCanvas(canvas: HTMLCanvasElement, boxes: readonly Box[], mode: RedactMode, strength: number): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not read the picture back. Try a smaller picture.");
  for (const box of boxes) {
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const w = Math.min(canvas.width - x, Math.ceil(box.w));
    const h = Math.min(canvas.height - y, Math.ceil(box.h));
    if (w < 1 || h < 1) continue;
    // A blur reads past the box edge, so it works on a padded copy and only the box is written back.
    const pad = mode === "blur" ? Math.min(60, redactAmount("blur", strength, box)) : 0;
    const px = Math.max(0, x - pad);
    const py = Math.max(0, y - pad);
    const pw = Math.min(canvas.width - px, w + (x - px) + pad);
    const ph = Math.min(canvas.height - py, h + (y - py) + pad);
    const padded = context.getImageData(px, py, pw, ph);
    if (mode === "blur") {
      blur(padded, redactAmount("blur", strength, box));
      const inner = context.getImageData(x, y, w, h);
      for (let row = 0; row < h; row += 1) {
        const from = ((y - py + row) * pw + (x - px)) * 4;
        inner.data.set(padded.data.subarray(from, from + w * 4), row * w * 4);
      }
      context.putImageData(inner, x, y);
    } else {
      const region = context.getImageData(x, y, w, h);
      redact(region, mode, mode === "pixelate" ? redactAmount("pixelate", strength, box) : 0);
      context.putImageData(region, x, y);
    }
  }
}

// ---- watermark ------------------------------------------------------------------------------------------

export type MarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

/** Where a mark of `markWidth` x `markHeight` goes on a picture, `margin` pixels from the edges (not for the centre). */
export function markPlacement(
  picture: { width: number; height: number },
  mark: { width: number; height: number },
  position: MarkCorner,
  margin: number,
): { x: number; y: number } {
  const left = margin;
  const top = margin;
  const right = picture.width - mark.width - margin;
  const bottom = picture.height - mark.height - margin;
  switch (position) {
    case "top-left":
      return { x: left, y: top };
    case "top-right":
      return { x: right, y: top };
    case "bottom-left":
      return { x: left, y: bottom };
    case "center":
      return { x: (picture.width - mark.width) / 2, y: (picture.height - mark.height) / 2 };
    default:
      return { x: right, y: bottom };
  }
}
