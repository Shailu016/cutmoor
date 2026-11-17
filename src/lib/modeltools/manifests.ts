import captionsManifest from "../captioning/model-manifest.json";
import type { ModelFile, ModelManifest } from "../captioning/model-loader";

/**
 * The model files for the two picture tools that run a neural network on your device (remove background, enlarge
 * picture). They follow the same rules as the captions models: files come only from our own model host, each is checked
 * against the SHA-256 listed here (this list ships with the site, so whoever serves the bytes cannot swap them), and
 * nothing is downloaded until the visitor agrees.
 *
 * Sources and licences (also in THIRD_PARTY_NOTICES.md):
 *  - Background: ISNet "general use" from the Dichotomous Image Segmentation project (Xuebin Qin et al.), Apache-2.0,
 *    in the half-precision ONNX build published by Ko033 on Hugging Face (Apache-2.0).
 *  - Enlarge: Real-ESRGAN "general x4 v3" (Xintao Wang et al.), BSD-3-Clause, exported to ONNX by Qualcomm AI Hub.
 */

/**
 * False until the two model files below are uploaded to models.cutmoor.com (scripts/models/upload-r2.mjs). While it is
 * false the two tools are left out of the production site entirely (menus, pages, sitemap), so no visitor lands on a
 * page whose download would fail. Development builds always show them.
 */
export const MODEL_TOOLS_PUBLISHED = false;

/**
 * Whether this build includes the two tools. True once the models are published, in a development build, and in a build
 * made with VITE_MODEL_TOOLS=1 (how the real-browser checks are run against a production-style build before upload).
 */
export const MODEL_TOOLS_ENABLED: boolean = MODEL_TOOLS_PUBLISHED || Boolean(import.meta.env.DEV) || import.meta.env.VITE_MODEL_TOOLS === "1";

export const BACKGROUND_MODEL: ModelManifest = {
  id: "isnet-general-fp16-onnx",
  version: "1",
  files: [
    {
      name: "isnet-general-fp16",
      url: "https://models.cutmoor.com/m/0857167263ad816d.bin",
      bytes: 88141111,
      sha256: "0857167263ad816d67c26852b99c2861e46a86c9a889527061a5eb2a6f90d32c",
    },
  ],
};

export const UPSCALE_MODEL: ModelManifest = {
  id: "realesrgan-x4v3-onnx",
  version: "1",
  files: [
    {
      name: "realesrgan-x4v3",
      url: "https://models.cutmoor.com/m/a7cd14832b3fb846.bin",
      bytes: 4876685,
      sha256: "a7cd14832b3fb84623c688c841c41b829ff62873b89bdc89943e6e1a1a8420c1",
    },
  ],
};

export const ORT_MODULE_FILE = "ort-mjs";
export const ORT_WASM_FILE = "ort-wasm";

/** The onnxruntime files are shared with the captions tool (same fingerprints), so a visitor who has one already has them. */
export function runtimeFiles(): ModelFile[] {
  return captionsManifest.files.filter((file) => file.name === ORT_MODULE_FILE || file.name === ORT_WASM_FILE);
}

/** The model plus the runtime that runs it: this is what the visitor is told they will download. */
export function withRuntime(model: ModelManifest): ModelManifest {
  return { ...model, files: [...model.files, ...runtimeFiles()] };
}
