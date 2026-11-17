/**
 * Reading and removing the hidden data inside picture files: camera make and model, date, GPS location, serial
 * numbers, editing software, comments. Works on the file's own bytes, so a JPEG, PNG, or WebP is cleaned WITHOUT
 * re-encoding: the picture stays bit-for-bit the same and only the metadata is cut out. Other formats are not handled here
 * (the tool re-draws them instead, which also drops their metadata).
 */

export type MetaKind = "jpeg" | "png" | "webp" | "other";

export interface Finding {
  label: string;
  value: string;
  /** "high" for things that identify a place or a person's device; "low" for the rest. */
  risk: "high" | "low";
}

export interface Inspection {
  kind: MetaKind;
  findings: Finding[];
  /** EXIF orientation (1 to 8), 1 when absent. */
  orientation: number;
  /** True when the file carries any metadata block this module would remove. */
  hasMetadata: boolean;
}

export function sniffKind(bytes: Uint8Array): MetaKind {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return "other";
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < Math.min(bytes.length, start + length); i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

// ---- JPEG segments --------------------------------------------------------------------------------------

interface Segment {
  marker: number;
  /** Offset of the 0xFF that starts the marker. */
  start: number;
  /** Offset just after the segment's last byte. */
  end: number;
}

/** The marker segments before the picture data starts (start of scan). */
function jpegSegments(bytes: Uint8Array): { segments: Segment[]; scanStart: number } {
  const segments: Segment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xda) return { segments, scanStart: offset };
    // Markers with no length: restart, start/end of image, standalone.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      segments.push({ marker, start: offset, end: offset + 2 });
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    segments.push({ marker, start: offset, end: Math.min(bytes.length, offset + 2 + length) });
    offset += 2 + length;
  }
  return { segments, scanStart: bytes.length };
}

const isExifSegment = (bytes: Uint8Array, s: Segment) => s.marker === 0xe1 && ascii(bytes, s.start + 4, 6) === "Exif\0\0";
const isXmpSegment = (bytes: Uint8Array, s: Segment) => s.marker === 0xe1 && ascii(bytes, s.start + 4, 28).startsWith("http://ns.adobe.com/xap/1.0/");

// ---- EXIF (TIFF) reading --------------------------------------------------------------------------------

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset of the value bytes inside the TIFF block. */
  valueOffset: number;
}

class Tiff {
  readonly view: DataView;
  readonly little: boolean;
  constructor(readonly bytes: Uint8Array, readonly base: number) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.little = ascii(bytes, base, 2) === "II";
  }
  u16(at: number) {
    return this.view.getUint16(at, this.little);
  }
  u32(at: number) {
    return this.view.getUint32(at, this.little);
  }
  /** The entries of the IFD at `offset` (relative to the TIFF header). Bad offsets give an empty list. */
  ifd(offset: number): Entry[] {
    const at = this.base + offset;
    if (offset < 8 || at + 2 > this.bytes.length) return [];
    const count = this.u16(at);
    const entries: Entry[] = [];
    for (let i = 0; i < count && at + 2 + (i + 1) * 12 <= this.bytes.length; i += 1) {
      const entry = at + 2 + i * 12;
      const type = this.u16(entry + 2);
      const n = this.u32(entry + 4);
      const size = (TYPE_SIZE[type] ?? 1) * n;
      const valueOffset = size <= 4 ? entry + 8 : this.base + this.u32(entry + 8);
      if (valueOffset + size > this.bytes.length) continue;
      entries.push({ tag: this.u16(entry), type, count: n, valueOffset });
    }
    return entries;
  }
  text(entry: Entry): string {
    return ascii(this.bytes, entry.valueOffset, entry.count).replace(/\0+$/, "").trim();
  }
  number(entry: Entry, index = 0): number {
    if (entry.type === 3) return this.u16(entry.valueOffset + index * 2);
    if (entry.type === 4) return this.u32(entry.valueOffset + index * 4);
    if (entry.type === 5) {
      const den = this.u32(entry.valueOffset + index * 8 + 4);
      return den === 0 ? 0 : this.u32(entry.valueOffset + index * 8) / den;
    }
    return this.bytes[entry.valueOffset + index];
  }
}

function degrees(tiff: Tiff, entry: Entry | undefined, ref: Entry | undefined): number | null {
  if (!entry || entry.type !== 5 || entry.count < 3) return null;
  const value = tiff.number(entry, 0) + tiff.number(entry, 1) / 60 + tiff.number(entry, 2) / 3600;
  const side = ref ? tiff.text(ref).toUpperCase() : "";
  return side === "S" || side === "W" ? -value : value;
}

