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
| `/guides` | 17 practical video and image guides |
| `/about`, `/privacy`, `/terms`, `/cookies`, `/contact`, `/editorial`, `/licences` | Trust and licence pages |

## Real results, the sample demo, and formats

- Every tool ends with a result card (`src/components/ResultSummary.tsx`) built
  from the real byte counts of the original and processed files
  (`src/lib/results.ts`). A larger or identical result is never shown as a
  saving, and an empty output is flagged. Processing time is measured with
  `performance.now()`, and the one-time encoder download is reported separately.
- The homepage demo (`src/components/DemoStage.tsx`) has a tab per tool
  (Compress, Crop, Trim, Convert, Audio, Frame, Image). **Try it live** runs the
  tool on `public/samples/sample-clip.mp4` (or `sample-photo.jpg` for Image)
  through the same job hooks and the same FFmpeg arguments as the tool pages
  (`src/lib/compress.ts`, `src/lib/tool-args.ts`, scenarios in `src/lib/demo.ts`).
  The samples are drawn in code, not filmed (a sunset over a mountain lake
  with a synthesized soundtrack; `node scripts/make-sample.mjs` re-makes them),
  and the page says so. A unit test checks their sizes
  against the files on disk.
- Until a visitor presses Try it live, the screen plays a **recording** of that
  exact run (`public/walkthroughs/*.mp4`), labelled as a recording. Re-make the
  clips with `node scripts/capture-walkthroughs.mjs` (see the script header)
  whenever the demo screen, the samples, or a tool's settings change, and raise
  `MEDIA_VERSION` in `src/lib/samples.ts`: these files are cached for a week under
  fixed names, so the version in the URL is what makes visitors fetch the new ones.
- **Layout rule:** the demo may never move the page. The screen is always 16:9,
  its overlays are sized from its own width, and the control area has a fixed
  height. `scripts/verify/layout-shift.mjs` steps through every tab and state and
  fails if anything moves.
- `src/lib/formats.ts` is the single source of truth for supported formats and
  limits. A format is only "Supported" after a real file went through the tool
  and the output decoded; see `scripts/verify/README.md` for how that is tested
  and re-run.

## Adding a guide

```bash
npm run new:guide -- how-to-compress-a-gif
```

This creates `src/content/guides/<slug>/meta.ts` (title, description, dates,
tool links, and an `order`) and `body.ts` (sections and FAQs). Fill in every
`TODO`; the tests fail while any remain, and they also check the structure
(three or more sections, unique headings, questions that end in `?`, descriptions
under 300 characters). Nothing else needs editing: the guide list, home page,
sitemap, RSS feed, `llms.txt` and structured data are all built from the index.

The split is deliberate. `meta.ts` files form a small index shipped with every
page; each `body.ts` is its own chunk, fetched only on that guide's page (and
prerendered in full at build time, so search engines see the whole article). A
guide therefore costs every visitor a few hundred bytes, not its whole text.

## Configuration

Copy `.env.example` to `.env` and set:

