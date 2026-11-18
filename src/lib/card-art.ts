import { MEDIA_VERSION } from "./samples";

/**
 * Address of a home-page card picture. The ?v= makes browsers and the edge cache fetch new pictures straight away after
 * they are re-made (raise MEDIA_VERSION in samples.ts when you re-run scripts/make-card-art.mjs).
 */
export function cardPicture(slug: string, name: string): string {
  return `/cards/${slug}-${name}.webp?v=${MEDIA_VERSION}`;
}
