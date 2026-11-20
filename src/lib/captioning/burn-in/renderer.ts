import type { CaptionStyle } from "../contracts";
import type { CaptionEvent, Word } from "../types";
import { cssFont } from "./font-stack";
import { createEventLookup } from "./timeline";
import { displayText, isWordVisible, wordColor, wordState } from "./word-look";

/**
 * Lays out and draws caption events onto a 2D canvas.
 *
 * Two layers, so the hard part is testable without a browser:
 *  - `layoutEvent` is pure: it takes a `measure(text, fontPx)` function and returns where every word
 *    goes. Tests feed it a fake measure and assert positions.
 *  - `createCaptionRenderer` wires a real (or recording fake) context into it and draws.
 *
 * Decisions that matter:
 *  - Width never changes when a word becomes the active one (only its colour does), so the
 *    karaoke highlight cannot make the text jitter.
 *  - Layout is computed once per event and cached; a frame only picks colours and draws.
 *  - Everything is forced inside a safe area. If a block would not fit, the font shrinks until it does.
 */

/** The small part of CanvasRenderingContext2D we use. A recording fake implements the same. */
export interface Canvas2DLike {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  closePath(): void;
  fill(): void;
  save(): void;
  restore(): void;
}

export type MeasureText = (text: string, fontPx: number) => number;

/** Sides stay 5% from the frame edge. */
export const SAFE_MARGIN_X = 0.05;
/** Block height never exceeds 40% of the frame so captions cannot swallow the picture. */
export const MAX_BLOCK_HEIGHT = 0.4;
/** Below this the text is unreadable anyway; stop shrinking. */
export const MIN_FONT_PX = 6;
const LINE_HEIGHT = 1.3;
const PILL_COLOR = "rgba(0, 0, 0, 0.66)";
const OUTLINE_COLOR = "#000000";
/** How far the spoken-word box reaches past the word on each side, as a fraction of the font size. */
export const ACTIVE_BOX_PAD = 0.14;

export interface PlacedWord {
  text: string;
  /** Left edge. */
  x: number;
  width: number;
  /** Position in `EventLayout.words`. */
  wordIndex: number;
}

