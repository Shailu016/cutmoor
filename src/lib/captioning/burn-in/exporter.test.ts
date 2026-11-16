// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The exporter is driven here with a fake mediabunny (the real encode is covered by
 * scripts/verify/burn-in.mjs in a browser). The fake records the `process` hook and lets each test
 * decide what the source file looks like.
 */
interface FakeTrack {
  isAudioTrack(): boolean;
  isVideoTrack(): boolean;
}
const h = vi.hoisted(() => ({
  firstTimestamp: 0,
  discarded: [] as { track: unknown; reason: string }[],
  utilized: [] as unknown[],
  hook: null as ((s: unknown) => unknown) | null,
  fontsGate: null as Promise<unknown> | null,
  planGate: null as Promise<unknown> | null,
  executeCalled: false,
  draws: [] as number[],
}));

vi.mock("mediabunny", () => {
  class Input {
    constructor(_: unknown) {}
    canRead() {
      return Promise.resolve(true);
    }
    getPrimaryVideoTrack() {
      return Promise.resolve({
        getCodec: () => Promise.resolve("avc"),
        canDecode: () => Promise.resolve(true),
        hasHighDynamicRange: () => Promise.resolve(false),
        getDisplayWidth: () => Promise.resolve(640),
        getDisplayHeight: () => Promise.resolve(360),
      });
    }
    getFirstTimestamp() {
      return Promise.resolve(h.firstTimestamp);
    }
    dispose() {}
  }
  class ConversionCanceledError extends Error {}
  const Conversion = {
    init: async (opts: { video: { process: (s: unknown) => unknown } }) => {
      h.hook = opts.video.process;
      return {
        isValid: true,
        discardedTracks: h.discarded,
        utilizedTracks: h.utilized,
        onProgress: null,
        execute: async () => {
          h.executeCalled = true;
        },
        cancel: async () => {},
      };
    },
  };
  class Passthrough {
    constructor(..._: unknown[]) {}
  }
  return {
    ALL_FORMATS: [],
    BlobSource: Passthrough,
    Mp4OutputFormat: Passthrough,
    Output: Passthrough,
    StreamTarget: Passthrough,
    Conversion,
    ConversionCanceledError,
    Input,
    canEncodeVideo: async () => true,
    getFirstEncodableVideoCodec: async () => "avc",
  };
});
vi.mock("./fonts", () => ({ loadCaptionFonts: () => h.fontsGate ?? Promise.resolve({ loaded: [], failed: [] }) }));
vi.mock("./plan", async (orig) => {
  const real = await orig<typeof import("./plan")>();
  return { ...real, planOutput: (...a: Parameters<typeof real.planOutput>) => h.planGate ?? real.planOutput(...a) };
});
vi.mock("./renderer", () => ({
  createCaptionRenderer: () => ({
    draw: (ms: number) => {
      h.draws.push(ms);
      return null;
    },
  }),
}));

class FakeCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {};
  }
}
vi.stubGlobal("VideoEncoder", class {});
vi.stubGlobal("VideoDecoder", class {});
vi.stubGlobal("VideoFrame", class {});
vi.stubGlobal("OffscreenCanvas", FakeCanvas);

import { CaptionError } from "../contracts";
import { createBurnInExporter } from "./exporter";
import { CAPTION_STYLES } from "./styles";

const track = (kind: "audio" | "video"): FakeTrack => ({ isAudioTrack: () => kind === "audio", isVideoTrack: () => kind === "video" });
const baseOptions = () => ({
  file: new Blob([new Uint8Array(4)]) as unknown as File,
  events: [{ id: "e", startMs: 1000, endMs: 2000, text: "hi", words: [{ text: "hi", startMs: 1000, endMs: 2000 }] }] as never,
  style: CAPTION_STYLES.clean,
});
const sample = (timestamp: number) => ({ timestamp, draw: () => {} });

beforeEach(() => {
  h.firstTimestamp = 0;
  h.discarded = [];
  h.utilized = [track("video"), track("audio")];
  h.hook = null;
  h.fontsGate = null;
  h.planGate = null;
  h.executeCalled = false;
  h.draws = [];
});

describe("burn-in exporter", () => {
  it("finding 1: a source whose first timestamp is 1 s draws the event that starts at 1000 ms on its first frame", async () => {
    h.firstTimestamp = 1;
    await createBurnInExporter().export(baseOptions());
    // Conversion has already shifted the first frame to 0; the event is on the source timeline.
    h.hook!(sample(0));
    h.hook!(sample(0.5));
    expect(h.draws).toEqual([1000, 1500]);
  });

  it("finding 1: a source starting at 0 is unchanged, and a negative first timestamp is treated as 0", async () => {
    await createBurnInExporter().export(baseOptions());
    h.hook!(sample(0.25));
    h.firstTimestamp = -0.02;
    await createBurnInExporter().export(baseOptions());
    h.hook!(sample(0.25));
    expect(h.draws).toEqual([250, 250]);
  });

  it("finding 2: aborting while the fonts load rejects with 'aborted' promptly", async () => {
    h.fontsGate = new Promise(() => {}); // never settles
    const controller = new AbortController();
    const run = createBurnInExporter().export({ ...baseOptions(), signal: controller.signal });
    const outcome = run.then(() => "resolved", (e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const result = await Promise.race([outcome, new Promise((r) => setTimeout(() => r("still-pending"), 150))]);
    expect(result).toBeInstanceOf(CaptionError);
    expect((result as CaptionError).code).toBe("aborted");
  });

  it("finding 2: aborting while the encoder probes run (planOutput) rejects promptly too", async () => {
    h.planGate = new Promise(() => {});
    const controller = new AbortController();
    const outcome = createBurnInExporter()
      .export({ ...baseOptions(), signal: controller.signal })
      .then(() => "resolved", (e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const result = await Promise.race([outcome, new Promise((r) => setTimeout(() => r("still-pending"), 150))]);
    expect((result as CaptionError).code).toBe("aborted");
  });

  it("finding 4: a usable main audio track plus one unusable extra track still exports", async () => {
    h.discarded = [{ track: track("audio"), reason: "undecodable_source_codec" }];
    const blob = await createBurnInExporter().export(baseOptions()).catch((e: unknown) => e);
    // Fails later only at writer.toBlob (the fake writes nothing); the point is it got past the audio check.
    expect(h.executeCalled).toBe(true);
    expect(blob).not.toMatchObject({ message: expect.stringContaining("would be silent") });
  });

  it("finding 4: when every audio track is lost the export is still refused", async () => {
    h.utilized = [track("video")];
    h.discarded = [{ track: track("audio"), reason: "undecodable_source_codec" }];
    await expect(createBurnInExporter().export(baseOptions())).rejects.toMatchObject({ code: "export", message: expect.stringContaining("silent") });
    expect(h.executeCalled).toBe(false);
  });
});
