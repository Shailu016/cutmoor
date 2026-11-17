import { describe, expect, it } from "vitest";
import { applyMask, coverage, EDGE_STYLES, normalizeMask, opaqueBounds, resizeMask, shapeMask, toNetworkInput } from "./matting";
import { CANVAS_PIXELS, extractPatch, fitsCanvas, MARGIN, outputSize, planTiles, reflect, SCALE, tileCount, TILE, writeCore } from "./tiling";

describe("toNetworkInput", () => {
  it("lays the channels out one after another and centres the values on zero", () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 128, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    const out = toNetworkInput(rgba, 2);
    expect([...out.slice(0, 4)]).toEqual([0.5, -0.5, -0.5, 0.5]);
    expect(out[4]).toBeCloseTo(-0.5);
    expect(out[5]).toBeCloseTo(0.5);
    expect(out[8]).toBeCloseTo(128 / 255 - 0.5);
    expect(out.length).toBe(12);
  });
});

describe("normalizeMask", () => {
  it("stretches to 0..1", () => {
    expect([...normalizeMask(Float32Array.from([0.2, 0.4, 0.6]))].map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, 1]);
  });
  it("leaves a flat mask empty instead of dividing by zero", () => {
    expect([...normalizeMask(Float32Array.from([0.3, 0.3, 0.3]))]).toEqual([0, 0, 0]);
    expect(normalizeMask(new Float32Array(0)).length).toBe(0);
  });
});

describe("resizeMask", () => {
  it("keeps a flat mask flat at any size", () => {
    const out = resizeMask(new Float32Array(16).fill(0.7), 4, 4, 9, 7);
    for (const v of out) expect(v).toBeCloseTo(0.7, 5);
    expect(out.length).toBe(63);
  });
  it("returns the same values at the same size", () => {
    const mask = Float32Array.from([0, 0.25, 0.5, 1]);
    expect([...resizeMask(mask, 2, 2, 2, 2)]).toEqual([...mask]);
  });
  it("blends smoothly between two values", () => {
    const out = resizeMask(Float32Array.from([0, 1]), 2, 1, 8, 1);
    for (let i = 1; i < out.length; i += 1) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] - 1e-6);
    expect(out[0]).toBe(0);
    expect(out[7]).toBe(1);
  });
  it("keeps the left half left and the right half right when it doubles in size", () => {
    const out = resizeMask(Float32Array.from([0, 0, 1, 1]), 4, 1, 8, 1);
    expect(out[1]).toBeLessThan(0.2);
    expect(out[6]).toBeGreaterThan(0.8);
  });
});

describe("shapeMask", () => {
  const values = Float32Array.from([0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]);
  it("sharp pushes values toward 0 and 1", () => {
    const a = Float32Array.from(values);
    shapeMask(a, "sharp");
    expect(a[2]).toBe(0);
    expect(a[4]).toBe(1);
    expect(a[0]).toBe(0);
    expect(a[6]).toBe(1);
  });
  it("soft keeps a wide band of in-between values", () => {
    const a = Float32Array.from(values);
    shapeMask(a, "soft");
    expect(a[2]).toBeGreaterThan(0);
    expect(a[2]).toBeLessThan(1);
    expect(a[4]).toBeGreaterThan(0.5);
  });
  it("never leaves 0..1 and never reverses the order", () => {
    for (const style of Object.keys(EDGE_STYLES) as Array<keyof typeof EDGE_STYLES>) {
      const a = Float32Array.from(values);
      shapeMask(a, style);
      for (let i = 0; i < a.length; i += 1) {
        expect(a[i]).toBeGreaterThanOrEqual(0);
        expect(a[i]).toBeLessThanOrEqual(1);
        if (i > 0) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
      }
    }
  });
});

