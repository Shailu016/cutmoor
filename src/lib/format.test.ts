import { describe, expect, it } from "vitest";
import {
  baseName,
  clamp,
  extensionOf,
  formatBytes,
  formatDuration,
  mimeForName,
  parseTimecode,
  targetVideoKbps,
} from "./format";

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(-10)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(83)).toBe("1:23");
    expect(formatDuration(3723)).toBe("1:02:03");
  });

  it("guards invalid values", () => {
    expect(formatDuration(-1)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("parseTimecode", () => {
  it("parses seconds and clock formats", () => {
    expect(parseTimecode("83")).toBe(83);
    expect(parseTimecode("1:23")).toBe(83);
    expect(parseTimecode("01:02:03")).toBe(3723);
    expect(parseTimecode("1:02:03.5")).toBeCloseTo(3723.5);
  });

  it("rejects malformed input", () => {
    expect(Number.isNaN(parseTimecode("abc"))).toBe(true);
    expect(Number.isNaN(parseTimecode("1:99"))).toBe(true);
    expect(Number.isNaN(parseTimecode("-5"))).toBe(true);
  });

  it("returns zero for an empty string", () => {
    expect(parseTimecode("  ")).toBe(0);
  });
});

describe("file helpers", () => {
  it("extracts extensions", () => {
    expect(extensionOf("clip.MP4")).toBe("mp4");
    expect(extensionOf("no-extension")).toBe("mp4");
  });

  it("builds safe base names", () => {
    expect(baseName("My Holiday Clip.MOV")).toBe("My-Holiday-Clip");
    expect(baseName("!!!.mp4")).toBe("clip");
  });

  it("maps mime types", () => {
    expect(mimeForName("out.mp4")).toBe("video/mp4");
    expect(mimeForName("out.vtt")).toBe("text/vtt");
    expect(mimeForName("out.unknown")).toBe("application/octet-stream");
  });
});

describe("targetVideoKbps", () => {
  it("reserves audio bitrate from the total budget", () => {
    // 10 MB over 60 s = 1365.33 kbps total; audio 128 leaves ~1237.
    expect(targetVideoKbps(10, 60, 128)).toBe(1237);
  });

  it("never drops below the floor", () => {
    expect(targetVideoKbps(1, 3600, 128)).toBe(120);
  });

  it("returns zero for an unknown duration", () => {
    expect(targetVideoKbps(25, 0)).toBe(0);
  });
});

describe("clamp", () => {
  it("bounds a value", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-2, 1, 10)).toBe(1);
    expect(clamp(99, 1, 10)).toBe(10);
  });
});
