import { describe, expect, it } from "vitest";
import {
  atempoChain,
  buildAddAudioArgs,
  buildGifArgs,
  buildLoopArgs,
  buildMergeArgs,
  buildMuteArgs,
  buildReverseArgs,
  buildRotateArgs,
  buildSlideshowArgs,
  buildSpeedArgs,
  buildWatermarkArgs,
  overlayPosition,
  reverseMemoryEstimate,
  REVERSE_MEMORY_LIMIT,
  rotateFilters,
  slideshowLength,
} from "./video-edit-args";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("rotateFilters", () => {
  it("turns right with transpose=1 and left with transpose=2", () => {
    expect(rotateFilters({ rotate: 90, flipH: false, flipV: false })).toEqual(["transpose=1"]);
    expect(rotateFilters({ rotate: 270, flipH: false, flipV: false })).toEqual(["transpose=2"]);
  });
  it("makes 180 from the two flips, then applies the mirrors after the turn", () => {
    expect(rotateFilters({ rotate: 180, flipH: false, flipV: false })).toEqual(["hflip", "vflip"]);
    expect(rotateFilters({ rotate: 90, flipH: true, flipV: true })).toEqual(["transpose=1", "hflip", "vflip"]);
  });
  it("does nothing for no turn and no mirror", () => {
    expect(rotateFilters({ rotate: 0, flipH: false, flipV: false })).toEqual([]);
  });
  it("always ends with an even-size scale so H.264 accepts the result", () => {
    const args = buildRotateArgs({ input: "in.mp4", output: "o.mp4", rotate: 90, flipH: false, flipV: false });
    expect(flag(args, "-vf")).toMatch(/scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2$/);
  });
});

describe("atempoChain", () => {
  const product = (chain: string[]) => chain.reduce((acc, step) => acc * Number(step.split("=")[1]), 1);
  it("keeps every step inside the 0.5 to 2 range FFmpeg accepts", () => {
    for (const factor of [0.25, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]) {
      const chain = atempoChain(factor);
      for (const step of chain) {
        const value = Number(step.split("=")[1]);
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(2);
      }
      expect(product(chain)).toBeCloseTo(factor, 2);
    }
  });
  it("chains two steps for 4x and for 0.25x", () => {
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
  });
});

describe("buildSpeedArgs", () => {
  it("re-times the picture and the sound together", () => {
    const args = buildSpeedArgs({ input: "in.mp4", output: "o.mp4", factor: 2, hasAudio: true });
    expect(flag(args, "-vf")).toContain("setpts=PTS/2");
    expect(flag(args, "-af")).toBe("atempo=2");
  });
  it("leaves the sound filter out for a silent video, which would otherwise fail", () => {
    const args = buildSpeedArgs({ input: "in.mp4", output: "o.mp4", factor: 2, hasAudio: false });
    expect(args).not.toContain("-af");
    expect(args).toContain("-an");
  });
  it("clamps the speed to 0.25 to 4", () => {
    expect(flag(buildSpeedArgs({ input: "i", output: "o", factor: 100, hasAudio: false }), "-vf")).toContain("PTS/4");
    expect(flag(buildSpeedArgs({ input: "i", output: "o", factor: 0, hasAudio: false }), "-vf")).toContain("PTS/0.25");
  });
});

describe("reverse and loop", () => {
  it("estimates the memory of the decoded frames", () => {
    const small = reverseMemoryEstimate({ width: 320, height: 180, fps: 24, duration: 2 });
    expect(small).toBeLessThan(REVERSE_MEMORY_LIMIT);
    const big = reverseMemoryEstimate({ width: 1920, height: 1080, fps: 30, duration: 60 });
    expect(big).toBeGreaterThan(REVERSE_MEMORY_LIMIT);
  });
  it("reverses sound only when there is sound", () => {
    expect(buildReverseArgs({ input: "i", output: "o", hasAudio: true })).toContain("areverse");
    expect(buildReverseArgs({ input: "i", output: "o", hasAudio: false })).not.toContain("areverse");
  });
  it("loops by repeating N-1 extra times, before the input", () => {
    const args = buildLoopArgs({ input: "i", output: "o", plays: 3, hasAudio: true });
    expect(flag(args, "-stream_loop")).toBe("2");
    expect(args.indexOf("-stream_loop")).toBeLessThan(args.indexOf("-i"));
  });
});

describe("mute", () => {
  it("drops the audio and keeps the picture encoder settings", () => {
    const args = buildMuteArgs({ input: "i", output: "o.mp4" });
    expect(args).toContain("-an");
    expect(args).toContain("libx264");
  });
});

describe("buildGifArgs", () => {
  it("never scales a GIF up", () => {
    const args = buildGifArgs({ input: "i.gif", output: "o.gif", width: 480, fps: 12, colors: 128 });
    expect(flag(args, "-vf")).toContain("scale='min(480,iw)':-2");
  });
  it("loops forever and uses a palette made for the animation", () => {
    const args = buildGifArgs({ input: "i.gif", output: "o.gif", width: 480, fps: 12, colors: 96 });
    expect(flag(args, "-loop")).toBe("0");
    expect(flag(args, "-vf")).toContain("palettegen=max_colors=96");
  });
});

