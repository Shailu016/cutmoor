import { describe, expect, it } from "vitest";
import { CaptionError } from "./contracts";
import { ModelLoadError } from "./model-loader";
import { modelStartError } from "./runtime";

describe("modelStartError", () => {
  it("keeps a CaptionError as it is", () => {
    const original = new CaptionError("device-lost", "gone");
    expect(modelStartError(original)).toBe(original);
  });
  it("reports a failed download as a download problem, not an internal one", () => {
    const error = modelStartError(new ModelLoadError("network", "no connection"));
    expect(error).toBeInstanceOf(CaptionError);
    expect(error.code).toBe("model-download");
    expect(error.message).toBe("no connection");
  });
  it("keeps a cancelled download as 'aborted'", () => {
    expect(modelStartError(new ModelLoadError("aborted", "stopped")).code).toBe("aborted");
  });
  it("reports any other failure as a model start problem and never throws on odd values", () => {
    expect(modelStartError(new Error("boom")).code).toBe("model-load");
    expect(modelStartError("text").code).toBe("model-load");
    expect(modelStartError(undefined).message).toMatch(/could not be started/);
  });
});
