// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fast from "./model-manifest.json";
import high from "./model-manifest-high.json";

/**
 * The WebGPU bundle of onnxruntime-web ("onnxruntime-web/webgpu") loads the `asyncify` WebAssembly build. Both manifests pin the
 * runtime files we host, and they MUST be those exact files: with the `jsep` build instead, WebGPU fails to start
 * ("webgpuInit is not a function") and every job silently falls back to the slow CPU path. This test fails if a manifest
 * and the installed package ever disagree, for example after upgrading onnxruntime-web without re-uploading the files.
 */
const dist = join(process.cwd(), "node_modules", "onnxruntime-web", "dist");
const sha = (file: string) => createHash("sha256").update(readFileSync(join(dist, file))).digest("hex");

describe("hosted onnxruntime files match the installed onnxruntime-web (WebGPU build)", () => {
  const installed = existsSync(join(dist, "ort-wasm-simd-threaded.asyncify.wasm"));
  for (const [label, manifest] of [["fast", fast], ["high", high]] as const) {
    it.skipIf(!installed)(`${label} manifest pins the asyncify module and wasm`, () => {
      const file = (name: string) => manifest.files.find((entry) => entry.name === name);
      expect(file("ort-mjs")?.sha256).toBe(sha("ort-wasm-simd-threaded.asyncify.mjs"));
      expect(file("ort-wasm")?.sha256).toBe(sha("ort-wasm-simd-threaded.asyncify.wasm"));
    });
  }
});