describe("buildMergeArgs", () => {
  const clips = [
    { name: "in0.mp4", hasAudio: true, duration: 2 },
    { name: "in1.mp4", hasAudio: false, duration: 1.5 },
  ];
  it("fits every clip to one even-sized frame", () => {
    const args = buildMergeArgs({ clips, output: "o.mp4", width: 321, height: 181, fps: 30 });
    const graph = flag(args, "-filter_complex");
    expect(graph).toContain("scale=322:182");
    expect(graph).toContain("concat=n=2:v=1:a=1");
  });
  it("makes silence of the right length for a clip with no sound", () => {
    const graph = flag(buildMergeArgs({ clips, output: "o.mp4", width: 320, height: 180, fps: 30 }), "-filter_complex");
    expect(graph).toContain("[0:a]aresample");
    expect(graph).toContain("anullsrc=r=44100:cl=stereo,atrim=duration=1.5[a1]");
  });
});

describe("watermark", () => {
  it("puts a mark in each corner with a margin and in the centre", () => {
    expect(overlayPosition("top-left", 10)).toEqual({ x: "10", y: "10" });
    expect(overlayPosition("bottom-right", 10)).toEqual({ x: "W-w-10", y: "H-h-10" });
    expect(overlayPosition("center", 10)).toEqual({ x: "(W-w)/2", y: "(H-h)/2" });
  });
  it("scales the mark to the given pixel width and applies the opacity", () => {
    const args = buildWatermarkArgs({ input: "i", mark: "m.png", output: "o", position: "top-right", markWidth: 120, opacity: 0.5, margin: 8, hasAudio: true });
    const graph = flag(args, "-filter_complex");
    expect(graph).toContain("scale=120:-1");
    expect(graph).toContain("colorchannelmixer=aa=0.5");
    expect(args).toContain("0:a");
  });
  it("does not map audio that is not there", () => {
    const args = buildWatermarkArgs({ input: "i", mark: "m.png", output: "o", position: "center", markWidth: 50, opacity: 1, margin: 0, hasAudio: false });
    expect(args).not.toContain("0:a");
    expect(args).toContain("-an");
  });
});

describe("add audio", () => {
  const base = { video: "v.mp4", audio: "a.mp3", output: "o.mp4", volume: 1, loop: false, duration: 10 };
  it("replaces the sound, or mixes it only when the video has sound of its own", () => {
    expect(flag(buildAddAudioArgs({ ...base, mode: "replace", videoHasAudio: true }), "-filter_complex")).not.toContain("amix");
    expect(flag(buildAddAudioArgs({ ...base, mode: "mix", videoHasAudio: true }), "-filter_complex")).toContain("amix");
    expect(flag(buildAddAudioArgs({ ...base, mode: "mix", videoHasAudio: false }), "-filter_complex")).not.toContain("amix");
  });
  it("keeps the length of the video and can loop a short sound", () => {
    const args = buildAddAudioArgs({ ...base, mode: "replace", videoHasAudio: false, loop: true });
    expect(flag(args, "-t")).toBe("10");
    expect(args.indexOf("-stream_loop")).toBeGreaterThan(args.indexOf("v.mp4"));
    expect(args.indexOf("-stream_loop")).toBeLessThan(args.indexOf("a.mp3"));
  });
  it("clamps the volume to 0 to 2", () => {
    expect(flag(buildAddAudioArgs({ ...base, mode: "replace", videoHasAudio: false, volume: 9 }), "-filter_complex")).toContain("volume=2");
  });
});

describe("slideshow", () => {
  it("works out the length with overlapping fades", () => {
    expect(slideshowLength({ count: 3, seconds: 3, fade: 0.5 })).toBe(8);
    expect(slideshowLength({ count: 3, seconds: 3, fade: 0 })).toBe(9);
    expect(slideshowLength({ count: 1, seconds: 4, fade: 1 })).toBe(4);
  });
  it("chains cross-fades at the right offsets", () => {
    const args = buildSlideshowArgs({ frames: ["a.jpg", "b.jpg", "c.jpg"], output: "o.mp4", seconds: 3, fade: 0.5, fps: 30, audio: null });
    const graph = flag(args, "-filter_complex");
    expect(graph).toContain("xfade=transition=fade:duration=0.5:offset=2.5");
    expect(graph).toContain("xfade=transition=fade:duration=0.5:offset=5");
    expect(args[args.lastIndexOf("-t") + 1]).toBe("8");
  });
  it("limits a fade to half the time a picture is shown", () => {
    const args = buildSlideshowArgs({ frames: ["a.jpg", "b.jpg"], output: "o.mp4", seconds: 1, fade: 5, fps: 30, audio: null });
    expect(flag(args, "-filter_complex")).toContain("duration=0.5");
  });
  it("uses a plain join for cuts and maps the music when there is some", () => {
    const args = buildSlideshowArgs({ frames: ["a.jpg", "b.jpg"], output: "o.mp4", seconds: 2, fade: 0, fps: 30, audio: "m.mp3" });
    expect(flag(args, "-filter_complex")).toContain("concat=n=2:v=1:a=0");
    expect(args).toContain("2:a");
    expect(args).toContain("-shortest");
  });
});
