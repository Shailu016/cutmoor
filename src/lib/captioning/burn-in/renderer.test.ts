import { describe, expect, it } from "vitest";
import type { CaptionStyle } from "../contracts";
import type { CaptionEvent, Word } from "../types";
import { CAPTION_STYLES } from "./styles";
import {
  MIN_FONT_PX,
  SAFE_MARGIN_X,
  activeWordIndex,
  baseFontPx,
  bottomMargin,
  createCaptionRenderer,
  layoutEvent,
} from "./renderer";
import type { Canvas2DLike, MeasureText } from "./renderer";

const word = (text: string, startMs: number, endMs: number, index = 0): Word => ({
  text,
  startMs,
  endMs,
  confidence: 1,
  index,
  windowIndex: 0,
});

/** Each code point is 0.55 em wide: deterministic and linear in the font size, like real text. */
const measure: MeasureText = (text, fontPx) => [...text].length * 0.55 * fontPx;

/** Builds an event from lines of words, spacing words 300 ms apart. */
function makeEvent(lines: string[][], startMs = 1000, index = 0): CaptionEvent {
  let t = startMs;
  let i = 0;
  const built = lines.map((line) =>
    line.map((text) => {
      const w = word(text, t, t + 280, i++);
      t += 300;
      return w;
    }),
  );
  return { index, startMs, endMs: t, lines: built };
}

type Call = { op: string; args: unknown[]; state: { font: string; fill: unknown; stroke: unknown } };

