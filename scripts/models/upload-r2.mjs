/**
 * Uploads a built model folder (build-manifest.mjs output) to the R2 bucket behind
 * models.cutmoor.com.
 *
 *   R2_BUCKET=cutmoor-models node scripts/models/upload-r2.mjs ./model-dist --dry-run   # prints the plan, does nothing
 *   R2_BUCKET=cutmoor-models node scripts/models/upload-r2.mjs ./model-dist             # the real upload (owner only)
 *
 * Safety rules:
 *  - Refuses to run without R2_BUCKET, and refuses if the folder does not match its manifest
 *    (it re-hashes every file first).
 *  - --dry-run makes no network call and runs no command; it prints each command it would run.
 *  - Objects are content-addressed, so one that is already served with the right size is skipped
 *    (checked with a public HEAD request). --force uploads them anyway.
 *  - Model files go first and the manifest copy last, so the bucket never holds a manifest that
 *    points at files that are not there yet.
 *  - Every object gets an immutable one-year cache header (the name changes if the content does).
 *
 * Needs Wrangler auth (`npx wrangler login`, or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertBucketName, MANIFEST_CACHE, planUpload, wranglerPutArgs } from "./lib.mjs";
import { verifyDirectory } from "./verify-manifest.mjs";

/** Size in bytes the public host reports for an object, or null if it is not there / not readable. */
export async function headSize(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { method: "HEAD", credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok) return null;
    const header = response.headers.get("content-length");
    if (header === null || !/^\d+$/.test(header)) return null; // Number(null) is 0, which would look like an empty file
    return Number(header);
  } catch {
    return null;
  }
}

const shellQuote = (value) => (/^[\w@./:=,+-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`);

/**
 * The whole upload as a function. `run(args)` executes `npx <args>` and returns the exit status;
 * `fetchImpl` answers the HEAD checks. Both are injected so tests never touch a real command.
 * Returns { actions, uploaded, skipped, dryRun }.
 */
export async function runUpload({ dir, bucket, dryRun = false, force = false, run, fetchImpl = fetch, log = console.log }) {
  assertBucketName(bucket);
  const root = resolve(dir);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const problems = await verifyDirectory(root, manifest);
  if (problems.length > 0) throw new Error(`The folder does not match its manifest, nothing was uploaded:\n  - ${problems.join("\n  - ")}`);
  // A dev-models manifest never reaches this point: checkManifestShape already refuses its http URLs
  // ("is not an https URL"), and the app's dev loader is the only thing that accepts them.

  const presentSizes = new Map();
  if (!dryRun && !force) {
    for (const file of manifest.files) {
      const size = await headSize(file.url, fetchImpl);
      if (size !== null) presentSizes.set(new URL(file.url).pathname.replace(/^\//, ""), size);
    }
  }
  const actions = planUpload(manifest, { presentSizes, force });
  const manifestKey = `manifests/${manifest.id}-${manifest.version}.json`;

  log(`${dryRun ? "DRY RUN - nothing will be uploaded.\n" : ""}Bucket: ${bucket}   Model: ${manifest.id}@${manifest.version}`);
  if (dryRun && !force) log("(A real run first asks the public host which objects it already has, with HEAD, and skips those with the same size.)");

  const jobs = [
    ...actions.filter((action) => action.kind === "put").map((action) => ({ ...action, file: join(root, action.key) })),
    { kind: "put", key: manifestKey, bytes: null, file: join(root, "manifest.json"), contentType: "application/json", cacheControl: MANIFEST_CACHE },
  ];
  for (const action of actions) if (action.kind === "skip") log(`SKIP  ${action.key} (${action.reason})`);

  let uploaded = 0;
  for (const job of jobs) {
    const args = wranglerPutArgs({ bucket, key: job.key, file: job.file, contentType: job.contentType, cacheControl: job.cacheControl });
    log(`${dryRun ? "WOULD RUN" : "RUN"}  npx ${args.map(shellQuote).join(" ")}`);
    if (dryRun) continue;
    const status = run(args);
    if (status !== 0) throw new Error(`wrangler failed (exit ${status}) while uploading ${job.key}. Re-run the same command: finished objects are skipped.`);
    uploaded += 1;
  }

  if (!dryRun) {
    // Prove the public host now serves what the manifest promises, with the right size.
    for (const file of manifest.files) {
      const size = await headSize(file.url, fetchImpl);
      if (size !== file.bytes) throw new Error(`After upload, ${file.url} reports ${size === null ? "no size (not reachable yet; check the custom domain)" : `${size} bytes`}, expected ${file.bytes}.`);
    }
    log("Public host serves every file with the expected size.");
  }
  const skipped = actions.filter((action) => action.kind === "skip").length;
  log(`${dryRun ? "Would upload" : "Uploaded"} ${jobs.length} object(s) (including the manifest copy), skipped ${skipped}.`);
  return { actions, uploaded, skipped, dryRun };
}

// On Windows npx is a .cmd file, so a shell is needed, and a shell does not keep an argument with spaces
// together unless it is quoted (the cache-control value has spaces).
const realRun = (args) =>
  spawnSync("npx", process.platform === "win32" ? args.map(shellQuote) : args, { stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const dir = argv.find((arg) => !arg.startsWith("--"));
  const unknown = argv.filter((arg) => arg.startsWith("--") && !["--dry-run", "--force"].includes(arg));
  if (!dir || unknown.length > 0) {
    console.error(`Usage: R2_BUCKET=<bucket> node scripts/models/upload-r2.mjs <model-dist folder> [--dry-run] [--force]${unknown.length ? `\nUnknown option: ${unknown.join(" ")}` : ""}`);
    process.exit(2);
  }
  try {
    await runUpload({ dir, bucket: process.env.R2_BUCKET, dryRun: argv.includes("--dry-run"), force: argv.includes("--force"), run: realRun });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
