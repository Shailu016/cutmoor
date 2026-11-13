import { useEffect, useState } from "react";

/**
 * True once the page has finished loading and the browser is idle. Use it to
 * hold back optional work (like starting a video) so it never competes with the
 * resources that decide how fast the page appears. False on the server.
 */
export function useAfterLoadIdle(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const whenIdle = () => {
      const idle =
        (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback ??
        ((callback: () => void) => window.setTimeout(callback, 1200));
      idle(
        () => {
          if (!cancelled) setReady(true);
        },
        { timeout: 3000 },
      );
    };

    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", whenIdle);
    };
  }, []);

  return ready;
}
