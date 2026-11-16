/**
 * Pure helpers for building, checking and uploading the speech-model set. No network, no
 * wrangler: everything here takes plain values so the unit tests can prove it works.
 *
 * Why the files get "opaque" names (m/<first 16 hex of the SHA-256>.bin):
 *  - The name IS the content. A changed file gets a new name, so a CDN or browser can cache every
 *    object forever and an old visitor never meets a half-updated model.
 *  - The URL says nothing about which model is being fetched, so a request log on the host
 *    cannot tell which language or model a visitor chose.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** 16 hex digits = 64 bits. Collisions are checked for anyway (see assertNoCollisions). */
export const NAME_HEX_LENGTH = 16;
export const OBJECT_NAME = /^m\/[0-9a-f]{16}\.bin$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const DEFAULT_BASE_URL = "https://models.cutmoor.com";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/** The manifest is small and may be replaced, so it must not be cached forever. */
export const MANIFEST_CACHE = "public, max-age=300";

/** SHA-256 of a file, streamed, so a 300 MB model never has to fit in memory. */
export function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    createReadStream(path)
      .on("data", (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
      })
      .on("error", reject)
      .on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });
}

export function sha256OfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The object name a file is stored under, from its hash. */
export function objectName(sha256) {
  if (!SHA256_HEX.test(sha256)) throw new Error(`Not a lower-case SHA-256: "${sha256}"`);
  return `m/${sha256.slice(0, NAME_HEX_LENGTH)}.bin`;
}

/** The https origin of a base URL, rejecting anything that is not plain https. */
export function normaliseBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`The base URL "${baseUrl}" is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`The base URL must be https, got "${baseUrl}".`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("The base URL must not contain credentials, a query or a fragment.");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

/** Where a local dev build serves model files (scripts/serve-local.mjs), never a production host. */
export const DEV_BASE_PATH = "/dev-models";

/**
 * The one non-production base a model build may use: the name localhost, any port, and the /dev-models path.
 * This is deliberately an opt-in separate argument (`--dev-base-url`), so `normaliseBaseUrl` keeps refusing every
 * http base: a manifest built without the flag can only ever point at https://models.cutmoor.com.
 */
export function normaliseDevBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`The dev base URL "${baseUrl}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`The dev base URL must be http, got "${baseUrl}".`);
  }
  // The name, not an IP and not a lookalike: the app's dev loader refuses anything else, so a build that used it
  // would produce a manifest the page silently ignores. Better to fail here.
  if (parsed.hostname !== "localhost") throw new Error(`The dev base URL must use the name localhost, got "${baseUrl}".`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("The dev base URL must not contain credentials, a query or a fragment.");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path !== DEV_BASE_PATH) throw new Error(`The dev base URL path must be ${DEV_BASE_PATH}, got "${path || "/"}".`);
  return parsed.origin + path;
}

/**
 * Two different files whose hashes share the same 16-digit prefix would overwrite each other in
 * the bucket. Astronomically unlikely, but silently serving the wrong model is the one failure
 * this tool must never allow, so it is checked.
 */
export function assertNoCollisions(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const key = objectName(entry.sha256);
    const other = seen.get(key);
    if (other && other !== entry.sha256) throw new Error(`Two different files would share the object name ${key}.`);
    seen.set(key, entry.sha256);
  }
}

/**
 * Builds the manifest object (the shape model-loader.ts calls ModelManifest). Deterministic: files
 * are sorted by name and nothing time- or machine-dependent is included, so building the same
 * input twice gives byte-identical output.
 *
 * entries: [{ name, bytes, sha256 }]
 *
 * `devBaseUrl` is the local-testing escape hatch (`--dev-base-url http://localhost:4180/dev-models`): it produces
 * http://localhost URLs that the dev-only loader in the app accepts, and nothing else changes. The normal `baseUrl`
 * rule stays https-only, so a production manifest can never be built with an http URL.
 */
