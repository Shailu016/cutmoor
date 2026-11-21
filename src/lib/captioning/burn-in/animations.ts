import type { CaptionStyle } from "../contracts";
import type { CaptionEvent } from "../types";
import { displayText } from "./word-look";

/**
 * Entry animations for captions. Pure math, shared by the burned-in MP4 (canvas, renderer.ts) and
 * the live preview (HTML, KaraokePreview.tsx), so both draw the same thing at the same caption
 * time. Nothing here reads a clock, `Date`, `Math.random` or the network: the caller passes the
 * progress `t` (0 at the caption's start, 1 when the animation is over), which makes exported
 * frames reproducible.
 *
 * `dx` and `dy` are fractions of the font size (em). The canvas multiplies them by its font size
 * and the preview writes them into a CSS `em` transform, so the movement is visually identical.
 *
 * Every animation ends exactly on the identity frame, so the final frame is the static look and
 * an absent `animation` field keeps a preset byte-for-byte as before.
 */

export interface AnimationFrame {
  opacity: number;
  scale: number;
  /** Horizontal offset, in em (fractions of the font size). */
  dx: number;
  /** Vertical offset, in em. Positive is down. */
  dy: number;
  /** Typewriter only: how many code points of the whole caption are visible. */
  visibleChars?: number;
}

export const ANIMATION_IDS = [
  "none",
  "fade",
  "pop",
  "bounce",
  "slide-up",
  "zoom-in",
  "typewriter",
  "shake",
] as const;

export type AnimationName = (typeof ANIMATION_IDS)[number];
export type AnimationFunction = (t: number, totalChars?: number) => AnimationFrame;

export const DEFAULT_ANIMATION_MS = 200;
/** Longer than this is not an entry animation any more; the picker stays well below it. */
export const MAX_ANIMATION_MS = 5000;

export interface AnimationOption {
  id: AnimationName;
  label: string;
  description: string;
}

export const ANIMATION_OPTIONS: readonly AnimationOption[] = [
  { id: "none", label: "None", description: "The caption appears as it is" },
  { id: "fade", label: "Fade", description: "Softly fades in" },
  { id: "pop", label: "Pop", description: "Pops in with a small overshoot" },
  { id: "bounce", label: "Bounce", description: "Drops in and bounces once" },
  { id: "slide-up", label: "Slide up", description: "Rises into place from below" },
  { id: "zoom-in", label: "Zoom in", description: "Grows from smaller to full size" },
  { id: "typewriter", label: "Typewriter", description: "Letters appear one at a time" },
  { id: "shake", label: "Shake", description: "Shakes itself still" },
];

const IDENTITY: AnimationFrame = { opacity: 1, scale: 1, dx: 0, dy: 0 };

export function isAnimationName(value: unknown): value is AnimationName {
  return typeof value === "string" && (ANIMATION_IDS as readonly string[]).includes(value);
}

/** Clamps progress into 0..1. A non-finite value counts as finished, the safe choice. */
export function clampProgress(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.min(1, Math.max(0, t));
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Overshoots above 1 before settling, which is what makes a pop feel like a pop. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/** The usual bounce curve; reaches exactly 1 at t = 1. */
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const x = t - 1.5 / d1;
    return n1 * x * x + 0.75;
  }
  if (t < 2.5 / d1) {
    const x = t - 2.25 / d1;
    return n1 * x * x + 0.9375;
  }
  const x = t - 2.625 / d1;
  return n1 * x * x + 0.984375;
}

function none(): AnimationFrame {
  return IDENTITY;
}

function fade(t: number): AnimationFrame {
  return { ...IDENTITY, opacity: easeOutQuad(t) };
}

function pop(t: number): AnimationFrame {
  // Fade in quickly while the scale overshoots: the text should not hang at zero size.
  return { ...IDENTITY, opacity: Math.min(1, t * 5), scale: 0.55 + 0.45 * easeOutBack(t) };
}

/** Keeps a computed zero positive, so the final frame equals the identity object exactly (never -0). */
function zero(value: number): number {
  return value === 0 ? 0 : value;
}

function bounce(t: number): AnimationFrame {
  return { ...IDENTITY, opacity: Math.min(1, t * 6), dy: zero(-0.75 * (1 - easeOutBounce(t))) };
}

