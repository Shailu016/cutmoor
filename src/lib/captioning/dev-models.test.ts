import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevModelUrl, loadDevCaptionModels, validateDevManifest } from "./dev-models";
import { downloadModel, type ModelFile, type ModelManifest, type ModelStore } from "./model-loader";

const PAGE = "http://localhost:4180";
const MANIFEST_PATH = "/dev-models/manifest.json";

const bytesOf = (length: number, seed = 1) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 255);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function devFile(name: string, data: Uint8Array): ModelFile {
  return { name, url: `${PAGE}/dev-models/m/${sha(data).slice(0, 16)}.bin`, bytes: data.length, sha256: sha(data) };
}

function manifestOf(...files: ModelFile[]): ModelManifest {
  return { id: "hinglish-dev", version: "1", files };
}

interface Call {
  url: string;
  init: RequestInit;
}

/** A stand-in for the dev server: answers the manifest path and the files it has, records every request. */
function fakeServer(body: unknown, files: Record<string, Uint8Array> = {}, behaviour: { manifestStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === MANIFEST_PATH || url === `${PAGE}${MANIFEST_PATH}`) {
      if (behaviour.manifestStatus) return new Response("nope", { status: behaviour.manifestStatus });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    const data = files[url];
    return data ? new Response(data as unknown as BodyInit, { status: 200 }) : new Response("missing", { status: 404 });
  };
  return { calls, fetchImpl };
}

const digest = async (data: Uint8Array) => {
  const hash = createHash("sha256").update(data).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
};

const depsFor = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) => ({ fetch: fetchImpl, digest });

