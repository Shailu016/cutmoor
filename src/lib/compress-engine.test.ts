import { describe, expect, it } from "vitest";
import { chooseCompressEngine } from "./compress-engine";
import type { VideoInspection } from "./video-inspect";

const video = (changes: Partial<VideoInspection> = {}): VideoInspection => ({
  container: "Matroska",
  videoCodec: "avc",
  audioCodec: "aac",
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
  durationSeconds: 9381,
  hdr: false,
  audioChannels: 2,
  audioSampleRate: 48_000,
  canDecodeVideo: true,
  canDecodeAudio: true,
  canEncodeAudio: true,
  encodableHeights: [1080, 720, 480],
  ...changes,
});

describe("chooseCompressEngine", () => {
  it("uses the browser when it can do everything", () => {
    expect(chooseCompressEngine(video({ audioCodec: "opus" }))).toEqual({ engine: "native", audio: "native" });
  });

  it("copies stereo AAC sound as it is, so a phone without a sound encoder still keeps it", () => {
    expect(chooseCompressEngine(video())).toEqual({ engine: "native", audio: "copy" });
    expect(chooseCompressEngine(video({ audioKbps: 160, canDecodeAudio: false, canEncodeAudio: false }))).toEqual({ engine: "native", audio: "copy" });
    expect(chooseCompressEngine(video({ audioKbps: 320, canEncodeAudio: false }))).toEqual({ engine: "native", audio: "copy" });
  });

  it("converts large AAC sound when the browser can, and does not copy surround sound", () => {
    expect(chooseCompressEngine(video({ audioKbps: 320 }))).toEqual({ engine: "native", audio: "native" });
    expect(chooseCompressEngine(video({ audioChannels: 6, canDecodeAudio: false }))).toEqual({ engine: "native", audio: "ffmpeg" });
  });

  it("converts sound in the browser even when it has no AAC encoder, because one is added", () => {
    expect(chooseCompressEngine(video({ audioCodec: "opus", canEncodeAudio: false }))).toEqual({ engine: "native", audio: "native" });
  });

  it("uses the browser for AV1 when it can decode it", () => {
    expect(chooseCompressEngine(video({ videoCodec: "av1" })).engine).toBe("native");
  });

  it("blocks AV1 the browser cannot decode, because FFmpeg cannot either", () => {
    const route = chooseCompressEngine(video({ videoCodec: "av1", canDecodeVideo: false }));
    expect(route.engine).toBe("blocked");
  });

  it("sends audio the browser cannot decode to FFmpeg, so sound is kept", () => {
    expect(chooseCompressEngine(video({ audioCodec: "ac3", canDecodeAudio: false }))).toEqual({ engine: "native", audio: "ffmpeg" });
  });

  it("has no audio step for a silent video", () => {
    expect(chooseCompressEngine(video({ hasAudio: false, audioCodec: null }))).toEqual({ engine: "native", audio: "none" });
  });

  it("falls back to FFmpeg for what the browser cannot handle", () => {
    expect(chooseCompressEngine(video({ canDecodeVideo: false, videoCodec: "hevc" }))).toEqual({ engine: "ffmpeg" });
    expect(chooseCompressEngine(video({ encodableHeights: [] }))).toEqual({ engine: "ffmpeg" });
    expect(chooseCompressEngine(video({ hdr: true, videoCodec: "hevc" }))).toEqual({ engine: "ffmpeg" });
    expect(chooseCompressEngine(null)).toEqual({ engine: "ffmpeg" });
  });

  it("does not change the colours of an HDR AV1 video", () => {
    expect(chooseCompressEngine(video({ hdr: true, videoCodec: "av1" })).engine).toBe("blocked");
  });
});