/** What the EXIF block of a JPEG says, or null when it cannot be read. */
function readExif(bytes: Uint8Array, segment: Segment): { findings: Finding[]; orientation: number } | null {
  const tiffBase = segment.start + 10;
  if (tiffBase + 8 > segment.end) return null;
  const order = ascii(bytes, tiffBase, 2);
  if (order !== "II" && order !== "MM") return null;
  const tiff = new Tiff(bytes, tiffBase);
  if (tiff.u16(tiffBase + 2) !== 42) return null;
  const findings: Finding[] = [];
  let orientation = 1;

  const ifd0 = tiff.ifd(tiff.u32(tiffBase + 4));
  const get = (list: Entry[], tag: number) => list.find((entry) => entry.tag === tag);
  const add = (label: string, value: string, risk: Finding["risk"]) => {
    if (value) findings.push({ label, value, risk });
  };

  const make = get(ifd0, 0x010f);
  const model = get(ifd0, 0x0110);
  const device = [make && tiff.text(make), model && tiff.text(model)].filter(Boolean).join(" ");
  add("Camera or phone", device, "high");
  const software = get(ifd0, 0x0131);
  if (software) add("Software", tiff.text(software), "low");
  const artist = get(ifd0, 0x013b);
  if (artist) add("Author", tiff.text(artist), "high");
  const copyright = get(ifd0, 0x8298);
  if (copyright) add("Copyright note", tiff.text(copyright), "low");
  const orient = get(ifd0, 0x0112);
  if (orient) orientation = Math.min(8, Math.max(1, tiff.number(orient)));
  const taken = get(ifd0, 0x0132);

  const exifPointer = get(ifd0, 0x8769);
  if (exifPointer) {
    const exif = tiff.ifd(tiff.number(exifPointer));
    const original = get(exif, 0x9003);
    add("Date and time taken", original ? tiff.text(original) : taken ? tiff.text(taken) : "", "low");
    const lens = get(exif, 0xa434);
    if (lens) add("Lens", tiff.text(lens), "low");
    for (const [tag, label] of [[0xa431, "Camera serial number"], [0xa435, "Lens serial number"], [0xa430, "Owner name"]] as const) {
      const entry = get(exif, tag);
      if (entry) add(label, tiff.text(entry), "high");
    }
  } else if (taken) {
    add("Date and time taken", tiff.text(taken), "low");
  }

  const gpsPointer = get(ifd0, 0x8825);
  if (gpsPointer) {
    const gps = tiff.ifd(tiff.number(gpsPointer));
    const lat = degrees(tiff, get(gps, 2), get(gps, 1));
    const lon = degrees(tiff, get(gps, 4), get(gps, 3));
    if (lat !== null && lon !== null) add("GPS location", `${lat.toFixed(5)}, ${lon.toFixed(5)}`, "high");
    else if (gps.length > 0) add("GPS data", "present", "high");
    const altitude = get(gps, 6);
    if (altitude) add("Altitude", `${tiff.number(altitude).toFixed(0)} m`, "low");
  }
  return { findings, orientation };
}

// ---- PNG and WebP ---------------------------------------------------------------------------------------

const PNG_META_CHUNKS = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);

function pngChunks(bytes: Uint8Array): Array<{ type: string; start: number; end: number }> {
  const chunks: Array<{ type: string; start: number; end: number }> = [];
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    chunks.push({ type: ascii(bytes, offset + 4, 4), start: offset, end });
    offset = end;
  }
  return chunks;
}

function webpChunks(bytes: Uint8Array): Array<{ type: string; start: number; end: number }> {
  const chunks: Array<{ type: string; start: number; end: number }> = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    const end = Math.min(bytes.length, offset + 8 + size + (size % 2));
    chunks.push({ type: ascii(bytes, offset, 4), start: offset, end });
    offset = end;
  }
  return chunks;
}

// ---- public: inspect ------------------------------------------------------------------------------------

