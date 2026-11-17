import { describe, expect, it } from "vitest";
import { hasMoreTool } from "../tools/more/registry";
import { TOOL_CATEGORIES, TOOLS, toolsInCategory } from "./tools";

const MODEL_TOOLS_PENDING = new Set<string>();

describe("tool list", () => {
  it("has a unique slug for every tool", () => {
    const slugs = TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("puts every tool in exactly one category, of its own kind", () => {
    const seen = new Map<string, string>();
    for (const category of TOOL_CATEGORIES) {
      for (const slug of category.slugs) {
        expect(seen.has(slug), `${slug} is in two categories`).toBe(false);
        seen.set(slug, category.id);
        const tool = TOOLS.find((item) => item.slug === slug);
        if (tool) expect(tool.kind, `${slug} is ${tool.kind} but sits in ${category.id}`).toBe(category.kind);
      }
    }
    for (const tool of TOOLS) expect(seen.has(tool.slug), `${tool.slug} has no category`).toBe(true);
  });

  it("lists a category's tools in its own order", () => {
    for (const category of TOOL_CATEGORIES) {
      expect(toolsInCategory(category).map((tool) => tool.slug)).toEqual(category.slugs.filter((slug) => TOOLS.some((tool) => tool.slug === slug)));
    }
  });
});

describe("every tool page has what search needs", () => {
  for (const tool of TOOLS) {
    it(`${tool.slug}: title, description, steps, questions and links`, () => {
      expect(tool.title.length, "title length").toBeLessThanOrEqual(65);
      expect(tool.title.length, "title length").toBeGreaterThanOrEqual(25);
      expect(tool.description.length, "description length").toBeLessThanOrEqual(300);
      expect(tool.description.length, "description length").toBeGreaterThanOrEqual(90);
      expect(tool.intro.length).toBeGreaterThan(120);
      expect(tool.keywords.length).toBeGreaterThanOrEqual(3);
      expect(tool.steps.length).toBeGreaterThanOrEqual(3);
      expect(tool.faqs.length).toBeGreaterThanOrEqual(3);
      for (const faq of tool.faqs) {
        expect(faq.question.endsWith("?"), `${tool.slug}: ${faq.question}`).toBe(true);
        expect(faq.answer.length).toBeGreaterThan(40);
      }
      for (const slug of tool.related) expect(TOOLS.some((item) => item.slug === slug), `${tool.slug} links to missing ${slug}`).toBe(true);
      expect(tool.related).not.toContain(tool.slug);
    });
  }

  it("keeps the names and titles different, so no two pages compete for one search", () => {
    expect(new Set(TOOLS.map((tool) => tool.title)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });
});

describe("every tool has a page to show", () => {
  const BUILT_IN = new Set(["compress", "resize", "trim", "convert", "audio", "frame", "captions", "auto-captions", "compress-image", "resize-image", "convert-image", "heic-to-jpg"]);
  for (const tool of TOOLS) {
    it(`${tool.slug} is wired to a component`, () => {
      if (MODEL_TOOLS_PENDING.has(tool.slug)) return;
      expect(BUILT_IN.has(tool.slug) || hasMoreTool(tool.slug), `${tool.slug} has no component`).toBe(true);
    });
  }
});
