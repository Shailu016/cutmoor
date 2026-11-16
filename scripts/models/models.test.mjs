// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFromDirectory } from "./build-manifest.mjs";
import {
  assertBucketName,
  assertNoCollisions,
  buildManifest,
  checkManifestShape,
  IMMUTABLE_CACHE,
  normaliseBaseUrl,
  normaliseDevBaseUrl,
  objectName,
  planUpload,
  serialiseManifest,
  wranglerPutArgs,
} from "./lib.mjs";
import { runUpload, headSize } from "./upload-r2.mjs";
import { verifyDirectory } from "./verify-manifest.mjs";
import { downloadModel, validateManifest } from "../../src/lib/captioning/model-loader";
import { isDevModelUrl, validateDevManifest } from "../../src/lib/captioning/dev-models";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (text) => new TextEncoder().encode(text);

let work;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "cutmoor-models-"));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function makeInput(files) {
  const dir = join(work, "in");
  await mkdir(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) await writeFile(join(dir, name), data);
  return dir;
}

const oneFile = (name, text) => ({ name, bytes: bytesOf(text).length, sha256: sha(bytesOf(text)) });

describe("objectName / buildManifest", () => {
  it("names a file after the first 16 hex digits of its hash", () => {
    // Known SHA-256 of "abc": ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(objectName(sha(bytesOf("abc")))).toBe("m/ba7816bf8f01cfea.bin");
  });

  it("refuses anything that is not a lower-case SHA-256", () => {
    expect(() => objectName("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD")).toThrow();
    expect(() => objectName("abc")).toThrow();
  });

  it("is deterministic and independent of input order", () => {
    const a = oneFile("a.onnx", "alpha");
    const b = oneFile("b.onnx", "beta");
    const one = serialiseManifest(buildManifest({ id: "m", version: "1", entries: [a, b] }));
    const two = serialiseManifest(buildManifest({ id: "m", version: "1", entries: [b, a] }));
    expect(one).toBe(two);
    expect(one.endsWith("\n")).toBe(true);
  });

  it("produces a manifest the real model loader accepts for the model host", () => {
    const manifest = buildManifest({ id: "m", version: "1", entries: [oneFile("a.onnx", "alpha")] });
    expect(() => validateManifest(manifest, ["https://models.cutmoor.com"])).not.toThrow();
    expect(manifest.files[0].url).toBe(`https://models.cutmoor.com/${objectName(manifest.files[0].sha256)}`);
    // ...and rejects it for any other host.
    expect(() => validateManifest(manifest, ["https://evil.example"])).toThrow();
  });

  it("rejects duplicate names, empty files, bad ids and non-https bases", () => {
    const a = oneFile("a.onnx", "alpha");
    expect(() => buildManifest({ id: "m", version: "1", entries: [a, a] })).toThrow(/twice/);
    expect(() => buildManifest({ id: "m", version: "1", entries: [{ name: "x", bytes: 0, sha256: sha(bytesOf("")) }] })).toThrow(/empty/);
    expect(() => buildManifest({ id: "bad id", version: "1", entries: [a] })).toThrow(/id/);
    expect(() => buildManifest({ id: "m", version: "", entries: [a] })).toThrow(/version/);
    expect(() => buildManifest({ id: "m", version: "1", baseUrl: "http://models.cutmoor.com", entries: [a] })).toThrow(/https/);
    expect(() => buildManifest({ id: "m", version: "1", entries: [] })).toThrow();
  });

  it("detects two different hashes that would share one object name", () => {
    const prefix = "0123456789abcdef";
    const x = { name: "x", bytes: 1, sha256: prefix + "0".repeat(48) };
    const y = { name: "y", bytes: 1, sha256: prefix + "1".repeat(48) };
    expect(() => assertNoCollisions([x, y])).toThrow(/share the object name/);
    // Identical content under two names is fine: they simply share one object.
    expect(() => assertNoCollisions([x, { ...x, name: "z" }])).not.toThrow();
  });

  it("keeps a base URL path and strips trailing slashes", () => {
    expect(normaliseBaseUrl("https://models.cutmoor.com/")).toBe("https://models.cutmoor.com");
    expect(normaliseBaseUrl("https://x.example/v1//")).toBe("https://x.example/v1");
    expect(() => normaliseBaseUrl("https://user:pw@x.example")).toThrow();
    expect(() => normaliseBaseUrl("https://x.example/?a=1")).toThrow();
    expect(() => normaliseBaseUrl("not a url")).toThrow();
  });
});

