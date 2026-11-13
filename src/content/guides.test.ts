import { describe, expect, it } from "vitest";
import { TOOLS } from "../lib/tools";
import { relatedGuides, toolsForGuide } from "./guide-helpers";
import { GUIDES } from "./guides";
import { GUIDES_FULL, GUIDE_BODIES } from "./guides.server";

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
    const imageGuides = ["social-media-image-sizes", "png-vs-jpg-vs-webp", "compress-image-without-visible-quality-loss", "heic-to-jpg-guide", "resize-image-without-losing-quality"];
    const videoGuides = ["compress-video-for-whatsapp", "trim-video-online", "extract-audio-from-video", "convert-srt-to-vtt", "convert-video-to-gif", "extract-frame-from-video"];

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

describe("guide files", () => {
  it("gives every guide in the index an article, and every article a place in the index", () => {
    const indexed = GUIDES.map((guide) => guide.slug).sort();
    expect(Object.keys(GUIDE_BODIES).sort()).toEqual(indexed);
  });

  it("orders guides with unique, positive numbers", () => {
    const orders = GUIDES.map((guide) => guide.order);
    expect(new Set(orders).size).toBe(orders.length);
    for (const order of orders) expect(order).toBeGreaterThan(0);
    expect(GUIDES.map((guide) => guide.order)).toEqual([...orders].sort((a, b) => a - b));
  });

  it("keeps the index free of article text", () => {
    for (const guide of GUIDES) {
      expect(guide, guide.slug).not.toHaveProperty("sections");
      expect(guide, guide.slug).not.toHaveProperty("faqs");
    }
  });

  it("has a real article for every guide", () => {
    for (const guide of GUIDES_FULL) {
      expect(guide.sections.length, guide.slug).toBeGreaterThanOrEqual(3);
      for (const section of guide.sections) {
        expect(section.heading, guide.slug).toBeTruthy();
        expect(section.paragraphs.length, `${guide.slug}: ${section.heading}`).toBeGreaterThan(0);
      }
    }
  });

  it("never repeats a section heading inside one guide (headings become anchor links)", () => {
    for (const guide of GUIDES_FULL) {
      const headings = guide.sections.map((section) => section.heading);
      expect(new Set(headings).size, guide.slug).toBe(headings.length);
    }
  });

  it("answers every question it asks", () => {
    for (const guide of GUIDES_FULL) {
      for (const faq of guide.faqs) {
        expect(faq.question.trim().endsWith("?"), `${guide.slug}: ${faq.question}`).toBe(true);
        expect(faq.answer.trim().length, `${guide.slug}: ${faq.question}`).toBeGreaterThan(40);
      }
    }
  });

  it("keeps titles and descriptions inside search-result limits", () => {
    for (const guide of GUIDES) {
      expect(guide.description.length, guide.slug).toBeLessThanOrEqual(300);
      expect(guide.excerpt.length, guide.slug).toBeLessThanOrEqual(260);
      expect(guide.published <= guide.modified, `${guide.slug}: modified before published`).toBe(true);
    }
  });

  it("has no unfinished TODO left over from the scaffolder", () => {
    for (const guide of GUIDES_FULL) {
      expect(JSON.stringify(guide), guide.slug).not.toContain("TODO");
    }
  });
});
