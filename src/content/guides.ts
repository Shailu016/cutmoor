import type { GuideMeta } from "./types";

/**
 * The guide index: titles, descriptions, dates and tool links for every guide,
 * and nothing else. This is what the home page, the guide list, the tool pages
 * and the SEO helpers need, so it is all that ships with the main bundle. The
 * article text lives in guides/<slug>/body.ts and is loaded per guide (see
 * guide-content.ts), so adding a guide adds a few hundred bytes here, not the
 * whole article, to every page.
 *
 * To add a guide: `npm run new:guide -- <slug>`.
 */
const metas = import.meta.glob<GuideMeta>("./guides/*/meta.ts", { eager: true, import: "meta" });

export const GUIDES: GuideMeta[] = Object.values(metas).sort((a, b) => a.order - b.order);

export function guideBySlug(slug: string): GuideMeta | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

export function guidesByCategory(): { category: string; guides: GuideMeta[] }[] {
  const groups = new Map<string, GuideMeta[]>();
  for (const guide of GUIDES) {
    const list = groups.get(guide.category) ?? [];
    list.push(guide);
    groups.set(guide.category, list);
  }
  return [...groups.entries()].map(([category, guides]) => ({ category, guides }));
}
