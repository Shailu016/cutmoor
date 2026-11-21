import { describe, expect, it } from "vitest";
import type { CaptionStyle } from "../contracts";
import type { CaptionEvent, Word } from "../types";
import {
  ANIMATION_IDS,
  ANIMATION_OPTIONS,
  animationDurationMs,
  animationFrame,
  animationText,
  captionCharCount,
  charCount,
  clampProgress,
  DEFAULT_ANIMATION_MS,
  easeOutBack,
  effectiveAnimationMs,
  easeOutBounce,
  easeOutCubic,
  easeOutQuad,
  isAnimationName,
  isIdentityFrame,
  MAX_ANIMATION_MS,
} from "./animations";
import { createCaptionRenderer, type Canvas2DLike } from "./renderer";
import { CAPTION_STYLES } from "./styles";
import { animationProgress } from "./timeline";

const style = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...CAPTION_STYLES.clean, ...over });
const identity = { opacity: 1, scale: 1, dx: 0, dy: 0 };

function word(text: string, startMs: number, endMs: number, index: number): Word {
  return { text, startMs, endMs, confidence: 1, index, windowIndex: 0 };
}

const event: CaptionEvent = {
  index: 0,
  startMs: 1000,
  endMs: 1800,
  lines: [[word("Hello", 1000, 1200, 0), word("world", 1200, 1400, 1)], [word("again", 1400, 1600, 2)]],
};

describe("animation options", () => {
  it("has the eight required ids, once each, and a label for every one", () => {
    expect(ANIMATION_IDS).toEqual(["none", "fade", "pop", "bounce", "slide-up", "zoom-in", "typewriter", "shake"]);
    expect(ANIMATION_OPTIONS.map((option) => option.id)).toEqual(ANIMATION_IDS);
    expect(new Set(ANIMATION_IDS).size).toBe(ANIMATION_IDS.length);
    for (const option of ANIMATION_OPTIONS) expect(option.label.length).toBeGreaterThan(0);
  });

  it("recognises only known names", () => {
    for (const id of ANIMATION_IDS) expect(isAnimationName(id)).toBe(true);
    expect(isAnimationName("glow")).toBe(false);
    expect(isAnimationName("")).toBe(false);
    expect(isAnimationName(undefined)).toBe(false);
  });
});

