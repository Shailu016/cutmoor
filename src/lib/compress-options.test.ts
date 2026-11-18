import { describe, expect, it } from "vitest";
import {
  bestQualityKbps,
  nativeLimits,
  outputSize,
  planCompression,
  planSizeChoices,
  recommendResolution,
  videoKbpsForTarget,
} from "./compress-options";

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("planCompression", () => {
  it("offers only sizes a long video can reach", () => {
    const plan = planCompression({ sizeBytes: 2.7 * GB, durationSeconds: 8586, width: 1920, height: 804 });
    expect(plan.smallestMb).toBe(260);
    expect(plan.sizes).toEqual([300, 700, 1400, 2100]);
    expect(plan.defaultSize).toBe(1400);
    expect(plan.resolutions).toEqual(["720", "480"]);
  });

  it("offers sizes below the original for a small clip", () => {
    const plan = planCompression({ sizeBytes: 3.2 * MB, durationSeconds: 6, width: 1280, height: 720 });
    expect(plan.sizes).toEqual([1, 1.5, 2.5]);
    expect(plan.defaultSize).toBe(1.5);
    expect(plan.resolutions).toEqual(["480"]);
  });

  it("keeps common upload limits when they fit", () => {
    const plan = planCompression({ sizeBytes: 104 * MB, durationSeconds: 20, width: 1920, height: 1080 });
    expect(plan.sizes).toEqual([8, 10, 16, 25, 50, 80]);
    expect(plan.resolutions).toEqual(["720", "480"]);
  });

  it("offers no target when the video is already near its smallest size", () => {
    const plan = planCompression({ sizeBytes: 100 * MB, durationSeconds: 3600, width: 1280, height: 720 });
    expect(plan.smallestMb).toBe(109);
    expect(plan.sizes).toEqual([]);
    expect(plan.defaultSize).toBeNull();
  });

  it("offers no target when the length is unknown", () => {
    expect(planCompression({ sizeBytes: 100 * MB, durationSeconds: 0, width: 0, height: 0 }).sizes).toEqual([]);
  });

  it("never offers a size that cannot be reached or would not shrink the file", () => {
    for (const [mb, seconds] of [[1, 2], [12, 30], [90, 40], [700, 600], [5000, 7200], [1331, 16799]]) {
      const plan = planCompression({ sizeBytes: mb * MB, durationSeconds: seconds, width: 1920, height: 1080 });
      expect(plan.sizes.length).toBeLessThanOrEqual(6);
      for (const size of plan.sizes) {
        expect(size).toBeGreaterThanOrEqual(Math.max(1, plan.smallestMb));
        expect(size).toBeLessThan(mb);
      }
    }
  });
});

describe("recommendResolution", () => {
  const plan = planCompression({ sizeBytes: 500 * MB, durationSeconds: 600, width: 3840, height: 2160 });

  it("keeps the original when the bitrate is enough", () => {
    expect(recommendResolution(8000, 3840, 2160, plan)).toBe("original");
  });

  it("picks the largest resolution the bitrate can carry", () => {
    expect(recommendResolution(1600, 3840, 2160, plan)).toBe("1080");
    expect(recommendResolution(800, 3840, 2160, plan)).toBe("720");
    expect(recommendResolution(350, 3840, 2160, plan)).toBe("480");
  });

  it("falls back to the lowest choice for a very low bitrate", () => {
    expect(recommendResolution(120, 3840, 2160, plan)).toBe("480");
  });

  it("does not guess without the video's dimensions", () => {
    expect(recommendResolution(120, 0, 0, plan)).toBe("original");
  });
});

describe("nativeLimits", () => {
  it("saves a little audio bandwidth for videos of an hour or more", () => {
    expect(nativeLimits(3599)).toEqual({ audioKbps: 128, minVideoKbps: 100 });
    expect(nativeLimits(3600)).toEqual({ audioKbps: 96, minVideoKbps: 100 });
  });
});

