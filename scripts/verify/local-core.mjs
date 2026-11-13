/**
 * Serves the ffmpeg core from node_modules when a page asks the CDN for it.
 *
 * The browser checks run against the production build, which loads the encoder
 * from unpkg. Fetching 32 MB from a third-party CDN inside every CI run makes
 * the gates fail for reasons unrelated to the change, so the same files are
 * answered locally instead. The bytes are identical to the published package,
 * so the page's SHA-256 check still runs and still has to pass.
 *
 *   await serveCoreLocally(page);   // call before page.goto
 *
 * Set USE_CDN_CORE=1 to let the requests through to the real CDN.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const CORE_DIR = join(dirname(require.resolve("@ffmpeg/core")), "..", "esm");
const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm" };
const cache = new Map();

async function coreFile(name) {
  if (!cache.has(name)) cache.set(name, await readFile(join(CORE_DIR, name)));
  return cache.get(name);
}

export async function serveCoreLocally(page) {
  if (process.env.USE_CDN_CORE === "1") return;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const match = /\/@ffmpeg\/core@[^/]+\/dist\/esm\/(ffmpeg-core\.(?:js|wasm))$/.exec(request.url());
    if (!match) {
      await request.continue();
      return;
    }
    const name = match[1];
    await request.respond({
      status: 200,
      contentType: TYPES[name.slice(name.lastIndexOf("."))],
      headers: { "Access-Control-Allow-Origin": "*" },
      body: await coreFile(name),
    });
  });
}
