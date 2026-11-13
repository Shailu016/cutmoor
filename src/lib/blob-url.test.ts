import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOB_RELEASE_DELAY_MS, releaseBlobUrl } from "./blob-url";

describe("releaseBlobUrl", () => {
  let revoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does not implement object URLs, so install a stand-in.
    revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not revoke immediately", () => {
    releaseBlobUrl("blob:one");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes after the delay", () => {
    releaseBlobUrl("blob:one");
    vi.advanceTimersByTime(BLOB_RELEASE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith("blob:one");
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("releases each URL exactly once", () => {
    releaseBlobUrl("blob:a");
    releaseBlobUrl("blob:b", 10);
    vi.advanceTimersByTime(BLOB_RELEASE_DELAY_MS);
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
