import { describe, expect, it } from "vitest";
import { INDEXABLE_PAGES } from "./seo";

describe("search snippets", () => {
  // Search results cut titles at roughly 60 characters and descriptions at roughly 160.
  for (const page of INDEXABLE_PAGES) {
    it(`${page.path} fits in a search result`, () => {
      expect(page.title.length, page.title).toBeLessThanOrEqual(60);
      expect(page.description.length, page.description).toBeLessThanOrEqual(160);
    });
  }

  it("gives every page its own title and description", () => {
    expect(new Set(INDEXABLE_PAGES.map((page) => page.title)).size).toBe(INDEXABLE_PAGES.length);
    expect(new Set(INDEXABLE_PAGES.map((page) => page.description)).size).toBe(INDEXABLE_PAGES.length);
  });
});
