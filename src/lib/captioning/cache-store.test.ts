import { describe, expect, it } from "vitest";
import { createCacheStore, deleteAllStoredModels, MODEL_CACHE_NAME, type CacheLike, type CacheStorageLike } from "./cache-store";

function memoryStorage(options: { failPut?: boolean; failOpen?: boolean } = {}) {
  const entries = new Map<string, Uint8Array>();
  const requested: string[] = [];
  const cache: CacheLike = {
    async match(request) {
      requested.push(request);
      const hit = entries.get(request);
      return hit ? new Response(hit.slice().buffer as ArrayBuffer) : undefined;
    },
    async put(request, response) {
      if (options.failPut) throw new Error("QuotaExceededError");
      entries.set(request, new Uint8Array(await response.arrayBuffer()));
    },
    async delete(request) {
      return entries.delete(request);
    },
  };
  const storage: CacheStorageLike & { delete(name: string): Promise<boolean> } = {
    async open() {
      if (options.failOpen) throw new Error("SecurityError");
      return cache;
    },
    async delete() {
      const had = entries.size > 0;
      entries.clear();
      return had;
    },
  };
  return { storage, entries, requested };
}

const ORIGIN = "https://cutmoor.com";

describe("createCacheStore", () => {
  it("stores and returns the exact bytes", async () => {
    const { storage } = memoryStorage();
    const store = createCacheStore(storage, ORIGIN);
    const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255);
    await store.put("cutmoor-model/abc", data);
    expect(await store.get("cutmoor-model/abc")).toEqual(data);
  });

  it("returns null for something never stored", async () => {
    expect(await createCacheStore(memoryStorage().storage, ORIGIN).get("nope")).toBeNull();
  });

  it("keys entries under our own origin, never another host", async () => {
    const { storage, entries, requested } = memoryStorage();
    const store = createCacheStore(storage, `${ORIGIN}/`);
    await store.put("cutmoor-model/abc def", new Uint8Array([1]));
    await store.get("cutmoor-model/abc def");
    for (const url of [...entries.keys(), ...requested]) expect(new URL(url).origin).toBe(ORIGIN);
    expect([...entries.keys()][0]).toBe(`${ORIGIN}/__cutmoor-models/cutmoor-model%2Fabc%20def`);
  });

  it("deletes one entry", async () => {
    const { storage } = memoryStorage();
    const store = createCacheStore(storage, ORIGIN);
    await store.put("k", new Uint8Array([1]));
    expect(await store.delete("k")).toBe(true);
    expect(await store.get("k")).toBeNull();
    expect(await store.delete("k")).toBe(false);
  });

  it("copies the bytes it is given, so a caller reusing the buffer cannot change what was stored", async () => {
    const { storage } = memoryStorage();
    const store = createCacheStore(storage, ORIGIN);
    const data = new Uint8Array([1, 2, 3]);
    await store.put("k", data);
    data[0] = 99;
    expect(await store.get("k")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("treats a storage failure as 'not stored' instead of throwing", async () => {
    const quota = createCacheStore(memoryStorage({ failPut: true }).storage, ORIGIN);
    await expect(quota.put("k", new Uint8Array([1]))).resolves.toBeUndefined();
    expect(await quota.get("k")).toBeNull();
    const blocked = createCacheStore(memoryStorage({ failOpen: true }).storage, ORIGIN);
    expect(await blocked.get("k")).toBeNull();
    await expect(blocked.put("k", new Uint8Array([1]))).resolves.toBeUndefined();
    expect(await blocked.delete("k")).toBe(false);
  });
});

describe("deleteAllStoredModels", () => {
  it("drops the whole model cache by name", async () => {
    const names: string[] = [];
    expect(await deleteAllStoredModels({ delete: async (name) => (names.push(name), true) })).toBe(true);
    expect(names).toEqual([MODEL_CACHE_NAME]);
  });

  it("never throws", async () => {
    expect(await deleteAllStoredModels({ delete: async () => { throw new Error("blocked"); } })).toBe(false);
  });
});
