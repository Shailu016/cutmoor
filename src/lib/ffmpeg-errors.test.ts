import { describe, expect, it } from "vitest";
import { describeJobError, explainFailure, isUnsupportedDecodeError, unsupportedVideoMessage } from "./ffmpeg-errors";

describe("describeJobError", () => {
  it("never shows the raw file read code", () => {
    expect(describeJobError(new Error("File could not be read! Code=-1"))).toMatch(/could not read this file/);
    expect(describeJobError(new Error("File could not be read! Code=-1"))).not.toMatch(/Code=/);
  });

  it("explains when part of the tool could not be loaded", () => {
    expect(describeJobError(new TypeError("Failed to fetch"))).toMatch(/could not load part of the video tool/);
    expect(describeJobError(new TypeError("Failed to fetch dynamically imported module: /assets/a.js"))).toMatch(/reload the page/);
  });

  it("explains running out of memory", () => {
    expect(describeJobError(new Error("RuntimeError: memory access out of bounds"))).toMatch(/ran out of memory/);
    expect(describeJobError("Array buffer allocation failed")).toMatch(/ran out of memory/);
  });

  it("keeps a message that is already clear, and has a fallback", () => {
    expect(describeJobError(new Error("Cutmoor cannot read AV1 video yet."))).toBe("Cutmoor cannot read AV1 video yet.");
    expect(describeJobError(undefined)).toMatch(/encoder failed/);
  });
});

describe("unsupported video", () => {
  it("recognises a stream the encoder cannot decode", () => {
    expect(isUnsupportedDecodeError("Error while decoding stream #0:0: Function not implemented")).toBe(true);
  });

  it("does not stop on errors a job can survive", () => {
    expect(isUnsupportedDecodeError("[av1 @ 0x15a92d0] Failed to get pixel format.")).toBe(false);
    expect(isUnsupportedDecodeError("Error while decoding stream #0:0: Invalid data found when processing input")).toBe(false);
    expect(isUnsupportedDecodeError("Error while decoding stream #0:0: Resource temporarily unavailable")).toBe(false);
  });

  it("names AV1 when the log shows it", () => {
    expect(unsupportedVideoMessage(["[av1 @ 0x15a92d0] Failed to get pixel format."])).toMatch(/cannot read AV1 video/);
    expect(unsupportedVideoMessage(["something else"])).toMatch(/cannot read this video format/);
  });
});

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
