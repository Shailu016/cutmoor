/**
 * Release an object URL a moment after the media element using it is gone.
 *
 * Revoking at the exact moment an element is removed can race with that
 * element's last in-flight read, which makes the browser log a failed request.
 * A short delay lets the read finish or cancel first; the memory is held for
 * one extra second, which is nothing.
 */
export const BLOB_RELEASE_DELAY_MS = 1000;

export function releaseBlobUrl(url: string, delayMs = BLOB_RELEASE_DELAY_MS): void {
  if (typeof window === "undefined") {
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), delayMs);
}
