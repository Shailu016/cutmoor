import { describe, expect, it } from "vitest";
import { buildCompressArgs } from "./compress";

const base = { input: "input.mp4", output: "out.mp4", targetMb: 2, durationSeconds: 6, resolution: "original" as const };

describe("buildCompressArgs", () => {
  it("builds the target-size command from the duration", () => {
    // 2 MB over 6 s = 2731 kbps total; minus 128 kbps of audio = 2603 kbps video.
    expect(buildCompressArgs({ ...base, mode: "size" })).toEqual([
      "-i", "input.mp4",
      "-c:v", "libx264", "-preset", "veryfast",
      "-b:v", "2603k", "-maxrate", "3905k", "-bufsize", "5206k",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", "out.mp4",
    ]);
  });

  it("uses a constant-quality encode in quality mode", () => {
    const args = buildCompressArgs({ ...base, mode: "quality" });
    expect(args).toContain("-crf");
    expect(args).not.toContain("-b:v");
  });

  it("falls back to quality mode when the duration is unknown", () => {
    const args = buildCompressArgs({ ...base, mode: "size", durationSeconds: 0 });
    expect(args).toContain("-crf");
    expect(args).not.toContain("-b:v");
  });

  it("adds a scale filter only when a resolution is chosen", () => {
    expect(buildCompressArgs({ ...base, mode: "size" })).not.toContain("-vf");
    const scaled = buildCompressArgs({ ...base, mode: "size", resolution: "720" });
    expect(scaled[scaled.indexOf("-vf") + 1]).toBe("scale=-2:720");
  });

  it("always writes the output file last, overwriting", () => {
    const args = buildCompressArgs({ ...base, mode: "size" });
    expect(args.slice(-2)).toEqual(["-y", "out.mp4"]);
  });
});
