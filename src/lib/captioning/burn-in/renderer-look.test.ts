import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CaptionStyle } from "../contracts";
import type { CaptionEvent, Word } from "../types";
import { CAPTION_STYLES } from "./styles";
import { createCaptionRenderer } from "./renderer";
import type { Canvas2DLike, MeasureText } from "./renderer";

const word = (text: string, startMs: number, endMs: number, index = 0): Word => ({ text, startMs, endMs, confidence: 1, index, windowIndex: 0 });

const measure: MeasureText = (text, fontPx) => [...text].length * 0.55 * fontPx;

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

interface DrawState {
  font: string;
  fill: unknown;
  stroke: unknown;
  lineWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}
type Call = { op: string; args: unknown[]; state: DrawState };

function recordingContext(): { ctx: Canvas2DLike & { shadowOffsetX: number; shadowOffsetY: number }; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = {
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
  } as Canvas2DLike & { shadowOffsetX: number; shadowOffsetY: number };
  const state = (): DrawState => ({
    font: ctx.font,
    fill: ctx.fillStyle,
    stroke: ctx.strokeStyle,
    lineWidth: ctx.lineWidth,
    shadowColor: ctx.shadowColor,
    shadowBlur: ctx.shadowBlur,
    shadowOffsetX: ctx.shadowOffsetX,
    shadowOffsetY: ctx.shadowOffsetY,
  });
  const push = (op: string, args: unknown[]) => calls.push({ op, args, state: state() });
  ctx.measureText = (text: string) => {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
    return { width: measure(text, px) };
  };
  ctx.fillText = (...args) => push("fillText", args);
  ctx.strokeText = (...args) => push("strokeText", args);
  ctx.beginPath = () => push("beginPath", []);
  ctx.moveTo = (...args) => push("moveTo", args);
  ctx.arcTo = (...args) => push("arcTo", args);
  ctx.closePath = () => push("closePath", []);
  ctx.fill = () => push("fill", []);
  ctx.save = () => push("save", []);
  ctx.restore = () => push("restore", []);
  return { ctx, calls };
}

const style = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...CAPTION_STYLES.clean, ...over });

/** Rounds to 6 decimals so a different order of the same float arithmetic (1e-13 noise) is not a change. */
const roundNumbers = (_key: string, value: unknown) => (typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value);

/** The draw call list of a preset with no custom fields, frozen from the original renderer, before custom looks, positions and animations were added. */
describe("presets without custom fields draw exactly the old calls", () => {
  const expected: Record<string, string> = {
    clean: "65093d75e2fe9cb1c7328388f2eb493c3bb1300b27f66770f57d51264d2b092a",
    shorts: "7aea05a8e743b66385991e5883628e25cc9ef24302699e66cb5d66528489117d",
    bold: "15cf8036c501151557911b72a0d53c19c5dd5ea013e8fd4a8f7bfef28b8fc0b5",
    karaoke: "16ffcbaa31c501e6efc35a699ee5f1fbec98c55302ccbd509b1d16c2913482ad",
    highlighter: "79f6e7f789c4c34615ccd5dc1a1c0d367586a222a82f306025cbc39eaa2dc2d1",
    pop: "7b24afed95a85bd594d4389b726d217b2107b5e2aa44f27ad87c85f5611e89ce",
  };

  it("hashes every recorded canvas call and state for every preset", () => {
    const ev = makeEvent([["Namaste", "dosto"], ["welcome"]], 1000, 0);
    for (const preset of Object.values(CAPTION_STYLES)) {
      const { ctx, calls } = recordingContext();
      const renderer = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: { ...preset, highlightNumbers: true } });
      renderer.draw(1350);
      const hash = createHash("sha256").update(JSON.stringify(calls, roundNumbers)).digest("hex");
      expect(hash, preset.id).toBe(expected[preset.id]);
    }
  });
});

