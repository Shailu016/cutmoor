import type { GuideBody, GuideMeta } from "./types";
import { GUIDES } from "./guides";

/**
 * Every guide, whole. Imported only by the server build (prerendering) and by
 * tests, never by code that ships to the browser: it pulls in every article.
 */
const bodies = import.meta.glob<GuideBody>("./guides/*/body.ts", { eager: true, import: "body" });

export const GUIDE_BODIES: Record<string, GuideBody> = Object.fromEntries(
  Object.entries(bodies).map(([path, body]) => [path.match(/guides\/([^/]+)\/body\.ts$/)![1], body]),
);

export const GUIDES_FULL: (GuideMeta & GuideBody)[] = GUIDES.map((guide) => ({ ...guide, ...GUIDE_BODIES[guide.slug] }));