export function buildManifest({ id, version, baseUrl = DEFAULT_BASE_URL, devBaseUrl, entries }) {
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`The model id "${id}" must be letters, digits, dot, dash or underscore.`);
  if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) throw new Error(`The version "${version}" must be letters, digits, dot, dash or underscore.`);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("There are no model files to put in the manifest.");
  const base = devBaseUrl ? normaliseDevBaseUrl(devBaseUrl) : normaliseBaseUrl(baseUrl);
  const names = new Set();
  for (const entry of entries) {
    if (!entry.name) throw new Error("A model file has no name.");
    if (names.has(entry.name)) throw new Error(`The model file name "${entry.name}" appears twice.`);
    names.add(entry.name);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) throw new Error(`"${entry.name}" is empty or has an impossible size.`);
  }
  assertNoCollisions(entries);
  const files = [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => ({ name: entry.name, url: `${base}/${objectName(entry.sha256)}`, bytes: entry.bytes, sha256: entry.sha256 }));
  return { id, version, files };
}

/** Stable text form of a manifest: two-space JSON and a final newline. */
export function serialiseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Checks a manifest's own consistency, with no files involved. Returns a list of problems
 * (empty means fine). The object name must match the hash, because that is what makes the URL
 * safe to cache forever.
 */
export function checkManifestShape(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") return ["The manifest is not an object."];
  if (!manifest.id || typeof manifest.id !== "string") problems.push("The manifest has no id.");
  if (!manifest.version || typeof manifest.version !== "string") problems.push("The manifest has no version.");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    problems.push("The manifest lists no files.");
    return problems;
  }
  const names = new Set();
  const origins = new Set();
  for (const file of manifest.files) {
    const label = `"${file?.name ?? "?"}"`;
    if (!file || typeof file.name !== "string" || !file.name) {
      problems.push("A file entry has no name.");
      continue;
    }
    if (names.has(file.name)) problems.push(`${label} is listed twice.`);
    names.add(file.name);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) problems.push(`${label} has an impossible size.`);
    if (!SHA256_HEX.test(file.sha256 ?? "")) {
      problems.push(`${label} has no valid SHA-256.`);
      continue;
    }
    let url;
    try {
      url = new URL(file.url);
    } catch {
      problems.push(`${label} has an invalid URL.`);
      continue;
    }
    if (url.protocol !== "https:") problems.push(`${label} is not an https URL.`);
    if (url.search || url.hash) problems.push(`${label} has a query or fragment in its URL.`);
    origins.add(url.origin);
    const objectPath = url.pathname.replace(/^\//, "");
    if (!OBJECT_NAME.test(objectPath)) problems.push(`${label} is not stored under an opaque m/<hash>.bin name.`);
    else if (objectPath !== objectName(file.sha256)) problems.push(`${label} has a URL whose name does not match its SHA-256.`);
  }
  if (origins.size > 1) problems.push(`The files are spread over several hosts (${[...origins].join(", ")}); a model must come from one host.`);
  return problems;
}

/**
 * Turns a manifest plus a "what is already there" lookup into the exact list of actions.
 * `presentSizes` maps object key -> size in bytes of what the host already serves (or is empty).
 * An object counts as present only if the size equals the manifest size: the name already encodes
 * the hash, so equal name + equal size is the strongest check available without downloading it.
 */
export function planUpload(manifest, { presentSizes = new Map(), force = false } = {}) {
  const seen = new Set();
  const actions = [];
  for (const file of manifest.files) {
    const key = new URL(file.url).pathname.replace(/^\//, "");
    if (seen.has(key)) continue; // two names with identical content share one object
    seen.add(key);
    const present = presentSizes.get(key);
    if (!force && present === file.bytes) actions.push({ kind: "skip", key, bytes: file.bytes, reason: "already uploaded with the same size" });
    else actions.push({ kind: "put", key, bytes: file.bytes, contentType: "application/octet-stream", cacheControl: IMMUTABLE_CACHE });
  }
  return actions;
}

/**
 * The wrangler command line for one upload. Pinned to the same wrangler version as the ffmpeg
 * upload script. `--remote` is explicit so a stray local-simulator default can never be used.
 */
export const WRANGLER = "wrangler@4.161.0";
export function wranglerPutArgs({ bucket, key, file, contentType, cacheControl }) {
  return [
    "--yes", WRANGLER, "r2", "object", "put", `${bucket}/${key}`,
    "--file", file,
    "--content-type", contentType,
    "--cache-control", cacheControl,
    "--remote",
  ];
}

/** Bucket names are 3-63 chars of lower-case letters, digits and dashes. */
export function assertBucketName(bucket) {
  if (!bucket) throw new Error("Set R2_BUCKET to the target bucket name, e.g. R2_BUCKET=cutmoor-models.");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`"${bucket}" is not a valid R2 bucket name.`);
}
