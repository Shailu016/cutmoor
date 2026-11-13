import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRemoteBase, verifiedBlobURL } from "./ffmpeg";

const BODY = new TextEncoder().encode("pretend this is the encoder");
const GOOD = createHash("sha256").update(BODY).digest("base64");

describe("verifiedBlobURL", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(BODY));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:verified");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a remote file whose fingerprint matches", async () => {
    await expect(verifiedBlobURL("https://cdn.test/core.js", "text/javascript", GOOD, { required: true })).resolves.toBe("blob:verified");
  });

  it("refuses a remote file whose fingerprint differs", async () => {
    await expect(verifiedBlobURL("https://cdn.test/core.js", "text/javascript", "AAAA", { required: true })).rejects.toThrow(/integrity check/);
  });

  it("refuses a remote file when no fingerprint was pinned, without downloading it", async () => {
    await expect(verifiedBlobURL("https://cdn.test/core.js", "text/javascript", undefined, { required: true })).rejects.toThrow(/could not be verified/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a remote file when the browser cannot compute SHA-256", async () => {
    vi.stubGlobal("crypto", {});
    await expect(verifiedBlobURL("https://cdn.test/core.js", "text/javascript", GOOD, { required: true })).rejects.toThrow(/cannot verify/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a same-origin copy without a pin", async () => {
    await expect(verifiedBlobURL("/ffmpeg/core.js", "text/javascript", undefined, { required: false })).resolves.toBe("blob:verified");
  });
});

describe("isRemoteBase", () => {
  it("treats a CDN as remote and the site's own path as local", () => {
    expect(isRemoteBase("https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm", "https://cutmoor.com")).toBe(true);
    expect(isRemoteBase("/ffmpeg", "https://cutmoor.com")).toBe(false);
    expect(isRemoteBase("https://cutmoor.com/ffmpeg", "https://cutmoor.com")).toBe(false);
  });
});
