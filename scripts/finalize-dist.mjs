/**
 * Last build step: make dist/ deployable and fail loudly if it is not.
 *
 * - When VITE_FFMPEG_BASE_URL points at R2/a CDN, dist/ffmpeg is removed so
 *   the 31 MiB wasm is never uploaded to the static host.
 * - Every file is checked against the host's per-file limit. Cloudflare Pages
 *   rejects files over 25 MiB, so on Cloudflare (or with STRICT_DEPLOY=1) an
 *   oversized file fails the build instead of failing the deploy later.
 * - The canonical origin is reported, with a warning when it is not the
 *   configured production domain.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadEnv } from "vite";
import { LAUNCH_ORIGIN, resolveFfmpegBase, resolveSiteUrl } from "./deploy-env.mjs";

const root = process.cwd();
const dist = join(root, "dist");
const env = { ...loadEnv("production", root, ""), ...process.env };

const MiB = 1024 * 1024;
const limitMiB = Number(env.DEPLOY_MAX_FILE_MIB) || 25;
const strict = Boolean(env.CF_PAGES) || env.STRICT_DEPLOY === "1";

const ffmpegBase = resolveFfmpegBase(env);
if (ffmpegBase) {
  await rm(join(dist, "ffmpeg"), { recursive: true, force: true });
  console.log(`ffmpeg core: loaded from ${ffmpegBase} (dist/ffmpeg removed).`);
} else {
  console.log("ffmpeg core: self-hosted from /ffmpeg.");
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const oversized = [];
for await (const file of walk(dist)) {
  const { size } = await stat(file);
  if (size > limitMiB * MiB) oversized.push(`${relative(dist, file)} (${(size / MiB).toFixed(1)} MiB)`);
}

if (oversized.length) {
  const message = [
    `Files over the ${limitMiB} MiB per-file deploy limit:`,
    ...oversized.map((line) => `  - ${line}`),
    "Upload the ffmpeg core with `npm run upload:ffmpeg` and set VITE_FFMPEG_BASE_URL (see README, Deploying).",
  ].join("\n");
  if (strict) {
    console.error(`\n${message}\n`);
    process.exit(1);
  }
  console.warn(`\nWarning (ignored outside Cloudflare; set STRICT_DEPLOY=1 to enforce):\n${message}\n`);
}

const site = resolveSiteUrl(env);
console.log(`Canonical origin: ${site.url} (from ${site.source}).`);
if (site.url !== LAUNCH_ORIGIN) {
  console.warn(
    `Note: canonical URLs, the sitemap, and robots.txt point at ${site.url}. ` +
      `Set VITE_SITE_URL=${LAUNCH_ORIGIN} once that domain is connected.`,
  );
}
