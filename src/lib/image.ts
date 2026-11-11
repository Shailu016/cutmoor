/**
 * Local image engine.
 *
 * Everything here runs in the browser. Images are decoded with the browser's
 * own codec when possible, drawn to a canvas, and re-encoded with the native
 * canvas encoder. HEIC is the exception: Safari decodes it natively, while
 * Chrome, Edge, and Firefox need a lazily loaded libheif build.
 */

export type ImageFormat = "jpeg" | "png" | "webp";
export type ImageFit = "crop" | "pad" | "stretch";
export type SourceKind = ImageFormat | "avif" | "gif" | "bmp" | "heic" | "svg" | "unknown";

export const IMAGE_MIME: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const IMAGE_EXT: Record<ImageFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

/**
 * Safari refuses to paint a canvas larger than 16,777,216 pixels. Capping
 * every output at the same area keeps the tool predictable across browsers
 * and prevents a tab crash on a 48 MP phone photo.
 */
export const MAX_CANVAS_PIXELS = 16_777_216;
export const MAX_CANVAS_EDGE = 16_384;
export const MIN_OUTPUT_EDGE = 64;

export interface Dimensions {
  width: number;
  height: number;
  scaled: boolean;
}

export interface DrawRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface EncoderSupport {
  jpeg: boolean;
  png: boolean;
  webp: boolean;
}

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  kind: SourceKind;
  release: () => void;
}

export interface ImageMeta {
  width: number;
  height: number;
  kind: SourceKind;
  hasAlpha: boolean;
}

export interface RenderOptions {
  width: number;
  height: number;
  fit: ImageFit;
  background?: string | null;
  format: ImageFormat;
  quality?: number;
}

export interface TargetCompressOptions {
  targetBytes: number;
  format: ImageFormat;
  background?: string | null;
  maxWidth?: number;
  maxHeight?: number;
  allowDownscale?: boolean;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface TargetCompressResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number | null;
  note?: string;
}

const SOURCE_LABELS: Record<SourceKind, string> = {
  jpeg: "JPG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
  gif: "GIF",
  bmp: "BMP",
  heic: "HEIC",
  svg: "SVG",
  unknown: "Image",
};

export function sourceLabel(kind: SourceKind): string {
  return SOURCE_LABELS[kind];
}

export function formatMime(format: ImageFormat): string {
  return IMAGE_MIME[format];
}

export function formatExtension(format: ImageFormat): string {
  return IMAGE_EXT[format];
}

/** Best-effort type detection from the MIME type, then the file extension. */
export function detectSourceKind(file: Pick<File, "name" | "type">): SourceKind {
  const type = (file.type || "").toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (type.includes("heic") || type.includes("heif") || extension === "heic" || extension === "heif") return "heic";
  if (type === "image/avif" || extension === "avif") return "avif";
  if (type === "image/webp" || extension === "webp") return "webp";
  if (type === "image/png" || extension === "png") return "png";
  if (type === "image/jpeg" || extension === "jpg" || extension === "jpeg") return "jpeg";
  if (type === "image/gif" || extension === "gif") return "gif";
  if (type === "image/bmp" || extension === "bmp") return "bmp";
  if (type === "image/svg+xml" || extension === "svg") return "svg";
  return "unknown";
}

export function sourceHasAlpha(kind: SourceKind): boolean {
  return kind === "png" || kind === "webp" || kind === "avif" || kind === "gif" || kind === "svg";
}

/** The default output for a source: keep the familiar format, but never emit HEIC or AVIF. */
export function defaultOutputFormat(kind: SourceKind): ImageFormat {
  if (kind === "jpeg" || kind === "heic" || kind === "avif" || kind === "bmp" || kind === "unknown") return "jpeg";
  if (kind === "png" || kind === "svg") return "png";
  return "webp";
}

/** A HEIC/HEIF brand check from the first bytes of the file. AVIF is deliberately excluded. */
export function isHeicHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const header = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 64)));
  if (!header.includes("ftyp")) return false;
  if (header.includes("avif") || header.includes("avis")) return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].some((brand) =>
    header.includes(brand),
  );
}

export async function looksLikeHeic(file: File): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    return isHeicHeader(bytes);
  } catch {
    return false;
  }
}

/** Downscale a source so it fits inside a maximum box, preserving aspect ratio. */
export function fitDimensions(sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number): Dimensions {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: scale < 0.9999,
  };
}

/** Clamp any requested output to the canvas limits every major browser can handle. */
export function clampDimensions(
  width: number,
  height: number,
  maxPixels = MAX_CANVAS_PIXELS,
  maxEdge = MAX_CANVAS_EDGE,
): Dimensions {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.round(width)) : 1;
  const safeHeight = Number.isFinite(height) ? Math.max(1, Math.round(height)) : 1;
  const edgeScale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));
  const pixelScale = Math.min(1, Math.sqrt(maxPixels / (safeWidth * safeHeight)));
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
    scaled: scale < 0.9999,
  };
}

