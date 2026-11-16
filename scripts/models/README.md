# Speech-model hosting (models.cutmoor.com)

The Auto captions tool downloads its speech models once, from a Cloudflare R2 bucket on
`https://models.cutmoor.com`, then keeps them in the visitor's browser. The app pins each file's
size and SHA-256, so a wrong or tampered file is thrown away; the bucket only needs to serve bytes.

Nothing in this folder is run by CI or by the build. The commands below are for the site owner.

## Build the upload folder (no network)

```bash
node scripts/models/build-manifest.mjs --in ./model-src --out ./model-dist \
     --id whisper-swift-base-hinglish --version 1 --strip-extension
node scripts/models/verify-manifest.mjs ./model-dist
```

`model-dist/` then holds `m/<16 hex>.bin` (one per model file, named after its hash) and
`manifest.json`. Copy the manifest's `files` entries into the app's model list (the app, not the
bucket, is the source of truth for the hashes). Rebuilding the same input gives identical output.

## One-time R2 setup (owner runs these)

Run `npx wrangler login` first (or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).

1. Create the bucket (use a dedicated one, not the ffmpeg bucket):
   `npx wrangler r2 bucket create cutmoor-models`
2. Custom domain, so models load from our own host and not `r2.dev`:
   `npx wrangler r2 bucket domain add cutmoor-models --domain models.cutmoor.com --zone-id <cutmoor.com zone id>`
   (or dashboard: R2 > cutmoor-models > Settings > Custom Domains). The domain's zone must be on Cloudflare.
   Leave the `r2.dev` public URL turned off.
3. CORS, GET/HEAD from our two origins only, exposing the range headers:
   `npx wrangler r2 bucket cors set cutmoor-models --file scripts/models/cors.json`
   Check it with `npx wrangler r2 bucket cors list cutmoor-models`.
4. Cache: objects are uploaded with `Cache-Control: public, max-age=31536000, immutable`, which the
   custom domain honours. In the dashboard, add a Cache Rule for host `models.cutmoor.com`:
   "Eligible for cache", Edge TTL "use cache-control header if present", so the 100+ MB files are
   cached at the edge and R2 is hit once per file.
5. WAF / abuse (dashboard, `cutmoor.com` zone > Security):
   - Rate-limiting rule on host `models.cutmoor.com`, e.g. 300 requests per 10 minutes per IP
     (a model is ~13 range requests of 8 MiB, so real visitors stay far below this).
   - Optionally a custom rule that blocks requests to this host whose method is not GET or HEAD.
   - R2 has no egress fee, but set a Cloudflare billing alert anyway.
6. Do NOT enable logging of query strings or referrers on this host. The only requests it sees are
   plain GETs of opaque names without cookies; keep it that way (the privacy page says so).

## Upload

```bash
R2_BUCKET=cutmoor-models node scripts/models/upload-r2.mjs ./model-dist --dry-run   # read the plan first
R2_BUCKET=cutmoor-models node scripts/models/upload-r2.mjs ./model-dist
```

The script re-verifies the folder, skips objects the public host already serves with the same
size, uploads the model files, then the manifest copy (`manifests/<id>-<version>.json`), and
finally checks with HEAD that the public host reports the right sizes. `--force` re-uploads
everything. Never overwrite a model under the same name: a new model version is a new file and a
new manifest (the old objects can be deleted later, once no live app version pins them).

## Page headers

The captions page needs `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` for
multi-threaded WebAssembly, and a Content-Security-Policy that only allows `models.cutmoor.com`.
Those are in `public/_headers` for the `/tools/auto-captions` path only. If the model host moves,
change `https://models.cutmoor.com` there and in the app's allowed-origins list together.

## Trying a new model in the browser, without uploading it

A model can be tested from `http://localhost:4180/dev-models/` before anything reaches the bucket.
Nothing about this path can be enabled in a production build; the details are at the end of this section.

1. Build the folder with the dev base URL (note the output folder: it IS what the server reads):

   ```bash
   node scripts/models/build-manifest.mjs --in ./.team/models-local/prime/onnx \
        --out ./.team/models-local/dev-models --id whisper-prime-dev --version 1 \
        --dev-base-url http://localhost:4180/dev-models --strip-extension
   ```

   That writes `.team/models-local/dev-models/manifest.json` plus `m/<hash>.bin` files. `--dev-base-url` is
   the only way to get an `http://` URL into a manifest: it accepts the name `localhost` (any port) and the
   path `/dev-models` only, cannot be combined with `--base-url`, and every other base still has to be https.

2. Build a **development** page (the only kind that contains the dev loader) and serve it with the folder
   (read from `DEV_MODELS_DIR`, default `.team/models-local/dev-models`):

   ```bash
   NODE_ENV=development npm run build          # dev-mode build: slower, unminified, for local testing only
   DEV_MODELS_DIR=.team/models-local/dev-models node scripts/serve-local.mjs 4180
   ```

   `NODE_ENV=development` makes Vite set `import.meta.env.DEV` to true, which is what pulls the dev loader in; a normal
   `npm run build` leaves it out entirely. Do not deploy a folder built this way.

   `scripts/serve-local.mjs` is not `vite dev`: it serves the built page and the dev model folder under one origin, so the
   page's own Content-Security-Policy (`'self'`) already allows the requests. Nothing was added to `public/_headers`
   and `localhost` is not in `MODEL_ORIGINS`.

3. Open `http://localhost:4180/tools/auto-captions/`. The app asks for `/dev-models/manifest.json`; if it exists, the
   files it lists are downloaded from the dev folder and hash-checked before use. If it does not exist, the page uses
   the bundled `https://models.cutmoor.com` list and behaves normally. A missing or broken dev folder never breaks the
   page: the dev path falls back silently.

   The dev manifest may cover only part of the set (for example the engine's `encoder`/`decoder`/`tokenizer`/
   `generation`); any part it does not list is still downloaded from the bundled list. The tier you pick still decides
   mel bands and decoder shape, so test a large-v3-sized model on High accuracy.

Why this cannot reach production:

- `runtime.ts` only contains the dev import inside `if (import.meta.env.DEV)`, which `vite build` replaces with
  `false`. The bundler then drops the branch and `src/lib/captioning/dev-models.ts` is not emitted at all.
  `npm run build && grep -r "dev-models" dist/` must find nothing.
- Even if it were emitted, the dev loader only accepts `http(s)://localhost:<port>/dev-models/...` URLs, sends no
  cookies or referrer, follows no redirect, and verifies every SHA-256; it is not a second way to reach the real host.
- `model-loader.ts` gained one narrow exception, because the speech engine downloads its own files through
  `downloadModel`: in a development build only, it accepts a file on `http://localhost:<port>/dev-models/...` when the
  runtime lists that exact origin, and still checks the pinned size and SHA-256. In a production bundle
  `import.meta.env.DEV` is false, so the rule there is unchanged: https to models.cutmoor.com, nothing else.

`verify-manifest.mjs` describes the production layout (https host, `m/<hash>.bin` URLs under it), so it reports a dev
folder as "not an https URL". That is expected; the dev loader's checks and the hash pin are what validate a dev
folder. Do not upload a dev folder.
