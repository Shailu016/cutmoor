import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caption } from "../components/home/ShowcaseCard";
import { cardPicture } from "./card-art";
import { CARD_ART } from "./card-art.generated";
import { MEDIA_VERSION } from "./samples";
import { TOOLS } from "./tools";

/** The pictures on the home-page cards are real tool output (scripts/make-card-art.mjs). These tests keep the data and the files in step. */

const picturePath = (slug: string, name: string) => resolve(process.cwd(), "public", "cards", `${slug}-${name}.webp`);

describe("home-page card art", () => {
  const entries = Object.entries(CARD_ART);

  it("has art for at least the twelve cards on the home page", () => {
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  it.each(entries)("%s is a real tool", (slug) => {
    expect(TOOLS.some((tool) => tool.slug === slug)).toBe(true);
  });

  it.each(entries)("%s has its picture files on disk, and they are not empty", (slug, art) => {
    const names = art.mode === "strip" ? ["before-strip", "after-strip"] : art.mode === "frames" ? ["frames"] : ["before", "after"];
    for (const name of names) {
      const path = picturePath(slug, name);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(1500);
      // WebP: "RIFF....WEBP"
      const head = readFileSync(path).subarray(0, 12);
      expect(head.toString("latin1", 0, 4)).toBe("RIFF");
      expect(head.toString("latin1", 8, 12)).toBe("WEBP");
    }
  });

  it.each(entries)("%s carries real, sensible numbers", (_slug, art) => {
    if (art.mode === "frames") {
      // The Auto captions card shows frames of the tool's live preview: there is no output file to measure.
      expect(art.frames).toBeGreaterThan(1);
      expect(art.sampleText?.length).toBeGreaterThan(10);
    } else {
      expect(art.beforeBytes).toBeGreaterThan(0);
      expect(art.afterBytes).toBeGreaterThan(0);
    }
    for (const side of [art.before, art.after]) {
      expect(side.w).toBeGreaterThan(0);
      expect(side.h).toBeGreaterThan(0);
    }
    if (art.mode === "strip") {
      expect(art.before.duration).toBeGreaterThan(0);
      expect(art.after.duration).toBeGreaterThan(0);
    }
    if (art.keep) {
      const [from, to] = art.keep;
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThan(from);
      expect(to).toBeLessThanOrEqual(art.before.duration ?? 0);
    }
  });

  it.each(entries)("%s has a caption that says something true and contains no placeholder text", (slug, art) => {
    const text = caption(slug, art);
    expect(text.length).toBeGreaterThan(8);
    expect(text).not.toMatch(/NaN|undefined|null|Infinity/);
  });

  it("states the saving on the size cards exactly as the files measure it", () => {
    const art = CARD_ART["compress-image"];
    const saved = Math.round((1 - art.afterBytes / art.beforeBytes) * 100);
    expect(caption("compress-image", art)).toContain(`${saved}%`);
  });

  it("has an Auto captions card and no GIF to MP4 card on the home page", () => {
    expect(CARD_ART["auto-captions"]?.mode).toBe("frames");
    expect(CARD_ART["gif-to-mp4"]).toBeUndefined();
  });

  it("builds picture addresses that carry the media version", () => {
    expect(cardPicture("compress", "after")).toBe(`/cards/compress-after.webp?v=${MEDIA_VERSION}`);
  });
});
