import type { ToolDef } from "../lib/tools";
import type { GuideMeta } from "./types";

/**
 * Guides declare the tools they should promote. Keeping the mapping explicit
 * avoids the old substring heuristic, where an image guide such as
 * "social-media-image-sizes" was matched by the word "size" and sent readers
 * to the video crop tool.
 */
export function toolsForGuide(guide: GuideMeta, tools: ToolDef[]): ToolDef[] {
  return guide.tools
    .map((slug) => tools.find((tool) => tool.slug === slug))
    .filter((tool): tool is ToolDef => Boolean(tool));
}

/** Prefer guides in the same medium, then the same category, then the rest. */
export function relatedGuides(guide: GuideMeta, guides: GuideMeta[], tools: ToolDef[], limit = 3): GuideMeta[] {
  const kindsFor = (item: GuideMeta) => new Set(toolsForGuide(item, tools).map((tool) => tool.kind));
  const current = kindsFor(guide);
  const score = (candidate: GuideMeta) => {
    const candidateKinds = kindsFor(candidate);
    const sameMedium =
      current.size === 1 &&
      candidateKinds.size === 1 &&
      [...current][0] === [...candidateKinds][0];
    const sameCategory = candidate.category === guide.category;
    return (sameMedium ? 2 : 0) + (sameCategory ? 1 : 0);
  };

  return guides
    .filter((item) => item.slug !== guide.slug)
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
