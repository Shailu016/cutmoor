/**
 * Build-time deployment settings, shared by vite.config.ts and the post-build
 * scripts so the client bundle, the prerendered HTML, and the checks agree.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** The launch domain. Used only when it is explicitly configured. */
export const LAUNCH_ORIGIN = "https://cutmoor.com";

const trimSlash = (value) => String(value ?? "").trim().replace(/\/+$/, "");

/**
 * Canonical origin, in priority order:
 * 1. VITE_SITE_URL (set this once the domain is live)
 * 2. the host's own deploy URL: Cloudflare Pages (CF_PAGES_URL),
 *    Netlify (URL), Vercel (VERCEL_PROJECT_PRODUCTION_URL)
 * 3. http://localhost:4173 for local builds
 *
 * It never silently falls back to a domain we may not control.
 */
export function resolveSiteUrl(env) {
  const explicit = trimSlash(env.VITE_SITE_URL);
  if (explicit) return { url: explicit, source: "VITE_SITE_URL" };
  // CF_PAGES_URL is per deployment (https://<hash>.<project>.pages.dev); canonicals need the stable project origin.
  const cloudflare = trimSlash(env.CF_PAGES_URL).replace(/^https:\/\/[^./]+\.([^./]+\.pages\.dev)$/, "https://$1");
  if (cloudflare) return { url: cloudflare, source: "CF_PAGES_URL" };
  const netlify = trimSlash(env.URL);
  if (netlify && /^https?:\/\//.test(netlify)) return { url: netlify, source: "Netlify URL" };
  const vercel = trimSlash(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercel) return { url: `https://${vercel}`, source: "VERCEL_PROJECT_PRODUCTION_URL" };
  return { url: "http://localhost:4173", source: "local fallback" };
}

/**
 * Where the browser loads the ffmpeg core from. Empty means same origin
 * (/ffmpeg). Set VITE_FFMPEG_BASE_URL to the R2/CDN folder for hosts with a
 * per-file size limit (Cloudflare Pages: 25 MiB; the wasm is ~31 MiB).
 */
export function resolveFfmpegBase(env) {
  return trimSlash(env.VITE_FFMPEG_BASE_URL);
}

/** SHA-256 (base64) of the core files, pinned into the client so a CDN copy is verified before it runs. */
export async function ffmpegCoreHashes(root) {
  const dir = join(root, "public", "ffmpeg");
  const hash = async (name) => {
    try {
      await stat(join(dir, name));
    } catch {
      return null;
    }
    return createHash("sha256").update(await readFile(join(dir, name))).digest("base64");
  };
  const [js, wasm] = await Promise.all([hash("ffmpeg-core.js"), hash("ffmpeg-core.wasm")]);
  return js && wasm ? { js, wasm } : null;
}
