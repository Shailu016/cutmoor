interface WakeLockHandle {
  release: () => Promise<void>;
}

/** Asks the device to keep the screen on during a job, where supported. Returns the function that stops asking. */
export function holdScreenAwake(): () => void {
  if (typeof document === "undefined" || typeof navigator === "undefined") return () => undefined;
  const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> } }).wakeLock;
  if (!wakeLock) return () => undefined;

  let active = true;
  let lock: WakeLockHandle | null = null;
  const request = () => {
    if (!active || document.visibilityState !== "visible") return;
    void wakeLock
      .request("screen")
      .then((next) => {
        lock = next;
        if (!active) void next.release().catch(() => undefined);
      })
      .catch(() => undefined);
  };
  // The browser drops the lock when the page is hidden, so ask again on return.
  document.addEventListener("visibilitychange", request);
  request();
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", request);
    void lock?.release().catch(() => undefined);
  };
}
