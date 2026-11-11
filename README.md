# ClipKit

The browser video toolkit for Reels, Shorts, and TikTok. Compress, crop, trim,
convert, extract audio, save a frame, and convert subtitles — all locally in the
browser. Files are never uploaded. No account, no watermark.

Built with React 19, Vite 6, TypeScript, and `@ffmpeg/ffmpeg` with a self-hosted
single-thread WebAssembly core. The site is prerendered to static HTML and can
be hosted on any static host.

## Quick start

```bash
npm install      # also copies the ffmpeg core into public/ffmpeg
npm run dev      # http://localhost:5173
npm test         # unit tests for formatting and subtitle conversion
npm run typecheck
npm run build    # client + SSR + prerender + sitemap/robots/ads.txt
npm run preview  # serve the built dist/ with pretty URLs
```

## What is in the box

| Route | Purpose |
| --- | --- |
| `/` | Marketing home with FAQ and tool grid |
| `/tools` | Tool directory |
| `/tools/compress` | Target-size and quality-first compression |
| `/tools/resize` | 9:16, 1:1, 4:5, 16:9, custom; crop or pad |
| `/tools/trim` | Accurate start/end trim |
| `/tools/convert` | MP4, WebM, GIF, MP3, M4A, WAV |
| `/tools/audio` | Extract MP3, M4A, or WAV |
| `/tools/frame` | Save a PNG or JPG still |
| `/tools/captions` | SRT ↔ VTT and timing shift |
| `/guides` | 10 practical video guides |
| `/about`, `/privacy`, `/terms`, `/cookies`, `/contact`, `/editorial` | Trust pages |

## Configuration

Copy `.env.example` to `.env` and set:

- `VITE_SITE_URL` — canonical origin, no trailing slash.
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

1. Set `VITE_SITE_URL` to the real domain.
2. Replace `hello@clipkit.tools` in `src/lib/seo.ts` and `src/content/site-pages.ts`.
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

Netlify, Vercel, or any static server works. Pretty URLs need folder-index
resolution, which all of those provide. For Netlify add nothing; for a bare
nginx use `try_files $uri $uri/ $uri.html =404`.

Cloudflare Pages currently rejects files above 25 MiB, and the ffmpeg wasm core
is ~32 MB. Use Netlify, Vercel, GitHub Pages, or a VPS for this build, or host
`/ffmpeg/*` on a separate origin and change the base URL in `src/lib/ffmpeg.ts`.

The encoder is large but cached by the browser after the first job. Serve
`/ffmpeg/*` with long cache headers and Brotli/gzip where possible. The transfer
is compressed even though the uncompressed file is 32 MB.

## Notes on limits

- ffmpeg runs in a Web Worker. Very large files are limited by tab memory, not
  by an upload quota. ~500 MB is reasonable on a desktop with 8 GB of RAM.
- GIF export is intentionally capped in quality (640 px, 12 fps) because GIF is
  a poor format for long clips.
- All exports re-encode for compatibility. Keeping the original file is always
  recommended.

## License

Source is private to the operator. Third-party dependencies keep their own
licenses (`@ffmpeg/core` is LGPL/GPL depending on build; the single-thread core
used here is the standard `@ffmpeg/core` distribution).