function slideUp(t: number): AnimationFrame {
  return { ...IDENTITY, opacity: easeOutQuad(t), dy: 0.6 * (1 - easeOutCubic(t)) };
}

function zoomIn(t: number): AnimationFrame {
  const eased = easeOutCubic(t);
  return { ...IDENTITY, opacity: eased, scale: 0.5 + 0.5 * eased };
}

function typewriter(t: number, totalChars = 0): AnimationFrame {
  // A steady character rate is the typewriter effect; easing the count would make the last
  // letters crawl. The total is code points, matching `animationText`.
  const total = Math.max(0, Math.floor(totalChars));
  const visibleChars = Math.min(total, Math.max(0, Math.floor(t * total + 1e-9)));
  return { ...IDENTITY, visibleChars };
}

function shake(t: number): AnimationFrame {
  // Three quick swings whose amplitude dies out, ending exactly at rest.
  return { ...IDENTITY, dx: zero(Math.sin(t * Math.PI * 6) * 0.14 * (1 - t)) };
}

const ANIMATION_FUNCTIONS: Readonly<Record<AnimationName, AnimationFunction>> = {
  none,
  fade,
  pop,
  bounce,
  "slide-up": slideUp,
  "zoom-in": zoomIn,
  typewriter,
  shake,
};

/**
 * The frame for an animation at progress `t`. An unknown or absent name is "none", so a stored
 * look from a newer version can never make a caption disappear.
 */
export function animationFrame(name: string | null | undefined, t: number, totalChars = 0): AnimationFrame {
  const fn = name ? ANIMATION_FUNCTIONS[name as AnimationName] : undefined;
  return fn ? fn(clampProgress(t), totalChars) : IDENTITY;
}

/** Whether this frame would change the drawing at all. At the end of every animation it is true. */
export function isIdentityFrame(frame: AnimationFrame, totalChars = 0): boolean {
  return (
    frame.opacity === 1 &&
    frame.scale === 1 &&
    frame.dx === 0 &&
    frame.dy === 0 &&
    (frame.visibleChars === undefined || frame.visibleChars >= totalChars)
  );
}

/** The contract's default is 200 ms; 0 is allowed and means "arrive already finished". */
export function animationDurationMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ANIMATION_MS;
  return Math.max(0, Math.min(MAX_ANIMATION_MS, Math.round(value)));
}

/** An entrance may use at most this share of the caption's time on screen, so it is always finished before the caption goes. */
export const MAX_ANIMATION_SHARE = 0.5;

/**
 * The entrance length actually used for one caption: the chosen length, but never more than half the
 * time the caption is on screen. A karaoke caption of 100 ms with a 500 ms typewriter used to end at
 * 20% progress, with the words cut off; now it takes 50 ms and ends complete. Both renderers use this.
 */
export function effectiveAnimationMs(value: number | undefined, captionMs: number): number {
  const chosen = animationDurationMs(value);
  if (!Number.isFinite(captionMs) || captionMs <= 0) return chosen;
  return Math.min(chosen, Math.floor(captionMs * MAX_ANIMATION_SHARE));
}

/** Code points, not UTF-16 units, so a typewriter never splits a surrogate pair. */
export function charCount(text: string): number {
  return [...text].length;
}

/** Characters of a caption (display text, so uppercase is counted exactly as it will be drawn). */
export function captionCharCount(event: Pick<CaptionEvent, "lines">, uppercase?: boolean): number {
  let total = 0;
  for (const line of event.lines) {
    for (const word of line) total += charCount(displayText(word.text, { uppercase }));
  }
  return total;
}

/**
 * The visible part of one word for a typewriter frame. `charOffset` is the number of code points
 * before this word in the caption. Non-typewriter frames return the word unchanged.
 */
export function animationText(text: string, charOffset: number, frame: AnimationFrame | null | undefined): string {
  if (!frame || frame.visibleChars === undefined) return text;
  const chars = [...text];
  const shown = Math.max(0, Math.min(chars.length, Math.floor(frame.visibleChars) - charOffset));
  return shown >= chars.length ? text : chars.slice(0, shown).join("");
}