function memoryStore(): ModelStore {
  const files = new Map<string, Uint8Array>();
  return {
    async get(key) {
      return files.get(key) ?? null;
    },
    async put(key, data) {
      files.set(key, data);
    },
    async delete(key) {
      return files.delete(key);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isDevModelUrl and validateDevManifest", () => {
  const data = bytesOf(100);
  const withUrl = (url: string): ModelManifest => manifestOf({ ...devFile("encoder", data), url });

  it("accepts localhost on any port, both http and https", () => {
    for (const url of [
      "http://localhost:4180/dev-models/m/ba7816bf8f01cfea.bin",
      "http://localhost/dev-models/encoder.onnx",
      "http://localhost:5199/dev-models/deep/dir/decoder.onnx",
      "https://localhost:4443/dev-models/m/ba7816bf8f01cfea.bin", // scripts/serve-local.mjs --https
      "http://LOCALHOST:4180/dev-models/x", // host names are case-insensitive, and the URL is parsed, not string-matched
    ]) {
      expect(isDevModelUrl(url), url).toBe(true);
      expect(() => validateDevManifest(withUrl(url)), url).not.toThrow();
    }
  });

  it("refuses every other host, port trick and path, before any request is made", () => {
    for (const url of [
      "http://evil.example/dev-models/m/x.bin",
      "https://evil.example/dev-models/m/x.bin",
      "https://models.cutmoor.com.evil.example/m/x.bin",
      "https://models.cutmoor.com/m/x.bin", // the production host is not a dev host either
      "http://127.0.0.1:4180/dev-models/m/x.bin", // an IP is not the name localhost
      "http://localhost.evil.example:4180/dev-models/m/x.bin",
      "http://evil.example:4180/?http://localhost/dev-models/m/x.bin",
      "http://localhost:4180/other/m/x.bin", // wrong path
      "https://localhost:4180/models/m/x.bin",
      "http://localhost:4180/dev-models", // the folder itself, not a file in it
      "http://localhost:4180/dev-models/../secret.bin", // normalised to /secret.bin by the URL parser
      "http://localhost:4180/dev-models/%2e%2e/secret.bin", // encoded dot-segment is rejected outright
      "http://localhost:4180/dev-models/a%2F..%2Fb.bin", // encoded slash
      "http://localhost:4180/dev-models/m/x.bin?token=1",
      "http://localhost:4180/dev-models/m/x.bin#frag",
      "http://user:pw@localhost:4180/dev-models/m/x.bin",
      "http://localhost:4180@evil.example/dev-models/m/x.bin",
      "file:///dev-models/m/x.bin",
      "//localhost:4180/dev-models/m/x.bin",
      "not a url",
    ]) {
      expect(isDevModelUrl(url), url).toBe(false);
      expect(() => validateDevManifest(withUrl(url)), url).toThrow();
    }
  });

  it("refuses a missing hash, an impossible size and a repeated name", () => {
    const file = devFile("encoder", data);
    expect(() => validateDevManifest(manifestOf({ ...file, sha256: "" }))).toThrow(/SHA-256/);
    expect(() => validateDevManifest(manifestOf({ ...file, sha256: file.sha256.toUpperCase() }))).toThrow(/SHA-256/);
    expect(() => validateDevManifest(manifestOf({ ...file, bytes: 0 }))).toThrow(/impossible size/);
    expect(() => validateDevManifest(manifestOf({ ...file, name: "" }))).toThrow(/missing or repeated/);
    expect(() => validateDevManifest(manifestOf(file, { ...file }))).toThrow(/repeated/);
    expect(() => validateDevManifest({ id: "x", version: "1", files: [] })).toThrow(/empty or malformed/);
  });
});

describe("loadDevCaptionModels", () => {
  it("fetches the dev manifest first, then verifies every file it lists", async () => {
    const encoder = bytesOf(900, 1);
    const vad = bytesOf(300, 2);
    const manifest = manifestOf(devFile("encoder", encoder), devFile("vad", vad));
    const server = fakeServer(manifest, { [manifest.files[0].url]: encoder, [manifest.files[1].url]: vad });

    const source = await loadDevCaptionModels(depsFor(server.fetchImpl));
    expect(source?.manifest).toEqual(manifest);
    expect(server.calls.map((call) => call.url)).toEqual([MANIFEST_PATH]); // nothing else before the list is known

    const files = await source!.load(source!.manifest);
    expect(files.get("encoder")).toEqual(encoder);
    expect(files.get("vad")).toEqual(vad);
    expect(server.calls.map((call) => call.url)).toEqual([MANIFEST_PATH, manifest.files[0].url, manifest.files[1].url]);
  });

  it("sends no cookies, no referrer, no body, follows no redirect and asks for no stored copy", async () => {
    const encoder = bytesOf(120, 3);
    const manifest = manifestOf(devFile("encoder", encoder));
    const server = fakeServer(manifest, { [manifest.files[0].url]: encoder });

    const source = await loadDevCaptionModels(depsFor(server.fetchImpl));
    await source!.load(source!.manifest);

    for (const call of server.calls) {
      expect(call.init.method).toBe("GET");
      expect(call.init.body).toBeUndefined();
      expect(call.init.credentials).toBe("omit");
      expect(call.init.referrerPolicy).toBe("no-referrer");
      expect(call.init.redirect).toBe("error");
      expect(call.init.cache).toBe("no-store");
      // Only our own origin (the manifest) or a localhost /dev-models file: no other host is ever contacted.
      expect(call.url === MANIFEST_PATH || isDevModelUrl(call.url)).toBe(true);
    }
  });

  it("falls back silently (null) when the folder or the list is missing, contacting nothing else", async () => {
    const missing = fakeServer({}, {}, { manifestStatus: 404 });
    expect(await loadDevCaptionModels(depsFor(missing.fetchImpl))).toBeNull();
    expect(missing.calls).toHaveLength(1);

    const garbage = fakeServer("this is not a manifest");
    expect(await loadDevCaptionModels(depsFor(garbage.fetchImpl))).toBeNull();
    expect(garbage.calls).toHaveLength(1);

    const noHash = manifestOf({ name: "encoder", url: `${PAGE}/dev-models/encoder.onnx`, bytes: 10 } as ModelFile);
    const server = fakeServer(noHash, { [`${PAGE}/dev-models/encoder.onnx`]: bytesOf(10) });
    expect(await loadDevCaptionModels(depsFor(server.fetchImpl))).toBeNull();
    expect(server.calls).toHaveLength(1); // the invalid list is never used to download anything
  });

  it("falls back silently for a manifest that points anywhere but localhost /dev-models", async () => {
    const data = bytesOf(50);
    for (const url of ["http://evil.example/dev-models/m/x.bin", "https://models.cutmoor.com.evil.example/m/x.bin", "http://localhost:4180/other/m/x.bin"]) {
      const file: ModelFile = { name: "encoder", url, bytes: data.length, sha256: sha(data) };
      const server = fakeServer(manifestOf(file), { [url]: data });
      expect(await loadDevCaptionModels(depsFor(server.fetchImpl)), url).toBeNull();
      expect(server.calls.map((call) => call.url), url).toEqual([MANIFEST_PATH]);
    }
  });

  it("refuses bytes that do not match the pin and keeps nothing (fails closed)", async () => {
    const good = bytesOf(600, 4);
    const tampered = good.slice();
    tampered[0] ^= 0xff;
    const manifest = manifestOf(devFile("encoder", good));
    const server = fakeServer(manifest, { [manifest.files[0].url]: tampered });

    const source = await loadDevCaptionModels(depsFor(server.fetchImpl));
    await expect(source!.load(source!.manifest)).rejects.toMatchObject({ code: "integrity" });

    // The rejected bytes were not remembered: a fresh load with the right bytes succeeds.
    const honest = await loadDevCaptionModels(depsFor(fakeServer(manifest, { [manifest.files[0].url]: good }).fetchImpl));
    expect((await honest!.load(honest!.manifest)).get("encoder")).toEqual(good);
  });

  it("refuses a wrong-sized answer and an HTTP error", async () => {
    const good = bytesOf(600, 5);
    const manifest = manifestOf(devFile("encoder", good));
    const wrongSize = await loadDevCaptionModels(depsFor(fakeServer(manifest, { [manifest.files[0].url]: good.slice(0, 500) }).fetchImpl));
    await expect(wrongSize!.load(wrongSize!.manifest)).rejects.toMatchObject({ code: "size-mismatch" });

    const unreachable = await loadDevCaptionModels(depsFor(fakeServer(manifest).fetchImpl)); // the file is not served
    await expect(unreachable!.load(unreachable!.manifest)).rejects.toMatchObject({ code: "http" });
  });

  it("downloads a file once per page, so the engine and voice detector do not fetch it twice", async () => {
    const encoder = bytesOf(400, 6);
    const file = devFile("encoder", encoder);
    const manifest = manifestOf(file);
    const server = fakeServer(manifest, { [file.url]: encoder });

    const source = await loadDevCaptionModels(depsFor(server.fetchImpl));
    // The runtime splits the list per part; the same file can appear in two parts that both ask for it.
    const first = await source!.load(manifestOf(file));
    const second = await source!.load(manifestOf(file));
    expect(first.get("encoder")).toEqual(encoder);
    expect(second.get("encoder")).toEqual(encoder);
    expect(server.calls.filter((call) => call.url === file.url)).toHaveLength(1);
  });

  it("stops before touching the network when the job is cancelled", async () => {
    const encoder = bytesOf(100, 7);
    const manifest = manifestOf(devFile("encoder", encoder));
    const server = fakeServer(manifest, { [manifest.files[0].url]: encoder });
    const source = await loadDevCaptionModels(depsFor(server.fetchImpl));
    server.calls.length = 0;

    const controller = new AbortController();
    controller.abort();
    await expect(source!.load(source!.manifest, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(server.calls).toHaveLength(0);
  });

  it("never uses the ambient fetch: the injected one is the only way out", async () => {
    const ambient = vi.fn(() => {
      throw new Error("the dev loader must use the fetch it was given");
    });
    vi.stubGlobal("fetch", ambient);
    const encoder = bytesOf(90, 8);
    const manifest = manifestOf(devFile("encoder", encoder));
    const server = fakeServer(manifest, { [manifest.files[0].url]: encoder });
    const source = await loadDevCaptionModels(depsFor(server.fetchImpl));
    expect((await source!.load(source!.manifest)).get("encoder")).toEqual(encoder);
    expect(ambient).not.toHaveBeenCalled();
  });

  it("does nothing at all outside a development build", async () => {
    vi.stubEnv("DEV", false);
    const server = fakeServer(manifestOf(devFile("encoder", bytesOf(30))), {});
    expect(await loadDevCaptionModels(depsFor(server.fetchImpl))).toBeNull();
    expect(server.calls).toHaveLength(0);
  });
});

describe("the speech engine's own download path (dev folder, development builds only)", () => {
  // whisper-engine calls downloadModel directly, so the dev origin has to pass the production validator: this is
  // the regression that made /dev-models unable to load a dev engine, and the gate that must never open in a build.
  const engine = bytesOf(2048, 9);
  const file: ModelFile = { name: "encoder", url: `${PAGE}/dev-models/m/encoder.bin`, bytes: engine.length, sha256: sha(engine) };
  const manifest = manifestOf(file);
  const DEV_ORIGIN = PAGE; // http://localhost:4180, the page's own dev origin
  const PRODUCTION_HOST = "https://models.cutmoor.com";

  const deps = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) => ({ ...depsFor(fetchImpl), store: memoryStore() });

  it("downloads and verifies a dev engine file when the build is a development build and the origin is listed", async () => {
    const server = fakeServer({}, { [file.url]: engine });
    const result = await downloadModel(manifest, { allowedOrigins: [PRODUCTION_HOST, DEV_ORIGIN], deps: deps(server.fetchImpl), chunkBytes: 1024 });

    expect(result.get("encoder")).toEqual(engine);
    expect(server.calls).toHaveLength(1);
    const init = server.calls[0].init;
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
  });

  it("refuses the same localhost URL in a production build, before any request", async () => {
    vi.stubEnv("DEV", false);
    const server = fakeServer({}, { [file.url]: engine });

    await expect(
      downloadModel(manifest, { allowedOrigins: [PRODUCTION_HOST, DEV_ORIGIN], deps: deps(server.fetchImpl), chunkBytes: 1024 }),
    ).rejects.toMatchObject({ code: "disallowed-url" });
    expect(server.calls).toHaveLength(0); // rejected by the validator, not by a failed request
  });

  it("refuses a dev file whose origin was not listed, and any other http host", async () => {
    const server = fakeServer({}, { [file.url]: engine });
    await expect(downloadModel(manifest, { allowedOrigins: [PRODUCTION_HOST], deps: deps(server.fetchImpl), chunkBytes: 1024 })).rejects.toMatchObject({
      code: "disallowed-url",
    });
    expect(server.calls).toHaveLength(0);

    const elsewhere = manifestOf({ ...file, url: "http://evil.example/dev-models/encoder.bin" });
    await expect(
      downloadModel(elsewhere, { allowedOrigins: [PRODUCTION_HOST, "http://evil.example"], deps: deps(server.fetchImpl), chunkBytes: 1024 }),
    ).rejects.toMatchObject({ code: "disallowed-url" });
    expect(server.calls).toHaveLength(0);
  });

  it("still refuses dev bytes that do not match the pinned SHA-256", async () => {
    const tampered = engine.slice();
    tampered[0] ^= 0xff;
    const server = fakeServer({}, { [file.url]: tampered });

    await expect(
      downloadModel(manifest, { allowedOrigins: [PRODUCTION_HOST, DEV_ORIGIN], deps: deps(server.fetchImpl), chunkBytes: 1024 }),
    ).rejects.toMatchObject({ code: "integrity" });
  });
});
