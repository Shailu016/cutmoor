/**
 * Splits a big model file into pieces the host can take (Wrangler uploads at most 300 MB per file), named
 * `<name>-p0.bin`, `<name>-p1.bin`, ... in the output folder. The speech engine joins them after the
 * hash-checked download. Use before build-manifest.mjs:
 *
 *   node scripts/models/split-file.mjs <file> <out-folder> [pieceMiB=150]
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const [file, outDir, mib = "150"] = process.argv.slice(2);
if (!file || !outDir) throw new Error("usage: split-file.mjs <file> <out-folder> [pieceMiB]");
const piece = Number(mib) * 1024 * 1024;
const base = basename(file, extname(file));
await mkdir(outDir, { recursive: true });
const { size } = await stat(file);
let index = 0;
let chunks = [];
let held = 0;
const flush = async () => {
  if (held === 0) return;
  await writeFile(join(outDir, `${base}-p${index}.bin`), Buffer.concat(chunks));
  console.log(`${base}-p${index}.bin  ${held} bytes`);
  index += 1;
  chunks = [];
  held = 0;
};
for await (const chunk of createReadStream(file, { highWaterMark: 8 * 1024 * 1024 })) {
  let data = chunk;
  while (data.length > 0) {
    const room = piece - held;
    chunks.push(data.subarray(0, room));
    held += Math.min(room, data.length);
    data = data.subarray(room);
    if (held >= piece) await flush();
  }
}
await flush();
console.log(`${size} bytes -> ${index} piece(s)`);
