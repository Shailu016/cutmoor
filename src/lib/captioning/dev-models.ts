/**
 * DEVELOPMENT ONLY: loads a speech model from `http://localhost:<port>/dev-models/`, so a new model (a bigger
 * Hinglish fine-tune, say) can be tried in the real browser before anything is uploaded to the model host.
 *
 * This module is reached in exactly one way: `if (import.meta.env.DEV) await import("./dev-models")` in
 * runtime.ts. `vite build` replaces that condition with `false`, so the bundler drops the branch and this file
 * with it; a production bundle contains no dev loader at all (checked with `grep -r "dev-models" dist/`).
 *
 * Why a separate validator instead of relaxing model-loader.ts: that loader only speaks https to
 * models.cutmoor.com, which is the privacy promise the security tests describe. So the dev rule lives here and is
 * narrower in every way that matters. The one exception is the speech engine: it downloads its own files through
 * model-loader (`whisper-engine` calls `downloadModel`), so that module carries the same localhost /dev-models rule,
 * behind `import.meta.env.DEV` and an origin the runtime lists explicitly. The engine therefore stays on the verified
 * path (pinned size and SHA-256, no cookies) instead of getting a second, weaker downloader.
 *   1. Only the name `localhost` (any port) and only paths under `/dev-models/`. Never 127.0.0.1, never a
 *      lookalike such as `localhost.example`, never a query, a fragment or credentials in the URL, and only
 *      plain ASCII names (so an encoded `..` cannot slip through).
 *   2. The same request options model-loader.ts uses: no cookies, no referrer, no redirect followed, no stored
 *      copy. A redirect to another host is an error, not something to follow.
 *   3. Every file must still match its pinned size and SHA-256 before it is used. A mismatch throws and nothing
 *      is returned: the dev path fails closed exactly like the production one.
 *   4. Verified bytes are kept in memory for this page only and are never written to the production model cache,
 *      so a local model cannot leak into (or stale) what a visitor has stored.
 */

import { ModelLoadError, type ModelManifest } from "./model-loader";

/** The folder scripts/serve-local.mjs serves and scripts/models/build-manifest.mjs writes (DEV_MODELS_DIR). */
export const DEV_MODELS_PREFIX = "/dev-models/";

/** The one file whose existence switches the dev models on. Missing means "use the normal model list". */
export const DEV_MANIFEST_PATH = `${DEV_MODELS_PREFIX}manifest.json`;

/** The same ceiling model-loader.ts applies, so an impossible size is refused before any request. */
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * A file path the dev server may serve: anything under /dev-models/ whose characters need no (possibly encoded)
 * interpretation. Rejecting `%`, `\\`, spaces and the like also rules out encoded dot-segments and encoded slashes.
 */
const PLAIN_DEV_PATH = /^\/dev-models\/[A-Za-z0-9._-][A-Za-z0-9._/-]*$/;

/** The request options model-loader.ts uses. Kept identical so the dev path cannot leak more than the real one. */
const HARDENED_REQUEST: RequestInit = {
  method: "GET",
  credentials: "omit",
  referrerPolicy: "no-referrer",
  redirect: "error",
  cache: "no-store",
  mode: "cors",
};

export interface DevModelDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** SHA-256 of the bytes. In the page this is `crypto.subtle.digest("SHA-256", data)`. */
  digest: (data: Uint8Array) => Promise<ArrayBuffer>;
}

export interface DevModelSource {
  /** The validated dev manifest. Its sizes are what the consent card will show. */
  manifest: ModelManifest;
  /** Downloads one part (engine, voice detector, onnxruntime) of the dev model set, verified. */
  load(manifest: ModelManifest, options?: { signal?: AbortSignal }): Promise<Map<string, Uint8Array>>;
}

/**
 * True only for a URL this dev loader may contact. `https` is allowed as well as `http` because
 * `scripts/serve-local.mjs --https` serves the same site (and so the same folder) over TLS on localhost;
 * both are loopback, so neither is a weaker promise.
 */
