/**
 * Downloads the speech models safely. This is the one place the captioning tool talks to the
 * network, so the privacy promise lives here:
 *
 *  - Only the origins the caller allows (our own model host) are ever contacted. Anything else is
 *    refused BEFORE a request is made, and a redirect to another host is an error.
 *  - Requests carry no cookies, no referrer and no body. Nothing about the visitor's media is in them.
 *  - Every file must match a pinned SHA-256 before it is used or cached. A file that does not match
 *    is thrown away: the loader fails closed instead of running an unchecked model.
 *  - A flaky connection does not restart a 100 MB download: files are fetched in ranges and only the
 *    failed range is retried.
 *
 * Everything the loader touches from the outside (fetch, hashing, storage, waiting) is passed in, so
 * the same code runs in the page and in tests without a network.
 */

export interface ModelFile {
  /** The name callers look the bytes up by, e.g. "swift-encoder". */
  name: string;
  /** Absolute https URL. Its origin must be one of the allowed origins. */
  url: string;
  /** Exact size in bytes. */
  bytes: number;
  /** Lower-case hex SHA-256 of the file. */
  sha256: string;
}

export interface ModelManifest {
  id: string;
  version: string;
  files: ModelFile[];
}

/** Where verified files are kept between visits. The page backs this with Cache Storage or OPFS. */
export interface ModelStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface LoaderDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** SHA-256 of the bytes. In the page this is `crypto.subtle.digest("SHA-256", data)`. */
  digest: (data: Uint8Array) => Promise<ArrayBuffer>;
  store: ModelStore;
  /** Waits between retries. Injected so tests do not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface DownloadProgress {
  file: string;
  /** Bytes of the whole model set that are in memory or cached. */
  loadedBytes: number;
  totalBytes: number;
}

export interface DownloadOptions {
  /** Origins such as "https://models.cutmoor.com". Nothing else is contacted. */
  allowedOrigins: readonly string[];
  deps: LoaderDeps;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Size of each range request. Default 8 MiB. */
  chunkBytes?: number;
  /** Tries per range, including the first. Default 4. */
  attempts?: number;
}

export type ModelLoadErrorCode = "bad-manifest" | "disallowed-url" | "http" | "size-mismatch" | "integrity" | "network" | "aborted";

export class ModelLoadError extends Error {
  constructor(
    readonly code: ModelLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelLoadError";
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const DEFAULT_CHUNK = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** The key a verified file is stored under. The hash is in the key, so a changed file can never be mistaken for the old one. */
export function storeKey(file: ModelFile): string {
  return `cutmoor-model/${file.sha256}`;
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * DEVELOPMENT BUILDS ONLY: the local dev model folder (`http://localhost:<port>/dev-models/...`), so the speech
 * engine can be tried from `scripts/serve-local.mjs` before it is uploaded. The engine downloads its own files
 * through this module (whisper-engine calls `downloadModel`), so the allowance has to live here; it is the same
 * narrow rule the dev loader applies, plus one more condition: the caller must list that exact origin in
 * `allowedOrigins`. `vite build` replaces `import.meta.env.DEV` with false, which removes this branch from a
 * production bundle, where an http URL is refused before any request (asserted in the tests).
 */
function isLocalDevModelFile(url: URL, allowedOrigins: readonly string[]): boolean {
  if (!import.meta.env.DEV) return false;
  if (url.protocol !== "http:") return false;
  if (url.hostname !== "localhost") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  return /^\/dev-models\/[A-Za-z0-9._-][A-Za-z0-9._/-]*$/.test(url.pathname) && allowedOrigins.includes(url.origin);
}

/** Throws if anything in the manifest is unsafe or malformed. Runs before any request is made. */
export function validateManifest(manifest: ModelManifest, allowedOrigins: readonly string[]): void {
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new ModelLoadError("bad-manifest", "The model list is empty or malformed.");
  }
  const allowed = new Set(allowedOrigins.map((origin) => originOf(origin) ?? ""));
  allowed.delete("");
  if (allowed.size === 0) throw new ModelLoadError("bad-manifest", "No https model host is allowed, so nothing can be downloaded.");
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (!file.name || names.has(file.name)) throw new ModelLoadError("bad-manifest", `Model file name "${file.name}" is missing or repeated.`);
    names.add(file.name);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_FILE_BYTES) {
      throw new ModelLoadError("bad-manifest", `Model file "${file.name}" has an impossible size.`);
    }
    if (!SHA256_HEX.test(file.sha256)) throw new ModelLoadError("bad-manifest", `Model file "${file.name}" has no valid SHA-256 pin.`);
    let parsed: URL;
    try {
      parsed = new URL(file.url);
    } catch {
      throw new ModelLoadError("disallowed-url", `Model file "${file.name}" is not an https URL.`);
    }
    if (parsed.protocol === "https:" && allowed.has(parsed.origin)) continue;
    if (isLocalDevModelFile(parsed, allowedOrigins)) continue;
    if (parsed.protocol !== "https:") throw new ModelLoadError("disallowed-url", `Model file "${file.name}" is not an https URL.`);
    throw new ModelLoadError("disallowed-url", `Model file "${file.name}" is hosted on ${parsed.origin}, which is not an allowed model host.`);
  }
}

