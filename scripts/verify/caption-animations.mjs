// Real-browser check of the caption entry animations, saved-looks validation and the two new
// controls (Task D).
//
//   node scripts/verify/caption-animations.mjs
//
// It builds scripts/verify/caption-animations.html with Vite as a PRODUCTION build (the same
// modules the app ships), serves the output on http://127.0.0.1:4213 from Node's own static
// server, and drives headless Chrome over the DevTools protocol using only built-ins (no
// puppeteer). No package is installed and nothing is uploaded or fetched from another host.
//
// Checks, for every animation:
//   - the canvas renderer the MP4 exporter calls per frame changes the picture over time
//     (except "none", which must stay static),
//   - the final frame is pixel-identical to the same caption with no animation.
// It also checks the HTML preview's fade/typewriter timing, that prefers-reduced-motion stops
// the preview animation (the export path is not affected), and that SavedLooks saves to
// localStorage. Screenshots are written to SHOT_DIR (default: <tmp>/caption-animation-shots).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { build } from "vite";

const ROOT = process.cwd();
const HARNESS_HTML = join(ROOT, "scripts", "verify", "caption-animations.html");
const OUT = join(tmpdir(), `cutmoor-caption-animations-${process.pid}`);
const SHOTS = process.env.SHOT_DIR ?? join(tmpdir(), "caption-animation-shots");
const PORT = Number(process.env.PORT ?? 4213);
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const REDUCED_ONLY = process.argv.includes("--reduced-only");

const failures = [];
let checksRun = 0;

function check(name, ok, detail) {
  checksRun += 1;
  if (!ok) failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

async function buildHarness() {
  mkdirSync(OUT, { recursive: true });
  await build({
    configFile: false,
    root: ROOT,
    base: "/",
    logLevel: "warn",
    esbuild: { jsx: "automatic" },
    build: {
      outDir: OUT,
      emptyOutDir: true,
      target: "es2022",
      rollupOptions: { input: HARNESS_HTML },
    },
  });
  const html = walk(OUT).find((file) => file.endsWith(".html"));
  if (!html) throw new Error("the Vite build produced no HTML entry");
  return { html, htmlUrl: relative(OUT, html).split(sep).join("/") };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function serve(directory) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = resolve(directory, `.${relativePath}`);
      if (!file.startsWith(resolve(directory) + sep)) {
        response.statusCode = 403;
        response.end("forbidden");
        return;
      }
      const body = readFileSync(file);
      response.setHeader("Content-Type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end("not found");
    }
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(PORT, "127.0.0.1", done);
  });
  return server;
}

async function launchChrome(userDataDir) {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const portFile = join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 300; attempt++) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, "utf8").split(/\r?\n/);
      if (port) return { child, port: Number(port) };
    }
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  child.kill();
  throw new Error(`Chrome did not open a DevTools port.\n${stderr}`);
}

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("Chrome has no page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done, fail) => pending.set(id, { resolve: done, reject: fail }));
  };
  const on = (method, listener) => {
    const list = listeners.get(method) ?? [];
    list.push(listener);
    listeners.set(method, list);
  };
  return { send, on, close: () => socket.close() };
}

async function runOnce({ reduced, url, label }) {
  const userDataDir = join(OUT, `chrome-${label}`);
  mkdirSync(userDataDir, { recursive: true });
  const { child, port } = await launchChrome(userDataDir);
  const cdp = await connect(port);
  const pageErrors = [];

  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1800, deviceScaleFactor: 1, mobile: false });
    if (reduced) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    }
    cdp.on("Runtime.exceptionThrown", (event) => pageErrors.push(event.exceptionDetails?.text ?? "exception"));
    cdp.on("Log.entryAdded", (event) => {
      if (event.entry?.level === "error") pageErrors.push(event.entry.text);
    });
    cdp.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "error") pageErrors.push(event.args?.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    });

    await cdp.send("Page.navigate", { url });

    let result = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: "window.__CAPTION_ANIMATION_RESULT__ ? JSON.stringify(window.__CAPTION_ANIMATION_RESULT__) : null",
        returnByValue: true,
      });
      if (typeof evaluated.result?.value === "string") {
        result = JSON.parse(evaluated.result.value);
        break;
      }
      await sleep(100);
    }
    if (!result) throw new Error("the harness did not finish within 40 s");
    if (result.error) throw new Error(`harness error: ${result.error}`);

    mkdirSync(SHOTS, { recursive: true });
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const shotPath = join(SHOTS, `caption-animations-${label}.png`);
    writeFileSync(shotPath, Buffer.from(shot.data, "base64"));

    console.log(`\n--- ${label}${reduced ? " (prefers-reduced-motion: reduce)" : ""} ---`);
    if (result.reduced !== reduced) {
      check(`${label}: media preference was applied`, false, `harness saw reduced=${result.reduced}`);
    }
    for (const item of result.checks) check(`${label}: ${item.name}`, item.ok, item.detail);
    check(`${label}: no page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

    const summary = {
      label,
      reduced,
      screenshot: shotPath,
      animations: result.animations,
      preview: result.preview,
      checks: result.checks.length,
    };
    writeFileSync(join(SHOTS, `caption-animations-${label}.json`), JSON.stringify(summary, null, 2));
    console.log(`screenshot: ${shotPath}`);
    return { pageErrors, result };
  } finally {
    cdp.close();
    child.kill();
    await sleep(300);
  }
}

async function main() {
  if (!existsSync(HARNESS_HTML)) throw new Error(`missing ${HARNESS_HTML}`);
  console.log("building the harness with Vite (production mode)…");
  const { htmlUrl } = await buildHarness();
  const server = await serve(OUT);
  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`serving ${OUT} at ${baseUrl} (page ${baseUrl}/${htmlUrl})`);

  try {
    if (!REDUCED_ONLY) await runOnce({ reduced: false, url: `${baseUrl}/${htmlUrl}`, label: "normal" });
    await runOnce({ reduced: true, url: `${baseUrl}/${htmlUrl}`, label: "reduced" });
  } finally {
    await new Promise((done) => server.close(done));
  }

  console.log(`\n${checksRun - failures.length} of ${checksRun} checks passed.`);
  if (failures.length > 0) {
    console.log(`failed: ${failures.join("; ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Keep the screenshots; drop the temporary build.
    try {
      rmSync(OUT, { recursive: true, force: true });
    } catch {
      /* nothing to clean */
    }
  });
