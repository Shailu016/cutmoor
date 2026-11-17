import { describe, expect, it } from "vitest";
import { inspectMetadata, orientationOnlyExif, sniffKind, stripMetadata } from "./exif";

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Builds a little-endian TIFF block with two levels of IFD, enough to exercise the reader. */
function buildTiff(options: { orientation?: number; gps?: boolean }): Uint8Array {
  const out: number[] = [];
  const u16 = (n: number) => out.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (n: number) => out.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  out.push(...enc("II"));
  u16(42);
  u32(8);

  // Plan the layout: IFD0 at 8, then the strings, then the Exif IFD, then the GPS IFD.
  const make = enc("Apple\0");
  const model = enc("iPhone 14\0");
  const dateTaken = enc("2024:05:17 10:30:00\0");
  const serial = enc("SN12345\0");
  const ifd0Entries = 4 + (options.gps ? 1 : 0) + (options.orientation ? 1 : 0);
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  let cursor = 8 + ifd0Size;
  const makeAt = cursor;
  cursor += make.length;
  const modelAt = cursor;
  cursor += model.length;
  const dateAt = cursor;
  cursor += dateTaken.length;
  const serialAt = cursor;
  cursor += serial.length;
  const exifIfdAt = cursor;
  cursor += 2 + 2 * 12 + 4;
  const gpsIfdAt = cursor;

  u16(ifd0Entries);
  const entry = (tag: number, type: number, count: number, value: number) => {
    u16(tag);
    u16(type);
    u32(count);
    if (type === 3 && count === 1) {
      u16(value);
      u16(0);
    } else u32(value);
  };
  entry(0x010f, 2, make.length, makeAt);
  entry(0x0110, 2, model.length, modelAt);
  if (options.orientation) entry(0x0112, 3, 1, options.orientation);
  entry(0x8769, 4, 1, exifIfdAt);
  if (options.gps) entry(0x8825, 4, 1, gpsIfdAt);
  entry(0x0132, 2, dateTaken.length, dateAt);
  u32(0);
  out.push(...make, ...model, ...dateTaken, ...serial);
  // Exif IFD: DateTimeOriginal and BodySerialNumber
  u16(2);
  entry(0x9003, 2, dateTaken.length, dateAt);
  entry(0xa431, 2, serial.length, serialAt);
  u32(0);
  if (options.gps) {
    // GPS IFD: N 28 36 50 / E 77 12 30, rationals stored after the IFD.
    const ratAt = gpsIfdAt + 2 + 4 * 12 + 4;
    u16(4);
    entry(1, 2, 2, "N".charCodeAt(0));
    entry(2, 5, 3, ratAt);
    entry(3, 2, 2, "E".charCodeAt(0));
    entry(4, 5, 3, ratAt + 24);
    u32(0);
    for (const [num, den] of [[28, 1], [36, 1], [50, 1], [77, 1], [12, 1], [30, 1]]) {
      u32(num);
      u32(den);
    }
  }
  return Uint8Array.from(out);
}

function jpeg(options: { orientation?: number; gps?: boolean; exif?: boolean; xmp?: boolean; comment?: string }): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  // JFIF
  parts.push(0xff, 0xe0, 0x00, 0x10, ...enc("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0);
  if (options.exif !== false) {
    const tiff = buildTiff({ orientation: options.orientation, gps: options.gps });
    const length = 2 + 6 + tiff.length;
    parts.push(0xff, 0xe1, length >> 8, length & 0xff, ...enc("Exif\0\0"), ...tiff);
  }
  if (options.xmp) {
    const body = enc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>");
    parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  }
  if (options.comment) {
    const body = enc(options.comment);
    parts.push(0xff, 0xfe, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  }
  // ICC profile (must survive) and a tiny scan
  const icc = [...enc("ICC_PROFILE\0"), 1, 1, ...enc("abcdef")];
  parts.push(0xff, 0xe2, (icc.length + 2) >> 8, (icc.length + 2) & 0xff, ...icc);
  parts.push(0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9);
  return Uint8Array.from(parts);
}

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("inspectMetadata (JPEG)", () => {
  it("reads the device, time, serial number and GPS position", () => {
    const info = inspectMetadata(jpeg({ orientation: 6, gps: true }));
    expect(info.kind).toBe("jpeg");
    expect(info.hasMetadata).toBe(true);
    expect(info.orientation).toBe(6);
    const byLabel = Object.fromEntries(info.findings.map((f) => [f.label, f]));
    expect(byLabel["Camera or phone"].value).toBe("Apple iPhone 14");
    expect(byLabel["Date and time taken"].value).toBe("2024:05:17 10:30:00");
    expect(byLabel["Camera serial number"].value).toBe("SN12345");
    expect(byLabel["GPS location"].value).toBe("28.61389, 77.20833");
    expect(byLabel["GPS location"].risk).toBe("high");
  });
  it("reports a file with no metadata as clean", () => {
    const info = inspectMetadata(jpeg({ exif: false }));
    expect(info.hasMetadata).toBe(false);
    expect(info.findings).toEqual([]);
    expect(info.orientation).toBe(1);
  });
  it("finds XMP and comments too", () => {
    const labels = inspectMetadata(jpeg({ exif: false, xmp: true, comment: "shot at the farm" })).findings.map((f) => f.label);
    expect(labels).toContain("XMP data");
    expect(labels).toContain("Comment");
  });
  it("survives a damaged EXIF block without throwing", () => {
    const bytes = jpeg({ gps: true });
    const broken = bytes.slice(0, 60);
    expect(() => inspectMetadata(broken)).not.toThrow();
  });
});

describe("stripMetadata (JPEG)", () => {
  it("removes EXIF, GPS, XMP and comments but keeps the profile and the picture data", () => {
    const original = jpeg({ gps: true, xmp: true, comment: "secret" });
    const clean = stripMetadata(original)!;
    const info = inspectMetadata(clean);
    expect(info.findings).toEqual([]);
    expect(text(clean)).not.toContain("Apple");
    expect(text(clean)).not.toContain("secret");
    expect(text(clean)).toContain("ICC_PROFILE");
    expect(text(clean)).toContain("JFIF");
    expect(clean[0]).toBe(0xff);
    expect(clean[1]).toBe(0xd8);
    expect([...clean.subarray(clean.length - 2)]).toEqual([0xff, 0xd9]);
    expect(clean.length).toBeLessThan(original.length);
  });
  it("keeps only the orientation so a turned phone photo still shows upright", () => {
    const clean = stripMetadata(jpeg({ orientation: 6, gps: true }))!;
    const info = inspectMetadata(clean);
    expect(info.orientation).toBe(6);
    expect(info.findings).toEqual([]);
    expect(info.hasMetadata).toBe(true);
    const plain = inspectMetadata(stripMetadata(jpeg({ orientation: 1 }))!);
    expect(plain.hasMetadata).toBe(false);
  });
  it("leaves the compressed picture bytes exactly as they were", () => {
    const original = jpeg({ gps: true });
    const clean = stripMetadata(original)!;
    const tail = (bytes: Uint8Array) => text(bytes.subarray(text(bytes).indexOf("\xff\xda")));
    expect(tail(clean)).toBe(tail(original));
  });
  it("builds an orientation block the reader understands", () => {
    const block = orientationOnlyExif(8);
    const wrapped = Uint8Array.from([0xff, 0xd8, ...block, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0, 0xff, 0xd9]);
    expect(inspectMetadata(wrapped).orientation).toBe(8);
  });
});

function pngChunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...enc(type), ...data, 0, 0, 0, 0];
}

