import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectVideo } from "./video-inspect";

interface VideoTrackState {
  codec: string;
  width: number;
  height: number;
  hdr: boolean;
  canDecode: boolean;
}

interface AudioTrackState {
  codec: string;
  channels: number;
  sampleRate: number;
  canDecode: boolean;
}

const state = vi.hoisted(() => ({
  readable: true,
  hang: false,
  formatName: "MP4",
  video: null as VideoTrackState | null,
  audio: null as AudioTrackState | null,
  metadataDuration: 12 as number | null,
  computedDuration: 12,
  encodable: [] as number[],
  rejectedHeights: [] as number[],
  disposed: 0,
  videoRequests: [] as Array<{ width: number; height: number }>,
  audioRequests: [] as Array<{ channels: number; sampleRate: number }>,
}));

vi.mock("mediabunny", () => {
  class Input {
    constructor(_options: unknown) {}
    canRead(): Promise<boolean> {
      if (state.hang) return new Promise<boolean>(() => undefined);
      return Promise.resolve(state.readable);
    }
    getFormat(): Promise<{ name: string }> {
      return Promise.resolve({ name: state.formatName });
    }
    getPrimaryVideoTrack() {
      const video = state.video;
      if (!video) return Promise.resolve(null);
      return Promise.resolve({
        getDisplayWidth: () => Promise.resolve(video.width),
        getDisplayHeight: () => Promise.resolve(video.height),
        getCodec: () => Promise.resolve(video.codec),
        hasHighDynamicRange: () => Promise.resolve(video.hdr),
        canDecode: () => Promise.resolve(video.canDecode),
      });
    }
    getPrimaryAudioTrack() {
      const audio = state.audio;
      if (!audio) return Promise.resolve(null);
      return Promise.resolve({
        getCodec: () => Promise.resolve(audio.codec),
        canDecode: () => Promise.resolve(audio.canDecode),
        numberOfChannels: audio.channels,
        sampleRate: audio.sampleRate,
      });
    }
    getDurationFromMetadata() {
      return Promise.resolve(state.metadataDuration);
    }
    computeDuration() {
      return Promise.resolve(state.computedDuration);
    }
    dispose(): void {
      state.disposed += 1;
    }
  }

  return {
    ALL_FORMATS: [],
    BlobSource: class {
      constructor(_file: File) {}
    },
    Input,
    canEncodeVideo: async (_codec: string, options: { width: number; height: number }) => {
      state.videoRequests.push({ width: options.width, height: options.height });
      if (state.rejectedHeights.includes(options.height)) throw new Error("this size cannot be encoded");
      return state.encodable.includes(options.height);
    },
    canEncodeAudio: async (_codec: string, options: { numberOfChannels: number; sampleRate: number }) => {
      state.audioRequests.push({ channels: options.numberOfChannels, sampleRate: options.sampleRate });
      return true;
    },
  };
});

const file = () => new File(["x"], "clip.mp4", { type: "video/mp4" });

beforeEach(() => {
  state.readable = true;
  state.hang = false;
  state.formatName = "MP4";
  state.video = { codec: "avc", width: 1920, height: 1080, hdr: false, canDecode: true };
  state.audio = { codec: "aac", channels: 2, sampleRate: 48_000, canDecode: true };
  state.metadataDuration = 12;
  state.computedDuration = 12;
  state.encodable = [1080, 720, 480];
  state.rejectedHeights = [];
  state.disposed = 0;
  state.videoRequests = [];
  state.audioRequests = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("inspectVideo", () => {
  it("returns null and still frees the input when the file cannot be read", async () => {
    state.readable = false;
    await expect(inspectVideo(file())).resolves.toBeNull();
    expect(state.disposed).toBe(1);
    expect(state.videoRequests).toEqual([]);
    expect(state.audioRequests).toEqual([]);
  });

  it("gives up after ten seconds and returns null", async () => {
    vi.useFakeTimers();
    state.hang = true;
    const inspection = inspectVideo(file());
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(inspection).resolves.toBeNull();
    expect(state.disposed).toBe(0);
  });

  it("maps the codecs, dimensions, HDR and browser support from the file's headers", async () => {
    state.video = { codec: "avc", width: 1920, height: 1080, hdr: true, canDecode: true };
    state.audio = { codec: "aac", channels: 6, sampleRate: 44_100, canDecode: false };
    state.metadataDuration = 5;
    state.encodable = [720];
    state.rejectedHeights = [1080];

    const inspection = await inspectVideo(file());

    expect(inspection).toEqual({
      container: "MP4",
      videoCodec: "avc",
      audioCodec: "aac",
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      hdr: true,
      audioChannels: 6,
      audioSampleRate: 44_100,
      canDecodeVideo: true,
      canDecodeAudio: false,
      canEncodeAudio: true,
      // 1080 was refused, 720 accepted and 480 refused, so only 720 is offered.
      encodableHeights: [720],
    });
    expect(state.disposed).toBe(1);
    expect(state.videoRequests).toEqual([
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 854, height: 480 },
    ]);
    expect(state.audioRequests).toEqual([{ channels: 2, sampleRate: 44_100 }]);
  });

  it("computes the duration when the header does not carry one", async () => {
    state.metadataDuration = null;
    state.computedDuration = 7;

    const inspection = await inspectVideo(file());

    expect(inspection?.durationSeconds).toBe(7);
  });

  it("reports a file with no sound as having no audio track", async () => {
    state.audio = null;

    const inspection = await inspectVideo(file());

    expect(inspection).toMatchObject({
      audioCodec: null,
      hasAudio: false,
      audioChannels: 0,
      audioSampleRate: 0,
      canDecodeAudio: false,
      canEncodeAudio: false,
    });
    expect(state.audioRequests).toEqual([]);
  });
});
