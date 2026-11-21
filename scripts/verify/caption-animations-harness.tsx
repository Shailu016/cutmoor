/**
 * Browser harness for scripts/verify/caption-animations.mjs.
 *
 * Draws a short caption with every entry animation through the REAL canvas renderer that the MP4
 * exporter calls for each frame, hashes the pixels, and checks that:
 *   - a non-none animation changes the picture between the caption's start and its end,
 *   - the final frame is pixel-identical to the same caption with no animation,
 *   - the HTML preview (KaraokePreview) shows the same fade/typewriter timing, and ignores it
 *     under prefers-reduced-motion,
 *   - AnimationPicker and SavedLooks render and SavedLooks saves into localStorage.
 *
 * The result is published on window.__CAPTION_ANIMATION_RESULT__ for the Node driver.
 */
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "../../src/brand.css";
import "../../src/captions.css";
import type { CaptionStyle } from "../../src/lib/captioning/contracts";
import type { CaptionEvent, Word } from "../../src/lib/captioning/types";
import { ANIMATION_IDS, animationDurationMs } from "../../src/lib/captioning/burn-in/animations";
import { createCaptionRenderer } from "../../src/lib/captioning/burn-in/renderer";
import { CAPTION_STYLES } from "../../src/lib/captioning/burn-in/styles";
import { AnimationPicker } from "../../src/components/captions/AnimationPicker";
import { KaraokePreview } from "../../src/components/captions/KaraokePreview";
import { SavedLooks } from "../../src/components/captions/SavedLooks";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface AnimationResult {
  id: string;
  hashes: string[];
  distinct: number;
  ink: number[];
  intermediateDiffers: boolean;
  finalMatchesStatic: boolean;
}

interface HarnessResult {
  done: boolean;
  reduced: boolean;
  checks: Check[];
  animations: AnimationResult[];
  preview: Record<string, unknown>;
  error?: string;
}

const result: HarnessResult = { done: false, reduced: false, checks: [], animations: [], preview: {} };

function check(name: string, ok: boolean, detail?: string): void {
  result.checks.push({ name, ok, detail });
}