describe("custom look drawing", () => {
  const ev = makeEvent([["Namaste", "dosto"], ["welcome"]], 1000, 0);

  it("sizeMul scales the layout font, still inside the safe area", () => {
    const { ctx } = recordingContext();
    const normal = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style() }).layoutOf(ev);
    const big = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ sizeMul: 2 }) }).layoutOf(ev);
    expect(normal.fontPx).toBe(Math.round(0.045 * 720));
    expect(big.fontPx).toBe(Math.round(0.045 * 2 * 720));
    expect(big.bounds.left).toBeGreaterThanOrEqual(1280 * 0.05 - 1e-6);
    expect(big.bounds.right).toBeLessThanOrEqual(1280 * 0.95 + 1e-6);
  });

  it("draws a custom outline on any background, with its width and colour", () => {
    const s = style({ background: "pill", outlineWidth: 0.25, outlineColor: "#ff2d95" });
    const { ctx, calls } = recordingContext();
    const renderer = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: s });
    renderer.draw(1350);
    const strokes = calls.filter((c) => c.op === "strokeText");
    expect(strokes).toHaveLength(3);
    expect(strokes.every((c) => c.state.stroke === "#ff2d95")).toBe(true);
    expect(strokes[0].state.lineWidth).toBeCloseTo(renderer.layoutOf(ev).fontPx * 0.25, 9);
    expect(calls.map((c) => c.op).lastIndexOf("strokeText")).toBeLessThan(calls.map((c) => c.op).indexOf("fillText"));
  });

  it("outlineWidth 0 removes the preset outline entirely", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "outline", outlineWidth: 0 }) }).draw(1000);
    expect(calls.some((c) => c.op === "strokeText")).toBe(false);
    expect(calls.filter((c) => c.op === "fillText")).toHaveLength(3);
  });

  it("draws a custom-opacity box behind every line on a non-pill background", () => {
    const s = style({ background: "outline", boxOpacity: 1, boxColor: "#7a1fa2" });
    const { ctx, calls } = recordingContext();
    const renderer = createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: s });
    renderer.draw(1000);
    const fills = calls.filter((c) => c.op === "fill");
    expect(fills).toHaveLength(2);
    expect(fills.every((c) => c.state.fill === "rgba(122, 31, 162, 1)")).toBe(true);
    const layout = renderer.layoutOf(ev);
    // The box starts on the first row's top edge (moveTo carries the corner radius in x only).
    const firstMove = calls.find((c) => c.op === "moveTo");
    expect(firstMove?.args[1]).toBeCloseTo(layout.lines[0].y - layout.rowHeight / 2, 9);
  });

  it("boxOpacity 0 hides the preset pill", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "pill", boxOpacity: 0 }) }).draw(1000);
    expect(calls.some((c) => c.op === "fill")).toBe(false);
  });

  it("shadow 0 removes the soft shadow the none background used to add", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "none", shadow: 0 }) }).draw(1000);
    expect(ctx.shadowBlur).toBe(0);
    expect(calls.filter((c) => c.op === "fillText")).toHaveLength(3);
  });

  it("a custom shadow sets colour, blur and offset for the text", () => {
    const { ctx } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ background: "pill", shadow: 0.5, shadowColor: "#00e5ff" }) }).draw(1000);
    expect(ctx.shadowColor).toBe("rgba(0, 229, 255, 0.4)");
    expect(ctx.shadowBlur).toBeGreaterThan(0);
    expect(ctx.shadowOffsetY).toBeGreaterThan(0);
  });

  it("draws the chosen bundled font at a weight it ships; an unknown key keeps the preset font", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ fontKey: "poppins" }) }).draw(1000);
    expect(calls.find((c) => c.op === "fillText")?.state.font).toMatch(/^600 \d+px "Poppins", /);
    calls.length = 0;
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ fontKey: "unknown-font" }) }).draw(1000);
    expect(calls.find((c) => c.op === "fillText")?.state.font).toMatch(/^600 \d+px "Geist Variable", /);
  });

  it("Bebas Neue is drawn at 400 because that is the only file it ships", () => {
    const { ctx, calls } = recordingContext();
    createCaptionRenderer({ ctx, width: 1280, height: 720, events: [ev], style: style({ fontKey: "bebas-neue" }) }).draw(1000);
    expect(calls.find((c) => c.op === "fillText")?.state.font).toMatch(/^400 \d+px "Bebas Neue", /);
  });
});
