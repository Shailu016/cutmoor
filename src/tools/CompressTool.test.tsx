import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressTool } from "./CompressTool";
import { NO_AUDIO_ROUTE_MESSAGE } from "../lib/compress-engine";
import type { RunOptions } from "../lib/ffmpeg";
import type { NativeCompressOptions } from "../lib/native-compress";
import type { VideoInspection } from "../lib/video-inspect";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MB = 1024 * 1024;

const mocks = vi.hoisted(() => ({
  media: { duration: 20, width: 1920, height: 1080, hasVideo: true },
  inspection: { value: null as VideoInspection | null, hang: false, calls: 0 },
  native: { calls: [] as NativeCompressOptions[], blob: null as Blob | null, error: null as Error | null },
  encoder: {
    calls: [] as RunOptions[],
    progress: [] as Array<(value: number) => void>,
    resets: 0,
    blob: null as Blob | null,
    error: null as Error | null,
  },
}));

vi.mock("../lib/media", () => ({
  readVideoMeta: async () => mocks.media,
}));

vi.mock("../lib/video-inspect", () => ({
  inspectVideo: async () => {
    mocks.inspection.calls += 1;
    if (mocks.inspection.hang) return new Promise<VideoInspection | null>(() => undefined);
    return mocks.inspection.value;
  },
}));

vi.mock("../lib/native-compress", () => ({
  compressNative: async (options: NativeCompressOptions) => {
    mocks.native.calls.push(options);
    if (mocks.native.error) throw mocks.native.error;
    return { blob: mocks.native.blob ?? new Blob(["compressed"]), release: async () => undefined };
  },
}));

vi.mock("../lib/ffmpeg", () => ({
  onFFmpegLog: () => () => undefined,
  onFFmpegProgress: (listener: (value: number) => void) => {
    mocks.encoder.progress.push(listener);
    return () => {
      const index = mocks.encoder.progress.indexOf(listener);
      if (index !== -1) mocks.encoder.progress.splice(index, 1);
    };
  },
  resetFFmpeg: () => {
    mocks.encoder.resets += 1;
  },
  runFFmpeg: async (options: RunOptions) => {
    mocks.encoder.calls.push(options);
    options.onTimings?.({ engineLoadMs: 3, processMs: 7 });
    if (mocks.encoder.error) throw mocks.encoder.error;
    return mocks.encoder.blob ?? new Blob(["encoded"]);
  },
  runFFmpegJob: async () => new Blob(["multi"]),
}));

function inspection(changes: Partial<VideoInspection> = {}): VideoInspection {
  return {
    container: "MP4",
    videoCodec: "avc",
    audioCodec: "aac",
    hasVideo: true,
    hasAudio: true,
    width: 1920,
    height: 1080,
    durationSeconds: 20,
    hdr: false,
    audioChannels: 2,
    audioSampleRate: 48_000,
    canDecodeVideo: true,
    canDecodeAudio: true,
    canEncodeAudio: true,
    encodableHeights: [1080, 720, 480],
    ...changes,
  };
}

