# Third-party notices

Cutmoor distributes some third-party code to visitors as part of the static
site. This file lists the components, their licences, and where to obtain the
corresponding source. It is a notice, not legal advice; the upstream licence
texts control.

Last updated: 2026-11-11

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
| Fraunces | OFL-1.1 | https://github.com/undercasetype/Fraunces |
| Manrope | OFL-1.1 | https://github.com/sharanda/manrope |

## Full licence texts

The complete licence files are installed with each npm package under
`node_modules/<package>/LICENSE` or an equivalent file. They are also available
at the upstream repositories linked above. The public summary is at
`/licences` on the deployed site.

## Source availability

For GPL and LGPL components, the corresponding source is available from the
upstream repositories listed above. If you redistribute this site, keep this
file, the `/licences` page, and the upstream source links available to users.