describe("applyMask and bounds", () => {
  it("writes the mask into alpha and keeps colour", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    applyMask(rgba, Float32Array.from([1, 0.5]));
    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
  });
  it("multiplies with a picture that is already see-through", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 100]);
    applyMask(rgba, Float32Array.from([0.5]));
    expect(rgba[3]).toBe(50);
  });
  it("finds the box around what is left", () => {
    const rgba = new Uint8ClampedArray(5 * 4 * 4);
    for (const [x, y] of [[1, 1], [3, 2]]) rgba[(y * 5 + x) * 4 + 3] = 255;
    expect(opaqueBounds(rgba, 5, 4)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
  });
  it("says there is nothing when everything is transparent", () => {
    expect(opaqueBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
  it("measures how much of the picture is kept", () => {
    expect(coverage(Float32Array.from([1, 1, 0, 0]))).toBe(0.5);
    expect(coverage(new Float32Array(0))).toBe(0);
  });
});

describe("planTiles", () => {
  const covers = (width: number, height: number) => {
    const seen = new Uint8Array(width * height);
    for (const tile of planTiles(width, height)) {
      expect(tile.cw).toBeGreaterThan(0);
      expect(tile.ch).toBeGreaterThan(0);
      for (let y = tile.cy; y < tile.cy + tile.ch; y += 1) for (let x = tile.cx; x < tile.cx + tile.cw; x += 1) seen[y * width + x] += 1;
    }
    return seen.every((count) => count === 1);
  };
  it("covers every pixel exactly once for many sizes", () => {
    for (const [w, h] of [[1, 1], [112, 112], [113, 112], [200, 150], [333, 77], [1000, 20], [5, 400]]) expect(covers(w, h), `${w}x${h}`).toBe(true);
  });
  it("starts each square a margin before its core", () => {
    const [first, second] = planTiles(300, 300);
    expect(first.sx).toBe(-MARGIN);
    expect(second.sx).toBe(TILE - 3 * MARGIN);
  });
  it("counts tiles", () => {
    expect(tileCount(112, 112)).toBe(1);
    expect(tileCount(224, 112)).toBe(2);
  });
});

describe("reflect and extractPatch", () => {
  it("mirrors positions that fall outside", () => {
    expect([-1, -2, 0, 3, 4, 5, 6].map((i) => reflect(i, 4))).toEqual([1, 2, 0, 3, 2, 1, 0]);
    expect(reflect(7, 1)).toBe(0);
  });
  it("cuts a square with the edge mirrored in", () => {
    const rgba = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i += 1) rgba.set([i * 60, 0, 0, 255], i * 4);
    const patch = extractPatch(rgba, 2, 2, -1, -1, 4);
    const red = (x: number, y: number) => Math.round(patch[y * 4 + x] * 255);
    expect(red(1, 1)).toBe(0);
    expect(red(2, 1)).toBe(60);
    expect(red(0, 0)).toBe(180);
    expect(red(3, 3)).toBe(0);
  });
});

describe("writeCore", () => {
  it("writes the middle of an enlarged square into the right place and no more", () => {
    const size = 8;
    const margin = 2;
    const scale = 2;
    const side = size * scale;
    const plane = side * side;
    const patch = new Float32Array(3 * plane);
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) patch[y * side + x] = (y * side + x) / plane;
    const outWidth = 8;
    const out = new Uint8ClampedArray(outWidth * 8 * 4);
    writeCore(out, outWidth, patch, { cx: 2, cy: 1, cw: 2, ch: 2, sx: 0, sy: -1 }, size, margin, scale);
    const written = new Set<number>();
    for (let i = 0; i < out.length; i += 4) if (out[i + 3] === 255) written.add(i / 4);
    expect(written.size).toBe(4 * 4);
    for (const [x, y] of [[4, 2], [7, 2], [4, 5], [7, 5]]) expect(written.has(y * outWidth + x)).toBe(true);
    expect(written.has(2 * outWidth + 3)).toBe(false);
    // the first written pixel is the patch pixel at (margin*scale, margin*scale)
    expect(out[(2 * outWidth + 4) * 4]).toBe(Math.round(((margin * scale * side + margin * scale) / plane) * 255));
  });
  it("clamps values outside 0 to 1", () => {
    const patch = new Float32Array(3 * 16).fill(1.4);
    patch.fill(-0.3, 16, 32);
    const out = new Uint8ClampedArray(4 * 4 * 4);
    writeCore(out, 4, patch, { cx: 0, cy: 0, cw: 4, ch: 4, sx: 0, sy: 0 }, 4, 0, 1);
    expect([...out.slice(0, 4)]).toEqual([255, 0, 255, 255]);
  });
});

describe("output size", () => {
  it("scales both sides", () => {
    expect(outputSize(300, 200, 2)).toEqual({ width: 600, height: 400 });
    expect(outputSize(300, 200, 4)).toEqual({ width: 1200, height: 800 });
  });
  it("refuses a result the browser cannot draw", () => {
    expect(fitsCanvas(1000, 1000, 4)).toBe(true);
    expect(fitsCanvas(1100, 1100, 4)).toBe(false);
    expect(fitsCanvas(2000, 2000, 2)).toBe(true);
    expect(fitsCanvas(5000, 5000, 4)).toBe(false);
    expect(4 * 1024 * 4 * 1024).toBeLessThanOrEqual(CANVAS_PIXELS);
  });
  it("uses the fixed scale of the network", () => {
    expect(SCALE).toBe(4);
  });
});
