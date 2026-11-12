/**
 * Copy the single-thread ffmpeg core into public/ffmpeg so the app can load it
 * from its own origin, or upload it to R2 (`npm run upload:ffmpeg`) for hosts
 * with a per-file limit. Either way the core is first-party, pinned by
 * SHA-256 at build time, and video files never leave the browser.
 *
 * @ffmpeg/ffmpeg creates its worker with `{ type: "module" }`. Module workers
 * cannot use importScripts, so the worker dynamic-imports the core instead.
 * That requires the ESM build; the UMD build fails with
 * "failed to import ffmpeg-core.js". Keep ESM first, and copy exactly one
 * variant so a later UMD pass cannot overwrite it.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const target = join(root, "public", "ffmpeg");

const variants = [
  {
    name: "esm",
    js: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
    wasm: "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
  },
  {
    name: "umd",
    js: "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js",
    wasm: "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm",
  },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(target, { recursive: true });

let chosen = null;
for (const candidate of variants) {
  if ((await exists(join(root, candidate.js))) && (await exists(join(root, candidate.wasm)))) {
    chosen = candidate;
    break;
  }
}

if (!chosen) {
  console.log("ffmpeg core is not installed yet; skipping copy.");
  process.exit(0);
}

await copyFile(join(root, chosen.js), join(target, "ffmpeg-core.js"));
await copyFile(join(root, chosen.wasm), join(target, "ffmpeg-core.wasm"));

console.log(`Copied ${chosen.name} ffmpeg core: ffmpeg-core.js, ffmpeg-core.wasm`);
