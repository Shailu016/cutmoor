import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionRuntime, CaptionRuntimeFactory } from "../components/captions/runtime-types";
import type { CaptionPipeline } from "../lib/captioning/contracts";
import type { ModelManifest, ModelStore } from "../lib/captioning/model-loader";
import { storeKey } from "../lib/captioning/model-loader";
import { IDLE_UNLOAD_MS, useCaptionJob, type CaptionJob } from "./useCaptionJob";

vi.mock("../lib/media", () => ({
  readVideoMeta: async () => ({ duration: 6, width: 1280, height: 720, hasVideo: true }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MANIFEST: ModelManifest = { id: "t", version: "1", files: [{ name: "m", url: "https://models.cutmoor.com/m/x.bin", bytes: 8, sha256: "a".repeat(64) }] };
const store = (): ModelStore => {
  const data = new Map<string, Uint8Array>();
  return { get: async (k) => data.get(k) ?? null, put: async (k, b) => void data.set(k, b), delete: async (k) => data.delete(k) };
};

/** A runtime whose pipeline can never run again once disposed, like the real one. */
function makeRuntime(label: string, options: { cached?: boolean } = {}) {
  const dispose = vi.fn(async () => undefined);
  const prewarm = vi.fn(async () => undefined);
  const unloadModels = vi.fn(async () => undefined);
  const pipeline: CaptionPipeline = { run: async () => { throw new Error("not used"); }, dispose, prewarm, unloadModels };
  const modelStore = store();
  if (options.cached) void modelStore.put(storeKey(MANIFEST.files[0]), new Uint8Array(MANIFEST.files[0].bytes));
  const runtime: CaptionRuntime = { pipeline, manifest: MANIFEST, store: modelStore, burnIn: null, label };
  return { runtime, dispose, prewarm, unloadModels };
}

let root: Root;
let container: HTMLDivElement;
let latest: CaptionJob;

function Probe({ factory, tier }: { factory?: CaptionRuntimeFactory; tier?: string }) {
  latest = useCaptionJob(factory, tier);
  return null;
}
const render = async (props: { factory?: CaptionRuntimeFactory; tier?: string }) => {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

beforeEach(() => {
  // jsdom has no blob URLs; choosing a file makes one for the preview.
  Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete (window as { __cutmoorCaptionTiers?: unknown }).__cutmoorCaptionTiers;
});

describe("runtime lifecycle", () => {
  it("builds a fresh runtime when the tool is opened again after leaving it", async () => {
    const built: ReturnType<typeof makeRuntime>[] = [];
    const factory: CaptionRuntimeFactory = () => {
      const next = makeRuntime(`r${built.length}`);
      built.push(next);
      return next.runtime;
    };
    await render({ factory });
    expect(built).toHaveLength(1);
    // Leave the tool (unmount), then come back with the same factory.
    await act(async () => root.render(null));
    expect(built[0].dispose).toHaveBeenCalledTimes(1);
    await render({ factory });
    expect(built).toHaveLength(2);
    expect(latest.runtime).toBe(built[1].runtime);
    expect(built[1].dispose).not.toHaveBeenCalled();
  });

  it("builds a fresh runtime when switching tier and back", async () => {
    const counts = { fast: 0, high: 0 };
    const made: Record<string, ReturnType<typeof makeRuntime>[]> = { fast: [], high: [] };
    const tierFactory = (id: "fast" | "high"): CaptionRuntimeFactory => () => {
      counts[id] += 1;
      const next = makeRuntime(id);
      made[id].push(next);
      return next.runtime;
    };
    (window as { __cutmoorCaptionTiers?: unknown }).__cutmoorCaptionTiers = [
      { id: "fast", name: "Fast", detail: "", factory: tierFactory("fast") },
      { id: "high", name: "High", detail: "", factory: tierFactory("high") },
    ];
    await render({ tier: "fast" });
    await render({ tier: "high" });
    expect(made.fast[0].dispose).toHaveBeenCalledTimes(1);
    await render({ tier: "fast" });
    expect(counts.fast).toBe(2);
    expect(latest.runtime).toBe(made.fast[1].runtime);
    expect(made.fast[1].dispose).not.toHaveBeenCalled();
    expect(made.high[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("frees a model load that the visitor abandoned by switching tier", async () => {
    const slow = makeRuntime("slow");
    const quick = makeRuntime("quick");
    let release: (runtime: CaptionRuntime) => void = () => undefined;
    (window as { __cutmoorCaptionTiers?: unknown }).__cutmoorCaptionTiers = [
      { id: "slow", name: "Slow", detail: "", factory: () => new Promise<CaptionRuntime>((resolve) => (release = resolve)) },
      { id: "quick", name: "Quick", detail: "", factory: () => quick.runtime },
    ];
    await render({ tier: "slow" });
    await render({ tier: "quick" });
    expect(latest.runtime).toBe(quick.runtime);
    await act(async () => {
      release(slow.runtime);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(slow.dispose).toHaveBeenCalledTimes(1);
    expect(quick.dispose).not.toHaveBeenCalled();
    expect(latest.runtime).toBe(quick.runtime);
  });

  it("deleting the saved model leaves a usable runtime behind", async () => {
    const built: ReturnType<typeof makeRuntime>[] = [];
    const factory: CaptionRuntimeFactory = () => {
      const next = makeRuntime(`r${built.length}`);
      built.push(next);
      return next.runtime;
    };
    await render({ factory });
    await act(async () => {
      await latest.removeModel();
    });
    expect(built[0].dispose).toHaveBeenCalledTimes(1);
    expect(built).toHaveLength(2);
    expect(latest.runtime).toBe(built[1].runtime);
    expect(built[1].dispose).not.toHaveBeenCalled();
  });
});

describe("warm-up and idle unload", () => {
  const clip = () => new File(["x"], "clip.mp4", { type: "video/mp4" });
  const choose = async (file: File) => {
    await act(async () => {
      latest.selectFile(file);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  };

  it("starts the model when a file is chosen and the model is already saved in this browser", async () => {
    const made = makeRuntime("cached", { cached: true });
    await render({ factory: () => made.runtime });
    expect(made.prewarm).not.toHaveBeenCalled();
    await choose(clip());
    expect(made.prewarm).toHaveBeenCalledTimes(1);
    // Choosing another file does not start it a second time.
    await choose(clip());
    expect(made.prewarm).toHaveBeenCalledTimes(1);
  });

  it("does not start the model when it would have to be downloaded first", async () => {
    const made = makeRuntime("not cached");
    await render({ factory: () => made.runtime });
    await choose(clip());
    expect(made.prewarm).not.toHaveBeenCalled();
  });

  it("does not start the model on a data-saver connection or a device with little memory", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "deviceMemory");
    Object.defineProperty(navigator, "deviceMemory", { value: 2, configurable: true });
    try {
      const made = makeRuntime("small device", { cached: true });
      await render({ factory: () => made.runtime });
      await choose(clip());
      expect(made.prewarm).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(navigator, "deviceMemory", original);
      else delete (navigator as { deviceMemory?: number }).deviceMemory;
    }
  });

  it("unloads the model after ten quiet minutes, not before", async () => {
    const made = makeRuntime("idle", { cached: true });
    await render({ factory: () => made.runtime });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => {
        latest.selectFile(clip());
      });
      await act(async () => {
        vi.advanceTimersByTime(IDLE_UNLOAD_MS - 1000);
      });
      expect(made.unloadModels).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(made.unloadModels).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts a model that has not been checked: switching to an uncached model does not prewarm it", async () => {
    const fast = makeRuntime("fast", { cached: true });
    const high = makeRuntime("high"); // its files are NOT saved
    (window as { __cutmoorCaptionTiers?: unknown }).__cutmoorCaptionTiers = [
      { id: "fast", name: "Fast", detail: "", factory: () => fast.runtime },
      { id: "high", name: "High", detail: "", factory: () => high.runtime },
    ];
    await render({ tier: "fast" });
    await choose(clip());
    expect(fast.prewarm).toHaveBeenCalledTimes(1);
    // The visitor picks the other model: the fast model's "saved" status must not be read as the high model's.
    await render({ tier: "high" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(high.prewarm).not.toHaveBeenCalled();
    expect(latest.modelStatus.state).toBe("missing");
  });

  it("Start pressed while the saved model is being deleted waits for the fresh runtime and does not fail", async () => {
    const built: ReturnType<typeof makeRuntime>[] = [];
    const runs: string[] = [];
    let releaseDelete: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (releaseDelete = resolve));
    const factory: CaptionRuntimeFactory = () => {
      const made = makeRuntime(`r${built.length}`, { cached: true });
      const innerDelete = made.runtime.store!.delete.bind(made.runtime.store);
      made.runtime.store!.delete = async (key) => {
        await gate;
        return innerDelete(key);
      };
      made.runtime.pipeline.run = async () => {
        if (made.dispose.mock.calls.length > 0) throw new Error("run on a disposed pipeline");
        runs.push(made.runtime.label);
        return { words: [], events: [], uncoveredSpeech: [], stats: { audioSeconds: 1, speechSeconds: 1, windows: 1, flaggedWindows: 0, droppedWords: 0, stageMs: {}, engineId: "e", alignerId: "a" } };
      };
      built.push(made);
      return made.runtime;
    };
    await render({ factory });
    await choose(clip());
    let removal: Promise<number> = Promise.resolve(0);
    await act(async () => {
      removal = latest.removeModel();
      await Promise.resolve();
    });
    await act(async () => {
      latest.start(); // pressed while the delete is still pending
      await Promise.resolve();
    });
    await act(async () => {
      releaseDelete();
      await removal;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(runs).toEqual(["r1"]); // the fresh runtime, never the disposed one
    expect(latest.state.phase).not.toBe("failed");
  });

  it("a rejecting delete still leaves a fresh usable runtime behind", async () => {
    const built: ReturnType<typeof makeRuntime>[] = [];
    const factory: CaptionRuntimeFactory = () => {
      const made = makeRuntime(`r${built.length}`, { cached: true });
      if (built.length === 0) made.runtime.store!.delete = async () => { throw new Error("storage refused"); };
      built.push(made);
      return made.runtime;
    };
    await render({ factory });
    let removed = -1;
    await act(async () => {
      removed = await latest.removeModel();
    });
    expect(removed).toBe(0);
    expect(built[0].dispose).toHaveBeenCalledTimes(1);
    expect(built).toHaveLength(2);
    expect(latest.runtime).toBe(built[1].runtime);
    expect(built[1].dispose).not.toHaveBeenCalled();
  });

  it("switching tier while the saved model is being deleted does not bring the old tier back", async () => {
    let releaseDelete: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (releaseDelete = resolve));
    const fastRuntimes: ReturnType<typeof makeRuntime>[] = [];
    const high = makeRuntime("high", { cached: true });
    (window as { __cutmoorCaptionTiers?: unknown }).__cutmoorCaptionTiers = [
      {
        id: "fast",
        name: "Fast",
        detail: "",
        factory: () => {
          const made = makeRuntime(`fast${fastRuntimes.length}`, { cached: true });
          made.runtime.store!.delete = async () => {
            await gate;
            return true;
          };
          fastRuntimes.push(made);
          return made.runtime;
        },
      },
      { id: "high", name: "High", detail: "", factory: () => high.runtime },
    ];
    await render({ tier: "fast" });
    let removal: Promise<number> = Promise.resolve(0);
    await act(async () => {
      removal = latest.removeModel();
      await Promise.resolve();
    });
    await render({ tier: "high" }); // the visitor picks the other model while the delete is still running
    await act(async () => {
      releaseDelete();
      await removal;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(latest.runtime).toBe(high.runtime);
    expect(high.dispose).not.toHaveBeenCalled();
  });

  it("a slow cache check for the model the visitor left does not overwrite the status of the one they chose", async () => {
    let releaseCheck: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (releaseCheck = resolve));
    const fast = makeRuntime("fast", { cached: true });
    const innerGet = fast.runtime.store!.get.bind(fast.runtime.store);
    fast.runtime.store!.get = async (key) => {
      await slow;
      return innerGet(key);
    };
    const high = makeRuntime("high"); // not cached
    (window as { __cutmoorCaptionTiers?: unknown }).__cutmoorCaptionTiers = [
      { id: "fast", name: "Fast", detail: "", factory: () => fast.runtime },
      { id: "high", name: "High", detail: "", factory: () => high.runtime },
    ];
    await render({ tier: "fast" });
    await render({ tier: "high" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(latest.modelStatus.state).toBe("missing");
    await act(async () => {
      releaseCheck(); // the old model's answer arrives late
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(latest.runtime).toBe(high.runtime);
    expect(latest.modelStatus.state).toBe("missing");
  });
});