- `VITE_SITE_URL` — canonical origin, no trailing slash. Leave it empty until
  `https://cutmoor.com` is connected: the build then uses the host's own URL
  (`CF_PAGES_URL` normalised to `<project>.pages.dev`, Netlify's `URL`, or
  Vercel's production URL), and `http://localhost:4173` for local builds. It
  never falls back to a domain you do not control. The build prints which
  origin it used.
- `VITE_FFMPEG_BASE_URL` — where the browser loads the ffmpeg core from. Empty
  means same origin (`/ffmpeg`). Required on Cloudflare Pages; see Deploying.
- `VITE_ADSENSE_CLIENT` — AdSense client ID. Empty disables ads completely.
- `VITE_ADSENSE_SLOT_HOME`, `VITE_ADSENSE_SLOT_ARTICLE`, `VITE_ADSENSE_SLOT_FOOTER` — ad unit IDs.

The ad script loads whenever `VITE_ADSENSE_CLIENT` is set. Consent for the EEA,
the UK, and Switzerland is handled by Google's own certified consent message:
turn it on in AdSense under **Privacy & messaging** before serving ads in those
regions. The privacy and cookie pages describe that setup, so keep them in sync
if it changes.

`ads.txt` is generated at build time from `VITE_ADSENSE_CLIENT`. If the variable
is empty the file contains a comment explaining what to set, which is valid but
will not authorize a publisher.

## Replacing the launch placeholders

Before going live:

1. Buy `cutmoor.com`, connect it to the host, and set
   `VITE_SITE_URL=https://cutmoor.com`. Until then leave it empty; the host URL
   is used automatically.
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
- `dist/ffmpeg/` contains the ~32 MB encoder core, served from your origin,
  unless `VITE_FFMPEG_BASE_URL` is set (then it is left out of `dist/`).
- The last step (`scripts/finalize-dist.mjs`) fails the build on Cloudflare
  Pages (or with `STRICT_DEPLOY=1`) if any file exceeds 25 MiB, so a bad deploy
  is caught at build time.
- `dist/assets/` includes a lazy ~3.2 MB HEIC decoder chunk, fetched only when a
  HEIC file cannot be decoded by the browser.

Netlify, Vercel, or any static server works. Pretty URLs need folder-index
resolution, which all of those provide. For Netlify add nothing; for a bare
nginx use `try_files $uri $uri/ $uri.html =404`.

### Production deploys (cutmoor.com)

`.github/workflows/deploy.yml` builds and deploys to the Cloudflare Pages
project `cutmoor` on every push to `master` (or run it by hand from the
Actions tab). It runs typecheck, tests, and the strict build first, so a
failing check never ships. It needs:

- Repository secret `CLOUDFLARE_API_TOKEN`: an API token with the account
  permission **Cloudflare Pages: Edit**.
- Repository variable `CLOUDFLARE_ACCOUNT_ID`.
- Optional repository variables for ads: `ADSENSE_CLIENT` (`ca-pub-…`), and
  `ADSENSE_SLOT_HOME`, `ADSENSE_SLOT_ARTICLE`, `ADSENSE_SLOT_FOOTER`. Setting
  only `ADSENSE_CLIENT` is the right state for AdSense review: every page gets
  the verification meta tag and the AdSense loader (which also enables Auto
  ads), `ads.txt` gets the authorization line, and no empty ad boxes render.
  Add the slot IDs after approval for manual placements.

The ffmpeg core is served from unpkg (`VITE_FFMPEG_BASE_URL` in the
workflow). When `@ffmpeg/core` is upgraded, update the version in that URL;
the workflow fails if they differ.

Deploy manually with Wrangler from an empty directory, not the repo root
(Wrangler 4 otherwise tries to convert the project into a Worker):
`npx wrangler@4.161.0 pages deploy <repo>/dist --project-name cutmoor --branch master`.

### Cloudflare Pages + R2

Cloudflare Pages rejects files above 25 MiB and the ffmpeg wasm core is ~31 MiB,
so the core is served from R2:

1. Create an R2 bucket (for example `cutmoor-assets`) and connect a custom
   domain to it (for example `assets.cutmoor.com`), under R2 > bucket >
   Settings > Custom Domains. Until you own a domain, the bucket's
   `r2.dev` public URL works for testing.
2. Allow cross-origin reads: `npx wrangler r2 bucket cors set cutmoor-assets --file r2-cors.json`
   (or paste the same rule in the dashboard under CORS policy).
3. Upload: `R2_BUCKET=cutmoor-assets npm run upload:ffmpeg`. Files go to a
   versioned path (`ffmpeg/<@ffmpeg/core version>/`) with an immutable cache
   header, so upgrades never overwrite what a live deploy uses.
4. In Pages > Settings > Environment variables, set
   `VITE_FFMPEG_BASE_URL=https://assets.cutmoor.com/ffmpeg/<version>` (the
   upload script prints it). Build command `npm run build`, output `dist`.

The build pins the SHA-256 of both core files into the bundle, and the browser
refuses to run a downloaded core whose hash does not match. Re-run the upload
whenever `@ffmpeg/core` is upgraded. Only the encoder is fetched from R2;
visitors' files still never leave the browser.

The encoder is large but cached by the browser after the first job. Serve
`/ffmpeg/*` with long cache headers and Brotli/gzip where possible. The transfer
is compressed even though the uncompressed file is 32 MB.

If you add a Content-Security-Policy, allow WebAssembly in `script-src`
(`'wasm-unsafe-eval'` in Chromium) for ffmpeg.wasm and the HEIC decoder. The
HEIC import already uses `heic-to/csp`, which avoids string-eval loading, but
WASM compilation still needs to be permitted, and the AdSense script hosts must
be allowed too. With `VITE_FFMPEG_BASE_URL` set, add the asset origin to
`connect-src`.

## Notes on limits

- ffmpeg runs in a Web Worker. Video files are limited by tab memory, not by an
  upload quota. The largest video tested so far is 104 MB (20 s of 1080p), which
  compressed in 96 s on a desktop; larger files are untested.
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
