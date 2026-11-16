/**
 * Serves dist/ with the headers from public/_headers, for trying the site locally:
 *
 *   node scripts/serve-local.mjs [port] [--https <key> <cert>]
 *
 * It also serves the dev-only model folder at /dev-models/* (see scripts/models/README.md). That folder is NOT part of
 * dist/ and is never built into the site: it is read from DEV_MODELS_DIR, which defaults to
 * .team/models-local/dev-models, so a model built for local testing is kept out of src/ and public/.
 */
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative } from "node:path";
import { headersFor, parseHeadersFile } from "./verify/captions-lib.mjs";

const port = Number(process.argv[2] ?? 4180);
const root = join(process.cwd(), "dist");
/** Dev-only model files. Missing is normal: /dev-models then simply answers 404 and the page uses the real models. */
const devDir = process.env.DEV_MODELS_DIR ?? join(".team", "models-local", "dev-models");
// An absolute DEV_MODELS_DIR (the usual case: a build folder elsewhere) must not be joined onto the working directory.
const devRoot = isAbsolute(devDir) ? devDir : join(process.cwd(), devDir);
const DEV_MODELS_PREFIX = "/dev-models/";
const rules = parseHeadersFile(await readFile(join(process.cwd(), "public", "_headers"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain" };
const devTypes = { ".json": "application/json", ".bin": "application/octet-stream", ".onnx": "application/octet-stream", ".wasm": "application/wasm" };

/**
 * A URL path as a file path inside `rootDir`, or null when it cannot be one. `..` is dropped and the result is
 * checked again with `relative()`, so no request can read a file outside the folder it is served from.
 */
function inRoot(rootDir, pathname) {
  const safe = normalize(pathname).split(/[\\/]/).filter((part) => part !== "..").join("/");
  const file = join(rootDir, safe);
  const inside = relative(rootDir, file);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside)) ? file : null;
}

const handler = async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    // A malformed escape (for example "/%ZZ") must be a 400, not an unhandled throw that kills the server.
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad request");
    return;
  }

  // Dev-only model files, served straight from DEV_MODELS_DIR. Never cached: a rebuilt model must be picked up on reload.
  if (path.startsWith(DEV_MODELS_PREFIX)) {
    // The folder root IS /dev-models/, so the prefix is removed before it is joined onto the folder (unlike dist/,
    // whose folder mirrors the whole URL path).
    const file = inRoot(devRoot, path.slice(DEV_MODELS_PREFIX.length));
    const info = file ? await stat(file).catch(() => null) : null;
    if (!info?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return res.end(`No dev model here. Put a manifest.json and its m/<hash>.bin files in ${devRoot} (DEV_MODELS_DIR).`);
    }
    res.writeHead(200, { "content-type": devTypes[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    return res.end(await readFile(file));
  }

  const trimmed = path.replace(/\/+$/, "");
  const candidates = [inRoot(root, path), inRoot(root, `${trimmed}/index.html`), inRoot(root, `${trimmed}.html`)];
  for (const file of candidates) {
    if (!file) continue;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) {
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", ...headersFor(path, rules) });
      return res.end(await readFile(file));
    }
  }
  res.writeHead(404, { "content-type": "text/html" });
  res.end(await readFile(join(root, "404.html")).catch(() => "Not found"));
};

// Plain HTTP for localhost (a secure context there). Over a network address the browser only gives WebGPU, crypto and the cache to
// HTTPS pages, so `--https <key> <cert>` serves the same site over HTTPS with the given (for example self-signed) certificate.
const tlsAt = process.argv.indexOf("--https");
if (tlsAt > 0) {
  const options = { key: await readFile(process.argv[tlsAt + 1]), cert: await readFile(process.argv[tlsAt + 2]) };
  createHttps(options, handler).listen(port, () => console.log(`https://localhost:${port}/tools/auto-captions/`));
} else {
  createHttp(handler).listen(port, () => console.log(`http://localhost:${port}/tools/auto-captions/`));
}
