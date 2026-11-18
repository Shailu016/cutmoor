import { describe, expect, it } from "vitest";
import { planCompression, recommendResolution } from "./compress-options";

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