describe("PNG", () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...pngChunk("tEXt", [...enc("Author"), 0, ...enc("Asha")]),
    ...pngChunk("tIME", [7, 232, 5, 17, 10, 30, 0]),
    ...pngChunk("eXIf", [1, 2, 3, 4]),
    ...pngChunk("iCCP", [1, 2, 3]),
    ...pngChunk("IDAT", [9, 9, 9]),
    ...pngChunk("IEND", []),
  ]);
  it("finds text, time and EXIF chunks", () => {
    const info = inspectMetadata(png);
    expect(info.kind).toBe("png");
    expect(info.hasMetadata).toBe(true);
    expect(info.findings.map((f) => f.label)).toEqual(["Text note", "Last-changed time", "EXIF data"]);
  });
  it("removes those chunks and keeps the rest", () => {
    const clean = stripMetadata(png)!;
    const names = text(clean);
    expect(names).not.toContain("tEXt");
    expect(names).not.toContain("eXIf");
    expect(names).not.toContain("tIME");
    expect(names).toContain("iCCP");
    expect(names).toContain("IDAT");
    expect(names).toContain("IEND");
    expect(inspectMetadata(clean).hasMetadata).toBe(false);
  });
});

function riff(chunks: Array<[string, number[]]>): Uint8Array {
  const body: number[] = [...enc("WEBP")];
  for (const [type, data] of chunks) {
    const size = data.length;
    body.push(...enc(type), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24, ...data);
    if (size % 2) body.push(0);
  }
  const total = body.length;
  return Uint8Array.from([...enc("RIFF"), total & 0xff, (total >> 8) & 0xff, (total >> 16) & 0xff, total >>> 24, ...body]);
}

describe("WebP", () => {
  const vp8x = [0x0c, 0, 0, 0, 1, 0, 0, 1, 0, 0]; // EXIF (0x08) and XMP (0x04) flags set
  const webp = riff([["VP8X", vp8x], ["VP8 ", [1, 2, 3, 4]], ["EXIF", [5, 6, 7]], ["XMP ", [8, 9]]]);
  it("finds EXIF and XMP chunks", () => {
    expect(inspectMetadata(webp).findings.map((f) => f.label)).toEqual(["EXIF data", "XMP data"]);
  });
  it("removes them, fixes the size in the header and clears the flags", () => {
    const clean = stripMetadata(webp)!;
    const view = new DataView(clean.buffer, clean.byteOffset, clean.byteLength);
    expect(view.getUint32(4, true)).toBe(clean.length - 8);
    expect(text(clean)).not.toContain("EXIF");
    expect(text(clean)).not.toContain("XMP ");
    expect(text(clean)).toContain("VP8 ");
    expect(clean[12 + 8] & 0x0c).toBe(0);
  });
  it("returns a clean file unchanged", () => {
    const cleanOne = riff([["VP8 ", [1, 2, 3, 4]]]);
    expect(stripMetadata(cleanOne)).toBe(cleanOne);
  });
});

describe("other files", () => {
  it("are not handled here", () => {
    const gif = Uint8Array.from(enc("GIF89a....."));
    expect(sniffKind(gif)).toBe("other");
    expect(stripMetadata(gif)).toBeNull();
    expect(inspectMetadata(gif).hasMetadata).toBe(false);
  });
});
