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

/**
 * onnxruntime-web ships its WebAssembly files next to the library, and the bundler would copy them (28 MB each)
 * into the site, past the host's 25 MiB per-file limit. The captioning runtime never loads them from the site:
 * it downloads them from our model host, checks their SHA-256, and hands the library blob: URLs (see
 * src/lib/captioning/runtime.ts). So the copies are dropped from the build.
 */
function dropOnnxRuntimeWasm(): Plugin {
  return {
    name: "cutmoor-drop-onnxruntime-wasm",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
      }
    },
  };
}

/** Code that only the captions tool uses. Named `captions-*` so the size budget can treat it as lazy. */
const CAPTIONS_CODE = /[\/](src[\/](lib[\/]captioning|components[\/]captions|tools[\/]AutoCaptionsTool|hooks[\/]useCaptionJob)|node_modules[\/](onnxruntime-web|mediabunny))[\/]?/;

/** The editing tools added after the first set (src/tools/more and the pieces only they use). Named `tools-*` so the size budget can treat them as lazy. */
const MORE_TOOLS_CODE = /[\/]src[\/](tools[\/]more|components[\/](Controls|MultiFileList|MarkSettings|PictureStage)|lib[\/](video-edit-args|media-info|watermark|crop|exif|redact|picture-edit))/;

export default defineConfig(async ({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const site = resolveSiteUrl(env);
  const ffmpegBase = resolveFfmpegBase(env);
  const ffmpegHashes = await ffmpegCoreHashes(process.cwd());
  // A CDN-hosted encoder is only safe to run if its fingerprint is pinned into the bundle.
  // Without the local copy there is nothing to pin, so the build stops instead of shipping an unchecked encoder.
  if (command === "build" && ffmpegBase && !ffmpegHashes) {
    throw new Error(
      `VITE_FFMPEG_BASE_URL is set (${ffmpegBase}) but public/ffmpeg/ffmpeg-core.js and .wasm are missing, so their SHA-256 cannot be pinned. Run \`npm run copy:ffmpeg\` (it runs on npm install) and build again.`,
    );
  }

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
        chunkFileNames: (chunk: { moduleIds: string[] }) =>
          chunk.moduleIds.some((id: string) => CAPTIONS_CODE.test(id))
            ? "assets/captions-[name]-[hash].js"
            : chunk.moduleIds.some((id: string) => MORE_TOOLS_CODE.test(id))
              ? "assets/tools-[name]-[hash].js"
              : "assets/[name]-[hash].js",
        // Framework code changes rarely; a separate chunk stays cached across deploys.
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "vendor";
          // Guide articles are loaded one at a time, so each stays its own chunk. Only the small
          // index and the site pages share the "content" chunk.
          if (id.includes("/src/content/") && !id.endsWith("/body.ts")) return "content";
          return undefined;
        },
      },
    },
  },
  plugins: [react(), prettyUrlPreview(), dropOnnxRuntimeWasm()],
  server: { port: 5173, host: true },
  // ffmpeg ships its own worker; pre-bundling it with esbuild breaks the worker URL.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  test: {
    environment: "jsdom",
    globals: true,
    // The seeded fuzz and oracle tests are CPU-heavy: they take 2-4 s alone and passed 5 s only on an idle machine.
    testTimeout: 30_000,
  },
  };
});
