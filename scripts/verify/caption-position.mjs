/**
 * Real-browser check for caption positioning, alignment and the safe-area guide.
 *
 * It builds a tiny production bundle of the REAL `KaraokePreview`, `PositionControls` and
 * `SafeAreaOverlay`, serves it on port 5211, and drives Chrome through its DevTools protocol
 * (no puppeteer dependency). It checks, with a real browser's text measurement:
 *
 *   1. the preview block's rectangle equals the shared `placeBlock` maths (inside the safe area);
 *   2. the burned-in renderer's `layoutEvent` rectangle equals the preview's for the same style;
 *   3. anchors 0/0.5/1, left/centre/right alignment, landscape and portrait frames;
 *   4. drag with the mouse, drag with touch, and arrow-key nudging update the anchors;
 *   5. the safe-area overlay is preview-only, follows its preset and is never inside the caption;
 *   6. PositionControls' grid, alignment, sliders and safe-area buttons update the style.
 *
 *   node scripts/verify/caption-position.mjs
 *
 * Screenshots land in SHOT_DIR (default: <tmp>/caption-position-shots).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = process.cwd();
const SHOTS = process.env.SHOT_DIR || join(tmpdir(), "caption-position-shots");
const PORT = Number(process.env.CAPTION_POSITION_PORT || 5211);
const DEBUG_PORT = Number(process.env.CAPTION_POSITION_DEBUG_PORT || 9333);
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const failures = [];
const notes = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "  ok  " : " FAIL "} ${message}`);
};
const close = (actual, expected, tolerance, label) => {
  const delta = Math.abs(actual - expected);
  check(delta <= tolerance, `${label}: ${actual.toFixed(2)} vs ${expected.toFixed(2)} (Δ ${delta.toFixed(2)} px, tolerance ${tolerance})`);
};

await mkdir(SHOTS, { recursive: true });
const harnessDir = await mkdtemp(join(projectRoot, ".caption-position-check-"));
const distDir = join(harnessDir, "dist");
const profileDir = await mkdtemp(join(tmpdir(), "caption-position-chrome-"));
let chrome;
let browser;
let server;

const harnessEntry = String.raw`
import "@fontsource-variable/geist";
import "@src/brand.css";
import "@src/captions.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { KaraokePreview } from "@src/components/captions/KaraokePreview";
import { PositionControls } from "@src/components/captions/PositionControls";
import { CAPTION_STYLES } from "@src/components/captions/styles";
import { layoutEvent } from "@src/lib/captioning/burn-in/renderer";
import { cssFont } from "@src/lib/captioning/burn-in/font-stack";
import { captionSafeArea, placeBlock } from "@src/lib/captioning/burn-in/position";
import type { CaptionStyle } from "@src/lib/captioning/contracts";
import type { CaptionEvent, Word } from "@src/lib/captioning/types";
import type { SafeAreaKey } from "@src/components/captions/SafeAreaOverlay";

const words: Word[] = "We place every caption exactly where it belongs".split(" ").map((text, index) => ({
  text,
  startMs: 300 + index * 600,
  endMs: 700 + index * 600,
  confidence: 1,
  index,
  windowIndex: 0,
}));
const event: CaptionEvent = { index: 0, startMs: 0, endMs: 60_000, lines: [words.slice(0, 5), words.slice(5)] };

declare global {
  interface Window {
    __capCheck: {
      setStyle: (patch: Partial<CaptionStyle>) => void;
      getStyle: () => CaptionStyle;
      setSafeArea: (key: SafeAreaKey | null) => void;
      setFrame: (width: number, height: number) => void;
      rendererRect: () => { left: number; top: number; width: number; height: number; fontPx: number };
      expectedRect: () => { left: number; top: number; width: number; height: number; safe: { left: number; top: number; right: number; bottom: number }; frame: { width: number; height: number } };
    };
  }
}

function Harness() {
  const [style, setStyle] = useState<CaptionStyle>({ ...CAPTION_STYLES.clean });
  const [safeArea, setSafeArea] = useState<SafeAreaKey | null>(null);

  useEffect(() => {
    window.__capCheck = {
      setStyle: (patch) => setStyle((old) => ({ ...old, ...patch })),
      getStyle: () => style,
      setSafeArea,
      setFrame: (width, height) => {
        document.documentElement.style.setProperty("--stage-w", width + "px");
        document.documentElement.style.setProperty("--stage-h", height + "px");
      },
      rendererRect: () => {
        const stage = document.querySelector<HTMLElement>(".cap-stage");
        if (!stage) throw new Error("no stage");
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        const measure = (text: string, fontPx: number) => {
          context.font = cssFont(style, fontPx);
          return context.measureText(text).width;
        };
        const layout = layoutEvent(event, measure, style, stage.clientWidth, stage.clientHeight);
        return {
          left: layout.bounds.left,
          top: layout.bounds.top,
          width: layout.bounds.right - layout.bounds.left,
          height: layout.bounds.bottom - layout.bounds.top,
          fontPx: layout.fontPx,
        };
      },
      expectedRect: () => {
        const stage = document.querySelector<HTMLElement>(".cap-stage");
        const block = document.querySelector<HTMLElement>(".cap-block");
        if (!stage || !block) throw new Error("no stage or block");
        const rect = placeBlock(style, { width: block.offsetWidth, height: block.offsetHeight }, stage.clientWidth, stage.clientHeight);
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          safe: captionSafeArea(stage.clientWidth, stage.clientHeight),
          frame: { width: stage.clientWidth, height: stage.clientHeight },
        };
      },
    };
  }, [style, safeArea]);

  return (
    <div>
      <KaraokePreview
        url={null}
        fileName={null}
        events={[event]}
        position={{ event: 0, line: 0, word: 0 }}
        style={style}
        videoRef={() => undefined}
        badge="position check"
        onAnchorChange={(anchorX, anchorY) => setStyle((old) => ({ ...old, anchorX, anchorY }))}
        safeArea={safeArea}
      />
      <div style={{ width: 800, maxWidth: "100%" }}>
        <PositionControls style={style} onChange={(patch) => setStyle((old) => ({ ...old, ...patch }))} safeArea={safeArea} onSafeArea={setSafeArea} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
`;

const harnessHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caption position check</title>
<style>
  html, body { margin: 0; background: #05070c; color: #f3f5f8; font-family: system-ui, sans-serif; }
  #root { padding: 16px; display: grid; gap: 12px; }
  #root .cap-stage { width: var(--stage-w, 800px) !important; height: var(--stage-h, 450px) !important; aspect-ratio: auto !important; }
</style>
</head>
<body><div id="root"></div><script type="module" src="./entry.tsx"></script></body>
</html>`;

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)), { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
  }

  waitForEvent(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        const list = this.listeners.get(method) ?? [];
        this.listeners.set(method, list.filter((item) => item !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  close() {
    this.socket.close();
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function evaluate(expression, awaitPromise = false) {
  const result = await browser.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, label, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(60);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function settle() {
  await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  await delay(40);
}

async function setStyle(patch) {
  await evaluate(`window.__capCheck.setStyle(${JSON.stringify(patch)})`);
  await settle();
}

async function setSafeArea(key) {
  await evaluate(`window.__capCheck.setSafeArea(${JSON.stringify(key)})`);
  await settle();
}

async function measure() {
  return evaluate(`(() => {
    const stage = document.querySelector('.cap-stage').getBoundingClientRect();
    const overlay = document.querySelector('.cap-overlay').getBoundingClientRect();
    const block = document.querySelector('.cap-block').getBoundingClientRect();
    const expected = window.__capCheck.expectedRect();
    const renderer = window.__capCheck.rendererRect();
    return {
      stage: { left: stage.left, top: stage.top, width: document.querySelector('.cap-stage').clientWidth, height: document.querySelector('.cap-stage').clientHeight },
      overlay: { left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height },
      block: { left: block.left - overlay.left, top: block.top - overlay.top, width: block.width, height: block.height },
      lines: [...document.querySelectorAll('.cap-line')].map((line) => {
        const r = line.getBoundingClientRect();
        return { text: line.textContent, top: r.top - block.top, left: r.left - block.left, right: r.right - block.left, width: r.width, center: r.left - block.left + r.width / 2 };
      }),
      expected,
      renderer,
      style: window.__capCheck.getStyle(),
    };
  })()`);
}

function insideSafe(rect, safe, label) {
  check(rect.left >= safe.left - 0.75, `${label}: left ${rect.left.toFixed(2)} >= safe ${safe.left.toFixed(2)}`);
  check(rect.left + rect.width <= safe.right + 0.75, `${label}: right ${(rect.left + rect.width).toFixed(2)} <= safe ${safe.right.toFixed(2)}`);
  check(rect.top >= safe.top - 0.75, `${label}: top ${rect.top.toFixed(2)} >= safe ${safe.top.toFixed(2)}`);
  check(rect.top + rect.height <= safe.bottom + 0.75, `${label}: bottom ${(rect.top + rect.height).toFixed(2)} <= safe ${safe.bottom.toFixed(2)}`);
}

function checkAgainstExpected(measured, label) {
  close(measured.block.left, measured.expected.left, 1.5, `${label}: block left matches placeBlock`);
  close(measured.block.top, measured.expected.top, 1.5, `${label}: block top matches placeBlock`);
  close(measured.block.width, measured.expected.width, 1.5, `${label}: block width matches placeBlock`);
  close(measured.block.height, measured.expected.height, 1.5, `${label}: block height matches placeBlock`);
  close(measured.renderer.left, measured.block.left, 2.5, `${label}: renderer left matches preview`);
  close(measured.renderer.top, measured.block.top, 2.5, `${label}: renderer top matches preview`);
  close(measured.renderer.width, measured.block.width, 4, `${label}: renderer width matches preview`);
  close(measured.renderer.height, measured.block.height, 2.5, `${label}: renderer height matches preview`);
  insideSafe(measured.block, measured.expected.safe, label);
  check(Math.abs(measured.renderer.fontPx - measured.style.fontScale * measured.stage.height) <= 1.01, `${label}: renderer font size follows the frame height`);
}

async function screenshot(name) {
  const shot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = join(SHOTS, `${name}.png`);
  await writeFile(path, Buffer.from(shot.data, "base64"));
  return path;
}

async function mouseDrag(dx, dy) {
  const start = await evaluate(`(() => { const r = document.querySelector('.cap-block').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + dx, y: start.y + dy, button: "left", buttons: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + dx, y: start.y + dy, button: "left", buttons: 0, clickCount: 1 });
  await settle();
}

async function touchDrag(dx, dy) {
  const start = await evaluate(`(() => { const r = document.querySelector('.cap-block').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + dx, y: start.y + dy, id: 1 }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle();
}

async function pressKey(key, code, virtualKeyCode, modifiers = 0) {
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode, modifiers });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode, modifiers });
  await settle();
}

try {
  console.log("Building the preview bundle…");
  await writeFile(join(harnessDir, "entry.tsx"), harnessEntry);
  await writeFile(join(harnessDir, "index.html"), harnessHtml);
  await build({
    configFile: false,
    root: harnessDir,
    base: "./",
    logLevel: "warn",
    plugins: [react()],
    resolve: { alias: { "@src": join(projectRoot, "src") } },
    build: { outDir: distDir, emptyOutDir: true },
  });

  server = await preview({
    configFile: false,
    root: harnessDir,
    logLevel: "warn",
    preview: { port: PORT, strictPort: true, host: "127.0.0.1" },
  });
  const base = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${PORT}/`;
  console.log(`Serving ${relative(projectRoot, distDir)} at ${base}`);

  chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1200,1100",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("Chrome opened no page target");
  browser = await Cdp.connect(target.webSocketDebuggerUrl);
  const pageErrors = [];
  browser.on("Runtime.exceptionThrown", (event) => pageErrors.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? "exception"));
  browser.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") pageErrors.push(event.args?.map((arg) => arg.value ?? arg.description).join(" ") ?? "console error");
  });

  await browser.send("Page.enable");
  await browser.send("Runtime.enable");
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1100, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.waitForEvent("Page.loadEventFired");
  await browser.send("Page.navigate", { url: base });
  await loaded;
  await waitFor("window.__capCheck", "the harness");
  await evaluate("document.fonts.ready.then(() => true)", true);
  await settle();

  console.log("\n== landscape, preset bottom (no anchors) ==");
  let m = await measure();
  check(m.style.anchorX === undefined && m.style.anchorY === undefined, "the preset style starts with no anchors");
  close(m.block.top + m.block.height, m.expected.safe.bottom, 1.5, "preset bottom sits on the old bottom margin");
  checkAgainstExpected(m, "preset bottom");
  const bottomShot = await screenshot("caption-position-1-preset-bottom");

  console.log("\n== landscape, anchors and alignment ==");
  for (const item of [
    { patch: { anchorX: 0, anchorY: 0, align: "left" }, name: "top-left", expect: "left" },
    { patch: { anchorX: 0.5, anchorY: 0.5, align: "center" }, name: "centre", expect: "center" },
    { patch: { anchorX: 1, anchorY: 0.5, align: "right" }, name: "middle-right", expect: "right" },
    { patch: { anchorX: 0, anchorY: 1, align: "right" }, name: "bottom-left-right-aligned", expect: "right" },
    { patch: { anchorX: 1, anchorY: 0, align: "left" }, name: "top-right-left-aligned", expect: "left" },
  ]) {
    await setStyle(item.patch);
    m = await measure();
    check(measuredSafe(m), `${item.name}: measured inside the safe area`);
    checkAgainstExpected(m, item.name);
    check(m.style.align === item.expect, `${item.name}: style alignment is ${item.expect}`);
    for (const [lineIndex, line] of m.lines.entries()) {
      if (item.expect === "left") close(line.left, 0, 0.75, `${item.name}: line ${lineIndex + 1} hugs the block's left`);
      if (item.expect === "right") close(line.right, m.block.width, 0.75, `${item.name}: line ${lineIndex + 1} hugs the block's right`);
      if (item.expect === "center") close(line.center, m.block.width / 2, 0.75, `${item.name}: line ${lineIndex + 1} is centred in the block`);
    }
    if (item.patch.anchorX === 0) close(m.block.left, m.expected.safe.left, 1.5, `${item.name}: left edge on the safe edge`);
    if (item.patch.anchorX === 1) close(m.block.left + m.block.width, m.expected.safe.right, 1.5, `${item.name}: right edge on the safe edge`);
    if (item.patch.anchorY === 0) close(m.block.top, m.expected.safe.top, 1.5, `${item.name}: top edge on the safe edge`);
    if (item.patch.anchorY === 1) close(m.block.top + m.block.height, m.expected.safe.bottom, 1.5, `${item.name}: bottom edge on the safe edge`);
  }
  const topLeftShot = await screenshot("caption-position-2-top-left");

  console.log("\n== portrait frame ==");
  await evaluate("window.__capCheck.setFrame(360, 640)");
  await setStyle({ anchorX: 0.5, anchorY: 0.5, align: "center" });
  m = await measure();
  check(m.stage.height === 640 && m.stage.width === 360, `portrait frame is 360x640 (got ${m.stage.width}x${m.stage.height})`);
  checkAgainstExpected(m, "portrait centre");
  close(m.block.left + m.block.width / 2, 180, 1.5, "portrait centre: block is horizontally centred");
  close(m.block.top + m.block.height / 2, 320, 1.5, "portrait centre: block is vertically centred");
  const portraitShot = await screenshot("caption-position-3-portrait");
  await evaluate("window.__capCheck.setFrame(800, 450)");
  await settle();

  console.log("\n== clamping and extremes ==");
  await setStyle({ anchorX: 2, anchorY: -3, align: "left" });
  m = await measure();
  check(measuredSafe(m), "out-of-range anchors: block stays inside the safe area");
  close(m.block.left + m.block.width, m.expected.safe.right, 1.5, "anchor 2 clamps to the right edge");
  close(m.block.top, m.expected.safe.top, 1.5, "anchor -3 clamps to the top edge");

  console.log("\n== safe-area guide ==");
  await setStyle({ anchorX: 0.5, anchorY: 1, align: "center" });
  await setSafeArea("tiktok");
  const safeInfo = await evaluate(`(() => {
    const overlay = document.querySelector('.cap-safe-area');
    const box = overlay?.querySelector('[data-safe-area-box]');
    const picture = document.querySelector('.cap-overlay').getBoundingClientRect();
    const r = overlay.getBoundingClientRect();
    return overlay ? {
      key: overlay.getAttribute('data-safe-area'),
      text: overlay.textContent,
      rect: { left: r.left - picture.left, top: r.top - picture.top, width: r.width, height: r.height },
      frame: { width: picture.width, height: picture.height },
      box: box ? { left: box.getBoundingClientRect().left - picture.left, top: box.getBoundingClientRect().top - picture.top, width: box.getBoundingClientRect().width, height: box.getBoundingClientRect().height } : null,
      inCaption: Boolean(overlay.closest('.cap-block')),
      pointerEvents: getComputedStyle(overlay).pointerEvents,
    } : null;
  })()`);
  check(Boolean(safeInfo), "safe-area overlay appears in the preview");
  if (safeInfo) {
    check(safeInfo.key === "tiktok", "safe-area overlay uses the chosen preset");
    check(/TikTok · approximate/.test(safeInfo.text), "safe-area overlay is labelled approximate");
    close(safeInfo.rect.width, safeInfo.frame.width, 0.75, "safe-area overlay covers the picture width");
    close(safeInfo.rect.height, safeInfo.frame.height, 0.75, "safe-area overlay covers the picture height");
    check(safeInfo.box && safeInfo.box.top / safeInfo.frame.height > 0.09, "safe-area box starts below the TikTok top strip");
    check(safeInfo.box && safeInfo.box.height / safeInfo.frame.height < 0.75, "safe-area box is shorter than the picture");
    check(!safeInfo.inCaption, "safe-area overlay is not inside the caption block (so it cannot be exported with it)");
    check(safeInfo.pointerEvents === "none", "safe-area overlay never blocks dragging");
  }
  const safeShot = await screenshot("caption-position-4-safe-area");
  await setSafeArea(null);

  console.log("\n== drag (mouse) ==");
  await setStyle({ anchorX: 0.5, anchorY: 0.5, align: "center" });
  const beforeMouse = (await evaluate("window.__capCheck.getStyle()"));
  await mouseDrag(120, 60);
  const afterMouse = await evaluate("window.__capCheck.getStyle()");
  check(afterMouse.anchorX > beforeMouse.anchorX, `mouse drag moved the caption right (${beforeMouse.anchorX} → ${afterMouse.anchorX})`);
  check(afterMouse.anchorY > beforeMouse.anchorY, `mouse drag moved the caption down (${beforeMouse.anchorY} → ${afterMouse.anchorY})`);
  m = await measure();
  check(measuredSafe(m), "mouse drag keeps the caption inside the safe area");
  checkAgainstExpected(m, "after mouse drag");

  console.log("\n== drag (touch) ==");
  await browser.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await setStyle({ anchorX: 0.5, anchorY: 0.5 });
  const beforeTouch = await evaluate("window.__capCheck.getStyle()");
  await touchDrag(-90, -40);
  const afterTouch = await evaluate("window.__capCheck.getStyle()");
  check(afterTouch.anchorX < beforeTouch.anchorX, `touch drag moved the caption left (${beforeTouch.anchorX} → ${afterTouch.anchorX})`);
  check(afterTouch.anchorY < beforeTouch.anchorY, `touch drag moved the caption up (${beforeTouch.anchorY} → ${afterTouch.anchorY})`);

  console.log("\n== keyboard nudge ==");
  await browser.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await setStyle({ anchorX: 0.5, anchorY: 0.5 });
  await evaluate("document.querySelector('.cap-block').focus()");
  await pressKey("ArrowRight", "ArrowRight", 39);
  let keyed = await evaluate("window.__capCheck.getStyle()");
  close(keyed.anchorX, 0.51, 0.006, "ArrowRight nudges across by 1%");
  await pressKey("ArrowUp", "ArrowUp", 38, 8);
  keyed = await evaluate("window.__capCheck.getStyle()");
  close(keyed.anchorY, 0.45, 0.006, "Shift+ArrowUp nudges up by 5%");
  check(keyed.anchorX < 0.6, "keyboard keeps the anchor in range");

  console.log("\n== PositionControls ==");
  await setStyle({ anchorX: 0.5, anchorY: 0.5, align: "center" });
  await evaluate("document.querySelector('[data-cell=\"1,0\"]').click()");
  await settle();
  let controls = await evaluate("window.__capCheck.getStyle()");
  check(controls.anchorX === 1 && controls.anchorY === 0, "3x3 grid sets anchorX=1, anchorY=0");
  m = await measure();
  close(m.block.left + m.block.width, m.expected.safe.right, 1.5, "grid top-right puts the block on the right safe edge");
  close(m.block.top, m.expected.safe.top, 1.5, "grid top-right puts the block on the top safe edge");

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') ?? '') === 'Middle left');
    button.click();
  })()`);
  await settle();
  controls = await evaluate("window.__capCheck.getStyle()");
  check(controls.anchorX === 0 && controls.anchorY === 0.5, "3x3 grid sets anchorX=0, anchorY=0.5");

  await evaluate(`(() => {
    const slider = document.querySelector('input[aria-label="Across"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '0.25');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();
  controls = await evaluate("window.__capCheck.getStyle()");
  close(controls.anchorX, 0.25, 0.001, "Across slider sets 25%");

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => /^right$/i.test((item.getAttribute('aria-label') ?? item.textContent ?? '').trim()));
    button.click();
  })()`);
  await settle();
  controls = await evaluate("window.__capCheck.getStyle()");
  check(controls.align === "right", "alignment button sets right alignment");
  await evaluate(`document.querySelector('[data-safe-area-choice="instagram-reels"]').click()`);
  await settle();
  const chosen = await evaluate("document.querySelector('.cap-safe-area')?.getAttribute('data-safe-area')");
  check(chosen === "instagram-reels", "safe-area button turns on the Instagram Reels guide");

  const controlsShot = await screenshot("caption-position-5-controls");

  console.log("\n== page errors ==");
  check(pageErrors.length === 0, `no page errors (${pageErrors.length}${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(" | ")}` : ""})`);

  console.log(`\nScreenshots:\n  ${[bottomShot, topLeftShot, portraitShot, safeShot, controlsShot].join("\n  ")}`);
  if (notes.length) console.log(`\nNotes:\n  ${notes.join("\n  ")}`);
  console.log(`\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}`);
  if (failures.length) for (const failure of failures) console.log(`  - ${failure}`);
  if (failures.length) process.exitCode = 1;
} finally {
  try {
    browser?.close();
  } catch {
    /* already gone */
  }
  try {
    chrome?.kill();
  } catch {
    /* already gone */
  }
  try {
    await server?.close();
  } catch {
    /* already gone */
  }
  await rm(harnessDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

/** Local helper: the measured block's safe-area check is reported separately for each case. */
function measuredSafe(measured) {
  return (
    measured.block.left >= measured.expected.safe.left - 0.75 &&
    measured.block.left + measured.block.width <= measured.expected.safe.right + 0.75 &&
    measured.block.top >= measured.expected.safe.top - 0.75 &&
    measured.block.top + measured.block.height <= measured.expected.safe.bottom + 0.75
  );
}
