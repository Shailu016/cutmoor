import { GUIDES_A } from "./guides-a";
import { GUIDES_B } from "./guides-b";
import type { Guide } from "./types";

export const GUIDES: Guide[] = [...GUIDES_A, ...GUIDES_B];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

export function guidesByCategory(): { category: string; guides: Guide[] }[] {
  const groups = new Map<string, Guide[]>();
  for (const guide of GUIDES) {
    const list = groups.get(guide.category) ?? [];
    list.push(guide);
    groups.set(guide.category, list);
  }
  return [...groups.entries()].map(([category, guides]) => ({ category, guides }));
}
