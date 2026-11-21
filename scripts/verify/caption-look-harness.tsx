/**
 * Browser half of scripts/verify/caption-look.mjs. It mounts the REAL KaraokePreview style path and
 * the REAL burn-in exporter on a generated solid-black clip, so caption pixels can be measured
 * against a clean reference without any footage getting in the way.
 *
 * Not part of the site: only the verification build (scripts/verify/caption-look.mjs) includes it.
 */
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";
import type { CaptionStyle } from "../../src/lib/captioning/contracts";
import type { CaptionEvent } from "../../src/lib/captioning/types";
import { KaraokePreview } from "../../src/components/captions/KaraokePreview";
import { LookControls } from "../../src/components/captions/LookControls";
import { CAPTION_STYLES } from "../../src/components/captions/styles";
import { findActive } from "../../src/components/captions/find-active";
import { captionFontFor } from "../../src/lib/captioning/burn-in/font-catalog";
import { loadCaptionFonts } from "../../src/lib/captioning/burn-in/fonts";
import { createBurnInExporter } from "../../src/lib/captioning/burn-in/exporter";
import { frameAt, framePng } from "../../src/lib/captioning/burn-in/verify-helpers";
import "../../src/styles.css";
import "../../src/brand.css";
import "../../src/captions.css";

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 12;
const DURATION_S = 3;
const TIME_MS = 1450;

const word = (text: string, startMs: number, endMs: number, index: number) => ({ text, startMs, endMs, confidence: 1, index, windowIndex: 0 });
const EVENTS: CaptionEvent[] = [
  {
    index: 0,
    startMs: 900,
    endMs: 2300,
    lines: [
      [word("CUSTOM", 1000, 1300, 0), word("LOOK", 1300, 1600, 1)],
      [word("SHADOW", 1600, 1900, 2), word("CHECK", 1900, 2200, 3)],
    ],
  },
];

export interface LookSpec {
  name: string;
  /** An opaque colour the look paints, as RGB, used to count its pixels in both renderers. */
  keyColor: [number, number, number];
  tolerance: number;
  style: CaptionStyle;
}

export const LOOKS: LookSpec[] = [
  {
    name: "purple-box",
    keyColor: [122, 31, 162],
    tolerance: 22,
    style: {
      ...CAPTION_STYLES.clean,
      fontKey: "inter",
      sizeMul: 1.15,
      outlineWidth: 0.12,
      outlineColor: "#ffffff",
      boxOpacity: 1,
      boxColor: "#7a1fa2",
      uppercase: true,
    },
  },
  {
    name: "pink-outline",
    keyColor: [255, 45, 149],
    tolerance: 26,
    style: {
      ...CAPTION_STYLES.bold,
      fontKey: "bebas-neue",
      sizeMul: 1.4,
      uppercase: true,
      outlineWidth: 0.3,
      outlineColor: "#ff2d95",
      shadow: 0,
      textColor: "#ffffff",
      activeColor: "#ffd84d",
    },
  },
  {
    name: "cyan-shadow",
    // A blurred glow over black never reaches the pure colour, so look for its dimmer cyan with a wide tolerance.
    keyColor: [0, 110, 125],
    tolerance: 70,
    style: {
      ...CAPTION_STYLES.shorts,
      fontKey: "poppins",
      sizeMul: 1.05,
      background: "none",
      shadow: 1,
      shadowColor: "#00e5ff",
      textColor: "#ffffff",
      activeColor: "#ffffff",
    },
  },
];

export interface Metrics {
  width: number;
  height: number;
  ink: number;
  key: number;
  /** Centroids of the ink mask and the key-colour mask, normalised to 0..1. */
  inkX: number;
  inkY: number;
  keyX: number;
  keyY: number;
}

interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Pixels that differ from the clean reference (caption ink), plus pixels near a key colour. */
function measure(frame: Frame, reference: Frame, key: [number, number, number], tolerance: number): Metrics {
  if (frame.width !== reference.width || frame.height !== reference.height) throw new Error("frame sizes differ");
  const [kr, kg, kb] = key;
  const tol2 = tolerance * tolerance;
  let ink = 0;
  let sx = 0;
  let sy = 0;
  let keyCount = 0;
  let kx = 0;
  let ky = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4;
      const r = frame.data[i];
      const g = frame.data[i + 1];
      const b = frame.data[i + 2];
      if (Math.abs(r - reference.data[i]) + Math.abs(g - reference.data[i + 1]) + Math.abs(b - reference.data[i + 2]) > 30) {
        ink++;
        sx += x;
        sy += y;
      }
      const dr = r - kr;
      const dg = g - kg;
      const db = b - kb;
      if (dr * dr + dg * dg + db * db <= tol2) {
        keyCount++;
        kx += x;
        ky += y;
      }
    }
  }
  return {
    width: frame.width,
    height: frame.height,
    ink,
    key: keyCount,
    inkX: ink === 0 ? 0 : sx / ink / frame.width,
    inkY: ink === 0 ? 0 : sy / ink / frame.height,
    keyX: keyCount === 0 ? 0 : kx / keyCount / frame.width,
    keyY: keyCount === 0 ? 0 : ky / keyCount / frame.height,
  };
}

