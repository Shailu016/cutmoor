import { describe, expect, it } from "vitest";
import { explainFailure } from "./ffmpeg-errors";

describe("explainFailure", () => {
  it("explains a silent video sent to audio extraction", () => {
    const log = ["Stream mapping:", "Output file #0 does not contain any stream"];
    expect(explainFailure(log)).toMatch(/no audio track/i);
  });

  it("explains an unreadable input", () => {
    expect(explainFailure(["input.mp4: Invalid data found when processing input"])).toMatch(/could not read/i);
  });

  it("explains a missing codec", () => {
    expect(explainFailure(["Unknown encoder 'libx265'"])).toMatch(/does not include the codec/i);
  });

  it("returns null when the cause is unknown", () => {
    expect(explainFailure(["frame=1 fps=0.0", "Conversion failed!"])).toBeNull();
    expect(explainFailure([])).toBeNull();
  });
});