export interface PlacedLine {
  words: PlacedWord[];
  /** Left edge of the line's text. */
  x: number;
  /** Vertical centre of the row (text is drawn with a middle baseline). */
  y: number;
  /** Width of the text without padding. */
  width: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EventLayout {
  fontPx: number;
  /** The event's words with empty text removed; `PlacedWord.wordIndex` indexes this. */
  words: Word[];
  lines: PlacedLine[];
  /** Row height, and the padding used by the pill. */
  rowHeight: number;
  padX: number;
  /** Everything drawn for this event (text plus pill padding) lies inside this box. */
  bounds: Box;
}

export function baseFontPx(style: Pick<CaptionStyle, "fontScale">, frameHeight: number): number {
  const scale = Number.isFinite(style.fontScale) && style.fontScale > 0 ? style.fontScale : 0.05;
  return Math.max(MIN_FONT_PX, Math.round(scale * frameHeight));
}

/** Distance from the frame bottom to the block's bottom edge. Portrait video leaves more room for app UI overlays. */
export function bottomMargin(frameWidth: number, frameHeight: number): number {
  return frameHeight * (frameHeight > frameWidth ? 0.16 : 0.07);
}

/** Greedy wrap of word indices into rows no wider than `maxWidth`. A single over-wide word keeps its own row. */
function wrapRow(indices: number[], widths: number[], space: number, maxWidth: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let rowWidth = 0;
  for (const i of indices) {
    const next = row.length === 0 ? widths[i] : rowWidth + space + widths[i];
    if (row.length > 0 && next > maxWidth) {
      rows.push(row);
      row = [i];
      rowWidth = widths[i];
    } else {
      row.push(i);
      rowWidth = next;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Cuts `text` into the fewest pieces (at grapheme boundaries) that each measure no wider than `limit`. At least one character per piece. */
function splitToWidth(text: string, measure: (text: string) => number, limit: number): string[] {
  const graphemes: string[] =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new (Intl as unknown as { Segmenter: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: "grapheme" }).segment(text), (x) => x.segment)
      : Array.from(text);
  const pieces: string[] = [];
  let current = "";
  for (const g of graphemes) {
    if (current !== "" && measure(current + g) > limit) {
      pieces.push(current);
      current = g;
    } else {
      current += g;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

/**
 * Where every word of an event goes. Pure.
 *
 * Starts from the event's own line breaks (layout.ts chose them for balance), re-wraps any line
 * that is too wide for this frame, and shrinks the font if the block is still too wide or too tall.
 */
export function layoutEvent(
  event: CaptionEvent,
  measure: MeasureText,
  style: Pick<CaptionStyle, "fontScale" | "background" | "position" | "uppercase" | "activeBox">,
  frameWidth: number,
  frameHeight: number,
): EventLayout {
  let words: Word[] = [];
  let lineHints: number[][] = [];
  for (const line of event.lines) {
    const hint: number[] = [];
    for (const word of line) {
      const text = displayText(word.text, style);
      if (text.length === 0) continue;
      hint.push(words.length);
      words.push(text === word.text ? word : { ...word, text });
    }
    if (hint.length > 0) lineHints.push(hint);
  }

  const marginX = frameWidth * SAFE_MARGIN_X;
  const maxBlockHeight = frameHeight * MAX_BLOCK_HEIGHT;
  const usePill = style.background === "pill";
  let fontPx = baseFontPx(style, frameHeight);

  let rows: number[][] = [];
  let widths: number[] = [];
  let space = 0;
  let rowWidths: number[] = [];
  let padX = 0;
  let rowHeight = 0;

  for (let attempt = 0; attempt < 24; attempt++) {
    widths = words.map((w) => measure(w.text.trim(), fontPx));
    space = measure(" ", fontPx);
    // A pill, or the box behind the spoken word, reaches past the text; keep that inside the safe area too.
    padX = usePill ? fontPx * 0.4 : style.activeBox ? fontPx * ACTIVE_BOX_PAD : 0;
    rowHeight = fontPx * LINE_HEIGHT;
    const maxTextWidth = frameWidth - 2 * marginX - 2 * padX;

    rows = lineHints.flatMap((hint) => wrapRow(hint, widths, space, maxTextWidth));
    rowWidths = rows.map((row) => row.reduce((sum, i, k) => sum + widths[i] + (k > 0 ? space : 0), 0));

    const widest = rowWidths.reduce((a, b) => Math.max(a, b), 0);
    const blockHeight = rows.length * rowHeight;
    const shrink = Math.min(
      widest > maxTextWidth && widest > 0 ? maxTextWidth / widest : 1,
      blockHeight > maxBlockHeight && blockHeight > 0 ? maxBlockHeight / blockHeight : 1,
    );
    if (shrink >= 1 || fontPx <= MIN_FONT_PX) break;
    // The 0.98 and the "at least one px" make sure each pass strictly shrinks, so this terminates.
    fontPx = Math.max(MIN_FONT_PX, Math.min(fontPx - 1, Math.floor(fontPx * shrink * 0.98)));
  }

  // Last resort for a single token wider than the safe area even at the smallest font (a very long URL):
  // break it at character boundaries so it stays inside the frame instead of running off it.
  const safeWidth = frameWidth - 2 * marginX - 2 * padX;
  if (words.some((_, i) => widths[i] > safeWidth)) {
    const ellipsis = "…";
    const limit = Math.max(1, safeWidth - measure(ellipsis, fontPx));
    const splitWords: Word[] = [];
    const splitHints: number[][] = [];
    for (const hint of lineHints) {
      const next: number[] = [];
      for (const i of hint) {
        const text = words[i].text.trim();
        if (widths[i] <= safeWidth) {
          next.push(splitWords.length);
          splitWords.push(words[i]);
          continue;
        }
        for (const piece of splitToWidth(text, (t) => measure(t, fontPx), limit)) {
          next.push(splitWords.length);
          splitWords.push({ ...words[i], text: piece });
        }
      }
      splitHints.push(next);
    }
    words = splitWords;
    lineHints = splitHints;
    widths = words.map((w) => measure(w.text, fontPx));
    rows = lineHints.flatMap((hint) => wrapRow(hint, widths, space, safeWidth));
    const maxRows = Math.max(1, Math.floor(maxBlockHeight / rowHeight));
    if (rows.length > maxRows) {
      rows = rows.slice(0, maxRows);
      const last = rows[rows.length - 1];
      const tail = last[last.length - 1];
      words[tail] = { ...words[tail], text: words[tail].text + ellipsis };
      widths[tail] = measure(words[tail].text, fontPx);
    }
    rowWidths = rows.map((row) => row.reduce((sum, i, k) => sum + widths[i] + (k > 0 ? space : 0), 0));
  }

  const blockHeight = rows.length * rowHeight;
  const bottomEdge = frameHeight - bottomMargin(frameWidth, frameHeight);
  const blockTop = style.position === "middle" ? (frameHeight - blockHeight) / 2 : bottomEdge - blockHeight;

  const lines: PlacedLine[] = [];
  let left = Infinity;
  let right = -Infinity;
  rows.forEach((row, r) => {
    const width = rowWidths[r];
    // Centre, but never start left of the margin even if (at the minimum font) the row is too wide.
    const x = Math.max(marginX + padX, (frameWidth - width) / 2);
    let cursor = x;
    const placed: PlacedWord[] = row.map((i) => {
      const word: PlacedWord = { text: words[i].text.trim(), x: cursor, width: widths[i], wordIndex: i };
      cursor += widths[i] + space;
      return word;
    });
    lines.push({ words: placed, x, y: blockTop + r * rowHeight + rowHeight / 2, width });
    left = Math.min(left, x - padX);
    right = Math.max(right, x + width + padX);
  });

  const bounds: Box =
    lines.length === 0
      ? { left: 0, top: 0, right: 0, bottom: 0 }
      : { left, top: blockTop, right, bottom: blockTop + blockHeight };
  return { fontPx, words, lines, rowHeight, padX, bounds };
}

/**
 * The word being spoken at `timeMs`: the last word that has started. It stays lit through short
 * pauses until the next word begins, which reads as steady karaoke rather than flicker. -1 before
 * the first word starts.
 */
export function activeWordIndex(words: readonly Word[], timeMs: number): number {
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].startMs <= timeMs) active = i;
    else break;
  }
  return active;
}

export interface CaptionRendererOptions {
  ctx: Canvas2DLike;
  width: number;
  height: number;
  events: readonly CaptionEvent[];
  style: CaptionStyle;
}

export interface CaptionRenderer {
  /** Draws the caption showing at `timeMs` (if any) and returns that event. Draws nothing and returns null otherwise. */
  draw(timeMs: number): CaptionEvent | null;
  /** The cached layout of an event; computed on first use. */
  layoutOf(event: CaptionEvent): EventLayout;
}

function roundedRect(ctx: Canvas2DLike, left: number, top: number, right: number, bottom: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(right, top, right, bottom, r);
  ctx.arcTo(right, bottom, left, bottom, r);
  ctx.arcTo(left, bottom, left, top, r);
  ctx.arcTo(left, top, right, top, r);
  ctx.closePath();
}

export function createCaptionRenderer(options: CaptionRendererOptions): CaptionRenderer {
  const { ctx, width, height, style } = options;
  const lookup = createEventLookup(options.events);
  const cache = new WeakMap<CaptionEvent, EventLayout>();
  // Measuring is the slow part of layout; the same word at the same size is measured once.
  const measureCache = new Map<string, number>();

  const measure: MeasureText = (text, fontPx) => {
    const key = `${fontPx}|${text}`;
    const known = measureCache.get(key);
    if (known !== undefined) return known;
    ctx.font = cssFont(style, fontPx);
    const value = ctx.measureText(text).width;
    measureCache.set(key, value);
    return value;
  };

  const layoutOf = (event: CaptionEvent): EventLayout => {
    let layout = cache.get(event);
    if (!layout) {
      layout = layoutEvent(event, measure, style, width, height);
      cache.set(event, layout);
    }
    return layout;
  };

  return {
    layoutOf,
    draw(timeMs: number): CaptionEvent | null {
      const event = lookup.at(timeMs);
      if (!event) return null;
      const layout = layoutOf(event);
      if (layout.lines.length === 0) return event;

      const active = activeWordIndex(layout.words, timeMs);
      ctx.save();
      ctx.font = cssFont(style, layout.fontPx);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.lineJoin = "round";

      if (style.background === "pill") {
        ctx.fillStyle = PILL_COLOR;
        const inset = layout.rowHeight * 0.04;
        for (const line of layout.lines) {
          roundedRect(
            ctx,
            line.x - layout.padX,
            line.y - layout.rowHeight / 2 + inset,
            line.x + line.width + layout.padX,
            line.y + layout.rowHeight / 2 - inset,
            layout.fontPx * 0.35,
          );
          ctx.fill();
        }
      } else if (style.background === "none") {
        // No box behind the text, so a soft shadow keeps it readable on bright footage.
        ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
        ctx.shadowBlur = layout.fontPx * 0.18;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = layout.fontPx * 0.05;
      }

      const visible = (word: PlacedWord) => isWordVisible(wordState(word.wordIndex, active), style);

      if (style.activeBox && active >= 0) {
        // A box behind the spoken word, drawn without the text shadow. It reaches past the word's
        // own width rather than changing it, so the line never moves when the box hops on.
        const line = layout.lines.find((l) => l.words.some((w) => w.wordIndex === active));
        const word = line?.words.find((w) => w.wordIndex === active);
        if (line && word) {
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0)";
          ctx.shadowBlur = 0;
          ctx.fillStyle = style.activeBox;
          const padX = layout.fontPx * ACTIVE_BOX_PAD;
          const half = layout.rowHeight * 0.44;
          roundedRect(ctx, word.x - padX, line.y - half, word.x + word.width + padX, line.y + half, layout.fontPx * 0.18);
          ctx.fill();
          ctx.restore();
        }
      }

      if (style.background === "outline") {
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = layout.fontPx * 0.16;
        for (const line of layout.lines) {
          for (const word of line.words) {
            // The word on the box is dark on a light box; a black outline would only smudge the box.
            if (!visible(word) || (style.activeBox && word.wordIndex === active)) continue;
            ctx.strokeText(word.text, word.x, line.y);
          }
        }
      }

      for (const line of layout.lines) {
        for (const word of line.words) {
          const state = wordState(word.wordIndex, active);
          if (!isWordVisible(state, style)) continue;
          const onBox = Boolean(style.activeBox) && state === "active";
          if (onBox) {
            ctx.save();
            ctx.shadowColor = "rgba(0, 0, 0, 0)";
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = wordColor(word.text, state, style);
          ctx.fillText(word.text, word.x, line.y);
          if (onBox) ctx.restore();
        }
      }
      ctx.restore();
      return event;
    },
  };
}
