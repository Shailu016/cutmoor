import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cachedFileNames,
  deleteModel,
  describeDownload,
  downloadModel,
  ModelLoadError,
  storeKey,
  validateManifest,
  type LoaderDeps,
  type ModelFile,
  type ModelManifest,
  type ModelStore,
} from "./model-loader";

const HOST = "https://models.cutmoor.com";

const bytesOf = (length: number, seed = 1) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 255);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function fileOf(name: string, data: Uint8Array, url = `${HOST}/m/${name}.onnx`): ModelFile {
  return { name, url, bytes: data.length, sha256: sha(data) };
}

class MemoryStore implements ModelStore {
  map = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async put(key: string, data: Uint8Array) {
    this.map.set(key, data);
  }
  async delete(key: string) {
    return this.map.delete(key);
  }
}

interface Call {
  url: string;
  init: RequestInit;
}

/** A tiny server: serves `files` by URL, honours Range, and records every request. */
function fakeNetwork(files: Record<string, Uint8Array>, behaviour: { ignoreRange?: boolean; failFirst?: Record<string, number>; status?: number } = {}) {
  const calls: Call[] = [];
  const failures = { ...(behaviour.failFirst ?? {}) };
  const fetchFn: LoaderDeps["fetch"] = async (url, init) => {
    calls.push({ url, init });
    const range = (init.headers as Record<string, string> | undefined)?.Range;
    if (failures[`${url}|${range}`] > 0) {
      failures[`${url}|${range}`] -= 1;
      throw new TypeError("network down");
    }
    if (behaviour.status) return new Response("nope", { status: behaviour.status });
    const data = files[url];
    if (!data) return new Response("missing", { status: 404 });
    if (behaviour.ignoreRange || !range) return new Response(data as unknown as BodyInit, { status: 200 });
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range) ?? [];
    return new Response(data.slice(Number(from), Number(to) + 1) as unknown as BodyInit, { status: 206 });
  };
  return { calls, fetchFn };
}

function depsFor(fetchFn: LoaderDeps["fetch"], store: ModelStore): LoaderDeps {
  return {
    fetch: fetchFn,
    digest: async (data) => {
      const hash = createHash("sha256").update(data).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    },
    store,
    sleep: async () => undefined,
  };
}

describe("validateManifest", () => {
  const data = bytesOf(100);
  const good = (): ModelManifest => ({ id: "swift", version: "1", files: [fileOf("a", data)] });

  it("accepts a good manifest", () => {
    expect(() => validateManifest(good(), [HOST])).not.toThrow();
  });

  it("refuses a file hosted anywhere but an allowed origin, before any request", () => {
    const manifest = good();
    manifest.files[0].url = "https://huggingface.co/x/model.onnx";
    expect(() => validateManifest(manifest, [HOST])).toThrowError(/not an allowed model host/);
    manifest.files[0].url = "https://models.cutmoor.com.evil.example/m.onnx";
    expect(() => validateManifest(manifest, [HOST])).toThrow(ModelLoadError);
    manifest.files[0].url = "https://user@models.cutmoor.com@evil.example/m.onnx";
    expect(() => validateManifest(manifest, [HOST])).toThrow(ModelLoadError);
  });

  it("refuses plain http and non-urls", () => {
    for (const url of ["http://models.cutmoor.com/m.onnx", "not a url", "//models.cutmoor.com/m.onnx", "file:///etc/passwd"]) {
      const manifest = good();
      manifest.files[0].url = url;
      expect(() => validateManifest(manifest, [HOST]), url).toThrow(ModelLoadError);
    }
  });

  it("refuses a missing or malformed pin, impossible sizes and repeated names", () => {
    const noPin = good();
    noPin.files[0].sha256 = "";
    expect(() => validateManifest(noPin, [HOST])).toThrowError(/SHA-256/);
    const upper = good();
    upper.files[0].sha256 = upper.files[0].sha256.toUpperCase();
    expect(() => validateManifest(upper, [HOST])).toThrow(ModelLoadError);
    const empty = good();
    empty.files[0].bytes = 0;
    expect(() => validateManifest(empty, [HOST])).toThrow(ModelLoadError);
    const twice = good();
    twice.files.push({ ...twice.files[0] });
    expect(() => validateManifest(twice, [HOST])).toThrowError(/repeated/);
    expect(() => validateManifest({ id: "x", version: "1", files: [] }, [HOST])).toThrow(ModelLoadError);
  });

  it("refuses to run with no allowed host at all", () => {
    expect(() => validateManifest(good(), [])).toThrowError(/No https model host/);
    expect(() => validateManifest(good(), ["http://models.cutmoor.com"])).toThrow(ModelLoadError);
  });
});

