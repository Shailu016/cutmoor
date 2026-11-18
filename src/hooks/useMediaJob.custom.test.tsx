import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunOptions } from "../lib/ffmpeg";
import type { CustomJobContext, CustomJobOutput, MediaJob } from "./useMediaJob";
import { useMediaJob } from "./useMediaJob";

interface EncoderCall {
  options: RunOptions;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
}

const encoder = vi.hoisted(() => ({
  calls: [] as EncoderCall[],
  logs: [] as Array<(message: string) => void>,
  progress: [] as Array<(value: number) => void>,
  resets: 0,
}));

vi.mock("../lib/ffmpeg", () => ({
  onFFmpegLog: (listener: (message: string) => void) => {
    encoder.logs.push(listener);
    return () => {
      const index = encoder.logs.indexOf(listener);
      if (index !== -1) encoder.logs.splice(index, 1);
    };
  },
  onFFmpegProgress: (listener: (value: number) => void) => {
    encoder.progress.push(listener);
    return () => {
      const index = encoder.progress.indexOf(listener);
      if (index !== -1) encoder.progress.splice(index, 1);
    };
  },
  runFFmpeg: (options: RunOptions) =>
    new Promise<Blob>((resolve, reject) => {
      encoder.calls.push({ options, resolve, reject });
    }),
  runFFmpegJob: async () => new Blob(["multi"]),
  resetFFmpeg: () => {
    encoder.resets += 1;
  },
}));

vi.mock("../lib/media", () => ({
  readVideoMeta: async () => ({ duration: 6, width: 1280, height: 720, hasVideo: true }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onDone, onFail) => {
    resolve = onDone;
    reject = onFail;
  });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let latest: MediaJob;

function Probe() {
  latest = useMediaJob();
  return null;
}

const video = () => new File(["x"], "clip.mp4", { type: "video/mp4" });

async function mountJob(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    await latest.selectFile(video());
  });
}

