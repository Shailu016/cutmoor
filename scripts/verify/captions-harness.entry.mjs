/**
 * Bundled by captions-network.mjs and loaded into the captions page, so the browser test runs the
 * REAL model-loader and network-policy code (not a copy) inside the page, under the page's real
 * security headers. It exposes window.__captionsHarness.
 */
import { cachedFileNames, describeDownload, downloadModel, ModelLoadError } from "../../src/lib/captioning/model-loader.ts";

const CACHE_NAME = "cutmoor-model-test";
const cacheUrl = (key) => `${location.origin}/__model-cache/${encodeURIComponent(key)}`;

/** A ModelStore on Cache Storage: the same kind of store the real page is expected to use. */
function cacheStore() {
  return {
    async get(key) {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(cacheUrl(key));
      return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
    },
    async put(key, data) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheUrl(key), new Response(data));
    },
    async delete(key) {
      const cache = await caches.open(CACHE_NAME);
      return cache.delete(cacheUrl(key));
    },
  };
}

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

window.__captionsHarness = {
  crossOriginIsolated: () => self.crossOriginIsolated === true,

  /** Runs the real downloader. Returns hashes (never the bytes) so the result crosses to the test cheaply. */
  async download(manifest, { allowedOrigins, chunkBytes, attempts }) {
    const store = cacheStore();
    const before = await cachedFileNames(manifest, store);
    const info = describeDownload(manifest, before);
    try {
      const files = await downloadModel(manifest, {
        allowedOrigins,
        chunkBytes,
        attempts,
        deps: {
          fetch: (input, init) => fetch(input, init),
          digest: (data) => crypto.subtle.digest("SHA-256", data),
          store,
          sleep: async () => {}, // no real waiting in a test
        },
      });
      const hashes = {};
      for (const [name, data] of files) hashes[name] = { sha256: toHex(await crypto.subtle.digest("SHA-256", data)), bytes: data.length };
      return { ok: true, hashes, cachedBefore: [...before], alreadyDownloaded: info.alreadyDownloaded };
    } catch (error) {
      return { ok: false, code: error instanceof ModelLoadError ? error.code : "other", message: String(error?.message ?? error), cachedBefore: [...before] };
    }
  },

  async cachedNames(manifest) {
    return [...(await cachedFileNames(manifest, cacheStore()))];
  },

  /** Flips one byte of a stored file, as a damaged disk or a malicious extension would. */
  async corrupt(key) {
    const store = cacheStore();
    const data = await store.get(key);
    if (!data) return false;
    data[0] ^= 0xff;
    await store.put(key, data);
    return true;
  },

  async clearStore() {
    return caches.delete(CACHE_NAME);
  },

  /**
   * Tries to send data to a host the page's policy does not allow, in every way a script could.
   * Returns which attempts the browser refused. Nothing here carries real user data.
   */
  async probeForbidden(url) {
    const violations = [];
    document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} -> ${event.blockedURI}`));
    const outcome = {};
    try {
      await fetch(url, { method: "POST", body: "probe", mode: "no-cors" });
      outcome.fetch = "ALLOWED";
    } catch {
      outcome.fetch = "blocked";
    }
    try {
      outcome.beacon = navigator.sendBeacon(url, "probe") ? "ALLOWED" : "blocked";
    } catch {
      outcome.beacon = "blocked";
    }
    outcome.image = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve("ALLOWED");
      img.onerror = () => resolve("blocked");
      img.src = `${url}?probe=1`;
      setTimeout(() => resolve("blocked"), 3000);
    });
    outcome.websocket = await new Promise((resolve) => {
      try {
        const socket = new WebSocket(url.replace(/^http/, "ws"));
        socket.onopen = () => resolve("ALLOWED");
        socket.onerror = () => resolve("blocked");
        setTimeout(() => resolve("blocked"), 3000);
      } catch {
        resolve("blocked");
      }
    });
    outcome.script = await new Promise((resolve) => {
      const script = document.createElement("script");
      script.onload = () => resolve("ALLOWED");
      script.onerror = () => resolve("blocked");
      script.src = `${url}/x.js`;
      document.head.append(script);
      setTimeout(() => resolve("blocked"), 3000);
    });
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the violation events arrive
    return { outcome, violations };
  },
};
