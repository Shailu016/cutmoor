import { describe, expect, it } from "vitest";
import { TOOLS } from "../lib/tools";
import { relatedGuides, toolsForGuide } from "./guide-helpers";
import { GUIDES } from "./guides";

describe("guide data", () => {
  it("has unique slugs", () => {
    const slugs = GUIDES.map((guide) => guide.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("links every guide to at least one real tool", () => {
    const toolSlugs = new Set(TOOLS.map((tool) => tool.slug));
    for (const guide of GUIDES) {
      expect(guide.tools.length, guide.slug).toBeGreaterThan(0);
      for (const slug of guide.tools) {
        expect(toolSlugs.has(slug), `${guide.slug} -> ${slug}`).toBe(true);
      }
    }
  });

  it("resolves every declared tool without dropping any", () => {
    for (const guide of GUIDES) {
      expect(toolsForGuide(guide, TOOLS).length, guide.slug).toBe(guide.tools.length);
    }
  });

  it("keeps image guides on image tools and video guides on video tools", () => {
    const imageGuides = ["social-media-image-sizes", "png-vs-jpg-vs-webp", "compress-image-without-visible-quality-loss", "heic-to-jpg-guide"];
    const videoGuides = ["compress-video-for-whatsapp", "trim-video-online", "extract-audio-from-video", "convert-srt-to-vtt"];

    for (const slug of imageGuides) {
      const guide = GUIDES.find((item) => item.slug === slug);
      expect(guide, slug).toBeDefined();
      for (const tool of toolsForGuide(guide!, TOOLS)) {
        expect(tool.kind, `${slug} -> ${tool.slug}`).toBe("image");
      }
    }

    for (const slug of videoGuides) {
      const guide = GUIDES.find((item) => item.slug === slug);
      expect(guide, slug).toBeDefined();
      for (const tool of toolsForGuide(guide!, TOOLS)) {
        expect(tool.kind, `${slug} -> ${tool.slug}`).toBe("video");
      }
    }
  });
});

describe("relatedGuides", () => {
  it("never returns the current guide", () => {
    for (const guide of GUIDES) {
      const related = relatedGuides(guide, GUIDES, TOOLS);
      expect(related.some((item) => item.slug === guide.slug), guide.slug).toBe(false);
    }
  });

  it("prefers guides in the same medium and category", () => {
    const guide = GUIDES.find((item) => item.slug === "heic-to-jpg-guide")!;
    const related = relatedGuides(guide, GUIDES, TOOLS, 3);
    const relatedImage = related.filter((item) =>
      toolsForGuide(item, TOOLS).every((tool) => tool.kind === "image"),
    );
    expect(relatedImage.length).toBeGreaterThan(0);
  });

  it("keeps an image guide among image guides", () => {
    const guide = GUIDES.find((item) => item.slug === "social-media-image-sizes")!;
    const related = relatedGuides(guide, GUIDES, TOOLS, 3);
    expect(
      toolsForGuide(related[0], TOOLS).every((tool) => tool.kind === "image"),
      related[0].slug,
    ).toBe(true);
  });

  it("respects the requested limit", () => {
    const guide = GUIDES[0];
    expect(relatedGuides(guide, GUIDES, TOOLS, 2).length).toBe(2);
  });
});
