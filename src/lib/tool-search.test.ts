import { describe, expect, it } from "vitest";
import { matchesSearch, searchTools, searchWords } from "./tool-search";
import { TOOLS } from "./tools";

const find = (query: string) => TOOLS.filter((tool) => matchesSearch(tool, searchWords(query))).map((tool) => tool.slug);

describe("searchWords", () => {
  it("drops filler words and unifies spellings", () => {
    expect(searchWords("How to make a JPEG from the photo")).toEqual(["jpg", "image"]);
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("tool search", () => {
  it("matches everything for an empty search", () => {
    expect(find("").length).toBe(TOOLS.length);
  });

  it("finds a tool by words in any order", () => {
    expect(find("video compress")).toContain("compress");
    expect(find("compress video")).toContain("compress");
  });

  const cases: Array<[string, string]> = [
    ["make video smaller", "compress"],
    ["jpeg to png", "jpg-to-png"],
    ["remove sound", "mute-video"],
    ["join clips", "merge-videos"],
    ["combine videos", "merge-videos"],
    ["gif to video", "gif-to-mp4"],
    ["remove location from photo", "remove-photo-metadata"],
    ["exif", "remove-photo-metadata"],
    ["blur face", "blur-image"],
    ["censor picture", "blur-image"],
    ["add logo to video", "watermark-video"],
    ["slow motion", "video-speed"],
    ["play backwards", "reverse-video"],
    ["flip video", "rotate-video"],
    ["iphone photo", "heic-to-jpg"],
    ["webp", "webp-to-jpg"],
    ["circle crop", "crop-image"],
    ["add music", "add-audio-to-video"],
    ["slideshow", "slideshow-maker"],
    ["subtitles", "captions"],
    ["transcribe video", "auto-captions"],
    ["mp3", "audio"],
    ["thumbnail", "frame"],
    ["9:16", "resize"],
  ];
  for (const [query, slug] of cases) {
    it(`"${query}" finds ${slug}`, () => {
      expect(find(query)).toContain(slug);
    });
  }

  it("finds nothing for words no tool has", () => {
    expect(find("spreadsheet invoice")).toEqual([]);
  });

  const best = (query: string) => searchTools(TOOLS, query).map((tool) => tool.slug);

  it("gives one tool for a phrase that names one job", () => {
    expect(best("remove sound")).toEqual(["mute-video"]);
    expect(best("how to remove audio from video")).toEqual(["mute-video"]);
    expect(best("remove location from photo")).toEqual(["remove-photo-metadata"]);
    expect(best("extract audio")).toEqual(["audio"]);
    expect(best("slow motion")).toEqual(["video-speed"]);
  });

  it("goes straight to a conversion page that exists", () => {
    expect(best("jpeg to png")).toEqual(["jpg-to-png"]);
    expect(best("WebP to JPG")).toEqual(["webp-to-jpg"]);
    expect(best("gif to mp4")).toEqual(["gif-to-mp4"]);
  });

  it("puts tools named after the words ahead of tools that only mention them", () => {
    expect(best("merge")[0]).toBe("merge-videos");
    expect(best("crop image")[0]).toBe("crop-image");
    expect(best("watermark video")[0]).toBe("watermark-video");
    expect(best("compress gif")[0]).toBe("compress-gif");
  });

  it("returns every tool for an empty search, in order", () => {
    expect(best("   ")).toEqual(TOOLS.map((tool) => tool.slug));
  });

  it("narrows as words are added", () => {
    expect(find("gif").length).toBeGreaterThan(find("gif resize").length);
    expect(find("gif resize")).toContain("resize-gif");
  });
});