/**
 * Geometry for crop (cover) and pad (contain). Destination coordinates are
 * always the full output canvas; source coordinates pick the visible region.
 */
export function computeDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: ImageFit,
): DrawRect {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);

  if (fit === "stretch") {
    return { sx: 0, sy: 0, sw, sh, dx: 0, dy: 0, dw: targetWidth, dh: targetHeight };
  }

  const sourceRatio = sw / sh;
  const targetRatio = targetWidth / targetHeight;

  if (fit === "crop") {
    if (sourceRatio > targetRatio) {
      const visibleWidth = sh * targetRatio;
      return {
        sx: (sw - visibleWidth) / 2,
        sy: 0,
        sw: visibleWidth,
        sh,
        dx: 0,
        dy: 0,
        dw: targetWidth,
        dh: targetHeight,
      };
    }
    const visibleHeight = sw / targetRatio;
    return {
      sx: 0,
      sy: (sh - visibleHeight) / 2,
      sw,
      sh: visibleHeight,
      dx: 0,
      dy: 0,
      dw: targetWidth,
      dh: targetHeight,
    };
  }

  // Pad: show the whole source, centered, and leave the background visible.
  if (sourceRatio > targetRatio) {
    const drawnHeight = targetWidth / sourceRatio;
    return {
      sx: 0,
      sy: 0,
      sw,
      sh,
      dx: 0,
      dy: (targetHeight - drawnHeight) / 2,
      dw: targetWidth,
      dh: drawnHeight,
    };
  }
  const drawnWidth = targetHeight * sourceRatio;
  return {
    sx: 0,
    sy: 0,
    sw,
    sh,
    dx: (targetWidth - drawnWidth) / 2,
    dy: 0,
    dw: drawnWidth,
    dh: targetHeight,
  };
}

/** The canvas is the single rendering path for compress, resize, convert, and previews. */
export function drawToCanvas(loaded: LoadedImage, options: RenderOptions): HTMLCanvasElement {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not create a canvas. Try a different browser or a smaller image.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const mustBeOpaque = options.format === "jpeg";
  if (options.background || mustBeOpaque) {
    context.fillStyle = options.background || "#ffffff";
    context.fillRect(0, 0, width, height);
  }

  const rect = computeDrawRect(loaded.width, loaded.height, width, height, options.fit);
  context.drawImage(loaded.source, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  return canvas;
}

/** Encode a canvas and refuse to return a mislabeled PNG when the browser lacks the requested encoder. */
export function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality?: number): Promise<Blob> {
  const expected = IMAGE_MIME[format];
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not encode this image. Try a smaller image or another format."));
          return;
        }
        if (blob.type !== expected) {
          reject(
            new Error(
              format === "webp"
                ? "This browser cannot encode WebP from a canvas. Choose JPG or PNG instead."
                : `The browser returned ${blob.type} instead of ${expected}. Try another format.`,
            ),
          );
          return;
        }
        resolve(blob);
      },
      expected,
      format === "png" ? undefined : quality,
    );
  });
}

let encoderSupportPromise: Promise<EncoderSupport> | null = null;

/** Probe once per page load. A feature test beats guessing from the user agent. */
export function getEncoderSupport(): Promise<EncoderSupport> {
  if (typeof document === "undefined") {
    return Promise.resolve({ jpeg: false, png: false, webp: false });
  }
  if (!encoderSupportPromise) {
    encoderSupportPromise = (async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const check = async (format: ImageFormat) => {
        try {
          await canvasToBlob(canvas, format, 0.8);
          return true;
        } catch {
          return false;
        }
      };
      return { jpeg: await check("jpeg"), png: await check("png"), webp: await check("webp") };
    })();
  }
  return encoderSupportPromise;
}

function decodeWithImageElement(file: File, kind: SourceKind): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      reject(new Error(message));
    };

    const timer = window.setTimeout(() => fail("The image took too long to decode. Try a smaller file."), 45_000);

    image.onload = () => {
      if (settled) return;
      if (!image.naturalWidth || !image.naturalHeight) {
        window.clearTimeout(timer);
        fail("The image decoded with no pixels. Try another file.");
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        kind,
        release: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      fail("This file is not an image the browser can decode.");
    };
    image.decoding = "async";
    image.src = url;
  });
}

/**
 * Decode an image, using the native path first. If a HEIC file fails in
 * Chrome/Edge/Firefox, load libheif lazily. The 3.2 MB decoder is only fetched
 * for the files that need it.
 */
