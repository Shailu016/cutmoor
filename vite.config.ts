import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { ffmpegCoreHashes, resolveFfmpegBase, resolveSiteUrl } from "./scripts/deploy-env.mjs";

/**
 * vite preview does not map /tools/compress to dist/tools/compress/index.html
 * the way a static host does. Reproduce pretty URLs and the 404 status locally
 * so the preview is a real smoke test of the prerendered site.
 */
function prettyUrlPreview(): Plugin {
  return {
    name: "cutmoor-pretty-url-preview",
    apply: "serve",
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent((req.url ?? "").split("?")[0]);
        } catch {
          return next();
        }
        if (
          req.method !== "GET" ||
          !pathname.startsWith("/") ||
          pathname === "/" ||
          pathname.includes(".") ||
          pathname.includes("..")
        ) {
          return next();
        }
        try {
          const html = await readFile(join(server.config.root, "dist", pathname, "index.html"), "utf8");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(html);
        } catch {
          try {
            const notFound = await readFile(join(server.config.root, "dist", "404.html"), "utf8");
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(notFound);
          } catch {
            next();
          }
        }
      });
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const site = resolveSiteUrl(env);
  const ffmpegBase = resolveFfmpegBase(env);
  const ffmpegHashes = await ffmpegCoreHashes(process.cwd());

  return {
  define: {
    // Resolved here so host-provided URLs (Cloudflare, Netlify, Vercel) reach the bundle without a VITE_ prefix.
    "import.meta.env.VITE_SITE_URL": JSON.stringify(site.url),
    "import.meta.env.VITE_FFMPEG_BASE_URL": JSON.stringify(ffmpegBase),
    __FFMPEG_CORE_SHA256__: JSON.stringify(ffmpegHashes),
  },
  build: {
    rollupOptions: {
      output: {
        // Framework code changes rarely; a separate chunk stays cached across deploys.
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "vendor";
          if (id.includes("/src/content/")) return "content";
          return undefined;
        },
      },
    },
  },
  plugins: [react(), prettyUrlPreview()],
  server: { port: 5173, host: true },
  // ffmpeg ships its own worker; pre-bundling it with esbuild breaks the worker URL.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  test: {
    environment: "jsdom",
    globals: true,
  },
  };
});