async function pngToFrame(base64: string): Promise<Frame> {
  const response = await fetch(`data:image/png;base64,${base64}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("cannot decode the screenshot");
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, data: image.data };
}

/** A 640x360 black clip generated in this tab. No file is fetched. */
async function makeBlackClip(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: 400_000 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  const frames = DURATION_S * FPS;
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    await source.add(i / FPS, 1 / FPS);
  }
  source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("the generated clip is empty");
  return new File([target.buffer], "caption-look-black.mp4", { type: "video/mp4" });
}

function paint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

interface Harness {
  ready: boolean;
  error: string | null;
  looks: LookSpec[];
  setLook(index: number): Promise<void>;
  setCaptions(on: boolean): Promise<void>;
  showControls(on: boolean): Promise<void>;
  stageRect(): { x: number; y: number; width: number; height: number };
  analyzePair(captions: string, clean: string, key: [number, number, number], tolerance: number): Promise<Metrics>;
  fontChecks(): Record<string, boolean>;
  exportLook(index: number): Promise<{ metrics: Metrics; png: string; bytes: number; ms: number }>;
}

declare global {
  interface Window {
    __captionLookHarness: Harness;
  }
}

const slots: {
  setLook?: (index: number) => void;
  setCaptions?: (on: boolean) => void;
  setControls?: (on: boolean) => void;
} = {};

let clipFile: File | null = null;
let referenceFrame: Frame | null = null;

function App() {
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [lookIndex, setLookIndex] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [controlsOn, setControlsOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const style = useMemo(() => LOOKS[lookIndex].style, [lookIndex]);
  const events = captionsOn ? EVENTS : [];
  const position = captionsOn ? findActive(EVENTS, TIME_MS) : null;
  const setVideo = (element: HTMLVideoElement | null) => {
    videoRef.current = element;
  };

  slots.setLook = setLookIndex;
  slots.setCaptions = setCaptionsOn;
  slots.setControls = setControlsOn;

  useEffect(() => {
    makeBlackClip()
      .then((file) => {
        clipFile = file;
        setClipUrl(URL.createObjectURL(file));
      })
      .catch((error: unknown) => {
        window.__captionLookHarness.error = error instanceof Error ? error.message : String(error);
        window.__captionLookHarness.ready = true;
      });
  }, []);

  useEffect(() => {
    if (!clipUrl) return;
    const video = videoRef.current;
    if (!video) return;
    const seek = () => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        const afterFrame = () => {
          window.__captionLookHarness.ready = true;
        };
        // A paused video in headless Chrome may never fire requestVideoFrameCallback, so do not wait on it alone.
        let done = false;
        const once = () => {
          if (done) return;
          done = true;
          afterFrame();
        };
        if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(once);
        requestAnimationFrame(() => requestAnimationFrame(once));
        setTimeout(once, 1500);
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = TIME_MS / 1000;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  }, [clipUrl]);

  return createElement(
    "div",
    null,
    createElement("div", { id: "stage-wrap" }, createElement(KaraokePreview, {
      url: clipUrl,
      fileName: "black.mp4",
      events,
      position,
      style,
      videoRef: setVideo,
      badge: null,
    })),
    controlsOn
      ? createElement("div", { id: "controls" }, createElement(LookControls, { style, onChange: () => undefined }))
      : null,
  );
}

async function ensureFont(index: number): Promise<void> {
  await loadCaptionFonts({ fontKey: LOOKS[index].style.fontKey });
  await document.fonts.ready;
  await paint();
}

async function exportLook(index: number): Promise<{ metrics: Metrics; png: string; bytes: number; ms: number }> {
  if (!clipFile) throw new Error("no clip");
  await ensureFont(index);
  const exporter = createBurnInExporter();
  if (!(await exporter.isSupported())) throw new Error("this Chrome cannot encode video");
  if (!referenceFrame) {
    const reference = await exporter.export({ file: clipFile, events: [], style: CAPTION_STYLES.clean });
    const frame = await frameAt(reference, TIME_MS / 1000);
    if (!frame) throw new Error("no reference frame");
    referenceFrame = frame;
  }
  const started = performance.now();
  const captioned = await exporter.export({ file: clipFile, events: EVENTS, style: LOOKS[index].style });
  const ms = Math.round(performance.now() - started);
  const frame = await frameAt(captioned, TIME_MS / 1000);
  if (!frame) throw new Error("no exported frame");
  const spec = LOOKS[index];
  const metrics = measure(frame, referenceFrame, spec.keyColor, spec.tolerance);
  return { metrics, png: await framePng(frame.width, frame.height, frame.data), bytes: captioned.size, ms };
}

const harness: Harness = {
  ready: false,
  error: null,
  looks: LOOKS,
  async setLook(index) {
    await ensureFont(index);
    slots.setLook?.(index);
    await paint();
  },
  async setCaptions(on) {
    slots.setCaptions?.(on);
    await paint();
  },
  async showControls(on) {
    slots.setControls?.(on);
    await paint();
  },
  stageRect() {
    const stage = document.querySelector(".cap-stage");
    if (!stage) throw new Error("no stage");
    const rect = stage.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  },
  async analyzePair(captions, clean, key, tolerance) {
    const [a, b] = await Promise.all([pngToFrame(captions), pngToFrame(clean)]);
    return measure(a, b, key, tolerance);
  },
  fontChecks() {
    const result: Record<string, boolean> = {};
    const faces = Array.from(document.fonts);
    for (const look of LOOKS) {
      const family = captionFontFor(look.style.fontKey)?.family;
      if (family) {
        result[family] = faces.some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded");
      }
    }
    return result;
  },
  exportLook,
};
window.__captionLookHarness = harness;

const root = document.getElementById("root");
if (!root) throw new Error("no root");
createRoot(root).render(createElement(App));