describe("dev base URL (localhost only, opt-in)", () => {
  const entries = [oneFile("enc.onnx", "alpha")];

  it("builds localhost /dev-models URLs only when asked, and the app's dev loader accepts them", () => {
    const manifest = buildManifest({ id: "m", version: "1", devBaseUrl: "http://localhost:4180/dev-models", entries });
    expect(manifest.files[0].url).toBe(`http://localhost:4180/dev-models/${objectName(manifest.files[0].sha256)}`);
    // The two sides of the dev path must agree, otherwise build-manifest happily writes a list the page ignores.
    expect(isDevModelUrl(manifest.files[0].url)).toBe(true);
    expect(() => validateDevManifest(manifest)).not.toThrow();
  });

  it("accepts any localhost port and the https local server, and strips a trailing slash", () => {
    expect(normaliseDevBaseUrl("http://localhost:5199/dev-models/")).toBe("http://localhost:5199/dev-models");
    expect(normaliseDevBaseUrl("https://localhost:4443/dev-models")).toBe("https://localhost:4443/dev-models");
    expect(normaliseDevBaseUrl("http://localhost/dev-models")).toBe("http://localhost/dev-models");
  });

  it("keeps https-only as the default and still rejects plain http there", () => {
    expect(buildManifest({ id: "m", version: "1", entries })).toMatchObject({ files: [{ url: expect.stringMatching(/^https:\/\/models\.cutmoor\.com\//) }] });
    expect(() => buildManifest({ id: "m", version: "1", baseUrl: "http://localhost:4180/dev-models", entries })).toThrow(/https/);
    expect(() => buildManifest({ id: "m", version: "1", baseUrl: "http://models.cutmoor.com", entries })).toThrow(/https/);
  });

  it("rejects a dev base that is not the name localhost or not /dev-models", () => {
    for (const bad of [
      "http://evil.example/dev-models",
      "http://models.cutmoor.com/dev-models",
      "http://127.0.0.1:4180/dev-models",
      "http://localhost.evil.example:4180/dev-models",
      "http://localhost:4180/other",
      "http://localhost:4180/dev-models/v2",
      "http://localhost:4180/dev-models?x=1",
      "http://user:pw@localhost:4180/dev-models",
      "ftp://localhost/dev-models",
      "not a url",
    ]) {
      expect(() => normaliseDevBaseUrl(bad), bad).toThrow();
      expect(() => buildManifest({ id: "m", version: "1", devBaseUrl: bad, entries }), bad).toThrow();
    }
  });

  it("buildFromDirectory passes the dev base through to the folder it writes", async () => {
    const inDir = await makeInput({ "enc.onnx": bytesOf("alpha") });
    const outDir = join(work, "dev-out");
    const manifest = await buildFromDirectory({ inDir, outDir, id: "prime-dev", version: "1", devBaseUrl: "http://localhost:4180/dev-models" });
    expect(manifest.files[0].url).toMatch(/^http:\/\/localhost:4180\/dev-models\/m\/[0-9a-f]{16}\.bin$/);
    expect(JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")).files[0].url).toBe(manifest.files[0].url);
  });
});

describe("checkManifestShape", () => {
  const good = () => buildManifest({ id: "m", version: "1", entries: [oneFile("a.onnx", "alpha"), oneFile("b.json", "beta")] });

  it("accepts a built manifest", () => {
    expect(checkManifestShape(good())).toEqual([]);
  });

  it("flags a URL whose name does not match the hash (cache-forever would be unsafe)", () => {
    const manifest = good();
    manifest.files[0].url = "https://models.cutmoor.com/m/0000000000000000.bin";
    expect(checkManifestShape(manifest).join()).toMatch(/does not match its SHA-256/);
  });

  it("flags readable names, http, queries and mixed hosts", () => {
    const manifest = good();
    manifest.files[0].url = "https://models.cutmoor.com/whisper-encoder.onnx";
    expect(checkManifestShape(manifest).join()).toMatch(/opaque/);
    const http = good();
    http.files[0].url = http.files[0].url.replace("https", "http");
    expect(checkManifestShape(http).join()).toMatch(/not an https/);
    const query = good();
    query.files[0].url += "?x=1";
    expect(checkManifestShape(query).join()).toMatch(/query/);
    const mixed = good();
    mixed.files[1].url = mixed.files[1].url.replace("models.cutmoor.com", "other.example");
    expect(checkManifestShape(mixed).join()).toMatch(/several hosts/);
  });

  it("flags garbage without throwing", () => {
    expect(checkManifestShape(null).length).toBe(1);
    expect(checkManifestShape({ id: "m", version: "1", files: [] }).join()).toMatch(/no files/);
    expect(checkManifestShape({ id: "m", version: "1", files: [{ name: "a", url: "x", bytes: 1.5, sha256: "zz" }] }).length).toBeGreaterThan(0);
  });
});

describe("planUpload", () => {
  const manifest = buildManifest({ id: "m", version: "1", entries: [oneFile("a", "alpha"), oneFile("b", "beta!")] });
  const [fa, fb] = manifest.files;
  const keyOf = (file) => new URL(file.url).pathname.slice(1);

  it("uploads everything when nothing is present", () => {
    const plan = planUpload(manifest);
    expect(plan.map((a) => a.kind)).toEqual(["put", "put"]);
    expect(plan[0]).toMatchObject({ contentType: "application/octet-stream", cacheControl: IMMUTABLE_CACHE });
  });

  it("skips only objects whose size matches; a wrong size is re-uploaded", () => {
    const plan = planUpload(manifest, { presentSizes: new Map([[keyOf(fa), fa.bytes], [keyOf(fb), fb.bytes + 1]]) });
    expect(plan.find((a) => a.key === keyOf(fa)).kind).toBe("skip");
    expect(plan.find((a) => a.key === keyOf(fb)).kind).toBe("put");
  });

  it("--force uploads even present objects, and identical content is planned once", () => {
    expect(planUpload(manifest, { presentSizes: new Map([[keyOf(fa), fa.bytes]]), force: true }).every((a) => a.kind === "put")).toBe(true);
    const dup = buildManifest({ id: "m", version: "1", entries: [oneFile("a", "same"), oneFile("b", "same")] });
    expect(planUpload(dup)).toHaveLength(1);
  });
});

describe("wrangler command and bucket name", () => {
  it("builds the pinned, remote, immutable put command", () => {
    const args = wranglerPutArgs({ bucket: "cutmoor-models", key: "m/a.bin", file: "x", contentType: "application/octet-stream", cacheControl: IMMUTABLE_CACHE });
    expect(args).toEqual([
      "--yes", "wrangler@4.161.0", "r2", "object", "put", "cutmoor-models/m/a.bin",
      "--file", "x", "--content-type", "application/octet-stream",
      "--cache-control", "public, max-age=31536000, immutable", "--remote",
    ]);
  });

  it("refuses a missing or malformed bucket", () => {
    expect(() => assertBucketName(undefined)).toThrow(/R2_BUCKET/);
    expect(() => assertBucketName("")).toThrow(/R2_BUCKET/);
    expect(() => assertBucketName("Bad_Bucket")).toThrow(/valid/);
    expect(() => assertBucketName("cutmoor-models")).not.toThrow();
  });
});

describe("build-manifest + verify-manifest on real files", () => {
  it("copies files under opaque names and the folder verifies clean", async () => {
    const inDir = await makeInput({ "enc.onnx": bytesOf("encoder-bytes"), "tok.json": bytesOf('{"a":1}') });
    const outDir = join(work, "out");
    const manifest = await buildFromDirectory({ inDir, outDir, id: "whisper-test", version: "3" });
    expect(manifest.files.map((f) => f.name)).toEqual(["enc.onnx", "tok.json"]);
    expect(await readdir(join(outDir, "m"))).toHaveLength(2);
    for (const file of manifest.files) {
      const stored = await readFile(join(outDir, new URL(file.url).pathname));
      expect(sha(stored)).toBe(file.sha256);
    }
    expect(await verifyDirectory(outDir, JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")))).toEqual([]);
  });

  it("is byte-for-byte reproducible and --strip-extension drops the extension", async () => {
    const inDir = await makeInput({ "enc.onnx": bytesOf("encoder-bytes") });
    const first = join(work, "o1");
    const second = join(work, "o2");
    await buildFromDirectory({ inDir, outDir: first, id: "t", version: "1", stripExtension: true });
    await buildFromDirectory({ inDir, outDir: second, id: "t", version: "1", stripExtension: true });
    const a = await readFile(join(first, "manifest.json"), "utf8");
    expect(a).toBe(await readFile(join(second, "manifest.json"), "utf8"));
    expect(JSON.parse(a).files[0].name).toBe("enc");
  });

  it("refuses names that collide after stripping the extension, and the same in/out folder", async () => {
    const inDir = await makeInput({ "a.onnx": bytesOf("one"), "a.json": bytesOf("two") });
    await expect(buildFromDirectory({ inDir, outDir: join(work, "o"), id: "t", version: "1", stripExtension: true })).rejects.toThrow(/twice/);
    await expect(buildFromDirectory({ inDir, outDir: inDir, id: "t", version: "1" })).rejects.toThrow(/different/);
  });

  it("verify catches a changed byte, a truncated file, a missing file and a stray file", async () => {
    const inDir = await makeInput({ "enc.onnx": bytesOf("encoder-bytes"), "tok.json": bytesOf("tokens!!") });
    const outDir = join(work, "out");
    const manifest = await buildFromDirectory({ inDir, outDir, id: "t", version: "1" });
    const [enc, tok] = manifest.files;

    const flipped = Buffer.from(bytesOf("encoder-bytez")); // same length, different byte
    await writeFile(join(outDir, new URL(enc.url).pathname), flipped);
    expect((await verifyDirectory(outDir, manifest)).join()).toMatch(/SHA-256/);

    await writeFile(join(outDir, new URL(enc.url).pathname), bytesOf("short"));
    expect((await verifyDirectory(outDir, manifest)).join()).toMatch(/bytes, the manifest says/);

    await rm(join(outDir, new URL(tok.url).pathname));
    expect((await verifyDirectory(outDir, manifest)).join()).toMatch(/is missing/);

    await writeFile(join(outDir, "m", "ffffffffffffffff.bin"), "x");
    expect((await verifyDirectory(outDir, manifest)).join()).toMatch(/not in the manifest/);
  });

  it("what it builds really downloads and verifies through the real model loader", async () => {
    const data = { "enc.onnx": new Uint8Array(5000).map((_, i) => (i * 31) % 251), "tok.json": bytesOf('{"vocab":[1,2,3]}') };
    const inDir = await makeInput(data);
    const outDir = join(work, "out");
    const manifest = await buildFromDirectory({ inDir, outDir, id: "t", version: "1" });
    const served = new Map();
    for (const file of manifest.files) served.set(file.url, new Uint8Array(await readFile(join(outDir, new URL(file.url).pathname))));
    const kv = new Map();
    const result = await downloadModel(manifest, {
      allowedOrigins: ["https://models.cutmoor.com"],
      chunkBytes: 2048,
      deps: {
        fetch: async (url, init) => {
          const body = served.get(url);
          const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
          return new Response(body.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
        },
        digest: async (bytes) => createHash("sha256").update(bytes).digest().buffer,
        store: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), delete: async (k) => kv.delete(k) },
      },
    });
    expect([...result.get("enc.onnx")]).toEqual([...data["enc.onnx"]]);
  });
});

describe("upload-r2 runUpload", () => {
  async function built() {
    const inDir = await makeInput({ "enc.onnx": bytesOf("encoder-bytes"), "tok.json": bytesOf("tokens") });
    const outDir = join(work, "out");
    const manifest = await buildFromDirectory({ inDir, outDir, id: "whisper-test", version: "1" });
    return { outDir, manifest };
  }

  it("dry run runs no command, makes no request, and prints each command", async () => {
    const { outDir } = await built();
    const lines = [];
    let commands = 0;
    let requests = 0;
    const result = await runUpload({
      dir: outDir, bucket: "cutmoor-models", dryRun: true, log: (l) => lines.push(l),
      run: () => { commands += 1; return 0; },
      fetchImpl: async () => { requests += 1; return new Response(null); },
    });
    expect(commands).toBe(0);
    expect(requests).toBe(0);
    expect(result.dryRun).toBe(true);
    const text = lines.join("\n");
    expect(text).toContain("DRY RUN");
    expect(text.match(/WOULD RUN/g)).toHaveLength(3); // two models + the manifest copy
    expect(text).toContain("--cache-control");
    expect(text).toContain("--remote");
    expect(text).toContain("manifests/whisper-test-1.json");
  });

  it("refuses without a bucket and refuses a folder that does not match its manifest", async () => {
    const { outDir, manifest } = await built();
    await expect(runUpload({ dir: outDir, bucket: undefined, dryRun: true, run: () => 0, log: () => {} })).rejects.toThrow(/R2_BUCKET/);
    await writeFile(join(outDir, new URL(manifest.files[0].url).pathname), bytesOf("tampered-bytes!"));
    let commands = 0;
    await expect(runUpload({ dir: outDir, bucket: "cutmoor-models", run: () => { commands += 1; return 0; }, log: () => {} })).rejects.toThrow(/does not match its manifest/);
    expect(commands).toBe(0);
  });

  it("a real run skips what the host already serves, uploads the manifest last, then re-checks sizes", async () => {
    const { outDir, manifest } = await built();
    const [first, second] = manifest.files;
    const hosted = new Map([[first.url, first.bytes]]); // first is already there
    const order = [];
    const fetchImpl = async (url) => (hosted.has(url) ? new Response(null, { status: 200, headers: { "content-length": String(hosted.get(url)) } }) : new Response(null, { status: 404 }));
    await runUpload({
      dir: outDir, bucket: "cutmoor-models", log: () => {}, fetchImpl,
      run: (args) => {
        order.push(args[5]);
        const key = args[5].replace("cutmoor-models/", "");
        for (const f of manifest.files) if (key === new URL(f.url).pathname.slice(1)) hosted.set(f.url, f.bytes);
        return 0;
      },
    });
    expect(order).toEqual([`cutmoor-models/${new URL(second.url).pathname.slice(1)}`, "cutmoor-models/manifests/whisper-test-1.json"]);
  });

  it("fails if the public host does not serve the right size after upload, and if wrangler fails", async () => {
    const { outDir } = await built();
    const lies = async () => new Response(null, { status: 200, headers: { "content-length": "1" } });
    await expect(runUpload({ dir: outDir, bucket: "cutmoor-models", force: true, log: () => {}, run: () => 0, fetchImpl: lies })).rejects.toThrow(/expected/);
    await expect(runUpload({ dir: outDir, bucket: "cutmoor-models", force: true, log: () => {}, run: () => 3, fetchImpl: lies })).rejects.toThrow(/wrangler failed/);
  });

  it("headSize returns null for errors, 404 and missing length", async () => {
    expect(await headSize("https://x", async () => { throw new Error("down"); })).toBeNull();
    expect(await headSize("https://x", async () => new Response(null, { status: 404 }))).toBeNull();
    expect(await headSize("https://x", async () => new Response(null, { status: 200 }))).toBeNull();
    expect(await headSize("https://x", async () => new Response(null, { status: 200, headers: { "content-length": "42" } }))).toBe(42);
  });
});

describe("cors.json", () => {
  it("allows only GET/HEAD from our two origins and exposes the range headers", async () => {
    const cors = JSON.parse(await readFile(new URL("./cors.json", import.meta.url), "utf8"));
    expect(cors.rules).toHaveLength(1);
    const rule = cors.rules[0];
    expect(rule.allowed.origins.sort()).toEqual(["https://cutmoor.com", "https://www.cutmoor.com"]);
    expect(rule.allowed.methods.sort()).toEqual(["GET", "HEAD"]);
    expect(rule.exposeHeaders).toEqual(expect.arrayContaining(["Content-Length", "Content-Range", "Accept-Ranges"]));
  });
});
