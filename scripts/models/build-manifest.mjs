/**
 * Turns a folder of model files into an upload-ready folder: every file copied under its opaque
 * content-hash name, plus manifest.json that pins each file's size and SHA-256.
 *
 *   node scripts/models/build-manifest.mjs --in ./model-src --out ./model-dist \
 *        --id whisper-swift-base-hinglish --version 1 [--base-url https://models.cutmoor.com] [--strip-extension]
 *
 *   node scripts/models/build-manifest.mjs --in ./model-src --out .team/models-local/dev-models \
 *        --id whisper-prime-dev --version 1 --dev-base-url http://localhost:4180/dev-models
 *
 * The input folder is read flat (no sub-folders). Each file's manifest name is its file name
 * ("swift-encoder.onnx"), or without the extension with --strip-extension ("swift-encoder").
 * Output is deterministic, so a rebuild of the same input changes nothing.
 *
 * --dev-base-url is for local testing only: it writes http://localhost:<port>/dev-models URLs, which only the app's
 * dev build can load. The default stays https://models.cutmoor.com, and any other http base is refused. The two flags
 * cannot be combined.
 *
 * Nothing here touches the network. Run verify-manifest.mjs afterwards, then upload-r2.mjs.
 */
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildManifest, DEFAULT_BASE_URL, hashFile, objectName, serialiseManifest } from "./lib.mjs";

/** Reads `inDir`, copies files to `outDir`, writes `outDir/manifest.json`, returns the manifest. */
export async function buildFromDirectory({ inDir, outDir, id, version, baseUrl = DEFAULT_BASE_URL, devBaseUrl, stripExtension = false }) {
  if (resolve(inDir) === resolve(outDir)) throw new Error("The input and output folders must be different.");
  const listing = await readdir(inDir, { withFileTypes: true });
  const sources = listing
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name !== "manifest.json")
    .map((entry) => entry.name)
    .sort();
  if (sources.length === 0) throw new Error(`No model files found in ${inDir}.`);

  const entries = [];
  for (const fileName of sources) {
    const path = join(inDir, fileName);
    const { sha256, bytes } = await hashFile(path);
    const name = stripExtension ? basename(fileName, extname(fileName)) : fileName;
    entries.push({ name, bytes, sha256, path });
  }
  // Throws on a repeated name, a collision, an empty file or a bad id/version/base URL, before anything is written.
  const manifest = buildManifest({ id, version, baseUrl, devBaseUrl, entries });

  await mkdir(join(outDir, "m"), { recursive: true });
  for (const entry of entries) {
    const target = join(outDir, objectName(entry.sha256));
    const existing = await stat(target).catch(() => null);
    if (!existing || existing.size !== entry.bytes) await copyFile(entry.path, target);
  }
  await writeFile(join(outDir, "manifest.json"), serialiseManifest(manifest));
  return manifest;
}

function parseArgs(argv) {
  const args = { stripExtension: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--in") args.inDir = value();
    else if (arg === "--out") args.outDir = value();
    else if (arg === "--id") args.id = value();
    else if (arg === "--version") args.version = value();
    else if (arg === "--base-url") args.baseUrl = value();
    else if (arg === "--dev-base-url") args.devBaseUrl = value();
    else if (arg === "--strip-extension") args.stripExtension = true;
    else throw new Error(`Unknown option ${arg}.`);
  }
  for (const required of ["inDir", "outDir", "id", "version"]) {
    if (!args[required]) throw new Error("Usage: build-manifest.mjs --in <dir> --out <dir> --id <model-id> --version <v> [--base-url <https url> | --dev-base-url <http://localhost:4180/dev-models>] [--strip-extension]");
  }
  // Two different bases cannot both be the one the URLs use.
  if (args.baseUrl && args.devBaseUrl) throw new Error("Use either --base-url or --dev-base-url, not both.");
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = await buildFromDirectory(parseArgs(process.argv.slice(2)));
    const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    console.log(`Wrote ${manifest.files.length} file(s), ${total} bytes, manifest ${manifest.id}@${manifest.version}.`);
    for (const file of manifest.files) console.log(`  ${file.name} -> ${file.url}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
