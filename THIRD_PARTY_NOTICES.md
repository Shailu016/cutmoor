# Third-party notices

Cutmoor distributes some third-party code to visitors as part of the static
site. This file lists the components, their licences, and where to obtain the
corresponding source. It is a notice, not legal advice; the upstream licence
texts control.

Last updated: 2026-11-14

## Distributed to the browser

### FFmpeg / ffmpeg.wasm

- Component: `@ffmpeg/core` WebAssembly build, loaded as `ffmpeg-core.js` and
  `ffmpeg-core.wasm` from `/ffmpeg/`.
- Licence: GPL-2.0-or-later (the `@ffmpeg/core` package declares
  `GPL-2.0-or-later`).
- Upstream FFmpeg: https://ffmpeg.org/
- ffmpeg.wasm source and build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm
- Source for the packaged core: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
- The local copy is installed from npm and copied verbatim by
  `scripts/copy-ffmpeg.mjs`. Cutmoor does not modify the core.
- If you deploy a modified core, you are responsible for publishing the
  corresponding source under the GPL and keeping the licence notice intact.

### heic-to (HEIC decoder)

- Component: `heic-to` 1.6.7, dynamically imported only when a HEIC file is
  selected and the browser cannot decode it natively.
- Licence: LGPL-3.0.
- Author: Hopper Gee.
- Source: https://github.com/hoppergee/heic-to
- Bundled upstream libraries:
  - libheif — https://github.com/strukturag/libheif — LGPL-3.0.
  - libde265 — https://github.com/strukturag/libde265 — LGPL-3.0.
- Cutmoor does not modify `heic-to` or its bundled libraries. The package is
  installed from npm and included by Vite as a lazy chunk.
- LGPL source and relinking information is available at the upstream links
  above. The unmodified npm package is also present in `node_modules/heic-to`
  after `npm install`.

### Auto captions (speech recognition)

The Auto captions tool offers two speech-recognition models. Both are published
by Oriserve and both model pages declare Apache-2.0. The files are hosted by
Cutmoor at `https://models.cutmoor.com`, downloaded once after the visitor
agrees, checked against SHA-256 fingerprints bundled with the site, and kept in
the browser.

- **Draft:** `Oriserve/Whisper-Hindi2Hinglish-Swift`, a fine-tune of OpenAI
  Whisper base. About 160 MB. Converted to ONNX by the Hugging Face user
  `di12355`.
  - Model page: https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Swift
  - ONNX conversion: https://huggingface.co/di12355/whisper-hinglish-swift-onnx
  - The converted repository carries the OpenAI Whisper MIT notice.
- **High accuracy:** `Oriserve/Whisper-Hindi2Hinglish-Apex`, a fine-tune of
  OpenAI `whisper-large-v3-turbo`. About 800 MB. Converted to ONNX and
  compressed to 4-bit weights by Cutmoor. Requires WebGPU in the browser.
  - Model page: https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Apex
- Oriserve describes its training data as proprietary or partly proprietary and
  does not publish it. Cutmoor relies on the Apache-2.0 licence each model page
  declares and has not independently verified the training data.
- OpenAI Whisper (MIT): https://github.com/openai/whisper

The tool runs the models with ONNX Runtime Web 1.31, published by Microsoft
under the MIT licence: https://github.com/microsoft/onnxruntime

Silero VAD v6 by the Silero Team is part of the app's model files, but the
Auto captions page does not run it: the page uses a small built-in
vocal-activity detector to decide which stretches to read. The repository
LICENSE file says MIT:
https://github.com/snakers4/silero-vad

Burned-in caption video is written with Mediabunny 1.66.0, published by
Vanilagy under the Mozilla Public License 2.0 (MPL-2.0):
https://github.com/Vanilagy/mediabunny

## Build and interface libraries

These are used to build or render the site. Minified copies of the runtime
libraries are distributed in the JavaScript bundle.

| Component | Licence | Source |
| --- | --- | --- |
| React, React DOM | MIT | https://github.com/facebook/react |
| React Router | MIT | https://github.com/remix-run/react-router |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| Vite | MIT | https://github.com/vitejs/vite |
| @ffmpeg/ffmpeg | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/util | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| Fontsource | MIT | https://github.com/fontsource/fontsource |
| Geist | OFL-1.1 | https://github.com/vercel/geist-font |
| Geist Mono | OFL-1.1 | https://github.com/vercel/geist-font |

### Remove background and Enlarge picture (neural networks)

Two picture tools run a small neural network on the visitor's device with the same
ONNX Runtime Web build listed above. Their files are hosted by Cutmoor at
`https://models.cutmoor.com`, downloaded once after the visitor agrees, checked
against SHA-256 fingerprints bundled with the site, and kept in the browser.

- **Remove background:** ISNet "general use" from the Dichotomous Image
  Segmentation project by Xuebin Qin and colleagues, Apache-2.0
  (https://github.com/xuebinqin/DIS). The file is the half-precision ONNX build
  published by Ko033 on Hugging Face under Apache-2.0
  (https://huggingface.co/Ko033/isnet-general-use-onnx), which states that it was
  converted from the `isnet-general-use.onnx` distributed by the rembg project
  (MIT, https://github.com/danielgatis/rembg). About 88 MB.
- **Enlarge picture:** Real-ESRGAN "general x4 v3" by Xintao Wang and colleagues,
  BSD-3-Clause (https://github.com/xinntao/Real-ESRGAN), exported to ONNX by
  Qualcomm AI Hub (BSD-3-Clause) and mirrored on Hugging Face as
  `TheGuy444/Real-ESRGAN-ONNX`. Cutmoor merged its external weight file into one
  ONNX file without changing any weight. About 5 MB.
- Neither model's training data is published by its authors. Cutmoor relies on the
  licence each project declares and has not independently verified the training data.

## Full licence texts

The complete licence files are installed with each npm package under
`node_modules/<package>/LICENSE` or an equivalent file. They are also available
at the upstream repositories linked above. The public summary is at
`/licences` on the deployed site.

## Source availability

For GPL and LGPL components, the corresponding source is available from the
upstream repositories listed above. If you redistribute this site, keep this
file, the `/licences` page, and the upstream source links available to users.
