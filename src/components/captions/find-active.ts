import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { anchorFromOrigin, type Anchor, type SafeArea, type Size } from "../../lib/captioning/burn-in/position";

/**
 * Finding "what is being said right now" for the karaoke preview and the editor. These run up to
 * 60 times a second while a video plays, so they use binary search: a two-hour transcript has
 * tens of thousands of words, and walking them every frame would waste a phone's battery.
 */

export interface ActivePosition {
  /** Position in the events array. */
  event: number;
  /** Line inside that event. */
  line: number;
  /** Word inside that line, or -1 when the caption is showing but its first word has not started yet. */
  word: number;
}

/** Index of the last item whose `startMs` is at or before `timeMs`, or -1. Items must be sorted by start. */
function lastStartedAtOrBefore(items: ReadonlyArray<{ startMs: number }>, timeMs: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (items[mid].startMs <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Which caption block is on screen at `timeMs`, and which word in it is being spoken. The spoken
 * word is the last one that has started: it stays highlighted through a short pause until the next
 * word begins, so the highlight does not flicker off between words. Returns null between captions.
 */
export function findActive(events: readonly CaptionEvent[], timeMs: number): ActivePosition | null {
  const eventIndex = lastStartedAtOrBefore(events, timeMs);
  if (eventIndex < 0) return null;
  const event = events[eventIndex];
  if (timeMs >= event.endMs) return null;
  let line = 0;
  let word = -1;
  for (let l = 0; l < event.lines.length; l += 1) {
    const words = event.lines[l];
    for (let w = 0; w < words.length; w += 1) {
      if (words[w].startMs <= timeMs) {
        line = l;
        word = w;
      } else {
        return { event: eventIndex, line, word };
      }
    }
  }
  return { event: eventIndex, line, word };
}

export interface WordAtTime {
  /** Index in the word list, or -1 when the list is empty. */
  index: number;
  /** 0 when `timeMs` is inside the word, otherwise how far away the nearest word is. */
  distanceMs: number;
}

/**
 * The word being spoken at `timeMs`, or if it falls in a silence, the nearest word. Words must be
 * sorted by start time and not overlap (the editor guarantees it).
 */
export function findWordAtTime(words: readonly Word[], timeMs: number): WordAtTime {
  if (words.length === 0) return { index: -1, distanceMs: 0 };
  const before = lastStartedAtOrBefore(words, timeMs);
  const distance = (word: Word) => (timeMs < word.startMs ? word.startMs - timeMs : timeMs >= word.endMs ? timeMs - word.endMs + 1 : 0);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  // The word that started last, and its neighbours: a gap is closest to one of the two words around it.
  for (const candidate of [before, before + 1]) {
    if (candidate < 0 || candidate >= words.length) continue;
    const d = distance(words[candidate]);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return { index: best, distanceMs: bestDistance };
}

/** Where a video of `media` size sits when fitted inside `box` without cropping (CSS object-fit: contain). */
export function fitRect(boxW: number, boxH: number, mediaW: number, mediaH: number): { x: number; y: number; width: number; height: number } {
  if (!(boxW > 0 && boxH > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  if (!(mediaW > 0 && mediaH > 0)) return { x: 0, y: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / mediaW, boxH / mediaH);
  const width = mediaW * scale;
  const height = mediaH * scale;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

export interface Point {
  x: number;
  y: number;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A client (pointer) position in the video picture's own pixel coordinates. */
export function pointerInPicture(picture: ClientRectLike, clientX: number, clientY: number): Point {
  return { x: clientX - picture.left, y: clientY - picture.top };
}

/** Where inside the block the pointer went down, in CSS pixels from the block's top-left. */
export function grabOffsetFromRect(rect: ClientRectLike, clientX: number, clientY: number): Point {
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return { x: clamp(clientX - rect.left, rect.width), y: clamp(clientY - rect.top, rect.height) };
}

export interface DragAnchorInput {
  /** The picture's box in client coordinates. */
  picture: ClientRectLike;
  /** Where inside the block the pointer went down, fixed for the whole drag. */
  grab: Point;
  /** Pointer position in client coordinates. */
  clientX: number;
  clientY: number;
  /** The block's size in frame pixels (its measured width/height). */
  blockSize: Size;
  /** The frame's safe area in frame pixels. */
  safe: SafeArea;
}

/**
 * The anchors that keep the point of the block the visitor grabbed under the pointer.
 * Pure, so the drag maths can be tested without a browser: convert the pointer to picture
 * coordinates, subtract the fixed grab offset, and invert the block placement.
 */
export function anchorForDrag(input: DragAnchorInput): Anchor {
  const point = pointerInPicture(input.picture, input.clientX, input.clientY);
  return anchorFromOrigin(point.x - input.grab.x, point.y - input.grab.y, input.safe, input.blockSize);
}