function publish(): void {
  result.done = true;
  (window as unknown as { __CAPTION_ANIMATION_RESULT__: HarnessResult }).__CAPTION_ANIMATION_RESULT__ = result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function word(text: string, startMs: number, endMs: number, index: number): Word {
  return { text, startMs, endMs, confidence: 1, index, windowIndex: 0 };
}

const EVENT: CaptionEvent = {
  index: 0,
  startMs: 1000,
  endMs: 1800,
  lines: [[word("Hello", 1000, 1200, 0), word("world", 1200, 1400, 1)], [word("again", 1400, 1600, 2)]],
};

const WIDTH = 480;
const HEIGHT = 270;
const ANIMATION_MS = 400;
// A larger size than the real preset only so the contact-sheet thumbnails are readable.
const BASE_STYLE: CaptionStyle = { ...CAPTION_STYLES.clean, fontScale: 0.09, background: "outline" };
const FRAME_TIMES = [1000, 1100, 1200, 1300, 1400];

/** FNV-1a over every byte of the RGBA buffer. */
function hashBytes(data: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function inkPixels(data: Uint8ClampedArray): number {
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 20) ink += 1;
  return ink;
}

function paint(canvas: HTMLCanvasElement, animation: string | null, timeMs: number): Uint8ClampedArray {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2D context");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const style: CaptionStyle = animation ? { ...BASE_STYLE, animation, animationMs: ANIMATION_MS } : BASE_STYLE;
  const renderer = createCaptionRenderer({ ctx, width: canvas.width, height: canvas.height, events: [EVENT], style });
  renderer.draw(timeMs);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function runCanvasChecks(): void {
  const probe = document.createElement("canvas");
  probe.width = WIDTH;
  probe.height = HEIGHT;

  // The same caption with no animation at each frame time. The karaoke highlight moves on its
  // own, so "equal to the static look" must be compared at the same time, not across times.
  const staticHashes = FRAME_TIMES.map((timeMs) => hashBytes(paint(probe, null, timeMs)));
  const staticLast = staticHashes[staticHashes.length - 1];
  check("the static caption draws something", inkPixels(paint(probe, null, FRAME_TIMES[0])) > 100);

  for (const id of ANIMATION_IDS) {
    const hashes: string[] = [];
    const ink: number[] = [];
    for (const timeMs of FRAME_TIMES) {
      const data = paint(probe, id, timeMs);
      hashes.push(hashBytes(data));
      ink.push(inkPixels(data));
    }
    const distinct = new Set(hashes).size;
    const final = hashes[hashes.length - 1];
    const intermediateDiffers = hashes.slice(0, -1).some((hash) => hash !== final);
    const finalMatchesStatic = final === staticLast;
    result.animations.push({ id, hashes, distinct, ink, intermediateDiffers, finalMatchesStatic });

    if (id === "none") {
      const sameAtEveryTime = hashes.every((hash, index) => hash === staticHashes[index]);
      check("none: every frame is the static look", sameAtEveryTime, `hashes ${hashes.join("/")}`);
    } else {
      check(`${id}: frames change over time`, distinct >= 2 && intermediateDiffers, `${distinct} distinct, ink ${ink.join("/")}`);
      check(`${id}: final frame equals the static look`, finalMatchesStatic, `${final} vs ${staticLast}`);
    }
  }
}

/** A contact sheet of five frames for every animation, for the screenshot. */
function drawContactSheet(): void {
  const sheet = document.getElementById("sheet");
  if (!(sheet instanceof HTMLCanvasElement)) return;
  const ctx = sheet.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0b0f17";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  const thumbWidth = 168;
  const thumbHeight = 94;
  const left = 122;
  const rowHeight = 104;
  const top = 16;
  const source = document.createElement("canvas");
  source.width = WIDTH;
  source.height = HEIGHT;
  const sourceCtx = source.getContext("2d");

  ANIMATION_IDS.forEach((id, row) => {
    const y = top + row * rowHeight;
    ctx.fillStyle = "#f3f5f8";
    ctx.fillText(id, 12, y + thumbHeight / 2);
    FRAME_TIMES.forEach((timeMs, column) => {
      const data = paint(source, id, timeMs);
      if (sourceCtx) {
        // A dark plate behind each thumbnail so transparent frames are still readable.
        sourceCtx.globalCompositeOperation = "destination-over";
        sourceCtx.fillStyle = "#1a2230";
        sourceCtx.fillRect(0, 0, source.width, source.height);
        sourceCtx.globalCompositeOperation = "source-over";
      }
      const x = left + column * (thumbWidth + 8);
      ctx.drawImage(source, x, y, thumbWidth, thumbHeight);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.strokeRect(x + 0.5, y + 0.5, thumbWidth - 1, thumbHeight - 1);
      if (sourceCtx) sourceCtx.clearRect(0, 0, source.width, source.height);
      const ink = inkPixels(data);
      if (ink === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText("transparent", x + 8, y + thumbHeight - 12);
        ctx.font = "600 13px system-ui, sans-serif";
      }
    });
    ctx.fillStyle = "#98a2b3";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("start → end", left, y + thumbHeight + 8);
    ctx.font = "600 13px system-ui, sans-serif";
  });

  ctx.fillStyle = "#f3f5f8";
  ctx.font = "700 20px system-ui, sans-serif";
  ctx.fillText("Caption entry animations — frames at 0, 25, 50, 75 and 100%", 12, 4);
}

function previewStyle(animation: string): CaptionStyle {
  return { ...CAPTION_STYLES.clean, animation, animationMs: 600 };
}

async function runPreviewChecks(): Promise<void> {
  const host = document.getElementById("preview-host");
  if (!host) throw new Error("no preview host");
  const previewRoot = createRoot(host);
  const renderPreview = (animation: string) =>
    previewRoot.render(
      createElement(KaraokePreview, {
        url: null,
        fileName: null,
        events: [EVENT],
        position: { event: 0, line: 0, word: 1 },
        style: previewStyle(animation),
        videoRef: () => undefined,
        badge: null,
      }),
    );

  renderPreview("fade");
  await delay(140);
  const block = host.querySelector<HTMLElement>(".cap-block");
  const earlyOpacity = block ? Number(getComputedStyle(block).opacity) : Number.NaN;
  const earlyTransform = block ? getComputedStyle(block).transform : "";
  await delay(700);
  const lateOpacity = block ? Number(getComputedStyle(block).opacity) : Number.NaN;

  result.preview = { earlyOpacity, lateOpacity, earlyTransform, reduced: result.reduced };
  if (result.reduced) {
    check("preview under reduced motion: no entry animation", earlyOpacity > 0.99, `opacity ${earlyOpacity}`);
    check("preview under reduced motion: transform stays identity", earlyTransform === "none" || earlyTransform === "matrix(1, 0, 0, 1, 0, 0)", earlyTransform);
  } else {
    check("preview fade: starts partly transparent", Number.isFinite(earlyOpacity) && earlyOpacity < 0.95, `opacity ${earlyOpacity}`);
    check("preview fade: ends fully opaque", lateOpacity > 0.99, `opacity ${lateOpacity}`);
    check("preview fade: transform is applied while running", earlyTransform !== "none", earlyTransform);
  }

  renderPreview("typewriter");
  await delay(150);
  const earlyText = host.querySelector(".cap-block")?.textContent ?? "";
  await delay(700);
  const lateText = host.querySelector(".cap-block")?.textContent ?? "";
  result.preview = { ...result.preview, earlyText, lateText };
  if (result.reduced) {
    check("preview under reduced motion: typewriter shows the whole caption at once", earlyText === "Helloworldagain", earlyText);
  } else {
    check("preview typewriter: reveals characters over time", earlyText.length > 0 && earlyText.length < "Helloworldagain".length, earlyText);
    check("preview typewriter: ends with every word", lateText === "Helloworldagain", lateText);
  }
}

function Demo(): ReturnType<typeof createElement> {
  const [current, setCurrent] = useState<CaptionStyle>({ ...CAPTION_STYLES.clean, sizeMul: 1.15, animation: "pop", animationMs: 300 });
  return createElement(
    "div",
    { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 16, fontFamily: '"Geist Variable", system-ui, sans-serif' } },
    createElement(
      "div",
      { style: { background: "#ffffff", color: "#121722", border: "1px solid #e3e7ee", borderRadius: 10, padding: 16 } },
      createElement("h2", { style: { margin: "0 0 8px", fontSize: 15 } }, "Animation picker (light panel)"),
      createElement(AnimationPicker, {
        value: current.animation ?? "none",
        ms: animationDurationMs(current.animationMs),
        onChange: (animation: string, ms: number) => setCurrent((old) => ({ ...old, animation, animationMs: ms })),
      }),
    ),
    createElement(
      "div",
      { id: "dark-panel", style: { background: "#10141d", color: "#f3f5f8", border: "1px solid #2a3240", borderRadius: 10, padding: 16 } },
      createElement("h2", { style: { margin: "0 0 8px", fontSize: 15 } }, "Saved looks (dark panel)"),
      createElement(SavedLooks, { current, onApply: setCurrent }),
    ),
  );
}

async function runUiChecks(): Promise<void> {
  const host = document.getElementById("ui-host");
  if (!host) throw new Error("no UI host");
  createRoot(host).render(createElement(Demo));
  await delay(250);

  const dark = document.getElementById("dark-panel");
  check("AnimationPicker renders eight chips", document.querySelectorAll('#ui-host button[aria-pressed]').length === 8);
  check("SavedLooks shows the browser-only note", (dark?.textContent ?? "").includes("Looks stay in this browser only."));

  const name = dark?.querySelector<HTMLInputElement>('input[aria-label="Look name"]');
  const save = [...(dark?.querySelectorAll("button") ?? [])].find((button) => (button.textContent ?? "").includes("Save this look"));
  if (name && save) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(name, "Demo look");
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await delay(50);
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await delay(150);
  }
  const stored = window.localStorage.getItem("cutmoor.captionLooks.v1") ?? "";
  check("SavedLooks saves a named look in localStorage", stored.includes("Demo look"), stored.slice(0, 80));
  check("SavedLooks shows the saved chip", (dark?.textContent ?? "").includes("Demo look"));
}

function addFatalHandlers(): void {
  window.addEventListener("error", (event) => {
    if (result.done) return;
    result.error = event.message;
    publish();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (result.done) return;
    result.error = String(event.reason);
    publish();
  });
}

async function main(): Promise<void> {
  addFatalHandlers();
  result.reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  runCanvasChecks();
  drawContactSheet();
  await runPreviewChecks();
  await runUiChecks();

  publish();
}

void main().catch((error: unknown) => {
  result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  publish();
});