describe("videoKbpsForTarget", () => {
  it("reserves the audio bitrate and leaves room below the requested size", () => {
    expect(videoKbpsForTarget(10, 60, { audioKbps: 128, minVideoKbps: 120 })).toBe(1101);
    expect(videoKbpsForTarget(10, 60, { audioKbps: 96, minVideoKbps: 100 })).toBe(1133);
  });

  it("never goes below the engine's minimum video bitrate", () => {
    expect(videoKbpsForTarget(1, 3600, { audioKbps: 128, minVideoKbps: 120 })).toBe(120);
    expect(videoKbpsForTarget(1, 3600, { audioKbps: 96, minVideoKbps: 100 })).toBe(100);
  });

  it("returns zero when the length is unknown", () => {
    expect(videoKbpsForTarget(10, 0, { audioKbps: 128, minVideoKbps: 120 })).toBe(0);
  });
});

describe("outputSize", () => {
  it("keeps the source size when the original resolution is chosen", () => {
    expect(outputSize("original", 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("scales to the chosen height and keeps the aspect ratio", () => {
    expect(outputSize("720", 1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(outputSize("480", 1920, 1080)).toEqual({ width: 853, height: 480 });
  });

  it("does not guess without known dimensions", () => {
    expect(outputSize("480", 0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("bestQualityKbps", () => {
  const source = { sizeBytes: 100 * MB, durationSeconds: 600, width: 1920, height: 1080 };

  it("stays generous for the picture but below the source's own bitrate", () => {
    expect(bestQualityKbps(1920, 1080, source, 128)).toBe(1016);
  });

  it("never drops below the 150 kbps floor", () => {
    expect(bestQualityKbps(1920, 1080, { ...source, durationSeconds: 60_000 }, 128)).toBe(150);
  });

  it("uses the picture size when the length is unknown", () => {
    expect(bestQualityKbps(1920, 1080, { ...source, durationSeconds: 0 }, 128)).toBe(3110);
  });
});

describe("planCompression with the browser encoder's limits", () => {
  it("offers only sizes a 2.9 GB, 9381-second video can reach", () => {
    const plan = planCompression(
      { sizeBytes: 2.9 * GB, durationSeconds: 9381, width: 1920, height: 1080 },
      nativeLimits(9381),
    );
    expect(plan.smallestMb).toBe(225);
    expect(plan.sizes).toEqual([250, 750, 1500, 2200]);
    expect(plan.defaultSize).toBe(1500);
    expect(plan.resolutions).toEqual(["720", "480"]);
  });

  it("offers only sizes a 1.3 GB, 16799-second video can reach", () => {
    const plan = planCompression(
      { sizeBytes: 1.3 * GB, durationSeconds: 16_799, width: 1920, height: 1080 },
      nativeLimits(16_799),
    );
    expect(plan.smallestMb).toBe(402);
    expect(plan.sizes).toEqual([450, 650, 1000]);
    expect(plan.defaultSize).toBe(650);
    expect(plan.resolutions).toEqual(["720", "480"]);
  });
});

describe("planSizeChoices", () => {
  it("offers the usual percentages when a video can reach them", () => {
    const source = { sizeBytes: 2.9 * GB, durationSeconds: 9381, width: 1920, height: 1080 };
    const plan = planSizeChoices(source, nativeLimits(9381));
    expect(plan.choices.map((choice) => choice.percent)).toEqual([25, 50, 75, 90]);
    expect(plan.defaultPercent).toBe(50);
    expect(plan.choices[1].targetMb).toBeCloseTo(1484.8, 1);
  });

  it("adds the most a long video can really shrink", () => {
    const source = { sizeBytes: 1.3 * GB, durationSeconds: 16799, width: 3840, height: 2160 };
    const plan = planSizeChoices(source, nativeLimits(16799));
    expect(plan.choices.map((choice) => choice.percent)).toEqual([25, 50, 65]);
  });

  it("starts on the largest reduction when 50% is out of reach", () => {
    const plan = planSizeChoices({ sizeBytes: 100 * MB, durationSeconds: 2400, width: 1280, height: 720 }, nativeLimits(2400));
    expect(plan.choices.map((choice) => choice.percent)).toEqual([25, 30]);
    expect(plan.defaultPercent).toBe(30);
  });

  it("offers nothing when the video cannot shrink or its length is unknown", () => {
    expect(planSizeChoices({ sizeBytes: 100 * MB, durationSeconds: 3600, width: 1280, height: 720 }).choices).toEqual([]);
    expect(planSizeChoices({ sizeBytes: 100 * MB, durationSeconds: 0, width: 0, height: 0 }).defaultPercent).toBeNull();
  });
});
