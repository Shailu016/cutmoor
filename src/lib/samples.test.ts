import { statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_CLIP, SAMPLE_PHOTO, sampleClipUrl, samplePhotoUrl } from "./samples";

describe("sample clip", () => {
  it("matches the real file on disk", () => {
    const file = resolve(__dirname, "../../public", SAMPLE_CLIP.path);
    expect(statSync(file).size).toBe(SAMPLE_CLIP.bytes);
  });

  it("matches the sample photo on disk", () => {
    const file = resolve(__dirname, "../../public", SAMPLE_PHOTO.path);
    expect(statSync(file).size).toBe(SAMPLE_PHOTO.bytes);
    expect(samplePhotoUrl("/")).toBe("/samples/sample-photo.jpg");
  });

  it("is small enough for a quick demo", () => {
    expect(SAMPLE_CLIP.bytes).toBeLessThan(5 * 1024 * 1024);
  });

  it("builds a URL under the app base", () => {
    expect(sampleClipUrl("/")).toBe("/samples/sample-clip.mp4");
  });
});
