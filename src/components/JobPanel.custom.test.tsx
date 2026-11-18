import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobPanel } from "./JobPanel";
import type { MediaJob } from "../hooks/useMediaJob";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MB = 1024 * 1024;

const file = () => new File(["x"], "clip.mp4", { type: "video/mp4" });
const meta = { duration: 60, width: 1920, height: 1080, hasVideo: true };

function job(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    file: null,
    meta: null,
    phase: "idle",
    progress: 0,
    logs: [],
    result: null,
    error: null,
    previewUrl: null,
    startedAt: null,
    wasCancelled: false,
    status: null,
    outputBytes: 0,
    selectFile: async () => undefined,
    clear: () => undefined,
    run: async () => undefined,
    runMulti: async () => undefined,
    runCustom: async () => undefined,
    cancel: () => undefined,
    ...overrides,
  };
}

const panel = (overrides: Partial<MediaJob>) =>
  createElement(JobPanel, {
    job: job({ file: file(), meta, previewUrl: "blob:preview", ...overrides }),
    idleHint: "Choose a video.",
  });

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("JobPanel while a custom job works", () => {
  it("shows the job's own status instead of saying the encoder is loading", async () => {
    await act(async () => {
      root.render(panel({ phase: "working", progress: 0, status: "Compressing the picture…", startedAt: performance.now() }));
    });
    expect(container.textContent).toContain("Compressing the picture…");
    expect(container.textContent).not.toContain("Loading the encoder…");

    await act(async () => {
      root.render(panel({ phase: "working", progress: 0, status: null, startedAt: performance.now() }));
    });
    expect(container.textContent).toContain("Loading the encoder…");

    await act(async () => {
      root.render(panel({ phase: "working", progress: 0.3, status: null, startedAt: performance.now() }));
    });
    expect(container.textContent).toContain("Encoding…");
    expect(container.textContent).not.toContain("Loading the encoder…");
  });

  it("shows time left only once progress is high enough to project it", async () => {
    const startedAt = performance.now() - 10_000;
    await act(async () => {
      root.render(panel({ phase: "working", progress: 0.01, status: "Compressing…", startedAt, meta, file: file() }));
    });
    expect(container.textContent).not.toMatch(/left\b/);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");

    await act(async () => {
      root.render(panel({ phase: "working", progress: 0.5, status: "Compressing…", startedAt: performance.now() - 20_000, meta, file: file() }));
    });
    expect(container.textContent).toMatch(/about \d+ s left/);

    await act(async () => {
      root.render(panel({ phase: "working", progress: 0.5, status: null, startedAt, meta, file: file() }));
    });
    expect(container.textContent).not.toMatch(/left\b/);

    await act(async () => {
      root.render(panel({ phase: "working", progress: 1, status: "Finishing the file…", startedAt, meta, file: file() }));
    });
    expect(container.textContent).not.toMatch(/left\b/);
  });

  it("shows how many bytes have been written", async () => {
    await act(async () => {
      root.render(panel({ phase: "working", progress: 0.4, status: "Compressing…", outputBytes: 2.5 * MB, startedAt: performance.now() }));
    });
    expect(container.textContent).toContain("2.5 MB written");

    await act(async () => {
      root.render(panel({ phase: "working", progress: 0.4, status: "Compressing…", outputBytes: 0, startedAt: performance.now() }));
    });
    expect(container.textContent).not.toContain("written");
  });
});

describe("JobPanel when a custom job finishes", () => {
  it("shows the note that comes with the result", async () => {
    const note = "This video was made without sound, as you chose.";
    await act(async () => {
      root.render(
        panel({
          phase: "done",
          progress: 1,
          result: { url: "blob:result", name: "clip-compressed.mp4", size: 1 * MB, processMs: 1234, engineLoadMs: 0, note },
        }),
      );
    });
    expect(container.textContent).toContain(note);
    expect(container.querySelector("a[download='clip-compressed.mp4']")).not.toBeNull();
  });

  it("adds no note when the result has none", async () => {
    await act(async () => {
      root.render(
        panel({
          phase: "done",
          progress: 1,
          result: { url: "blob:result", name: "clip-compressed.mp4", size: 1 * MB, processMs: 1234, engineLoadMs: 0 },
        }),
      );
    });
    expect(container.textContent).toContain("Your file is ready");
    expect(container.textContent).not.toContain("undefined");
  });
});
