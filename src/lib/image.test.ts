import { describe, expect, it } from "vitest";
import {
  clampDimensions,
  computeDrawRect,
  defaultOutputFormat,
  detectSourceKind,
  fitDimensions,
  isHeicHeader,
  savingsPercent,
  sourceHasAlpha,
} from "./image";

function fakeFile(name: string, type: string): Pick<File, "name" | "type"> {
  return { name, type };
}

describe("detectSourceKind", () => {
  it("reads the MIME type first", () => {
    expect(detectSourceKind(fakeFile("photo.bin", "image/jpeg"))).toBe("jpeg");
    expect(detectSourceKind(fakeFile("photo.bin", "image/webp"))).toBe("webp");
  });

  it("falls back to the extension when the MIME type is missing", () => {
    expect(detectSourceKind(fakeFile("IMG_0042.HEIC", ""))).toBe("heic");
    expect(detectSourceKind(fakeFile("screenshot.png", "application/octet-stream"))).toBe("png");
    expect(detectSourceKind(fakeFile("art.avif", ""))).toBe("avif");
    expect(detectSourceKind(fakeFile("clip.gif", ""))).toBe("gif");
  });

  it("returns unknown for a file it cannot identify", () => {
    expect(detectSourceKind(fakeFile("notes.txt", "text/plain"))).toBe("unknown");
  });
});

describe("defaultOutputFormat", () => {
  it("never emits HEIC or AVIF", () => {
    expect(defaultOutputFormat("heic")).toBe("jpeg");
    expect(defaultOutputFormat("avif")).toBe("jpeg");
  });

  it("keeps PNG and WebP sensible", () => {
    expect(defaultOutputFormat("png")).toBe("png");
    expect(defaultOutputFormat("webp")).toBe("webp");
  });
});

describe("alpha detection", () => {
  it("knows which formats can carry transparency", () => {
    expect(sourceHasAlpha("png")).toBe(true);
    expect(sourceHasAlpha("webp")).toBe(true);
    expect(sourceHasAlpha("jpeg")).toBe(false);
    expect(sourceHasAlpha("heic")).toBe(false);
  });
});

describe("fitDimensions", () => {
  it("does not upscale", () => {
    expect(fitDimensions(800, 600, 1920, 1920)).toEqual({ width: 800, height: 600, scaled: false });
  });

  it("preserves aspect ratio when fitting inside a box", () => {
    expect(fitDimensions(4000, 3000, 1000, 1000)).toEqual({ width: 1000, height: 750, scaled: true });
    expect(fitDimensions(3000, 4000, 1000, 1000)).toEqual({ width: 750, height: 1000, scaled: true });
  });
});

describe("clampDimensions", () => {
  it("leaves a normal social image alone", () => {
    expect(clampDimensions(1080, 1350)).toEqual({ width: 1080, height: 1350, scaled: false });
  });

  it("caps an image over the 16.7 million pixel canvas area", () => {
    const result = clampDimensions(6000, 4000);
    expect(result.scaled).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(16_777_216);
    expect(result.width / result.height).toBeCloseTo(1.5, 3);
  });

  it("caps an extremely long edge", () => {
    const result = clampDimensions(40_000, 100);
    expect(result.scaled).toBe(true);
    expect(result.width).toBeLessThanOrEqual(16_384);
  });
});

describe("computeDrawRect", () => {
  it("crops the sides of a landscape photo for a portrait frame", () => {
    const rect = computeDrawRect(1600, 900, 1080, 1350, "crop");
    expect(rect.sx).toBeGreaterThan(0);
    expect(rect.sy).toBe(0);
    expect(rect.sh).toBe(900);
    expect(rect.sw).toBeCloseTo(720, 5);
    expect(rect.dx).toBe(0);
    expect(rect.dy).toBe(0);
  });

  it("crops the top and bottom of a portrait photo for a landscape frame", () => {
    const rect = computeDrawRect(1080, 1920, 1280, 720, "crop");
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBeGreaterThan(0);
    expect(rect.sw).toBe(1080);
    expect(rect.sh).toBeCloseTo(607.5, 5);
  });

  it("pads a landscape photo into a portrait frame without cropping it", () => {
    const rect = computeDrawRect(1600, 900, 1080, 1350, "pad");
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBe(0);
    expect(rect.sw).toBe(1600);
    expect(rect.sh).toBe(900);
    expect(rect.dx).toBe(0);
    expect(rect.dy).toBeGreaterThan(0);
    expect(rect.dw).toBe(1080);
  });

  it("pads a portrait photo into a landscape frame", () => {
    const rect = computeDrawRect(1080, 1920, 1280, 720, "pad");
    expect(rect.dx).toBeGreaterThan(0);
    expect(rect.dy).toBe(0);
    expect(rect.dh).toBe(720);
  });

  it("stretches the full source into the full destination", () => {
    expect(computeDrawRect(400, 300, 1000, 1000, "stretch")).toEqual({
      sx: 0,
      sy: 0,
      sw: 400,
      sh: 300,
      dx: 0,
      dy: 0,
      dw: 1000,
      dh: 1000,
    });
  });

  it("does not alter a matching aspect ratio", () => {
    const rect = computeDrawRect(1920, 1080, 1280, 720, "crop");
    expect(rect.sw).toBe(1920);
    expect(rect.sh).toBe(1080);
  });
});

describe("isHeicHeader", () => {
  const ascii = (value: string) => new TextEncoder().encode(value);

  it("recognises a HEIC ftyp brand", () => {
    expect(isHeicHeader(ascii("00 00 00 18ftypheic00 00 00 00"))).toBe(true);
  });

  it("recognises a HEIF mif1 brand", () => {
    expect(isHeicHeader(ascii("00 00 00 18ftypmif100 00 00 00"))).toBe(true);
  });

  it("rejects AVIF", () => {
    expect(isHeicHeader(ascii("00 00 00 18ftypavif00 00 00 00"))).toBe(false);
  });

  it("rejects a JPEG header", () => {
    expect(isHeicHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]))).toBe(false);
  });

  it("rejects a short buffer", () => {
    expect(isHeicHeader(new Uint8Array([0x66, 0x74, 0x79, 0x70]))).toBe(false);
  });
});

describe("savingsPercent", () => {
  it("reports a reduction", () => {
    expect(savingsPercent(1_000_000, 240_000)).toBe(76);
  });

  it("reports a negative number when the output grew", () => {
    expect(savingsPercent(100_000, 140_000)).toBe(-40);
  });

  it("returns null for a missing source size", () => {
    expect(savingsPercent(0, 100)).toBeNull();
  });
});
