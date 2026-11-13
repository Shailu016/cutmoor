import { describe, expect, it } from "vitest";
import { canonicalPath } from "./paths";

describe("canonicalPath", () => {
  it("adds the trailing slash pages are served at", () => {
    expect(canonicalPath("/tools")).toBe("/tools/");
    expect(canonicalPath("/tools/compress")).toBe("/tools/compress/");
  });

  it("leaves the home page and already-canonical paths alone", () => {
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("/guides/")).toBe("/guides/");
  });

  it("keeps the hash and query in place", () => {
    expect(canonicalPath("/tools#image-tools")).toBe("/tools/#image-tools");
    expect(canonicalPath("/tools/compress?size=10")).toBe("/tools/compress/?size=10");
    expect(canonicalPath("/#tools")).toBe("/#tools");
  });

  it("does not touch files, other sites or in-page anchors", () => {
    expect(canonicalPath("/feed.xml")).toBe("/feed.xml");
    expect(canonicalPath("https://example.com/a")).toBe("https://example.com/a");
    expect(canonicalPath("//example.com/a")).toBe("//example.com/a");
    expect(canonicalPath("#faq")).toBe("#faq");
    expect(canonicalPath("mailto:hello@cutmoor.com")).toBe("mailto:hello@cutmoor.com");
  });
});
