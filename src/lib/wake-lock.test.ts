import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdScreenAwake } from "./wake-lock";

interface WakeLockHandle {
  release: () => Promise<void>;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockHandle>;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setVisible(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
}

function wakeLockWith(request: WakeLockLike["request"]): void {
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
}

let stop: (() => void) | null = null;

beforeEach(() => {
  stop = null;
  setVisible(true);
});

afterEach(() => {
  stop?.();
  stop = null;
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("holdScreenAwake", () => {
  it("does nothing, safely, when the browser has no wake lock API", () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    stop = holdScreenAwake();
    expect(() => stop?.()).not.toThrow();
  });

  it("asks the device for a screen lock", () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    wakeLockWith(request);

    stop = holdScreenAwake();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("does not ask while the page is hidden, and asks again when it is visible", async () => {
    setVisible(false);
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    wakeLockWith(request);

    stop = holdScreenAwake();
    expect(request).not.toHaveBeenCalled();

    setVisible(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);

    // A second return to the tab asks again: the browser drops the old lock while hidden.
    setVisible(false);
    document.dispatchEvent(new Event("visibilitychange"));
    setVisible(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops asking and releases the lock when the job ends", async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    wakeLockWith(request);

    const releaseScreen = holdScreenAwake();
    await flush();
    expect(release).not.toHaveBeenCalled();

    releaseScreen();
    expect(release).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after the job already ended", async () => {
    let resolveRequest!: (lock: WakeLockHandle) => void;
    const release = vi.fn(async () => undefined);
    const request = vi.fn(
      () =>
        new Promise<WakeLockHandle>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    wakeLockWith(request);

    const releaseScreen = holdScreenAwake();
    releaseScreen();
    resolveRequest({ release });
    await flush();

    expect(release).toHaveBeenCalledTimes(1);
  });
});
