import { describe, expect, it } from "vitest";
import { captionFileName, formatClock } from "./time";

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(65_999)).toBe("1:05"); // seconds are floored, never rounded up past the real time
    expect(formatClock(600_000)).toBe("10:00");
  });
  it("adds hours for long files", () => {
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
  it("shows milliseconds when precise", () => {
    expect(formatClock(65_250, true)).toBe("1:05.250");
    expect(formatClock(7, true)).toBe("0:00.007");
  });
  it("copes with bad input", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("captionFileName", () => {
  it("swaps the extension and marks the file as captions", () => {
    expect(captionFileName("holiday.mp4", "srt")).toBe("holiday-captions.srt");
    expect(captionFileName("a.b.c.mov", "vtt")).toBe("a.b.c-captions.vtt");
  });
  it("handles names without an extension, and characters Windows forbids", () => {
    expect(captionFileName("clip", "json")).toBe("clip-captions.json");
    expect(captionFileName('we"ird:name.mp4', "srt")).toBe("we-ird-name-captions.srt");
    expect(captionFileName("", "srt")).toBe("video-captions.srt");
    expect(captionFileName(".mp4", "srt")).toBe(".mp4-captions.srt");
  });
});
