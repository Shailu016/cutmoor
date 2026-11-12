/**
 * Upload the ffmpeg core to a Cloudflare R2 bucket under a versioned path, so
 * it can be cached forever and a new @ffmpeg/core version never overwrites the
 * files a live deploy is pinned to.
 *
 *   R2_BUCKET=cutmoor-assets npm run upload:ffmpeg
 *
 * Needs Wrangler auth (`npx wrangler login`, or CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID). Prints the VITE_FFMPEG_BASE_URL to set afterwards.
 */
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const bucket = process.env.R2_BUCKET;
if (!bucket) {
  console.error("Set R2_BUCKET to the target bucket name, e.g. R2_BUCKET=cutmoor-assets npm run upload:ffmpeg");
  process.exit(1);
}

const { version } = JSON.parse(await readFile(join(root, "node_modules", "@ffmpeg", "core", "package.json"), "utf8"));
const prefix = `ffmpeg/${version}`;
const files = [
  { name: "ffmpeg-core.js", type: "text/javascript" },
  { name: "ffmpeg-core.wasm", type: "application/wasm" },
];

for (const file of files) {
  const path = join(root, "public", "ffmpeg", file.name);
  await stat(path).catch(() => {
    console.error(`${path} is missing. Run \`npm run copy:ffmpeg\` first.`);
    process.exit(1);
  });
  const key = `${bucket}/${prefix}/${file.name}`;
  console.log(`Uploading ${file.name} -> r2://${key}`);
  const result = spawnSync(
    "npx",
    [
      "--yes", "wrangler@4", "r2", "object", "put", key,
      "--file", path,
      "--content-type", file.type,
      "--cache-control", "public, max-age=31536000, immutable",
      "--remote",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`
Done. Make the bucket readable through a custom domain (R2 > bucket > Settings >
Custom Domains), apply r2-cors.json, then set on the static host:

  VITE_FFMPEG_BASE_URL=https://<your-assets-domain>/${prefix}
`);
