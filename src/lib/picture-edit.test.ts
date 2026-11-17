import { describe, expect, it } from "vitest";
import { blackout, blur, pixelate, redact, redactAmount, rotatedSize, type Pixels } from "./picture-edit";

function make(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}
const px = (p: Pixels, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

describe("rotatedSize", () => {
  it("swaps the sides for a quarter turn without adding a pixel", () => {
    expect(rotatedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 270)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
  });
  it("grows to hold the corners of a tilted picture", () => {
    const tilted = rotatedSize(400, 300, 10);
    expect(tilted.width).toBeGreaterThan(400);
    expect(tilted.height).toBeGreaterThan(300);
    expect(rotatedSize(100, 100, 45)).toEqual({ width: 142, height: 142 });
  });
  it("treats a negative angle like its positive twin", () => {
    expect(rotatedSize(400, 300, -10)).toEqual(rotatedSize(400, 300, 10));
  });
});

describe("pixelate", () => {
  it("replaces each block with its average colour", () => {
    const p = make(4, 4, (x) => (x < 2 ? [0, 0, 0, 255] : [200, 100, 50, 255]));
    pixelate(p, 4);
    expect(px(p, 0, 0)).toEqual([100, 50, 25, 255]);
    expect(px(p, 3, 3)).toEqual([100, 50, 25, 255]);
  });
  it("handles a block that does not divide the picture evenly", () => {
    const p = make(5, 3, () => [10, 20, 30, 255]);
    pixelate(p, 4);
    expect(px(p, 4, 2)).toEqual([10, 20, 30, 255]);
  });
  it("makes the original detail unrecoverable within a block", () => {
    const p = make(8, 8, (x, y) => ((x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    pixelate(p, 8);
    const first = px(p, 0, 0);
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) expect(px(p, x, y)).toEqual(first);
  });
});

describe("blur", () => {
  it("leaves a flat colour unchanged", () => {
    const p = make(20, 20, () => [90, 120, 150, 255]);
    blur(p, 4);
    expect(px(p, 10, 10)).toEqual([90, 120, 150, 255]);
    expect(px(p, 0, 0)).toEqual([90, 120, 150, 255]);
  });
  it("softens a sharp edge", () => {
    const p = make(40, 10, (x) => (x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    blur(p, 5);
    const left = px(p, 19, 5)[0];
    const right = px(p, 20, 5)[0];
    expect(left).toBeGreaterThan(20);
    expect(right).toBeLessThan(235);
    expect(px(p, 2, 5)[0]).toBeLessThan(5);
    expect(px(p, 37, 5)[0]).toBeGreaterThan(250);
  });
  it("keeps the average brightness of the picture about the same", () => {
    const p = make(30, 30, (x, y) => [((x * 37 + y * 11) % 256), 100, 100, 255]);
    const mean = (q: Pixels) => {
      let sum = 0;
      for (let i = 0; i < q.data.length; i += 4) sum += q.data[i];
      return sum / (q.data.length / 4);
    };
    const before = mean(p);
    blur(p, 3);
    expect(Math.abs(mean(p) - before)).toBeLessThan(6);
  });
});

describe("blackout and redact", () => {
  it("covers everything with opaque black, even a see-through region", () => {
    const p = make(3, 3, () => [200, 200, 200, 10]);
    blackout(p);
    expect(px(p, 1, 1)).toEqual([0, 0, 0, 255]);
  });
  it("redact picks the mode", () => {
    const a = make(4, 4, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    redact(a, "blackout", 0);
    expect(px(a, 0, 0)).toEqual([0, 0, 0, 255]);
    const b = make(4, 4, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    redact(b, "pixelate", 4);
    expect(px(b, 0, 0)).toEqual(px(b, 3, 3));
  });
  it("scales strength with the size of the region", () => {
    const small = redactAmount("pixelate", 5, { x: 0, y: 0, w: 100, h: 100 });
    const large = redactAmount("pixelate", 5, { x: 0, y: 0, w: 1000, h: 1000 });
    expect(large).toBeGreaterThan(small);
    expect(redactAmount("blur", 10, { x: 0, y: 0, w: 300, h: 200 })).toBeGreaterThan(redactAmount("blur", 1, { x: 0, y: 0, w: 300, h: 200 }));
  });
});

import { markPlacement } from "./picture-edit";

describe("markPlacement", () => {
  const picture = { width: 1000, height: 600 };
  const mark = { width: 200, height: 50 };
  it("puts a mark in each corner with a margin and in the centre", () => {
    expect(markPlacement(picture, mark, "top-left", 20)).toEqual({ x: 20, y: 20 });
    expect(markPlacement(picture, mark, "top-right", 20)).toEqual({ x: 780, y: 20 });
    expect(markPlacement(picture, mark, "bottom-left", 20)).toEqual({ x: 20, y: 530 });
    expect(markPlacement(picture, mark, "bottom-right", 20)).toEqual({ x: 780, y: 530 });
    expect(markPlacement(picture, mark, "center", 20)).toEqual({ x: 400, y: 275 });
  });
});