function videoFile(name = "clip.mp4", size = 104 * MB): File {
  const file = new File(["x"], name, { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

let root: Root;
let container: HTMLDivElement;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(async () => {
  mocks.media = { duration: 20, width: 1920, height: 1080, hasVideo: true };
  mocks.inspection.value = inspection();
  mocks.inspection.hang = false;
  mocks.inspection.calls = 0;
  mocks.native.calls = [];
  mocks.native.blob = new Blob(["compressed"]);
  mocks.native.error = null;
  mocks.encoder.calls = [];
  mocks.encoder.progress = [];
  mocks.encoder.resets = 0;
  mocks.encoder.blob = new Blob(["encoded"]);
  mocks.encoder.error = null;

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);

  await act(async () => {
    root.render(createElement(CompressTool));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function pick(file: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  await settle();
}

async function removeFile(): Promise<void> {
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove file"]');
  if (!remove) throw new Error("no remove button");
  await act(async () => remove.click());
  await settle();
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
  if (!found) throw new Error(`no button named "${text}"`);
  return found;
}

function hasButton(text: string): boolean {
  return [...container.querySelectorAll("button")].some((candidate) => candidate.textContent?.trim() === text);
}

function runButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("button.button-primary.button-lg");
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
  await settle();
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no input value setter");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function customInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Exact size in megabytes"]');
  if (!input) throw new Error("no custom size input");
  return input;
}

describe("CompressTool while it checks the video", () => {
  it("says it is checking, and offers no run button yet", async () => {
    mocks.inspection.hang = true;
    await pick(videoFile());

    expect(container.textContent).toContain("Checking which options work for this video…");
    expect(runButton()).toBeNull();
  });

  it("explains a blocked video and offers no run button", async () => {
    mocks.inspection.value = inspection({ videoCodec: "av1", canDecodeVideo: false });
    await pick(videoFile());

    expect(container.textContent).toContain("This browser cannot decode AV1 video");
    expect(container.textContent).toContain("Nothing was changed.");
    expect(runButton()).toBeNull();
    expect(hasButton("Compress video")).toBe(false);
  });
});

describe("CompressTool chooses an engine", () => {
  it("sends a supported video through the browser encoder", async () => {
    await pick(videoFile());

    const run = runButton();
    if (!run) throw new Error("no run button");
    await click(run);

    expect(mocks.native.calls).toHaveLength(1);
    expect(mocks.encoder.calls).toHaveLength(0);
    const options = mocks.native.calls[0];
    expect(options.file.name).toBe("clip.mp4");
    expect(options.audio).toBe("copy");
    expect(options.height).toBeNull();
    expect(options.videoKbps).toBeGreaterThan(0);
    expect(options.signal.aborted).toBe(false);
    expect(container.textContent).toContain("Your file is ready");
  });

  it("sends a video the browser cannot decode through the FFmpeg engine", async () => {
    mocks.inspection.value = inspection({ videoCodec: "hevc", canDecodeVideo: false });
    await pick(videoFile());

    const run = runButton();
    if (!run) throw new Error("no run button");
    await click(run);

    expect(mocks.encoder.calls).toHaveLength(1);
    expect(mocks.native.calls).toHaveLength(0);
    expect(mocks.encoder.calls[0].outputName).toBe("clip-compressed.mp4");
    expect(mocks.encoder.calls[0].args("input.hevc")).toContain("libx264");
    expect(container.textContent).toContain("Your file is ready");
  });
});

describe("CompressTool options", () => {
  const percentages = () => [...container.querySelectorAll('[aria-label="How much smaller"] button')].map((item) => item.textContent?.trim());

  it("offers reachable percentages and leaves quality to Cutmoor", async () => {
    await pick(videoFile());

    expect(percentages()).toEqual(["25% smaller", "50% smaller", "75% smaller", "90% smaller"]);
    expect(button("50% smaller").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-label="Output resolution"]')).toBeNull();
    expect(hasButton("Best quality")).toBe(false);
    expect(container.textContent).toContain("About 52.0 MB");
    expect(container.textContent).toContain("best quality that fits");
  });

  it("chooses a lower resolution by itself when the size needs it", async () => {
    mocks.media = { duration: 300, width: 1920, height: 1080, hasVideo: true };
    await pick(videoFile());
    await click(button("90% smaller"));
    await click(runButton() as HTMLButtonElement);

    expect(mocks.native.calls[0].height).toBe(480);
  });

  it("never asks the browser for a resolution it cannot encode", async () => {
    mocks.inspection.value = inspection({ encodableHeights: [720, 480] });
    await pick(videoFile());
    await click(runButton() as HTMLButtonElement);

    expect(mocks.native.calls[0].height).toBe(720);
  });

  it("keeps an exact size available", async () => {
    await pick(videoFile());
    type(customInput(), "40");

    expect(customInput().value).toBe("40");
    expect(button("50% smaller").getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("About 40.0 MB");
    await click(button("25% smaller"));
    expect(customInput().value).toBe("");
  });

  it("resets the choices for a new file", async () => {
    await pick(videoFile());
    await click(button("75% smaller"));
    type(customInput(), "42");

    await removeFile();
    await pick(videoFile("second.mp4", 90 * MB));

    expect(customInput().value).toBe("");
    expect(button("50% smaller").getAttribute("aria-pressed")).toBe("true");
  });

  it("still makes the best version when no percentage is reachable", async () => {
    mocks.media = { duration: 3600, width: 1280, height: 720, hasVideo: true };
    mocks.inspection.value = inspection({ width: 1280, height: 720, durationSeconds: 3600 });
    await pick(videoFile("full.mp4", 80 * MB));

    expect(percentages()).toEqual([]);
    expect(container.textContent).toContain("best version it can");
    await click(runButton() as HTMLButtonElement);
    expect(mocks.native.calls).toHaveLength(1);
  });

  it("notes a long job, including the slower engine when FFmpeg will be used", async () => {
    mocks.media = { duration: 2400, width: 1920, height: 1080, hasVideo: true };
    await pick(videoFile());
    expect(container.textContent).toContain("This is a long job.");
    expect(container.textContent).not.toContain("slower engine");

    await removeFile();
    mocks.inspection.value = inspection({ videoCodec: "hevc", canDecodeVideo: false });
    await pick(videoFile("long.mp4", 1200 * MB));
    expect(container.textContent).toContain("slower engine");
  });
});

describe("CompressTool when the sound cannot be converted", () => {
  it("offers to continue without sound only for that message, and then runs a silent job", async () => {
    mocks.inspection.value = inspection({ audioCodec: "ac3", canDecodeAudio: false });
    mocks.native.error = new Error(NO_AUDIO_ROUTE_MESSAGE);
    await pick(videoFile());

    const run = runButton();
    if (!run) throw new Error("no run button");
    await click(run);

    expect(mocks.native.calls).toHaveLength(1);
    expect(mocks.native.calls[0].audio).toBe("ffmpeg");
    expect(container.textContent).toContain(NO_AUDIO_ROUTE_MESSAGE);
    expect(hasButton("Continue without sound")).toBe(true);

    mocks.native.error = null;
    await click(button("Continue without sound"));

    expect(mocks.native.calls).toHaveLength(2);
    expect(mocks.native.calls[1].audio).toBe("none");
    expect(container.textContent).toContain("This video was made without sound, as you chose.");
    expect(hasButton("Continue without sound")).toBe(false);
  });

  it("does not offer it for an ordinary failure", async () => {
    mocks.inspection.value = inspection({ videoCodec: "hevc", canDecodeVideo: false });
    mocks.encoder.error = new Error("The encoder said no");
    await pick(videoFile());

    const run = runButton();
    if (!run) throw new Error("no run button");
    await click(run);

    expect(container.textContent).toContain("The encoder said no");
    expect(hasButton("Continue without sound")).toBe(false);
  });
});
