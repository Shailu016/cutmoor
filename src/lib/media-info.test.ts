import { describe, expect, it } from "vitest";
import { parseMediaInfo } from "./media-info";

const REAL_LOG = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from in0.mp4:",
  "  Duration: 00:00:02.02, start: 0.000000, bitrate: 305 kb/s",
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x180 [SAR 1:1 DAR 16:9], 220 kb/s, 24 fps, 24 tbr, 12288 tbn (default)",
  "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706d), 44100 Hz, mono, fltp, 69 kb/s (default)",
];

describe("parseMediaInfo", () => {
  it("reads streams, size, frame rate and length from the encoder log", () => {
    expect(parseMediaInfo(REAL_LOG)).toEqual({ hasVideo: true, hasAudio: true, duration: 2.02, fps: 24, width: 320, height: 180 });
  });
  it("reports a file with no sound", () => {
    expect(parseMediaInfo(REAL_LOG.slice(0, 3)).hasAudio).toBe(false);
  });
  it("reports audio only for a sound file", () => {
    const info = parseMediaInfo(["  Duration: 00:00:01.04, start: 0.025057, bitrate: 66 kb/s", "  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 64 kb/s"]);
    expect(info.hasVideo).toBe(false);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeCloseTo(1.04, 2);
  });
  it("ignores cover art that is listed as a video stream", () => {
    const info = parseMediaInfo(["  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc), 500x500, 90k tbr (attached pic)"]);
    expect(info.hasVideo).toBe(false);
  });
  it("returns empty values for an empty log", () => {
    expect(parseMediaInfo([])).toEqual({ hasVideo: false, hasAudio: false, duration: 0, fps: 0, width: 0, height: 0 });
  });
});
