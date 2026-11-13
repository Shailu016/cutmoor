import { describe, expect, it } from "vitest";
import { TOOLS } from "./tools";
import { compatForTool, summarizeFormats, TOOL_COMPAT, type FormatEntry } from "./formats";

describe("format compatibility table", () => {
  it("covers every tool, and only real tools", () => {
    const slugs = TOOLS.map((tool) => tool.slug).sort();
    expect(Object.keys(TOOL_COMPAT).sort()).toEqual(slugs);
  });

  it("gives every tool at least one supported input and output", () => {
    for (const tool of TOOLS) {
      const compat = compatForTool(tool.slug)!;
      expect(compat.inputs.some((entry) => entry.status === "supported"), `${tool.slug} inputs`).toBe(true);
      expect(compat.outputs.some((entry) => entry.status === "supported"), `${tool.slug} outputs`).toBe(true);
    }
  });

  it("explains every limited or unsupported entry", () => {
    for (const [slug, compat] of Object.entries(TOOL_COMPAT)) {
      for (const entry of [...compat.inputs, ...compat.outputs]) {
        if (entry.status !== "supported") {
          expect(entry.note, `${slug}: ${entry.label}`).toBeTruthy();
        }
      }
    }
  });

  it("never marks something supported while saying it is unverified", () => {
    for (const [slug, compat] of Object.entries(TOOL_COMPAT)) {
      for (const entry of [...compat.inputs, ...compat.outputs]) {
        if (entry.status === "supported") {
          expect(entry.note ?? "", `${slug}: ${entry.label}`).not.toMatch(/not verified|not tested/i);
        }
      }
    }
  });

  it("does not offer the VP9 encoder that crashes", () => {
    const convert = compatForTool("convert")!;
    const vp9 = convert.outputs.find((entry) => entry.label.includes("VP9"));
    expect(vp9?.status).toBe("unsupported");
  });

  it("has the documentation fields every tool needs", () => {
    for (const [slug, compat] of Object.entries(TOOL_COMPAT)) {
      expect(compat.maxTested, slug).toBeTruthy();
      expect(compat.resolutions, slug).toBeTruthy();
      expect(compat.codecs, slug).toBeTruthy();
      expect(compat.metadata, slug).toBeTruthy();
      expect(compat.limitations.length, slug).toBeGreaterThan(0);
    }
  });
});

describe("summarizeFormats", () => {
  it("merges tools without repeating a format", () => {
    const entries: FormatEntry[] = summarizeFormats(["compress", "trim", "convert"], "inputs");
    const labels = entries.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("MP4 (H.264 + AAC)");
  });

  it("returns outputs from every tool in the group", () => {
    const labels = summarizeFormats(["convert", "frame"], "outputs").map((entry) => entry.label);
    expect(labels).toContain("GIF");
    expect(labels).toContain("PNG");
  });
});
