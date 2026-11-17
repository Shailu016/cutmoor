import { describe, expect, it } from "vitest";
import { crossesAdFreeBoundary, isAdFreePath } from "./ad-free";

describe("isAdFreePath", () => {
  it("is true for the captions page in every URL form", () => {
    for (const path of ["/tools/auto-captions", "/tools/auto-captions/", "/tools/auto-captions/?captions-test", "/tools/auto-captions#editor", "/tools/auto-captions/sub"]) {
      expect(isAdFreePath(path), path).toBe(true);
    }
  });

  it("is false for every other page, including look-alikes", () => {
    for (const path of ["/", "/tools", "/tools/", "/tools/compress/", "/tools/auto-captions-extra", "/tools/captions/", "/guides/", "/tools/auto-caption"]) {
      expect(isAdFreePath(path), path).toBe(false);
    }
  });
});

describe("crossesAdFreeBoundary", () => {
  it("is true only when one side is the captions page and the other is not", () => {
    expect(crossesAdFreeBoundary("/tools/compress/", "/tools/auto-captions/")).toBe(true);
    expect(crossesAdFreeBoundary("/tools/auto-captions/", "/guides/")).toBe(true);
    expect(crossesAdFreeBoundary("/tools/auto-captions/", "/tools/auto-captions/?captions-test")).toBe(false);
    expect(crossesAdFreeBoundary("/tools/compress/", "/guides/")).toBe(false);
  });
});