export async function loadImage(
  file: File,
  options: { onStatus?: (status: "decoding" | "heic-decoder") => void } = {},
): Promise<LoadedImage> {
  const kind = detectSourceKind(file);
  options.onStatus?.("decoding");

  try {
    return await decodeWithImageElement(file, kind);
  } catch (firstError) {
    if (!(await looksLikeHeic(file))) {
      throw firstError instanceof Error ? firstError : new Error("This image could not be decoded.");
    }

    options.onStatus?.("heic-decoder");
    try {
      const { heicTo } = await import("heic-to");
      const bitmap = await heicTo({ blob: file, type: "bitmap" });
      if (!bitmap.width || !bitmap.height) {
        bitmap.close();
        throw new Error("The HEIC decoder returned an empty image.");
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        kind: "heic",
        release: () => bitmap.close(),
      };
    } catch (heicError) {
      const detail = heicError instanceof Error ? heicError.message : "";
      throw new Error(
        `This HEIC file could not be decoded${detail ? ` (${detail})` : ""}. On an iPhone, open the photo in Photos, tap Share, and export it as a JPEG. Some 10-bit HDR, Live Photo, and burst HEIC variants are not supported.`,
      );
    }
  }
}

export async function readImageMeta(file: File): Promise<ImageMeta> {
  const loaded = await loadImage(file);
  try {
    return {
      width: loaded.width,
      height: loaded.height,
      kind: loaded.kind,
      hasAlpha: sourceHasAlpha(loaded.kind),
    };
  } finally {
    loaded.release();
  }
}

/** A small data URL for the job panel. Keeps a 48 MP source out of the DOM. */
export function createPreview(loaded: LoadedImage, maxEdge = 720): string {
  const size = fitDimensions(loaded.width, loaded.height, maxEdge, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const alpha = sourceHasAlpha(loaded.kind);
  if (!alpha) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(loaded.source, 0, 0, size.width, size.height);
  return alpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.82);
}

/** The quality-mode path used by resize and convert. */
export async function renderImage(loaded: LoadedImage, options: RenderOptions): Promise<Blob> {
  const canvas = drawToCanvas(loaded, options);
  return canvasToBlob(canvas, options.format, options.quality);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

/**
 * Hit a target byte size. Lossy formats binary-search quality first; if even
 * the minimum quality is too large, the image is downscaled in steps. PNG is
 * lossless, so it can only reach a target by reducing dimensions.
 */
export async function compressToTarget(
  loaded: LoadedImage,
  options: TargetCompressOptions,
): Promise<TargetCompressResult> {
  const target = Math.max(1024, Math.round(options.targetBytes));
  const format = options.format;
  const lossy = format !== "png";
  const maxWidth = options.maxWidth ?? loaded.width;
  const maxHeight = options.maxHeight ?? loaded.height;
  const fitted = fitDimensions(loaded.width, loaded.height, maxWidth, maxHeight);
  const clamped = clampDimensions(fitted.width, fitted.height);

  let width = clamped.width;
  let height = clamped.height;
  let best: { blob: Blob; quality: number | null; width: number; height: number } | null = null;
  let downscaled = clamped.scaled || fitted.scaled;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    throwIfAborted(options.signal);
    const canvas = drawToCanvas(loaded, {
      width,
      height,
      fit: "stretch",
      background: options.background,
      format,
    });

    if (lossy) {
      let low = 0.3;
      let high = 0.95;
      let candidate: { blob: Blob; quality: number } | null = null;

      for (let step = 0; step < 7; step += 1) {
        throwIfAborted(options.signal);
        const quality = (low + high) / 2;
        const blob = await canvasToBlob(canvas, format, quality);
        options.onProgress?.(Math.min(0.94, 0.2 + attempt * 0.1 + step * 0.09));
        if (blob.size <= target) {
          candidate = { blob, quality };
          low = quality;
        } else {
          high = quality;
        }
      }

      if (candidate) {
        best = { ...candidate, width, height };
        break;
      }
    } else {
      const blob = await canvasToBlob(canvas, format);
      options.onProgress?.(Math.min(0.94, 0.3 + attempt * 0.12));
      if (blob.size <= target) {
        best = { blob, quality: null, width, height };
        break;
      }
    }

    if (!options.allowDownscale) break;
    if (Math.min(width, height) <= 320) break;
    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));
    downscaled = true;
  }

  if (!best) {
    // Return the smallest thing we can make rather than pretending it worked.
    const canvas = drawToCanvas(loaded, { width, height, fit: "stretch", background: options.background, format });
    const blob = await canvasToBlob(canvas, format, lossy ? 0.3 : undefined);
    best = { blob, quality: lossy ? 0.3 : null, width, height };
    return {
      ...best,
      note: `The smallest version is ${Math.round(blob.size / 1024)} KB, above the ${Math.round(target / 1024)} KB target. Try a smaller output size, a different format, or a higher target.`,
    };
  }

  let note: string | undefined;
  if (downscaled) {
    note = `To reach ${Math.round(target / 1024)} KB, the output was reduced to ${width}×${height}.`;
  }
  if (!lossy && best.quality === null) {
    note = `${note ? `${note} ` : ""}PNG is lossless, so the target was met by reducing dimensions, not by throwing away detail.`;
  }

  options.onProgress?.(1);
  return { ...best, note };
}

/** Human-readable savings for the result panel. */
export function savingsPercent(originalBytes: number, resultBytes: number): number | null {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return null;
  return Math.round(((originalBytes - resultBytes) / originalBytes) * 100);
}
