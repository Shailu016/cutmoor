/**
 * Re-hashes a built model folder and compares it with its manifest. Run it after build-manifest
 * and again right before upload: it is the last check that what goes to the bucket is exactly what
 * the manifest (and so the app) pins.
 *
 *   node scripts/models/verify-manifest.mjs ./model-dist [manifest.json]
 *
 * Exit code 0 only if every file is present, has the manifest's size and SHA-256, and the manifest
 * itself is consistent (opaque names that match the hashes, one https host).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkManifestShape, hashFile } from "./lib.mjs";

/** Returns an array of plain-English problems; empty means the folder matches the manifest. */
export async function verifyDirectory(dir, manifest) {
  const problems = checkManifestShape(manifest);
  if (!Array.isArray(manifest?.files)) return problems;
  const expectedKeys = new Set();
  for (const file of manifest.files) {
    let key;
    try {
      key = new URL(file.url).pathname.replace(/^\//, "");
    } catch {
      continue; // already reported by checkManifestShape
    }
    expectedKeys.add(key);
    const path = join(dir, key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      problems.push(`"${file.name}" is missing (${key}).`);
      continue;
    }
    if (info.size !== file.bytes) {
      problems.push(`"${file.name}" is ${info.size} bytes, the manifest says ${file.bytes}.`);
      continue;
    }
    const { sha256 } = await hashFile(path);
    if (sha256 !== file.sha256) problems.push(`"${file.name}" has SHA-256 ${sha256}, the manifest says ${file.sha256}.`);
  }
  // A stray file in m/ would be uploaded by mistake, so it counts as a problem too.
  const present = await readdir(join(dir, "m")).catch(() => []);
  for (const name of present) {
    if (!expectedKeys.has(`m/${name}`)) problems.push(`m/${name} is in the folder but not in the manifest.`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, manifestPath = dir && join(dir, "manifest.json")] = process.argv.slice(2);
  if (!dir) {
    console.error("Usage: verify-manifest.mjs <model-dist folder> [manifest.json]");
    process.exit(2);
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const problems = await verifyDirectory(dir, manifest);
    if (problems.length > 0) {
      console.error(`Manifest check FAILED (${problems.length} problem(s)):`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log(`Manifest OK: ${manifest.id}@${manifest.version}, ${manifest.files.length} file(s) match their size and SHA-256.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
