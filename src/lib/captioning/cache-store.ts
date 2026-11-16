import type { ModelStore } from "./model-loader";

/**
 * Keeps verified model files in the browser's Cache Storage, so the one-time download really is one-time
 * and the captioning tool works with no network afterwards.
 *
 * Cache Storage wants a URL for each entry. The entries use a made-up path on our OWN origin, so nothing
 * here is ever fetched: `put` stores the bytes we hand it and `match` only reads them back.
 *
 * The cache is injected so tests can run without a browser. Any storage failure (private windows, quota,
 * blocked storage) is treated as "not stored": the loader then simply downloads again.
 */

/** The small part of Cache Storage this module uses. */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

export const MODEL_CACHE_NAME = "cutmoor-captioning-models-v1";

export function createCacheStore(storage: CacheStorageLike, origin: string): ModelStore {
  let opened: Promise<CacheLike> | null = null;
  const cache = () => (opened ??= storage.open(MODEL_CACHE_NAME));
  const urlFor = (key: string) => `${origin.replace(/\/+$/, "")}/__cutmoor-models/${encodeURIComponent(key)}`;

  return {
    async get(key) {
      try {
        const hit = await (await cache()).match(urlFor(key));
        return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
      } catch {
        return null;
      }
    },
    async put(key, data) {
      try {
        const body = data.slice().buffer as ArrayBuffer;
        await (await cache()).put(urlFor(key), new Response(body, { headers: { "Content-Type": "application/octet-stream" } }));
      } catch {
        // Quota or blocked storage: the model works for this visit and is downloaded again next time.
      }
    },
    async delete(key) {
      try {
        return await (await cache()).delete(urlFor(key));
      } catch {
        return false;
      }
    },
  };
}

/** Removes every captioning model from the browser in one go, whatever manifest wrote it. */
export async function deleteAllStoredModels(storage: { delete(name: string): Promise<boolean> }): Promise<boolean> {
  try {
    return await storage.delete(MODEL_CACHE_NAME);
  } catch {
    return false;
  }
}