describe("downloadModel", () => {
  const encoder = bytesOf(2500, 3);
  const decoder = bytesOf(1300, 9);
  const manifest = (): ModelManifest => ({ id: "swift", version: "1", files: [fileOf("encoder", encoder), fileOf("decoder", decoder)] });
  const served = () => ({ [`${HOST}/m/encoder.onnx`]: encoder, [`${HOST}/m/decoder.onnx`]: decoder });

  it("downloads in ranges, verifies, stores and reports progress", async () => {
    const { calls, fetchFn } = fakeNetwork(served());
    const store = new MemoryStore();
    const progress: number[] = [];
    const result = await downloadModel(manifest(), {
      allowedOrigins: [HOST],
      deps: depsFor(fetchFn, store),
      chunkBytes: 1024,
      onProgress: (p) => progress.push(p.loadedBytes),
    });
    expect(result.get("encoder")).toEqual(encoder);
    expect(result.get("decoder")).toEqual(decoder);
    expect(calls).toHaveLength(3 + 2); // 2500 -> 3 ranges, 1300 -> 2 ranges
    expect(progress.at(-1)).toBe(3800);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(store.map.size).toBe(2);
  });

  it("sends nothing that identifies the visitor: no cookies, no referrer, no body, no redirect, and only to the allowed host", async () => {
    const { calls, fetchFn } = fakeNetwork(served());
    await downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(fetchFn, new MemoryStore()), chunkBytes: 1024 });
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe(HOST);
      expect(call.init.credentials).toBe("omit");
      expect(call.init.referrerPolicy).toBe("no-referrer");
      expect(call.init.redirect).toBe("error");
      expect(call.init.method).toBe("GET");
      expect(call.init.body).toBeUndefined();
    }
  });

  it("makes no request at all for files already stored, even if offline", async () => {
    const store = new MemoryStore();
    const first = fakeNetwork(served());
    await downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(first.fetchFn, store), chunkBytes: 1024 });
    const offline = fakeNetwork({});
    const again = await downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(offline.fetchFn, store), chunkBytes: 1024 });
    expect(offline.calls).toHaveLength(0);
    expect(again.get("encoder")).toEqual(encoder);
  });

  it("throws away a damaged stored copy and downloads it again", async () => {
    const store = new MemoryStore();
    const m = manifest();
    const damaged = encoder.slice();
    damaged[10] ^= 255;
    store.map.set(storeKey(m.files[0]), damaged);
    const { calls, fetchFn } = fakeNetwork(served());
    const result = await downloadModel(m, { allowedOrigins: [HOST], deps: depsFor(fetchFn, store), chunkBytes: 4096 });
    expect(result.get("encoder")).toEqual(encoder);
    expect(calls.length).toBeGreaterThan(0);
    expect(store.map.get(storeKey(m.files[0]))).toEqual(encoder);
  });

  it("refuses a file whose bytes do not match the pin, and stores nothing for it", async () => {
    const tampered = encoder.slice();
    tampered[0] ^= 1;
    const { fetchFn } = fakeNetwork({ ...served(), [`${HOST}/m/encoder.onnx`]: tampered });
    const store = new MemoryStore();
    await expect(downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(fetchFn, store), chunkBytes: 1024 })).rejects.toMatchObject({ code: "integrity" });
    expect(store.map.size).toBe(0);
  });

  it("never contacts a disallowed host", async () => {
    const m = manifest();
    m.files[1].url = "https://huggingface.co/x/decoder.onnx";
    const { calls, fetchFn } = fakeNetwork(served());
    await expect(downloadModel(m, { allowedOrigins: [HOST], deps: depsFor(fetchFn, new MemoryStore()) })).rejects.toMatchObject({ code: "disallowed-url" });
    expect(calls).toHaveLength(0); // not even the first, allowed, file
  });

  it("retries only the failed range after a dropped connection", async () => {
    const m = manifest();
    const { calls, fetchFn } = fakeNetwork(served(), { failFirst: { [`${HOST}/m/encoder.onnx|bytes=1024-2047`]: 2 } });
    const result = await downloadModel(m, { allowedOrigins: [HOST], deps: depsFor(fetchFn, new MemoryStore()), chunkBytes: 1024 });
    expect(result.get("encoder")).toEqual(encoder);
    const firstRange = calls.filter((c) => (c.init.headers as Record<string, string>).Range === "bytes=0-1023" && c.url.endsWith("encoder.onnx"));
    const failedRange = calls.filter((c) => (c.init.headers as Record<string, string>).Range === "bytes=1024-2047" && c.url.endsWith("encoder.onnx"));
    expect(firstRange).toHaveLength(1); // not downloaded again
    expect(failedRange).toHaveLength(3); // two failures, then success
  });

  it("gives up with a clear error after the last attempt", async () => {
    const { fetchFn } = fakeNetwork(served(), { failFirst: { [`${HOST}/m/encoder.onnx|bytes=0-1023`]: 99 } });
    await expect(downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(fetchFn, new MemoryStore()), chunkBytes: 1024, attempts: 3 })).rejects.toMatchObject({ code: "network" });
  });

  it("does not retry a real HTTP error or a wrong-sized answer", async () => {
    const missing = fakeNetwork({});
    await expect(downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(missing.fetchFn, new MemoryStore()), chunkBytes: 1024 })).rejects.toMatchObject({ code: "http" });
    expect(missing.calls).toHaveLength(1);
    const wrong = fakeNetwork({ ...served(), [`${HOST}/m/encoder.onnx`]: encoder.slice(0, 2000) });
    await expect(downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(wrong.fetchFn, new MemoryStore()), chunkBytes: 1024 })).rejects.toMatchObject({ code: "size-mismatch" });
  });

  it("retries a server error, but not before trying", async () => {
    const down = fakeNetwork(served(), { status: 503 });
    await expect(downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(down.fetchFn, new MemoryStore()), chunkBytes: 1024, attempts: 2 })).rejects.toMatchObject({ code: "network" });
    expect(down.calls).toHaveLength(2);
  });

  it("copes with a server that ignores Range, taking the whole file once", async () => {
    const { calls, fetchFn } = fakeNetwork(served(), { ignoreRange: true });
    const result = await downloadModel(manifest(), { allowedOrigins: [HOST], deps: depsFor(fetchFn, new MemoryStore()), chunkBytes: 1024 });
    expect(result.get("encoder")).toEqual(encoder);
    expect(result.get("decoder")).toEqual(decoder);
    expect(calls).toHaveLength(2); // one request per file, not one per range
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    const { fetchFn } = fakeNetwork(served());
    const promise = downloadModel(manifest(), {
      allowedOrigins: [HOST],
      deps: depsFor(fetchFn, new MemoryStore()),
      chunkBytes: 1024,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("describeDownload, cachedFileNames and deleteModel", () => {
  const a = bytesOf(1000, 1);
  const b = bytesOf(500, 2);
  const m: ModelManifest = { id: "x", version: "1", files: [fileOf("a", a), fileOf("b", b)] };

  it("tells the visitor the size and host before anything is downloaded", () => {
    expect(describeDownload(m)).toEqual({ totalBytes: 1500, hosts: [HOST], fileCount: 2, alreadyDownloaded: false });
    expect(describeDownload(m, new Set(["a"]))).toMatchObject({ totalBytes: 500, fileCount: 1 });
    expect(describeDownload(m, new Set(["a", "b"]))).toMatchObject({ totalBytes: 0, alreadyDownloaded: true });
  });

  it("lists what is stored and removes it on request", async () => {
    const store = new MemoryStore();
    await store.put(storeKey(m.files[0]), a);
    expect([...(await cachedFileNames(m, store))]).toEqual(["a"]);
    expect(await deleteModel(m, store)).toBe(1);
    expect((await cachedFileNames(m, store)).size).toBe(0);
  });
});
