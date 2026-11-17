import { describe, expect, it } from "vitest";
import { boxBetween, clampBox, CROP_ASPECTS, dragBox, largestBox, refitBox, roundBox, toPicturePoint, type Box } from "./crop";

const W = 1000;
const H = 800;
const inside = (box: Box) => box.x >= -1e-6 && box.y >= -1e-6 && box.x + box.w <= W + 1e-6 && box.y + box.h <= H + 1e-6;

describe("largestBox", () => {
  it("is the whole picture when the shape is free", () => {
    expect(largestBox(W, H, null)).toEqual({ x: 0, y: 0, w: W, h: H });
  });
  it("fits a wide shape by width and a tall shape by height, centred", () => {
    const wide = largestBox(W, H, 16 / 9);
    expect(wide.w).toBeCloseTo(1000);
    expect(wide.h).toBeCloseTo(562.5);
    expect(wide.y).toBeCloseTo((H - 562.5) / 2);
    const tall = largestBox(W, H, 9 / 16);
    expect(tall.h).toBeCloseTo(800);
    expect(tall.w).toBeCloseTo(450);
    expect(tall.x).toBeCloseTo(275);
  });
  it("gives every preset shape a box that fits", () => {
    for (const aspect of CROP_ASPECTS) {
      const box = largestBox(W, H, aspect.ratio);
      expect(inside(box)).toBe(true);
      if (aspect.ratio) expect(box.w / box.h).toBeCloseTo(aspect.ratio, 4);
    }
  });
});

describe("clampBox", () => {
  it("pulls a box back inside the picture", () => {
    expect(clampBox({ x: -50, y: 780, w: 100, h: 100 }, W, H)).toEqual({ x: 0, y: 700, w: 100, h: 100 });
  });
  it("never lets a box get smaller than the minimum or bigger than the picture", () => {
    expect(clampBox({ x: 0, y: 0, w: 1, h: 1 }, W, H, 16)).toMatchObject({ w: 16, h: 16 });
    expect(clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, W, H)).toMatchObject({ w: W, h: H });
  });
});

describe("dragBox", () => {
  const start: Box = { x: 200, y: 200, w: 300, h: 200 };
  it("moves the box and stops at the edges", () => {
    expect(dragBox(start, "move", 50, -30, null, W, H)).toMatchObject({ x: 250, y: 170, w: 300, h: 200 });
    expect(dragBox(start, "move", 5000, 5000, null, W, H)).toMatchObject({ x: 700, y: 600 });
    expect(dragBox(start, "move", -5000, -5000, null, W, H)).toMatchObject({ x: 0, y: 0 });
  });
  it("keeps the opposite corner fixed for each corner", () => {
    const se = dragBox(start, "se", 100, 50, null, W, H);
    expect(se).toMatchObject({ x: 200, y: 200, w: 400, h: 250 });
    const nw = dragBox(start, "nw", -100, -50, null, W, H);
    expect(nw).toMatchObject({ x: 100, y: 150, w: 400, h: 250 });
    const ne = dragBox(start, "ne", 100, -50, null, W, H);
    expect(ne).toMatchObject({ x: 200, y: 150, w: 400, h: 250 });
    const sw = dragBox(start, "sw", -100, 50, null, W, H);
    expect(sw).toMatchObject({ x: 100, y: 200, w: 400, h: 250 });
  });
  it("never leaves the picture, whatever the drag", () => {
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      for (const [dx, dy] of [[5000, 5000], [-5000, -5000], [5000, -5000], [-5000, 5000]]) {
        const box = dragBox(start, handle, dx, dy, null, W, H);
        expect(inside(box)).toBe(true);
        expect(box.w).toBeGreaterThanOrEqual(16);
        expect(box.h).toBeGreaterThanOrEqual(16);
      }
    }
  });
  it("holds the ratio while a corner is dragged", () => {
    const square: Box = { x: 100, y: 100, w: 200, h: 200 };
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      for (const [dx, dy] of [[60, 10], [-40, 90], [300, 300], [-300, -300], [20, -250]]) {
        const box = dragBox(square, handle, dx, dy, 1, W, H);
        expect(inside(box)).toBe(true);
        expect(box.w / box.h).toBeCloseTo(1, 3);
      }
    }
    const wide = dragBox({ x: 100, y: 100, w: 320, h: 180 }, "se", 80, 0, 16 / 9, W, H);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9, 3);
  });
});

describe("refitBox", () => {
  it("changes a box to a new ratio around its centre", () => {
    const box = refitBox({ x: 100, y: 100, w: 400, h: 300 }, 1, W, H);
    expect(box.w / box.h).toBeCloseTo(1, 3);
    expect(box.x + box.w / 2).toBeCloseTo(300, 0);
    expect(inside(box)).toBe(true);
  });
  it("keeps a free box where it is", () => {
    expect(refitBox({ x: 10, y: 10, w: 100, h: 100 }, null, W, H)).toEqual({ x: 10, y: 10, w: 100, h: 100 });
  });
  it("falls back to the largest box when the centre leaves no room", () => {
    const box = refitBox({ x: 0, y: 0, w: 20, h: 20 }, 2, W, H);
    expect(inside(box)).toBe(true);
    expect(box.w / box.h).toBeCloseTo(2, 3);
  });
});

describe("pointer maths", () => {
  it("scales a pointer on the shown picture to the real picture", () => {
    const point = toPicturePoint(150, 120, { left: 100, top: 100, width: 500, height: 400 }, { width: 2000, height: 1600 });
    expect(point).toEqual({ x: 200, y: 80 });
  });
  it("clamps a pointer outside the picture", () => {
    expect(toPicturePoint(0, 0, { left: 100, top: 100, width: 500, height: 400 }, { width: 2000, height: 1600 })).toEqual({ x: 0, y: 0 });
    expect(toPicturePoint(9999, 9999, { left: 100, top: 100, width: 500, height: 400 }, { width: 2000, height: 1600 })).toEqual({ x: 2000, y: 1600 });
  });
  it("makes a box from two corners in either order", () => {
    expect(boxBetween({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
});

describe("roundBox", () => {
  it("returns whole pixels inside the picture and never an empty box", () => {
    expect(roundBox({ x: 10.4, y: 20.6, w: 99.5, h: 0.2 }, W, H)).toEqual({ x: 10, y: 21, w: 100, h: 1 });
    const edge = roundBox({ x: 999.9, y: 799.9, w: 50, h: 50 }, W, H);
    expect(edge.x + edge.w).toBeLessThanOrEqual(W);
    expect(edge.y + edge.h).toBeLessThanOrEqual(H);
  });
});