export function isDevModelUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // `hostname` is the parsed host without the port, so this is the whole host rule: the name localhost, any port.
  if (url.hostname !== "localhost") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  return PLAIN_DEV_PATH.test(url.pathname);
}

/**
 * Throws if anything in a dev manifest is unsafe or malformed. The same consistency checks as the production
 * validator (names, sizes, SHA-256 pins), with the dev-only URL rule in place of "https on the model host".
 */
export function validateDevManifest(manifest: ModelManifest): void {
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new ModelLoadError("bad-manifest", "The dev model list is empty or malformed.");
  }
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (!file.name || names.has(file.name)) throw new ModelLoadError("bad-manifest", `Dev model file name "${file.name}" is missing or repeated.`);
    names.add(file.name);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_FILE_BYTES) {
      throw new ModelLoadError("bad-manifest", `Dev model file "${file.name}" has an impossible size.`);
    }
    if (!SHA256_HEX.test(file.sha256)) throw new ModelLoadError("bad-manifest", `Dev model file "${file.name}" has no valid SHA-256 pin.`);
    if (!isDevModelUrl(file.url)) {
      throw new ModelLoadError("disallowed-url", `Dev model file "${file.name}" must be on http://localhost:<port>/dev-models/ and nowhere else.`);
    }
  }
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Looks for `/dev-models/manifest.json` and returns a loader for it, or null when there is none (the page then
 * uses the normal model list). Every failure here is silent on purpose: a dev folder that is missing, half
 * written or invalid must not stop the tool from working with the real models.
 */
export async function loadDevCaptionModels(deps: Partial<DevModelDeps> = {}): Promise<DevModelSource | null> {
  // Belt and braces: the only caller already checks this, and the import is tree-shaken away in a build.
  if (!import.meta.env.DEV) return null;

  const fetchImpl = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const digest = deps.digest ?? ((data: Uint8Array) => crypto.subtle.digest("SHA-256", data as BufferSource));

  let manifest: ModelManifest;
  try {
    const response = await fetchImpl(DEV_MANIFEST_PATH, HARDENED_REQUEST);
    if (response.status !== 200) return null; // no dev folder: use the bundled model list
    manifest = (await response.json()) as ModelManifest;
    validateDevManifest(manifest);
  } catch {
    return null; // unreadable or unsafe: fall back to the bundled model list, without a message
  }

  // One copy per verified SHA-256 for this page. The runtime asks for the engine, the voice detector and the
  // onnxruntime files separately, and a model file must not be fetched twice for that.
  const verified = new Map<string, Uint8Array>();

  return {
    manifest,
    async load(part, options = {}) {
      validateDevManifest(part);
      const result = new Map<string, Uint8Array>();
      for (const file of part.files) {
        if (options.signal?.aborted) throw new ModelLoadError("aborted", "Loading the dev model was cancelled.");
        const cached = verified.get(file.sha256);
        if (cached && cached.length === file.bytes) {
          result.set(file.name, cached);
          continue;
        }
        const response = await fetchImpl(file.url, { ...HARDENED_REQUEST, signal: options.signal });
        if (response.status !== 200) throw new ModelLoadError("http", `Dev model file "${file.name}" could not be downloaded (HTTP ${response.status}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length !== file.bytes) {
          throw new ModelLoadError("size-mismatch", `Dev model file "${file.name}" came back ${data.length} bytes, expected ${file.bytes}.`);
        }
        if (toHex(await digest(data)) !== file.sha256) {
          throw new ModelLoadError("integrity", `Dev model file "${file.name}" failed its integrity check and was not loaded.`);
        }
        verified.set(file.sha256, data); // only after the check, so a bad file can never be served from this cache
        result.set(file.name, data);
      }
      return result;
    },
  };
}