describe("animationFrame", () => {
  it("clamps progress and treats a missing or unknown name as none", () => {
    expect(clampProgress(-2)).toBe(0);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(1);
    expect(animationFrame(undefined, 0.3)).toEqual(identity);
    expect(animationFrame(null, 0.3)).toEqual(identity);
    expect(animationFrame("not-a-real-animation", 0.3)).toEqual(identity);
    expect(animationFrame("fade", -5)).toEqual(animationFrame("fade", 0));
    expect(animationFrame("fade", 5)).toEqual(animationFrame("fade", 1));
  });

  it("keeps every frame finite and inside sensible bounds (seeded sweep)", () => {
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let run = 0; run < 500; run++) {
      const name = ANIMATION_IDS[Math.floor(random() * ANIMATION_IDS.length)];
      const t = random() * 1.4 - 0.2;
      const total = Math.floor(random() * 80);
      const frame = animationFrame(name, t, total);
      expect(Number.isFinite(frame.opacity), name).toBe(true);
      expect(Number.isFinite(frame.scale), name).toBe(true);
      expect(Number.isFinite(frame.dx), name).toBe(true);
      expect(Number.isFinite(frame.dy), name).toBe(true);
      expect(frame.opacity, name).toBeGreaterThanOrEqual(0);
      expect(frame.opacity, name).toBeLessThanOrEqual(1);
      expect(frame.scale, name).toBeGreaterThan(0);
      expect(Math.abs(frame.dx), name).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.dy), name).toBeLessThanOrEqual(1);
      if (frame.visibleChars !== undefined) {
        expect(frame.visibleChars, name).toBeGreaterThanOrEqual(0);
        expect(frame.visibleChars, name).toBeLessThanOrEqual(total);
      }
    }
  });

  it("ends every animation exactly on the static look", () => {
    for (const name of ANIMATION_IDS) {
      const frame = animationFrame(name, 1, 27);
      expect(frame, name).toMatchObject(identity);
      expect(isIdentityFrame(frame, 27), name).toBe(true);
    }
  });

  it("none never changes anything", () => {
    for (let i = 0; i <= 20; i++) expect(animationFrame("none", i / 20)).toEqual(identity);
  });

  it("fade follows an ease-out opacity curve", () => {
    expect(animationFrame("fade", 0).opacity).toBe(0);
    expect(animationFrame("fade", 0.5).opacity).toBeCloseTo(easeOutQuad(0.5), 12);
    expect(animationFrame("fade", 0.5).opacity).toBeCloseTo(0.75, 12);
    expect(animationFrame("fade", 1).opacity).toBe(1);
  });

  it("pop starts small and overshoots before settling", () => {
    expect(animationFrame("pop", 0).scale).toBeCloseTo(0.55, 12);
    expect(animationFrame("pop", 0.6).scale).toBeGreaterThan(1);
    expect(animationFrame("pop", 1).scale).toBe(1);
    expect(easeOutBack(0.6)).toBeGreaterThan(1);
  });

  it("bounce starts above its resting place and lands at zero", () => {
    expect(animationFrame("bounce", 0).dy).toBeCloseTo(-0.75, 12);
    expect(animationFrame("bounce", 0.5).dy).toBeLessThan(0);
    expect(animationFrame("bounce", 1).dy).toBe(0);
    expect(easeOutBounce(1)).toBe(1);
  });

  it("slide-up starts below, transparent, and rises to rest", () => {
    expect(animationFrame("slide-up", 0).dy).toBeCloseTo(0.6, 12);
    expect(animationFrame("slide-up", 0).opacity).toBe(0);
    expect(animationFrame("slide-up", 0.5).dy).toBeCloseTo(0.6 * (1 - easeOutCubic(0.5)), 12);
    expect(animationFrame("slide-up", 1).dy).toBe(0);
  });

  it("zoom-in grows from half size", () => {
    expect(animationFrame("zoom-in", 0).scale).toBeCloseTo(0.5, 12);
    expect(animationFrame("zoom-in", 1).scale).toBe(1);
  });

  it("shake moves sideways in the middle and is at rest at both ends", () => {
    expect(animationFrame("shake", 0).dx).toBe(0);
    expect(animationFrame("shake", 0.25).dx).not.toBe(0);
    expect(Math.abs(animationFrame("shake", 0.25).dx)).toBeGreaterThan(0.05);
    expect(animationFrame("shake", 1).dx).toBe(0);
  });

  it("typewriter reveals whole code points, never more than the total, and never goes back", () => {
    const total = 17;
    expect(animationFrame("typewriter", 0, total).visibleChars).toBe(0);
    expect(animationFrame("typewriter", 1, total).visibleChars).toBe(total);
    let previous = -1;
    for (let i = 0; i <= 40; i++) {
      const shown = animationFrame("typewriter", i / 40, total).visibleChars ?? -1;
      expect(shown).toBeGreaterThanOrEqual(previous);
      expect(shown).toBeLessThanOrEqual(total);
      previous = shown;
    }
    expect(animationFrame("typewriter", 0.5, total).visibleChars).toBe(Math.floor(0.5 * total + 1e-9));
    expect(animationFrame("typewriter", 0.5, 0).visibleChars).toBe(0);
  });

  it("is deterministic for the same name, time and length", () => {
    for (const name of ANIMATION_IDS) {
      expect(animationFrame(name, 0.37, 19)).toEqual(animationFrame(name, 0.37, 19));
    }
  });
});

