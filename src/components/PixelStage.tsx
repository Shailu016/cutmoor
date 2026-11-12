import { useEffect, useRef } from "react";

/**
 * Hero pixel-art animation: a scrambled frame of "raw data" is scanned and
 * re-encoded into a synthwave landscape while a file-size counter drops.
 * It shows the product's promise — the file is processed right here.
 *
 * - Draws at 96×60 logical pixels; CSS scales it up with crisp edges.
 * - One putImageData per frame (not a fillRect per pixel), capped at 30 fps.
 * - Pauses when off-screen or when the tab is hidden.
 * - prefers-reduced-motion renders a single finished frame.
 * - Server render is an empty canvas with fixed dimensions (no layout shift).
 */

const W = 96;
const H = 60;
const HORIZON = 38;
const LOOP = 9600;
const T_SCAN_START = 800;
const T_SCAN_END = 3600;
const T_DISSOLVE = 8200;

const SIZE_BEFORE = 48.2;
const SIZE_AFTER = 6.4;

// Brand palette, darkest to brightest, for sky banding.
const SKY = ["#0b0f17", "#121826", "#1c2434", "#26324a", "#2d4bf0", "#8a5aa8", "#ff6a3d", "#ff8f5e", "#ffb35c"];
const NOISE = ["#121826", "#1c2434", "#26324a", "#2d4bf0", "#8a5aa8", "#ff6a3d", "#ffb35c", "#222b3e"];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// 3×5 bitmap glyphs for the in-canvas readout.
const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ".": ["000", "000", "000", "000", "010"],
  M: ["101", "111", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  " ": ["000", "000", "000", "000", "000"],
};

function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function mountain(x: number, base: number, amp: number, f1: number, f2: number, phase: number) {
  return base - amp * (0.55 * Math.sin(x * f1 + phase) + 0.45 * Math.sin(x * f2 + phase * 1.7)) - amp * 0.4;
}

/** The finished pixel-art scene; `t` animates stars, sun stripes and water. */
function sceneColor(x: number, y: number, t: number): string {
  const sunX = 48;
  const sunY = 28;
  const sunR = 13;

  if (y < HORIZON) {
    // Mountains in front of the sun.
    const front = mountain(x, HORIZON + 1, 6.3, 0.14, 0.31, 0.6);
    if (y >= front) return y - front < 1 ? "#26324a" : "#121826";
    const back = mountain(x, HORIZON - 1, 8.2, 0.087, 0.21, 2.1);

    // Synthwave sun with scrolling horizontal cuts in its lower half.
    const dx = x - sunX + 0.5;
    const dy = y - sunY + 0.5;
    if (dx * dx + dy * dy <= sunR * sunR && y < back + 1) {
      if (y > sunY) {
        const gap = (y + Math.floor(t / 220)) % 4 === 0;
        if (gap && y > sunY + 1) return skyColor(x, y);
      }
      return y < sunY - 6 ? "#ffc98a" : y < sunY + 1 ? "#ffb35c" : y < sunY + 6 ? "#ff8f5e" : "#ff6a3d";
    }
    if (y >= back) return y - back < 1 ? "#2d4bf0" : "#1c2434";

    // Twinkling stars in the upper sky.
    if (y < 18) {
      const s = rand(x * 41 + y * 7);
      if (s > 0.965) {
        const tw = Math.sin(t / 380 + s * 50);
        if (tw > 0.2) return tw > 0.8 ? "#ffffff" : "#c4cad6";
      }
    }
    return skyColor(x, y);
  }

  // Water: dark bands with a shimmering sun reflection.
  const depth = y - HORIZON;
  const reflW = Math.max(2, 14 - depth);
  const wobble = Math.round(Math.sin(t / 300 + y * 0.9) * 2);
  if (Math.abs(x - sunX + wobble) < reflW && (y + Math.floor(t / 200)) % 2 === 0) {
    return depth < 5 ? "#ffb35c" : depth < 11 ? "#ff8f5e" : "#ff6a3d";
  }
  const ripple = rand(x * 13 + y * 29 + Math.floor(t / 500)) > 0.93;
  if (ripple) return "#26324a";
  return depth < 6 ? "#1c2434" : depth < 14 ? "#121826" : "#0b0f17";
}

function skyColor(x: number, y: number): string {
  // Ordered (Bayer) dithering between adjacent bands — classic pixel shading.
  const v = (y / (HORIZON - 1)) * (SKY.length - 1);
  const lo = Math.floor(v);
  const frac = v - lo;
  const threshold = (BAYER[y % 4][x % 4] + 0.5) / 16;
  return SKY[Math.min(SKY.length - 1, frac > threshold ? lo + 1 : lo)];
}

function noiseColor(x: number, y: number, t: number): string {
  const r = rand(x * 17 + y * 131 + Math.floor(t / 90) * 7.3);
  return r < 0.55 ? "#0b0f17" : NOISE[Math.floor(r * 97) % NOISE.length];
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      g.forEach((row, ry) => {
        for (let rx = 0; rx < 3; rx++) if (row[rx] === "1") ctx.fillRect(cx + rx, y + ry, 1, 1);
      });
    }
    cx += 4;
  }
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

