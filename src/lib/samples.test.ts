import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MEDIA_VERSION, SAMPLE_CLIP, SAMPLE_PHOTO, sampleClipUrl, samplePhotoUrl } from "./samples";

/** Reads the facts out of an MP4's own header (no decoder needed). */
function readMp4(bytes: Buffer) {
  const facts = { width: 0, height: 0, seconds: 0, hasAudio: false, hasVideo: false };
  const CONTAINERS = new Set(["moov", "trak", "mdia"]);
  const walk = (start: number, end: number) => {
    let at = start;
    while (at + 8 <= end) {
      const size = bytes.readUInt32BE(at);
      const type = bytes.toString("latin1", at + 4, at + 8);
      if (size < 8) return;
      const body = at + 8;
      if (CONTAINERS.has(type)) walk(body, at + size);
      else if (type === "mvhd") {
        const version = bytes[body];
        const scaleAt = body + (version === 1 ? 20 : 12);
        const timescale = bytes.readUInt32BE(scaleAt);
        const duration = version === 1 ? Number(bytes.readBigUInt64BE(scaleAt + 4)) : bytes.readUInt32BE(scaleAt + 4);
        facts.seconds = duration / timescale;
      } else if (type === "tkhd") {
        const version = bytes[body];
        const sizeAt = body + (version === 1 ? 88 : 76);
        const width = bytes.readUInt32BE(sizeAt) / 65536;
        const height = bytes.readUInt32BE(sizeAt + 4) / 65536;
        if (width > 0) {
          facts.width = width;
          facts.height = height;
        }
      } else if (type === "hdlr") {
        const handler = bytes.toString("latin1", body + 8, body + 12);
        if (handler === "soun") facts.hasAudio = true;
        if (handler === "vide") facts.hasVideo = true;
      }
      at += size;
    }
  };
  walk(0, bytes.length);
  return facts;
}

describe("sample clip", () => {
  it("has the size, length and audio that samples.ts says it has", () => {
    const facts = readMp4(readFileSync(resolve(__dirname, "../../public", SAMPLE_CLIP.path)));
    expect(facts.hasVideo).toBe(true);
    expect(facts.width).toBe(SAMPLE_CLIP.width);
    expect(facts.height).toBe(SAMPLE_CLIP.height);
    expect(facts.hasAudio).toBe(SAMPLE_CLIP.hasAudio);
    expect(Math.abs(facts.seconds - SAMPLE_CLIP.durationSeconds)).toBeLessThan(0.25);
  });

  it("matches the real file on disk", () => {
    const file = resolve(__dirname, "../../public", SAMPLE_CLIP.path);
    expect(statSync(file).size).toBe(SAMPLE_CLIP.bytes);
  });

  it("matches the sample photo on disk", () => {
    const file = resolve(__dirname, "../../public", SAMPLE_PHOTO.path);
    expect(statSync(file).size).toBe(SAMPLE_PHOTO.bytes);
    expect(samplePhotoUrl("/")).toBe(`/samples/sample-photo.jpg?v=${MEDIA_VERSION}`);
  });

  it("is small enough for a quick demo", () => {
    expect(SAMPLE_CLIP.bytes).toBeLessThan(5 * 1024 * 1024);
  });

  it("builds a URL under the app base", () => {
    expect(sampleClipUrl("/")).toBe(`/samples/sample-clip.mp4?v=${MEDIA_VERSION}`);
  });
});
