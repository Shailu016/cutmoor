/**
 * Pure helpers for the Auto captions browser check (captions-network.mjs): reading the real
 * public/_headers the way Cloudflare Pages applies it, a pretend model host, and a tiny
 * deterministic set of pretend model files. No browser and no network in here, so unit tests
 * can pin the behaviour down.
 */
import { createHash } from "node:crypto";

export const MODEL_ORIGIN = "https://models.cutmoor.com";

// ------------------------------------------------------------------ _headers

/**
 * Parses a Cloudflare Pages / Netlify style _headers file into [{ pattern, headers: [[name, value]] }].
 * A line that starts at column 0 (and is not a comment) opens a rule; indented "Name: value" lines
 * belong to it.
 */
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const colon = raw.indexOf(":");
    if (!current || colon < 0) throw new Error(`Cannot read this _headers line: "${raw}"`);
    current.headers.push([raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()]);
  }
  return rules;
}

/** `*` is a splat that matches anything, slashes included; `:name` placeholders match one path segment. */
export function patternToRegExp(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") source += ".*";
    else if (ch === ":" && /[A-Za-z_]/.test(pattern[i + 1] ?? "")) {
      source += "[^/]+";
      while (/[A-Za-z0-9_]/.test(pattern[i + 1] ?? "")) i += 1;
    } else source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * The response headers the host would add for a path: every matching rule applies, and a header
 * set by more than one rule is joined with ", " (Cloudflare Pages behaviour). Keys are lower-case.
 */
export function headersFor(pathname, rules) {
  const out = {};
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(pathname)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      out[key] = key in out ? `${out[key]}, ${value}` : value;
    }
  }
  return out;
}

/** Splits a Content-Security-Policy into { directive: [sources] }. */
export function parseCsp(csp) {
  const directives = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives[tokens[0].toLowerCase()] = tokens.slice(1);
  }
  return directives;
}

// ------------------------------------------------------------------ pretend model files

/** Deterministic bytes (xorshift32), so every run and every machine builds the same files. */
export function seededBytes(length, seed) {
  const out = new Uint8Array(length);
  let x = (seed | 0) || 1;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ------------------------------------------------------------------ pretend model host

/**
 * Answers a request the way R2 behind models.cutmoor.com would: GET/HEAD only, one "bytes=a-b"
 * Range -> 206 with Content-Range, CORS headers for the page's origin, 404 for unknown paths.
 * `ignoreRange` lists URLs the server answers in full with 200 (some proxies do; the loader
 * must cope). Returns { status, headers, body } where body is a Uint8Array or null.
 */
export function createFakeModelHost({ files, pageOrigin, ignoreRange = new Set() }) {
  const cors = {
    "access-control-allow-origin": pageOrigin,
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges",
    vary: "Origin",
  };
  return function respond({ url, method, headers = {} }) {
    const upper = method.toUpperCase();
    if (upper === "OPTIONS") {
      return {
        status: 204,
        headers: { ...cors, "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": "Range", "access-control-max-age": "600" },
        body: null,
      };
    }
    if (upper !== "GET" && upper !== "HEAD") return { status: 405, headers: cors, body: null };
    const data = files.get(url);
    if (!data) return { status: 404, headers: cors, body: new Uint8Array(0) };
    const base = { ...cors, "accept-ranges": "bytes", "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" };
    const range = /^bytes=(\d+)-(\d*)$/.exec(headers.range ?? headers.Range ?? "");
    if (!range || ignoreRange.has(url)) {
      return { status: 200, headers: { ...base, "content-length": String(data.length) }, body: upper === "HEAD" ? null : data };
    }
    const start = Number(range[1]);
    const end = Math.min(data.length - 1, range[2] === "" ? data.length - 1 : Number(range[2]));
    if (start >= data.length || end < start) {
      return { status: 416, headers: { ...base, "content-range": `bytes */${data.length}` }, body: null };
    }
    const slice = data.subarray(start, end + 1);
    return {
      status: 206,
      headers: { ...base, "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": String(slice.length) },
      body: upper === "HEAD" ? null : slice,
    };
  };
}
