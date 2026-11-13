# Verification scripts

These scripts back the claims on the site: the "Supported / Limited /
Unsupported" statuses in `src/lib/formats.ts`, the maximum tested file size,
and the privacy statement on `/privacy`. Re-run them whenever the encoder, a
tool's FFmpeg arguments, or the image pipeline changes, then update the
`TESTED_SETUP` date and any status that changed.

They are not part of the build and need a browser driver that is not a project
dependency:

```bash
npm install --no-save puppeteer-core
```

Set `CHROME_PATH` to a Chrome or Chromium binary if it is not in the default
Windows location.

| Script | What it does | Needs |
| --- | --- | --- |
| `formats.mjs <base-url> <out.json>` | Creates real sample files in each video and image format, runs them through each tool's real code path, and checks that every output decodes. Prints each result as it happens. | `npm run dev` |
| `extra.mjs` | WebM input (a VP9 file recorded by the browser, plus VP8) and a ~100 MB 1080p large-file compress. | `npm run dev` on port 5174 |
| `network.mjs <url> <file> <out.json>` | Loads a deployed tool page, runs a real job on a file, and records every network request, including the encoder's worker. Reports any request that carries a body. | The live or preview site |

`formats.mjs` and `extra.mjs` import `/src/lib/*.ts` straight from the Vite dev
server, so they exercise the same functions the tools use.

## What they found (2026-11-13, Chrome 157)

- The VP9 encoder crashes the single-thread WebAssembly core with `memory access
  out of bounds` in every configuration tried, including a real Convert job on
  the live site. Convert to WebM now uses VP8 + Opus, which works.
- Audio extraction from a video with no sound used to fail with a bare
  "encoder exited with code 1"; it now says the file has no audio track.
- During a real compress job on the live site, the only requests were `GET`s for
  the encoder (unpkg.com) and the page's own worker script. No request carried the
  file, and the largest request body in the whole session was 848 bytes.
