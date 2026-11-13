import { describe, expect, it } from "vitest";
import { buildAudioArgs, buildConvertArgs, buildFrameArgs, buildResizeArgs, buildTrimArgs } from "./tool-args";

describe("buildResizeArgs", () => {
  it("crops to fill the frame", () => {
    const args = buildResizeArgs({ input: "in.mp4", output: "out.mp4", width: 1080, height: 1920, fit: "crop" });
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1");
    expect(args.slice(-2)).toEqual(["-y", "out.mp4"]);
  });

  it("pads to fit with black bars", () => {
    const args = buildResizeArgs({ input: "in.mp4", output: "out.mp4", width: 1080, height: 1080, fit: "pad" });
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1");
  });

  it("re-encodes to H.264 + AAC", () => {
    const args = buildResizeArgs({ input: "i", output: "o", width: 10, height: 10, fit: "crop" });
    expect(args).toEqual(expect.arrayContaining(["libx264", "aac", "+faststart"]));
  });
});

describe("buildTrimArgs", () => {
  it("seeks before the input and limits the length", () => {
    expect(buildTrimArgs({ input: "in.mp4", output: "out.mp4", startSeconds: 1.5, lengthSeconds: 2 })).toEqual([
      "-ss", "1.5", "-i", "in.mp4", "-t", "2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart", "-y", "out.mp4",
    ]);
  });
});

describe("buildConvertArgs", () => {
  const base = { input: "in.mp4", output: "out" };

  it("uses VP8 for WebM, never the crashing VP9 encoder", () => {
    const args = buildConvertArgs({ ...base, format: "webm" });
    expect(args).toContain("libvpx");
    expect(args).not.toContain("libvpx-vp9");
  });

  it("builds a palette-based GIF at 12 fps and 640 px", () => {
    const args = buildConvertArgs({ ...base, format: "gif" });
    expect(args[args.indexOf("-vf") + 1]).toContain("fps=12,scale=640:-1");
    expect(args).toContain("-loop");
  });

  it("drops the picture for audio formats", () => {
    for (const format of ["mp3", "m4a", "wav"] as const) {
      expect(buildConvertArgs({ ...base, format }), format).toContain("-vn");
    }
  });

  it("encodes MP4 with H.264 and AAC", () => {
    expect(buildConvertArgs({ ...base, format: "mp4" })).toEqual(expect.arrayContaining(["libx264", "aac", "-crf", "23"]));
  });
});

describe("buildAudioArgs", () => {
  it("applies the chosen bitrate to MP3 and M4A but not WAV", () => {
    expect(buildAudioArgs({ input: "i", output: "o", format: "mp3", bitrate: 128 })).toContain("128k");
    expect(buildAudioArgs({ input: "i", output: "o", format: "m4a", bitrate: 256 })).toContain("256k");
    expect(buildAudioArgs({ input: "i", output: "o", format: "wav", bitrate: 128 })).not.toContain("128k");
  });
});

describe("buildFrameArgs", () => {
  it("grabs one frame at the timestamp", () => {
    expect(buildFrameArgs({ input: "in.mp4", output: "f.png", seconds: 3.5, format: "png" })).toEqual([
      "-ss", "3.5", "-i", "in.mp4", "-frames:v", "1", "-y", "f.png",
    ]);
  });

  it("adds a quality flag for JPG only", () => {
    expect(buildFrameArgs({ input: "i", output: "f.jpg", seconds: 1, format: "jpg" })).toContain("-q:v");
    expect(buildFrameArgs({ input: "i", output: "f.png", seconds: 1, format: "png" })).not.toContain("-q:v");
  });
});