describe("timing helpers", () => {
  it("defaults to 200 ms and keeps 0 meaning 'already finished'", () => {
    expect(DEFAULT_ANIMATION_MS).toBe(200);
    expect(animationDurationMs(undefined)).toBe(200);
    expect(animationDurationMs(Number.NaN)).toBe(200);
    expect(animationDurationMs(0)).toBe(0);
    expect(animationDurationMs(-50)).toBe(0);
    expect(animationDurationMs(250.6)).toBe(251);
    expect(animationDurationMs(999_999)).toBe(MAX_ANIMATION_MS);
  });

  it("counts progress from the caption's own start, not a clock", () => {
    expect(animationProgress(1000, 900, 200)).toBe(0);
    expect(animationProgress(1000, 1000, 200)).toBe(0);
    expect(animationProgress(1000, 1100, 200)).toBe(0.5);
    expect(animationProgress(1000, 1200, 200)).toBe(1);
    expect(animationProgress(1000, 1400, 200)).toBe(1);
    expect(animationProgress(1000, 1100, 0)).toBe(1);
    expect(animationProgress(Number.NaN, 1100, 200)).toBe(1);
  });

  it("makes the first and last exported frames reproducible", () => {
    const at = (timeMs: number) => animationFrame("fade", animationProgress(event.startMs, timeMs, 200));
    expect(at(event.startMs)).toEqual(at(event.startMs));
    expect(at(event.startMs + 100)).toEqual(at(event.startMs + 100));
    expect(at(event.startMs + 1000)).toEqual(identity);
  });
});

describe("text helpers", () => {
  it("counts code points so surrogate pairs stay whole", () => {
    expect(charCount("abc")).toBe(3);
    expect(charCount("नमस्ते")).toBe([..."नमस्ते"].length);
    expect(charCount("😀a")).toBe(2);
    expect(animationText("😀a", 0, { ...identity, visibleChars: 1 })).toBe("😀");
  });

  it("cuts a word at the caption-wide offset", () => {
    const frame = { ...identity, visibleChars: 7 };
    expect(animationText("Hello", 0, frame)).toBe("Hello");
    expect(animationText("wonderful", 3, frame)).toBe("wond");
    expect(animationText("world", 20, frame)).toBe("");
    expect(animationText("world", 0, null)).toBe("world");
    expect(animationText("world", 0, identity)).toBe("world");
  });

  it("counts the words of an event as they are drawn", () => {
    expect(captionCharCount(event)).toBe(5 + 5 + 5);
    const upper = { ...event, lines: [[word("ab", 0, 1, 0)]] };
    expect(captionCharCount(upper, true)).toBe(2);
  });
});

type Recorded = { op: string; text?: string; alpha: number; x?: number; y?: number };

/** Records draw calls with the alpha in force and the context transforms that were applied. */
function animatedContext(): { ctx: Canvas2DLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let alpha = 1;
  const record = (op: string, extra: Partial<Recorded> = {}) => calls.push({ op, alpha, ...extra });
  const ctx: Canvas2DLike = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    textBaseline: "alphabetic",
    textAlign: "start",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value: number) {
      alpha = value;
    },
    translate: (x, y) => record("translate", { x, y }),
    scale: (x, y) => record("scale", { x, y }),
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: [...text].length * 0.55 * px };
    },
    fillText: (text, x, y) => record("fillText", { text, x, y }),
    strokeText: (text, x, y) => record("strokeText", { text, x, y }),
    beginPath: () => record("beginPath"),
    moveTo: () => record("moveTo"),
    arcTo: () => record("arcTo"),
    closePath: () => record("closePath"),
    fill: () => record("fill"),
    save: () => record("save"),
    restore: () => record("restore"),
  };
  return { ctx, calls };
}

function render(animation: string | undefined, timeMs: number, over: Partial<CaptionStyle> = {}) {
  const { ctx, calls } = animatedContext();
  const s = style({ background: "none", ...(animation === undefined ? {} : { animation, animationMs: 200 }), ...over });
  const renderer = createCaptionRenderer({ ctx, width: 640, height: 360, events: [event], style: s });
  renderer.draw(timeMs);
  return { calls, texts: calls.filter((call) => call.op === "fillText").map((call) => call.text ?? "") };
}