/** A context that records every call with the style state at that moment. */
function recordingContext(): { ctx: Canvas2DLike; calls: Call[] } {
  const calls: Call[] = [];
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
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: measure(text, px) };
    },
    fillText: (...args) => calls.push({ op: "fillText", args, state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    strokeText: (...args) => calls.push({ op: "strokeText", args, state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    beginPath: () => calls.push({ op: "beginPath", args: [], state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    moveTo: (...args) => calls.push({ op: "moveTo", args, state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    arcTo: (...args) => calls.push({ op: "arcTo", args, state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    closePath: () => calls.push({ op: "closePath", args: [], state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    fill: () => calls.push({ op: "fill", args: [], state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    save: () => calls.push({ op: "save", args: [], state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
    restore: () => calls.push({ op: "restore", args: [], state: { font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle } }),
  };
  return { ctx, calls };
}

const style = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...CAPTION_STYLES.clean, ...over });

/** Seeded random numbers so fuzz failures can be reproduced. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("layoutEvent", () => {
  it("keeps the event's own lines and centres each line horizontally", () => {
    const layout = layoutEvent(makeEvent([["Hello", "world"], ["again"]]), measure, style(), 1280, 720);
    expect(layout.lines.map((l) => l.words.map((w) => w.text))).toEqual([["Hello", "world"], ["again"]]);
    const fontPx = layout.fontPx;
    expect(fontPx).toBe(baseFontPx(style(), 720));
    const space = 0.55 * fontPx;
    const line0 = layout.lines[0];
    const expectedWidth = 5 * 0.55 * fontPx + space + 5 * 0.55 * fontPx;
    expect(line0.width).toBeCloseTo(expectedWidth, 6);
    expect(line0.x).toBeCloseTo((1280 - expectedWidth) / 2, 6);
    // Second word starts exactly one word plus one space after the first.
    expect(line0.words[1].x).toBeCloseTo(line0.x + 5 * 0.55 * fontPx + space, 6);
    // Line 1 is centred on its own width.
    const line1 = layout.lines[1];
    expect(line1.x + line1.width / 2).toBeCloseTo(640, 6);
  });

  it("stacks rows downward and puts the bottom row at the bottom margin", () => {
    const layout = layoutEvent(makeEvent([["one"], ["two"]]), measure, style({ position: "bottom" }), 1280, 720);
    expect(layout.lines[1].y - layout.lines[0].y).toBeCloseTo(layout.rowHeight, 6);
    expect(layout.bounds.bottom).toBeCloseTo(720 - bottomMargin(1280, 720), 6);
  });

  it("centres the block vertically for position middle", () => {
    const layout = layoutEvent(makeEvent([["one"], ["two"]]), measure, style({ position: "middle" }), 1280, 720);
    expect((layout.bounds.top + layout.bounds.bottom) / 2).toBeCloseTo(360, 6);
  });

  it("leaves more room at the bottom of portrait video for app overlays", () => {
    expect(bottomMargin(1080, 1920) / 1920).toBeGreaterThan(bottomMargin(1920, 1080) / 1080);
  });

  it("scales the font with the frame height", () => {
    const small = layoutEvent(makeEvent([["hi"]]), measure, style(), 640, 360);
    const large = layoutEvent(makeEvent([["hi"]]), measure, style(), 1280, 720);
    expect(large.fontPx).toBe(small.fontPx * 2);
  });

  it("wraps a line that is too wide for the frame instead of overflowing", () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${i}`);
    const layout = layoutEvent(makeEvent([words]), measure, style(), 640, 360);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.flatMap((l) => l.words.map((w) => w.text))).toEqual(words);
    for (const line of layout.lines) {
      expect(line.x).toBeGreaterThanOrEqual(640 * SAFE_MARGIN_X - 1e-6);
      expect(line.x + line.width).toBeLessThanOrEqual(640 * (1 - SAFE_MARGIN_X) + 1e-6);
    }
  });

  it("shrinks the font when a single word is wider than the frame", () => {
    const layout = layoutEvent(makeEvent([["Supercalifragilisticexpialidocious".repeat(4)]]), measure, style(), 640, 360);
    expect(layout.fontPx).toBeLessThan(baseFontPx(style(), 360));
    expect(layout.bounds.left).toBeGreaterThanOrEqual(640 * SAFE_MARGIN_X - 1e-6);
    expect(layout.bounds.right).toBeLessThanOrEqual(640 * (1 - SAFE_MARGIN_X) + 1e-6);
  });

  it("shrinks the font when the wrapped block would be too tall", () => {
    // Narrow portrait frame: many rows at the base size.
    const words = Array.from({ length: 40 }, () => "caption");
    const layout = layoutEvent(makeEvent([words]), measure, style({ fontScale: 0.06 }), 360, 640);
    expect(layout.bounds.bottom - layout.bounds.top).toBeLessThanOrEqual(640 * 0.4 + 1e-6);
  });

  it("includes pill padding in the bounds and none for other backgrounds", () => {
    const ev = makeEvent([["pill"]]);
    const pill = layoutEvent(ev, measure, style({ background: "pill" }), 1280, 720);
    const none = layoutEvent(ev, measure, style({ background: "none" }), 1280, 720);
    expect(pill.padX).toBeGreaterThan(0);
    expect(none.padX).toBe(0);
    expect(pill.bounds.left).toBeCloseTo(pill.lines[0].x - pill.padX, 6);
    expect(pill.bounds.right).toBeCloseTo(pill.lines[0].x + pill.lines[0].width + pill.padX, 6);
  });

  it("drops empty words and returns an empty layout when nothing is left", () => {
    const layout = layoutEvent(makeEvent([[" ", ""], ["  "]]), measure, style(), 1280, 720);
    expect(layout.lines).toEqual([]);
    expect(layout.words).toEqual([]);
  });

  it("measures Devanagari text by code point and keeps it unsplit", () => {
    const hindi = "नमस्ते";
    const layout = layoutEvent(makeEvent([[hindi, "दोस्तों"]]), measure, style(), 1280, 720);
    expect(layout.lines[0].words.map((w) => w.text)).toEqual([hindi, "दोस्तों"]);
    expect(layout.lines[0].words[0].width).toBeCloseTo([...hindi].length * 0.55 * layout.fontPx, 6);
  });

  it("never throws and never leaves the safe area, for random frames and words (seeded fuzz)", () => {
    const random = rng(20240611);
    const alphabet = "abcdefghijklmnopqrstuvwxyzनमस्तेदोस्तों";
    for (let run = 0; run < 400; run++) {
      const width = 120 + Math.floor(random() * 3880);
      const height = 120 + Math.floor(random() * 3880);
      const lineCount = 1 + Math.floor(random() * 3);
      const lines: string[][] = [];
      for (let l = 0; l < lineCount; l++) {
        const n = 1 + Math.floor(random() * 9);
        lines.push(
          Array.from({ length: n }, () => {
            const len = 1 + Math.floor(random() * 14);
            return Array.from({ length: len }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
          }),
        );
      }
      const bg = (["none", "pill", "outline"] as const)[Math.floor(random() * 3)];
      const pos = (["bottom", "middle"] as const)[Math.floor(random() * 2)];
      const layout = layoutEvent(makeEvent(lines), measure, style({ background: bg, position: pos, fontScale: 0.02 + random() * 0.08 }), width, height);

      const label = `run ${run} ${width}x${height} ${bg} ${pos}`;
      expect(layout.bounds.left, label).toBeGreaterThanOrEqual(width * SAFE_MARGIN_X - 1e-6);
      expect(layout.bounds.right, label).toBeLessThanOrEqual(width * (1 - SAFE_MARGIN_X) + 1e-6);
      expect(layout.bounds.top, label).toBeGreaterThanOrEqual(0);
      expect(layout.bounds.bottom, label).toBeLessThanOrEqual(height + 1e-6);
      expect(layout.bounds.bottom - layout.bounds.top, label).toBeLessThanOrEqual(height * 0.4 + 1e-6);
      // Words stay in order and none is lost.
      expect(layout.lines.flatMap((l) => l.words.map((w) => w.text)), label).toEqual(lines.flat());
      // Within a row, words never overlap.
      for (const line of layout.lines) {
        for (let i = 1; i < line.words.length; i++) {
          expect(line.words[i].x, label).toBeGreaterThan(line.words[i - 1].x + line.words[i - 1].width - 1e-6);
        }
      }
    }
  });

  it("at the minimum font a hopeless word is clamped to the left margin instead of looping or throwing", () => {
    const layout = layoutEvent(makeEvent([["x".repeat(2000)]]), measure, style(), 200, 120);
    expect(layout.fontPx).toBe(MIN_FONT_PX);
    expect(layout.lines[0].x).toBeGreaterThanOrEqual(200 * SAFE_MARGIN_X - 1e-6);
  });

  it("finding 6: a hopeless single token is broken up so the whole caption stays inside the safe area", () => {
    for (const token of ["x".repeat(2000), "x".repeat(40), "https://example.com/" + "a".repeat(300)]) {
      const layout = layoutEvent(makeEvent([[token]]), measure, style(), 200, 120);
      expect(layout.bounds.left).toBeGreaterThanOrEqual(200 * SAFE_MARGIN_X - 1e-6);
      expect(layout.bounds.right).toBeLessThanOrEqual(200 * (1 - SAFE_MARGIN_X) + 1e-6);
      expect(layout.bounds.bottom - layout.bounds.top).toBeLessThanOrEqual(120 * 0.4 + 1e-6);
      for (const line of layout.lines) expect(line.words.length).toBeGreaterThan(0);
    }
  });
});

describe("activeWordIndex", () => {
  const words = [word("a", 100, 200), word("b", 300, 400), word("c", 500, 600)];
  it("is -1 before the first word starts", () => {
    expect(activeWordIndex(words, 99)).toBe(-1);
  });
  it("switches exactly at each word's start (inclusive)", () => {
    expect(activeWordIndex(words, 100)).toBe(0);
    expect(activeWordIndex(words, 299.9)).toBe(0);
    expect(activeWordIndex(words, 300)).toBe(1);
    expect(activeWordIndex(words, 5000)).toBe(2);
  });
  it("stays on the last word through the gap after it ends", () => {
    expect(activeWordIndex(words, 250)).toBe(0);
  });
});

describe("createCaptionRenderer", () => {
  const ev = makeEvent([["Namaste", "dosto"], ["welcome"]], 1000, 0); // words start 1000, 1300, 1600; event ends 1900

  it("draws nothing outside every event and exactly at the boundaries (start inclusive, end exclusive)", () => {
    const { ctx, calls } = recordingContext();
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style() });
    expect(r.draw(999.9)).toBeNull();
    expect(r.draw(1900)).toBeNull();
    expect(calls.filter((c) => c.op === "fillText")).toHaveLength(0);
    expect(r.draw(1000)).toBe(ev);
    expect(r.draw(1899.9)).toBe(ev);
  });

  it("draws every word once at the laid-out position, with the active word in the active colour", () => {
    const { ctx, calls } = recordingContext();
    const s = style({ background: "none" });
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: s });
    r.draw(1350); // second word started at 1300
    const texts = calls.filter((c) => c.op === "fillText");
    expect(texts.map((c) => c.args[0])).toEqual(["Namaste", "dosto", "welcome"]);
    expect(texts.map((c) => c.state.fill)).toEqual([s.textColor, s.activeColor, s.textColor]);
    const layout = r.layoutOf(ev);
    expect(texts.map((c) => [c.args[1], c.args[2]])).toEqual(layout.lines.flatMap((l) => l.words.map((w) => [w.x, l.y])));
  });

  it("highlights nothing before the first word starts but still shows the caption block", () => {
    const early: CaptionEvent = { ...ev, startMs: 800 };
    const { ctx, calls } = recordingContext();
    const s = style({ background: "none" });
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [early], style: s }).draw(900);
    const fills = calls.filter((c) => c.op === "fillText").map((c) => c.state.fill);
    expect(fills).toEqual([s.textColor, s.textColor, s.textColor]);
  });

  it("does not move any word when the highlight moves", () => {
    const { ctx, calls } = recordingContext();
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style() });
    r.draw(1050);
    const first = calls.filter((c) => c.op === "fillText").map((c) => [c.args[1], c.args[2]]);
    calls.length = 0;
    r.draw(1700);
    const later = calls.filter((c) => c.op === "fillText").map((c) => [c.args[1], c.args[2]]);
    expect(later).toEqual(first);
  });

  it("measures each distinct word once however many frames are drawn", () => {
    const { ctx } = recordingContext();
    let measured = 0;
    const original = ctx.measureText.bind(ctx);
    ctx.measureText = (t: string) => {
      measured++;
      return original(t);
    };
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style() });
    r.draw(1000);
    const afterFirst = measured;
    for (let t = 1000; t < 1900; t += 33) r.draw(t);
    expect(measured).toBe(afterFirst);
  });

  it("pill style fills one rounded rectangle per line behind the text, before the text", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "pill" }) }).draw(1000);
    const ops = calls.map((c) => c.op);
    expect(ops.filter((o) => o === "fill")).toHaveLength(2);
    expect(ops.lastIndexOf("fill")).toBeLessThan(ops.indexOf("fillText"));
    expect(ops.filter((o) => o === "arcTo")).toHaveLength(8);
  });

  it("outline style strokes every word before filling it, and fills no pill", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "outline" }) }).draw(1000);
    const ops = calls.map((c) => c.op);
    expect(ops.filter((o) => o === "strokeText")).toHaveLength(3);
    expect(ops.filter((o) => o === "fill")).toHaveLength(0);
    expect(ops.lastIndexOf("strokeText")).toBeLessThan(ops.indexOf("fillText"));
  });

  it("none style adds a soft shadow and nothing else behind the text", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "none" }) }).draw(1000);
    expect(ctx.shadowBlur).toBeGreaterThan(0);
    expect(calls.some((c) => c.op === "fill" || c.op === "strokeText")).toBe(false);
  });

  it("uses a font string that has the Devanagari fallbacks after the style family", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [makeEvent([["नमस्ते"]])], style: style() }).draw(1000);
    const font = calls.find((c) => c.op === "fillText")?.state.font ?? "";
    expect(font).toMatch(/^600 \d+px "Geist Variable", .*"Noto Sans Devanagari".*"Nirmala UI".*sans-serif$/);
    expect(calls.find((c) => c.op === "fillText")?.args[0]).toBe("नमस्ते");
  });

  it("karaoke: spoken words in the text colour, words still to come dimmed", () => {
    const { ctx, calls } = recordingContext();
    const s = style({ background: "none", activeColor: "#ffffff", textColor: "#ffffff", upcomingColor: "#999999" });
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: s }).draw(1350);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.state.fill)).toEqual(["#ffffff", "#ffffff", "#999999"]);
  });

  it("a spoken reveal draws only the words said so far, at their final positions", () => {
    const { ctx, calls } = recordingContext();
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ reveal: "spoken", background: "outline" }) });
    r.draw(1350);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["Namaste", "dosto"]);
    expect(calls.filter((c) => c.op === "strokeText").map((c) => c.args[0])).toEqual(["Namaste", "dosto"]);
    const layout = r.layoutOf(ev);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[1])).toEqual(layout.lines[0].words.map((w) => w.x));
    calls.length = 0;
    r.draw(950 + 100); // before the second word: only the first
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["Namaste"]);
  });

  it("a box style fills one box behind the spoken word, before the text, and does not outline that word", () => {
    const { ctx, calls } = recordingContext();
    const s = style({ background: "outline", activeBox: "#c6f432", activeColor: "#111111" });
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: s });
    r.draw(1350);
    const fills = calls.filter((c) => c.op === "fill");
    expect(fills).toHaveLength(1);
    expect(fills[0].state.fill).toBe("#c6f432");
    const ops = calls.map((c) => c.op);
    expect(ops.indexOf("fill")).toBeLessThan(ops.indexOf("fillText"));
    expect(calls.filter((c) => c.op === "strokeText").map((c) => c.args[0])).toEqual(["Namaste", "welcome"]);
    const layout = r.layoutOf(ev);
    const boxLeft = calls.find((c) => c.op === "moveTo")?.args[0] as number;
    const dosto = layout.lines[0].words[1];
    expect(boxLeft).toBeGreaterThan(dosto.x - layout.fontPx * 0.5);
    expect(boxLeft).toBeLessThan(dosto.x + layout.fontPx * 0.2); // moveTo starts after the corner radius
    calls.length = 0;
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: s }).draw(1050 - 100); // before any word
    expect(calls.some((c) => c.op === "fill")).toBe(false);
  });

  it("capitals: draws upper-case text and lays it out at that width; Devanagari is unchanged", () => {
    const { ctx, calls } = recordingContext();
    const e = makeEvent([["namaste", "नमस्ते"]]);
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [e], style: style({ uppercase: true }) }).draw(1000);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["NAMASTE", "नमस्ते"]);
  });

  it("highlights numbers in the number colour only when asked, and the spoken word still wins", () => {
    const e = makeEvent([["gold", "is", "$5,000", "up", "40%"]]);
    const s = style({ background: "none", numberColor: "#ff00ff" });
    const fillsAt = (on: boolean, t: number) => {
      const { ctx, calls } = recordingContext();
      createCaptionRenderer({ ctx, width: 1280, height: 720, events: [e], style: { ...s, highlightNumbers: on } }).draw(t);
      return calls.filter((c) => c.op === "fillText").map((c) => c.state.fill);
    };
    expect(fillsAt(true, 1050)).toEqual([s.activeColor, s.textColor, "#ff00ff", s.textColor, "#ff00ff"]);
    expect(fillsAt(true, 1650)).toEqual([s.textColor, s.textColor, s.activeColor, s.textColor, "#ff00ff"]);
    expect(fillsAt(false, 1050)).toEqual([s.activeColor, s.textColor, s.textColor, s.textColor, s.textColor]);
  });

  it("every preset draws without throwing at landscape and portrait sizes", () => {
    for (const preset of Object.values(CAPTION_STYLES)) {
      for (const [w, h] of [[1920, 1080], [720, 1280]]) {
        const { ctx, calls } = recordingContext();
        const r = createCaptionRenderer({ ctx, width: w, height: h, events: [ev], style: { ...preset, highlightNumbers: true } });
        for (let t = 900; t < 2000; t += 50) r.draw(t);
        expect(calls.filter((c) => c.op === "fillText").length, preset.id).toBeGreaterThan(0);
        const layout = r.layoutOf(ev);
        expect(layout.bounds.left, preset.id).toBeGreaterThanOrEqual(w * SAFE_MARGIN_X - 0.01);
        if (preset.activeBox) expect(layout.padX, preset.id).toBeGreaterThan(0); // the hopping box is counted in the bounds
        expect(layout.bounds.right, preset.id).toBeLessThanOrEqual(w * (1 - SAFE_MARGIN_X) + 0.01);
      }
    }
  });

  it("brackets drawing in save/restore so styles never leak into the video frame", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style() }).draw(1000);
    const ops = calls.map((c) => c.op);
    expect(ops[0]).toBe("save");
    expect(ops[ops.length - 1]).toBe("restore");
  });

  it("finds a long event that began before a shorter one inside it", () => {
    const long = makeEvent([["long"]], 0, 0);
    long.endMs = 10_000;
    const short = makeEvent([["short"]], 2000, 1);
    short.endMs = 3000;
    const { ctx } = recordingContext();
    const r = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [long, short], style: style() });
    expect(r.draw(2500)).toBe(short);
    expect(r.draw(5000)).toBe(long);
  });
});
