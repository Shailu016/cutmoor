# Cutmoor

The browser video and image toolkit. Compress, crop, trim, convert, extract
audio, save a frame, and convert subtitles — plus compress, resize, and convert
images, and turn iPhone HEIC photos into JPG. Everything runs locally in the
browser. Files are never uploaded. No account, no watermark.

Built with React 19, Vite 6, TypeScript, and `@ffmpeg/ffmpeg` with a self-hosted
single-thread WebAssembly core for video. Images use the native canvas API, with
`heic-to` loaded lazily only when a HEIC file cannot be decoded natively. The
site is prerendered to static HTML and can be hosted on any static host.

## Quick start

```bash
npm install      # also copies the ffmpeg core into public/ffmpeg
npm run dev      # http://localhost:5173
npm test         # unit tests for formatting, subtitles, and image geometry
npm run typecheck
npm run build    # client + SSR + prerender + sitemap/robots/ads.txt
npm run preview  # serve the built dist/ with pretty URLs
```

## What is in the box

| Route | Purpose |
| --- | --- |
| `/` | Marketing home with FAQ and grouped video/image tool grid |
| `/tools` | Tool directory with problem-based choices |
| `/tools/compress` | Target-size and quality-first video compression |
| `/tools/resize` | 9:16, 1:1, 4:5, 16:9, custom; crop or pad |
| `/tools/trim` | Accurate start/end trim |
| `/tools/convert` | MP4, WebM, GIF, MP3, M4A, WAV |
| `/tools/audio` | Extract MP3, M4A, or WAV |
| `/tools/frame` | Save a PNG or JPG still |
| `/tools/captions` | SRT ↔ VTT and timing shift |
| `/tools/compress-image` | Target-size or quality compression for JPG, PNG, WebP |
| `/tools/resize-image` | Social presets, crop or pad, transparency |
| `/tools/convert-image` | JPG, PNG, WebP conversion with quality control |
| `/tools/heic-to-jpg` | iPhone HEIC/HEIF to JPG, decoded locally |
| `/guides` | 14 practical video and image guides |
| `/about`, `/privacy`, `/terms`, `/cookies`, `/contact`, `/editorial`, `/licences` | Trust and licence pages |

## Configuration

Copy `.env.example` to `.env` and set:

- `VITE_SITE_URL` — canonical origin, no trailing slash. The built-in default is
  `https://cutmoor.com`, the planned launch origin. Until that domain is
  purchased and connected, set this to the real deployment URL so canonical
  links, the sitemap, and JSON-LD never point at a domain you do not control.
- `VITE_ADSENSE_CLIENT` — AdSense client ID. Empty disables ads completely.
- `VITE_ADSENSE_SLOT_HOME`, `VITE_ADSENSE_SLOT_ARTICLE`, `VITE_ADSENSE_SLOT_FOOTER` — ad unit IDs.

The ad script only loads after the visitor accepts advertising cookies. The
built-in consent banner is a lightweight gate, not a certified CMP: a production
deployment serving the EEA, the UK, or Switzerland must use a Google-certified
consent management platform before enabling ads there.

`ads.txt` is generated at build time from `VITE_ADSENSE_CLIENT`. If the variable
is empty the file contains a comment explaining what to set, which is valid but
will not authorize a publisher.

## Replacing the launch placeholders

Before going live:

1. Buy `cutmoor.com`, connect it to the host, and set `VITE_SITE_URL` to the
   live origin. Until then, point `VITE_SITE_URL` at the temporary deployment
   URL instead of the unowned domain.
2. Confirm `hello@cutmoor.com` in `src/lib/seo.ts` and `src/content/site-pages.ts`
   once mail for the domain is set up, or replace it with the real address.
3. Replace `public/og-image.png` and `public/icon-512.png` if the branding changes.
4. Configure `VITE_ADSENSE_CLIENT` and the slot IDs, or leave ads off.
5. Review `privacy`, `terms`, and `cookies` for your jurisdiction.

## Deploying

`npm run build` writes a fully static `dist/`:

- Every indexable route is a real HTML file with unique title, description,
  canonical, Open Graph, Twitter, and JSON-LD.
- `dist/404.html` is the not-found shell.
- `dist/sitemap.xml`, `dist/robots.txt`, and `dist/ads.txt` are generated.
- `dist/ffmpeg/` contains the ~32 MB encoder core, served from your origin.
- `dist/assets/` includes a lazy ~3.2 MB HEIC decoder chunk, fetched only when a
  HEIC file cannot be decoded by the browser.

Netlify, Vercel, or any static server works. Pretty URLs need folder-index
resolution, which all of those provide. For Netlify add nothing; for a bare
nginx use `try_files $uri $uri/ $uri.html =404`.

Cloudflare Pages currently rejects files above 25 MiB, and the ffmpeg wasm core
is ~32 MB. Use Netlify, Vercel, GitHub Pages, or a VPS for this build, or host
`/ffmpeg/*` on a separate origin and change the base URL in `src/lib/ffmpeg.ts`.

The encoder is large but cached by the browser after the first job. Serve
`/ffmpeg/*` with long cache headers and Brotli/gzip where possible. The transfer
is compressed even though the uncompressed file is 32 MB.

If you add a Content-Security-Policy, allow WebAssembly in `script-src`
(`'wasm-unsafe-eval'` in Chromium) for ffmpeg.wasm and the HEIC decoder. The
HEIC import already uses `heic-to/csp`, which avoids string-eval loading, but
WASM compilation still needs to be permitted. The ad script remains gated behind
explicit advertising consent.

## Notes on limits

- ffmpeg runs in a Web Worker. Video files are limited by tab memory, not by an
  upload quota. ~500 MB is reasonable on a desktop with 8 GB of RAM.
- Image output is capped at 16,777,216 pixels and 16,384 px per edge, matching
  the largest canvas Safari will paint reliably. Larger sources are downscaled.
- Safari cannot encode WebP from a canvas and silently returns a PNG. The UI
  probes the encoder and disables WebP export where it is unavailable.
- No current browser can encode AVIF from a canvas, so AVIF is accepted as input
  but never offered as output.
- HEIC uses the native system decoder on Safari. Chrome, Edge, and Firefox lazy
  load a ~3.2 MB `heic-to` chunk after a HEIC file is selected; it is cached and
  only fetched when needed. Live Photos and some 10-bit HDR variants may fail.
- GIF export is intentionally capped in quality (640 px, 12 fps) because GIF is
  a poor format for long clips.
- All video exports re-encode for compatibility. Image exports also re-encode,
  which strips most metadata. Keeping the original file is always recommended.

## License

Source is private to the operator. Third-party dependencies keep their own
licenses. `heic-to`, libheif, and libde265 are LGPL-3.0; `@ffmpeg/core` is
distributed under GPL-2.0-or-later; React, React Router, and Vite are MIT;
Lucide is ISC; the Fontsource fonts are OFL-1.1. See `THIRD_PARTY_NOTICES.md`
and the public `/licences` page for attribution and source links.