/** What to tell the visitor before downloading, so they can say yes with the facts in front of them. */
export function describeDownload(manifest: ModelManifest, cachedNames: ReadonlySet<string> = new Set()) {
  const pending = manifest.files.filter((file) => !cachedNames.has(file.name));
  return {
    totalBytes: pending.reduce((sum, file) => sum + file.bytes, 0),
    hosts: [...new Set(pending.map((file) => originOf(file.url) ?? file.url))],
    fileCount: pending.length,
    alreadyDownloaded: pending.length === 0,
  };
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(deps: LoaderDeps, data: Uint8Array): Promise<string> {
  return toHex(await deps.digest(data));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ModelLoadError("aborted", "The download was cancelled.");
}

/** One range of one file, retried on network trouble. A wrong answer from the server is never retried. */
async function fetchRange(file: ModelFile, start: number, end: number, options: DownloadOptions): Promise<{ data: Uint8Array; whole: boolean }> {
  const { deps, signal } = options;
  const attempts = Math.max(1, options.attempts ?? 4);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const expected = end - start + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await deps.fetch(file.url, {
        method: "GET",
        headers: { Range: `bytes=${start}-${end}` },
        // No cookies, no referrer, no redirect to another host, and no stored copy that could be swapped.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
        mode: "cors",
        signal,
      });
      if (response.status === 206) {
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length !== expected) throw new ModelLoadError("size-mismatch", `"${file.name}" range ${start}-${end} came back ${data.length} bytes, expected ${expected}.`);
        return { data, whole: false };
      }
      if (response.status === 200) {
        // The server ignored Range and sent the whole file. Take all of it, once, instead of asking again per range.
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length !== file.bytes) throw new ModelLoadError("size-mismatch", `"${file.name}" came back ${data.length} bytes, expected ${file.bytes}.`);
        return { data, whole: true };
      }
      if (response.status >= 500 || response.status === 429) throw new Error(`HTTP ${response.status}`);
      throw new ModelLoadError("http", `"${file.name}" could not be downloaded (HTTP ${response.status}).`);
    } catch (error) {
      if (error instanceof ModelLoadError) throw error;
      if (signal?.aborted) throw new ModelLoadError("aborted", "The download was cancelled.");
      lastError = error;
      if (attempt < attempts) await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new ModelLoadError("network", `"${file.name}" could not be downloaded: ${lastError instanceof Error ? lastError.message : "network error"}.`);
}

/**
 * Returns every file of the manifest, verified. Files already in the store are used without any
 * request (after being checked again). Throws a ModelLoadError, and stores nothing, on any problem.
 */
export async function downloadModel(manifest: ModelManifest, options: DownloadOptions): Promise<Map<string, Uint8Array>> {
  validateManifest(manifest, options.allowedOrigins);
  const { deps, signal } = options;
  const chunk = Math.max(1024, Math.floor(options.chunkBytes ?? DEFAULT_CHUNK));
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  const result = new Map<string, Uint8Array>();
  let loaded = 0;
  const report = (file: string) => options.onProgress?.({ file, loadedBytes: loaded, totalBytes });

  for (const file of manifest.files) {
    throwIfAborted(signal);
    const key = storeKey(file);

    const stored = await deps.store.get(key);
    if (stored && stored.length === file.bytes && (await sha256Hex(deps, stored)) === file.sha256) {
      result.set(file.name, stored);
      loaded += file.bytes;
      report(file.name);
      continue;
    }
    if (stored) await deps.store.delete(key); // damaged or outdated: never trust it

    let data: Uint8Array = new Uint8Array(file.bytes);
    for (let start = 0; start < file.bytes; start += chunk) {
      const end = Math.min(file.bytes, start + chunk) - 1;
      const part = await fetchRange(file, start, end, options);
      if (part.whole) {
        data = part.data;
        loaded += file.bytes - start; // ranges before this one were already counted
        report(file.name);
        break;
      }
      data.set(part.data, start);
      loaded += end - start + 1;
      report(file.name);
    }

    if ((await sha256Hex(deps, data)) !== file.sha256) {
      throw new ModelLoadError("integrity", `"${file.name}" failed its integrity check and was not loaded.`);
    }
    await deps.store.put(key, data);
    result.set(file.name, data);
  }
  return result;
}

/** Which files of the manifest are already stored, by name. Does not touch the network. */
export async function cachedFileNames(manifest: ModelManifest, store: ModelStore): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of manifest.files) {
    const stored = await store.get(storeKey(file));
    if (stored && stored.length === file.bytes) names.add(file.name);
  }
  return names;
}

/** Removes every file of the manifest from the store. Returns how many were removed. */
export async function deleteModel(manifest: ModelManifest, store: ModelStore): Promise<number> {
  let removed = 0;
  for (const file of manifest.files) if (await store.delete(storeKey(file))) removed += 1;
  return removed;
}
