import { useEffect, useState } from "react";
import type { GuideBody } from "./types";

/**
 * Guide article bodies. In the browser each body is its own chunk, fetched when
 * its guide is opened. During the build (server rendering) every body is primed
 * into the cache first, so each page is prerendered in full.
 */
const loaders = import.meta.glob<GuideBody>("./guides/*/body.ts", { import: "body" });

const cache = new Map<string, GuideBody>();
const pending = new Map<string, Promise<GuideBody | undefined>>();

const keyFor = (slug: string) => `./guides/${slug}/body.ts`;

/** Used by the server build to make every body available before rendering. */
export function primeGuideBodies(bodies: Record<string, GuideBody>): void {
  for (const [slug, body] of Object.entries(bodies)) cache.set(slug, body);
}

/** The body if it is already loaded. Never starts a download. */
export function getGuideBody(slug: string): GuideBody | undefined {
  return cache.get(slug);
}

export function loadGuideBody(slug: string): Promise<GuideBody | undefined> {
  const cached = cache.get(slug);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(slug);
  if (existing) return existing;
  const loader = loaders[keyFor(slug)];
  if (!loader) return Promise.resolve(undefined);
  const request = loader()
    .then((body) => {
      cache.set(slug, body);
      return body;
    })
    .catch(() => undefined)
    .finally(() => pending.delete(slug));
  pending.set(slug, request);
  return request;
}

/**
 * The body for a guide page. Already loaded (server render, or hydration after
 * the entry waited for it): returned on the first render, so markup matches.
 * Otherwise it loads and the page re-renders when it arrives.
 */
export function useGuideBody(slug: string): GuideBody | undefined {
  const [body, setBody] = useState<GuideBody | undefined>(() => getGuideBody(slug));

  useEffect(() => {
    let cancelled = false;
    const known = getGuideBody(slug);
    if (known) {
      setBody(known);
      return;
    }
    setBody(undefined);
    void loadGuideBody(slug).then((loaded) => {
      if (!cancelled) setBody(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return body;
}
