import { describe, expect, it } from "vitest";
import { explainFailure, isUnsupportedDecodeError, unsupportedVideoMessage } from "./ffmpeg-errors";

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