const FRAME_MS = 1000 / 30;

// "#rrggbb" -> packed RGB, cached: the palette is about twenty colours.
const rgbCache = new Map<string, number>();
function rgb(hex: string): number {
  let value = rgbCache.get(hex);
  if (value === undefined) {
    value = parseInt(hex.slice(1), 16);
    rgbCache.set(hex, value);
  }
  return value;
}

export function PixelStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLSpanElement>(null);
  const afterRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dissolveOrder = Array.from({ length: W * H }, (_, i) => rand(i * 3.7 + 1));
    const frame = ctx.createImageData(W, H);
    const pixels = frame.data;
    let raf = 0;
    let lastPaint = -Infinity;
    let visible = true;
    let start = performance.now();
    let lastStatus = "";

    const setStatus = (text: string) => {
      if (text !== lastStatus && statusRef.current) {
        statusRef.current.textContent = text;
        lastStatus = text;
      }
    };

    const render = (now: number) => {
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(render);
      if (now - lastPaint < FRAME_MS - 1) return;
      lastPaint = now;
      const t = reduce ? T_DISSOLVE - 1 : (now - start) % LOOP;
      const scanP = Math.min(1, Math.max(0, (t - T_SCAN_START) / (T_SCAN_END - T_SCAN_START)));
      const beam = scanP * (W + 3);
      const dissolveP = t > T_DISSOLVE ? (t - T_DISSOLVE) / (LOOP - T_DISSOLVE) : 0;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let color: string;
          if (dissolveP > 0 && dissolveOrder[y * W + x] < dissolveP) color = noiseColor(x, y, t);
          else if (t < T_SCAN_START || x > beam) color = noiseColor(x, y, t);
          else color = sceneColor(x, y, t);
          const value = rgb(color);
          const i = (y * W + x) * 4;
          pixels[i] = value >> 16;
          pixels[i + 1] = (value >> 8) & 255;
          pixels[i + 2] = value & 255;
          pixels[i + 3] = 255;
        }
      }
      ctx.putImageData(frame, 0, 0);

      // Scan beam with a soft trailing glow.
      if (scanP > 0 && scanP < 1) {
        const bx = Math.floor(beam);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(bx, 0, 1, H);
        ctx.fillStyle = "rgba(255,194,71,0.55)";
        ctx.fillRect(bx - 1, 0, 1, H);
        ctx.fillStyle = "rgba(255,92,122,0.3)";
        ctx.fillRect(bx - 2, 0, 1, H);
      }

      // Pixel readout of the shrinking file size, top-left.
      const size = SIZE_BEFORE - (SIZE_BEFORE - SIZE_AFTER) * easeOut(scanP);
      const label = `${size.toFixed(1)} MB`;
      ctx.fillStyle = "rgba(11,10,31,0.72)";
      ctx.fillRect(2, 2, label.length * 4 + 3, 9);
      drawText(ctx, label, 4, 4, scanP >= 1 ? "#ffb35c" : "#ffffff");

      if (beforeRef.current) beforeRef.current.textContent = `${SIZE_BEFORE.toFixed(1)} MB`;
      if (afterRef.current) afterRef.current.textContent = `${size.toFixed(1)} MB`;
      if (barRef.current) barRef.current.style.transform = `scaleX(${dissolveP > 0 ? 1 - dissolveP : scanP})`;
      if (t < T_SCAN_START) setStatus("Reading on your device…");
      else if (scanP < 1) setStatus("Encoding locally…");
      else if (dissolveP > 0) setStatus("Next file…");
      else setStatus(`Done · ${Math.round((1 - SIZE_AFTER / SIZE_BEFORE) * 100)}% smaller · 0 bytes uploaded`);
    };

    const resume = () => {
      cancelAnimationFrame(raf);
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    observer.observe(canvas);
    const onVisibility = () => resume();
    document.addEventListener("visibilitychange", onVisibility);

    start = performance.now();
    cancelAnimationFrame(raf);
    render(start);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <figure className="pixel-stage" aria-label="Animation: a video is compressed from 48.2 MB to 6.4 MB inside the browser">
      <div className="pixel-stage-bar" aria-hidden="true">
        <span className="pixel-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="pixel-stage-file">sunset-reel.mov</span>
        <span className="pixel-stage-chip">LOCAL</span>
      </div>
      <div className="pixel-stage-screen">
        <canvas ref={canvasRef} width={W} height={H} aria-hidden="true" />
        <span className="pixel-scanlines" aria-hidden="true" />
      </div>
      <figcaption className="pixel-stage-foot">
        <div className="pixel-stage-sizes">
          <span ref={beforeRef} className="size-before">
            48.2 MB
          </span>
          <span className="size-arrow" aria-hidden="true">
            →
          </span>
          <span ref={afterRef} className="size-after">
            6.4 MB
          </span>
        </div>
        <span className="pixel-progress" aria-hidden="true">
          <span ref={barRef} />
        </span>
        <span ref={statusRef} className="pixel-stage-status">
          Done · 87% smaller · 0 bytes uploaded
        </span>
      </figcaption>
    </figure>
  );
}
