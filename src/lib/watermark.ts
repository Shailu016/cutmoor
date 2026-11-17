import { canvasToBlob, drawToCanvas, fitDimensions, loadImage } from "./image";

/**
 * Pictures for the watermark tools. The text is drawn by the browser, so any script works (Hindi, Arabic, emoji)
 * with the fonts already on the visitor's device; FFmpeg's own text filter has no fonts in the browser build.
 */

export interface TextMarkOptions {
  text: string;
  color: string;
  bold: boolean;
  /** Draw a soft dark outline so the text stays readable on light and dark pictures. */
  outline: boolean;
}

const FONT_STACK = '"Geist Variable", "Segoe UI", system-ui, -apple-system, "Noto Sans", "Noto Sans Devanagari", sans-serif';
const FONT_PX = 120;

/** The text as a transparent PNG, sized to its own content. */
export async function renderTextMark({ text, color, bold, outline }: TextMarkOptions): Promise<Blob> {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length > 0).slice(0, 4);
  if (lines.length === 0) throw new Error("Type the text for the watermark first.");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not create a canvas for the watermark.");
  const font = `${bold ? "700" : "500"} ${FONT_PX}px ${FONT_STACK}`;
  context.font = font;
  const widths = lines.map((line) => context.measureText(line).width);
  const pad = outline ? 14 : 8;
  const lineHeight = Math.round(FONT_PX * 1.25);
  canvas.width = Math.max(8, Math.ceil(Math.max(...widths)) + pad * 2);
  canvas.height = lineHeight * lines.length + pad * 2;
  // Resizing a canvas resets its state, so the font is set again.
  context.font = font;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.lineJoin = "round";
  lines.forEach((line, index) => {
    const x = canvas.width / 2;
    const y = pad + lineHeight * index + lineHeight / 2;
    if (outline) {
      context.lineWidth = 10;
      context.strokeStyle = "rgba(0, 0, 0, 0.55)";
      context.strokeText(line, x, y);
    }
    context.fillStyle = color;
    context.fillText(line, x, y);
  });
  return canvasToBlob(canvas, "png");
}

/** Any picture the browser (or the HEIC decoder) can read, as a PNG no larger than `maxEdge`, keeping transparency. */
export async function imageToPngBlob(file: File, maxEdge = 1024): Promise<Blob> {
  const loaded = await loadImage(file);
  try {
    const size = fitDimensions(loaded.width, loaded.height, maxEdge, maxEdge);
    const canvas = drawToCanvas(loaded, { width: size.width, height: size.height, fit: "stretch", format: "png", background: null });
    return await canvasToBlob(canvas, "png");
  } finally {
    loaded.release();
  }
}

/** The width of a mark on a picture of `pictureWidth`, for a size given as a share of that width. */
export function markWidthFor(pictureWidth: number, percent: number): number {
  return Math.max(16, Math.round((pictureWidth * Math.min(100, Math.max(2, percent))) / 100));
}