export function inspectMetadata(bytes: Uint8Array): Inspection {
  const kind = sniffKind(bytes);
  const findings: Finding[] = [];
  let orientation = 1;
  let hasMetadata = false;

  if (kind === "jpeg") {
    const { segments } = jpegSegments(bytes);
    for (const segment of segments) {
      if (isExifSegment(bytes, segment)) {
        hasMetadata = true;
        const read = readExif(bytes, segment);
        if (read) {
          findings.push(...read.findings);
          orientation = read.orientation;
        }
      } else if (isXmpSegment(bytes, segment)) {
        hasMetadata = true;
        findings.push({ label: "XMP data", value: "editing history and tags", risk: "low" });
      } else if (segment.marker === 0xed) {
        hasMetadata = true;
        findings.push({ label: "IPTC / Photoshop data", value: "captions and keywords", risk: "low" });
      } else if (segment.marker === 0xfe) {
        hasMetadata = true;
        findings.push({ label: "Comment", value: ascii(bytes, segment.start + 4, Math.min(80, segment.end - segment.start - 4)).trim(), risk: "low" });
      }
    }
  } else if (kind === "png") {
    for (const chunk of pngChunks(bytes)) {
      if (PNG_META_CHUNKS.has(chunk.type)) {
        hasMetadata = true;
        const label = chunk.type === "tIME" ? "Last-changed time" : chunk.type === "eXIf" ? "EXIF data" : "Text note";
        findings.push({ label, value: chunk.type === "tEXt" ? ascii(bytes, chunk.start + 8, Math.min(60, chunk.end - chunk.start - 12)).replace(/\0/g, ": ") : "present", risk: chunk.type === "eXIf" ? "high" : "low" });
      }
    }
  } else if (kind === "webp") {
    for (const chunk of webpChunks(bytes)) {
      if (chunk.type === "EXIF" || chunk.type === "XMP ") {
        hasMetadata = true;
        findings.push({ label: chunk.type === "EXIF" ? "EXIF data" : "XMP data", value: "present", risk: chunk.type === "EXIF" ? "high" : "low" });
      }
    }
  }
  return { kind, findings, orientation, hasMetadata };
}

// ---- public: strip --------------------------------------------------------------------------------------

/** A small EXIF block that holds only the orientation, so a rotated phone photo still shows upright after cleaning. */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const out = new Uint8Array(10 + 8 + 2 + 12 + 4);
  out.set([0xff, 0xe1], 0);
  const length = out.length - 2;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  const view = new DataView(out.buffer);
  const base = 10;
  out.set([0x4d, 0x4d], base);
  view.setUint16(base + 2, 42);
  view.setUint32(base + 4, 8);
  view.setUint16(base + 8, 1);
  view.setUint16(base + 10, 0x0112);
  view.setUint16(base + 12, 3);
  view.setUint32(base + 14, 1);
  view.setUint16(base + 18, orientation);
  view.setUint32(base + 22, 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The file with its metadata cut out. JPEG keeps its colour profile and gets back only the orientation (when it is not
 * the default), PNG and WebP lose every metadata chunk. Returns null for formats this module does not handle.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array | null {
  const kind = sniffKind(bytes);
  if (kind === "jpeg") {
    const { segments, scanStart } = jpegSegments(bytes);
    const orientation = inspectMetadata(bytes).orientation;
    const parts: Uint8Array[] = [bytes.subarray(0, 2)];
    if (orientation !== 1) parts.push(orientationOnlyExif(orientation));
    for (const segment of segments) {
      const drop = isExifSegment(bytes, segment) || isXmpSegment(bytes, segment) || segment.marker === 0xed || segment.marker === 0xfe || (segment.marker === 0xe1);
      if (!drop) parts.push(bytes.subarray(segment.start, segment.end));
    }
    parts.push(bytes.subarray(scanStart));
    return concat(parts);
  }
  if (kind === "png") {
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    for (const chunk of pngChunks(bytes)) if (!PNG_META_CHUNKS.has(chunk.type)) parts.push(bytes.subarray(chunk.start, chunk.end));
    return concat(parts);
  }
  if (kind === "webp") {
    const kept: Uint8Array[] = [];
    let hadMeta = false;
    for (const chunk of webpChunks(bytes)) {
      if (chunk.type === "EXIF" || chunk.type === "XMP ") {
        hadMeta = true;
        continue;
      }
      const part = bytes.slice(chunk.start, chunk.end);
      if (chunk.type === "VP8X" && part.length >= 18) part[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      kept.push(part);
    }
    if (!hadMeta) return bytes;
    const body = concat(kept);
    const out = new Uint8Array(12 + body.length);
    out.set(bytes.subarray(0, 12), 0);
    out.set(body, 12);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return out;
  }
  return null;
}