beforeEach(() => {
  encoder.calls = [];
  encoder.logs = [];
  encoder.progress = [];
  encoder.resets = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("runCustom", () => {
  it("shows the status, progress and written bytes a custom job reports", async () => {
    await mountJob();
    const work = deferred<CustomJobOutput>();
    const captured: CustomJobContext[] = [];
    let running: Promise<void> = Promise.resolve();

    await act(async () => {
      running = latest.runCustom("out.mp4", (next) => {
        captured.push(next);
        return work.promise;
      });
    });
    expect(latest.phase).toBe("working");
    const context = captured[0];
    if (!context) throw new Error("the job did not receive a context");
    // A custom job measures itself; the encoder's own progress events are not wired up.
    expect(encoder.progress).toHaveLength(0);

    await act(async () => {
      context.setStatus("Compressing the picture…");
      context.setProgress(0.42);
      context.setOutputBytes(2048);
    });
    expect(latest.status).toBe("Compressing the picture…");
    expect(latest.progress).toBe(0.42);
    expect(latest.outputBytes).toBe(2048);

    await act(async () => {
      work.resolve({ blob: new Blob(["done"]) });
      await running;
    });
    expect(latest.phase).toBe("done");
    expect(latest.progress).toBe(1);
    expect(latest.status).toBeNull();
    expect(latest.result).toMatchObject({ name: "out.mp4", size: 4, engineLoadMs: 0 });
  });

  it("keeps the note a custom job returns", async () => {
    await mountJob();
    await act(async () => {
      await latest.runCustom("out.mp4", async () => ({
        blob: new Blob(["smaller"]),
        note: "This video was made without sound, as you chose.",
      }));
    });

    expect(latest.phase).toBe("done");
    expect(latest.result?.note).toBe("This video was made without sound, as you chose.");
  });

  it("releases a result's storage when it is replaced, and when it is cleared", async () => {
    await mountJob();
    const first = vi.fn();
    await act(async () => {
      await latest.runCustom("one.mp4", async () => ({ blob: new Blob(["one"]), release: first }));
    });
    expect(latest.phase).toBe("done");
    expect(first).not.toHaveBeenCalled();

    const second = vi.fn();
    await act(async () => {
      await latest.runCustom("two.mp4", async () => ({ blob: new Blob(["two"]), release: second }));
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      latest.clear();
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(latest.result).toBeNull();
  });

  it("cancel aborts the signal, returns to ready, and ignores late reports", async () => {
    await mountJob();
    const work = deferred<CustomJobOutput>();
    const captured: CustomJobContext[] = [];
    let running: Promise<void> = Promise.resolve();

    await act(async () => {
      running = latest.runCustom("out.mp4", (next) => {
        captured.push(next);
        return work.promise;
      });
    });
    const context = captured[0];
    if (!context) throw new Error("the job did not receive a context");
    await act(async () => {
      context.setProgress(0.5);
      context.setStatus("Halfway…");
      context.setOutputBytes(1024);
    });

    await act(async () => {
      latest.cancel();
    });
    expect(context.signal.aborted).toBe(true);
    expect(latest.phase).toBe("ready");
    expect(latest.wasCancelled).toBe(true);
    expect(latest.progress).toBe(0);
    expect(latest.status).toBeNull();
    expect(latest.outputBytes).toBe(0);

    await act(async () => {
      context?.setProgress(0.9);
      context?.setStatus("Too late");
      context?.setOutputBytes(4096);
    });
    expect(latest.progress).toBe(0);
    expect(latest.status).toBeNull();
    expect(latest.outputBytes).toBe(0);

    const release = vi.fn();
    await act(async () => {
      work.resolve({ blob: new Blob(["late"]), release });
      await running;
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(latest.phase).toBe("ready");
    expect(latest.result).toBeNull();
  });

  it("ignores a cancelled job that finishes after a new file was chosen", async () => {
    await mountJob();
    const work = deferred<CustomJobOutput>();
    let running!: Promise<void>;
    await act(async () => {
      running = latest.runCustom("old.mp4", () => work.promise);
    });
    await act(async () => {
      latest.cancel();
      await latest.selectFile(new File(["y"], "new.mp4", { type: "video/mp4" }));
    });

    const release = vi.fn();
    await act(async () => {
      work.resolve({ blob: new Blob(["late"]), release });
      await running;
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(latest.result).toBeNull();
    expect(latest.phase).toBe("ready");
  });

  it("turns errors into the sentences describeJobError gives", async () => {
    await mountJob();
    await act(async () => {
      await latest.runCustom("out.mp4", async () => {
        throw new Error("Cannot allocate memory for this video");
      });
    });
    expect(latest.phase).toBe("error");
    expect(latest.error).toBe(
      "This device ran out of memory or storage for this video. Close other tabs, free some space, or try a shorter video or a computer.",
    );

    await act(async () => {
      await latest.runCustom("out.mp4", async () => {
        throw new Error("The browser refused this file.");
      });
    });
    expect(latest.phase).toBe("error");
    expect(latest.error).toBe("The browser refused this file.");
    expect(encoder.resets).toBeGreaterThan(0);
  });
});

describe("run", () => {
  it("still uses the encoder's own progress events", async () => {
    await mountJob();
    let running: Promise<void> = Promise.resolve();

    await act(async () => {
      running = latest.run("out.mp4", () => ["-i", "input.mp4", "out.mp4"]);
    });
    expect(latest.phase).toBe("working");
    expect(encoder.progress).toHaveLength(1);

    await act(async () => {
      encoder.progress[0](0.37);
    });
    expect(latest.progress).toBe(0.37);

    await act(async () => {
      encoder.calls[0].options.onTimings?.({ engineLoadMs: 12, processMs: 34 });
      encoder.calls[0].resolve(new Blob(["done"]));
      await running;
    });
    expect(latest.phase).toBe("done");
    expect(latest.result).toMatchObject({ name: "out.mp4", size: 4, engineLoadMs: 12, processMs: 34 });
  });
});