describe("canvas renderer animation hook", () => {
  it("draws exactly as before when the field is absent", () => {
    const { calls, texts } = render(undefined, 1300);
    expect(texts).toEqual(["Hello", "world", "again"]);
    expect(calls.some((call) => call.op === "translate" || call.op === "scale")).toBe(false);
    expect(calls.filter((call) => call.op === "fillText").every((call) => call.alpha === 1)).toBe(true);
  });

  it("leaves the drawing alone when the animation is over or unknown", () => {
    const over = render("fade", 1200);
    expect(over.texts).toEqual(["Hello", "world", "again"]);
    expect(over.calls.some((call) => call.op === "translate" || call.op === "scale")).toBe(false);
    expect(over.calls.filter((call) => call.op === "fillText").every((call) => call.alpha === 1)).toBe(true);

    const unknown = render("glow", 1100);
    expect(unknown.texts).toEqual(["Hello", "world", "again"]);
    expect(unknown.calls.some((call) => call.op === "translate" || call.op === "scale")).toBe(false);
  });

  it("applies the frame's opacity and transform while the animation runs", () => {
    const { calls } = render("fade", 1100);
    const fills = calls.filter((call) => call.op === "fillText");
    expect(fills).toHaveLength(3);
    expect(fills.every((call) => (call.alpha ?? 1) > 0 && (call.alpha ?? 1) < 1)).toBe(true);
    expect(calls.filter((call) => call.op === "translate").length).toBe(2);
    expect(calls.filter((call) => call.op === "scale").length).toBe(1);
    const scale = calls.find((call) => call.op === "scale");
    expect(scale?.x).toBe(1);
    expect(scale?.y).toBe(1);
  });

  it("typewriter draws only the visible characters and finishes with the whole words", () => {
    const total = 5 + 5 + 5;
    const half = render("typewriter", 1100);
    const shown = half.texts.join("");
    expect(shown.length).toBe(Math.floor(total / 2));
    expect(shown).toBe("Hellowo");

    const start = render("typewriter", 1000);
    expect(start.texts).toEqual([]);

    const end = render("typewriter", 1200);
    expect(end.texts).toEqual(["Hello", "world", "again"]);
  });

  it("never draws a zero-length word", () => {
    const { calls } = render("typewriter", 1000);
    expect(calls.filter((call) => call.op === "fillText")).toHaveLength(0);
    expect(calls.filter((call) => call.op === "strokeText")).toHaveLength(0);
  });
});

describe("effectiveAnimationMs: an entrance always finishes before its caption ends", () => {
  it("keeps the chosen length when the caption is long enough", () => {
    expect(effectiveAnimationMs(300, 4000)).toBe(300);
    expect(effectiveAnimationMs(undefined, 4000)).toBe(DEFAULT_ANIMATION_MS);
  });

  it("never uses more than half the caption's time on screen", () => {
    expect(effectiveAnimationMs(500, 100)).toBe(50);
    expect(effectiveAnimationMs(1500, 1000)).toBe(500);
  });

  it("falls back to the chosen length when the caption length is unknown", () => {
    expect(effectiveAnimationMs(400, Number.NaN)).toBe(400);
    expect(effectiveAnimationMs(400, 0)).toBe(400);
    expect(effectiveAnimationMs(400, Number.POSITIVE_INFINITY)).toBe(400);
  });

  it("lets every animation reach the plain caption before a very short caption ends", () => {
    // The reviewer's case: a 100 ms caption with a 500 ms animation ended at 20% progress and stayed cut off.
    for (const id of ANIMATION_IDS) {
      const duration = effectiveAnimationMs(500, 100);
      const progress = animationProgress(0, 100, duration);
      expect(progress, id).toBe(1);
      const text = [..."hello"].length;
      expect(isIdentityFrame(animationFrame(id, progress, text), text), id).toBe(true);
    }
  });
});
