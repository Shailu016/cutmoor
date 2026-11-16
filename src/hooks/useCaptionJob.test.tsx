import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionPipeline, CaptionResult, PipelineOptions } from "../lib/captioning/contracts";
import type { CaptionEvent, Word } from "../lib/captioning/types";
import { CaptionError } from "../lib/captioning/contracts";
import { ModelLoadError, storeKey, type ModelFile, type ModelManifest, type ModelStore } from "../lib/captioning/model-loader";
import type { CaptionRuntime } from "../components/captions/runtime-types";
import { useCaptionJob, type CaptionJob } from "./useCaptionJob";

// jsdom cannot decode video, and reading metadata would wait for its 8 s timeout.
vi.mock("../lib/media", () => ({
  readVideoMeta: async () => ({ duration: 6, width: 1280, height: 720, hasVideo: true }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FILE: ModelFile = { name: "m", url: "https://models.cutmoor.com/m/x.bin", bytes: 8, sha256: "a".repeat(64) };
const MANIFEST: ModelManifest = { id: "t", version: "1", files: [FILE] };

function memoryStore(): ModelStore & { keys: () => string[] } {
  const data = new Map<string, Uint8Array>();
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, bytes) => void data.set(key, bytes),
    delete: async (key) => data.delete(key),
    keys: () => [...data.keys()],
  };
}

const RESULT: CaptionResult = {
  words: [{ text: "hi", startMs: 0, endMs: 400, confidence: 1, index: 0, windowIndex: 0 }],
  events: [],
  uncoveredSpeech: [],
  stats: { audioSeconds: 1, speechSeconds: 1, windows: 1, flaggedWindows: 0, droppedWords: 0, stageMs: {}, engineId: "e", alignerId: "a" },
};

interface Call {
  options: PipelineOptions;
  resolve: (result: CaptionResult) => void;
  reject: (error: unknown) => void;
}

/** A pipeline whose runs only finish when the test says so. */
function controllable() {
  const calls: Call[] = [];
  const dispose = vi.fn(async () => undefined);
  const pipeline: CaptionPipeline = {
    run: (_file, options) =>
      new Promise<CaptionResult>((resolve, reject) => {
        calls.push({ options, resolve, reject });
        options.signal?.addEventListener("abort", () => reject(new CaptionError("aborted", "stop")));
      }),
    dispose,
  };
  return { pipeline, calls, dispose };
}

let root: Root;
let container: HTMLDivElement;
let latest: CaptionJob;

function Probe({ runtime, glossary }: { runtime: CaptionRuntime; glossary?: string[] }) {
  latest = useCaptionJob(() => runtime, undefined, glossary);
  return null;
}

async function mount(runtime: CaptionRuntime, glossary?: string[]): Promise<CaptionRuntime> {
  await act(async () => {
    root.render(createElement(Probe, { runtime, glossary }));
  });
  // The runtime loads in an effect; give its promise a turn.
  await act(async () => {
    await Promise.resolve();
  });
  return runtime;
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 150))));
const video = () => new File(["x"], "clip.mp4", { type: "video/mp4" });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function runtimeWith(store: ModelStore | null, pipeline: CaptionPipeline, manifest: ModelManifest | null = MANIFEST): CaptionRuntime {
  return { pipeline, manifest, store, burnIn: null, label: "Test model" };
}

describe("useCaptionJob", () => {
  it("says the tool is unavailable when no engine is provided", async () => {
    await act(async () => {
      root.render(createElement(() => ((latest = useCaptionJob()), null)));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.runtimeStatus).toBe("unavailable");
    expect(latest.state.phase).toBe("idle");
  });

  it("asks for consent before downloading, shows the facts, and does not start the pipeline", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(memoryStore(), pipeline));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    expect(latest.state).toEqual({ phase: "needs-consent", download: { totalBytes: 8, hosts: ["https://models.cutmoor.com"], fileCount: 1 } });
    expect(calls).toHaveLength(0);
    expect(latest.modelStatus.state).toBe("missing");
  });

  it("runs after the visitor agrees, then reports the result", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(memoryStore(), pipeline));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    await act(async () => latest.approveDownload());
    expect(calls).toHaveLength(1);
    expect(latest.state.phase).toBe("running");
    expect(calls[0].options.language).toBe("hinglish");
    await act(async () => calls[0].resolve(RESULT));
    expect(latest.state).toEqual({ phase: "done", result: RESULT });
  });

  it("reads the whole file by default, with no setting to change", async () => {
    const { pipeline, calls } = controllable();
    await mount({ pipeline, manifest: null, store: null, burnIn: null, label: "test" });
    await act(async () => latest.selectFile(video()));
    await settle();
    await act(async () => latest.start());
    await settle();
    expect(calls[0].options.detection).toBe("everything");
  });

  it("passes the chosen language to the pipeline", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.setLanguage("hindi"));
    await act(async () => latest.start());
    expect(calls[0].options.language).toBe("hindi");
  });

  it("starts straight away, with no question, when the model is already stored", async () => {
    const { pipeline, calls } = controllable();
    const store = memoryStore();
    await store.put(storeKey(FILE), new Uint8Array(FILE.bytes));
    await mount(runtimeWith(store, pipeline));
    expect(latest.modelStatus.state).toBe("cached");
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    expect(calls).toHaveLength(1);
    expect(latest.state.phase).toBe("running");
  });

  it("declining the download goes back to idle without running", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(memoryStore(), pipeline));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    await act(async () => latest.declineDownload());
    expect(latest.state.phase).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("cancel aborts the run, and a late result from it is ignored", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    await act(async () => latest.cancel());
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(latest.state.phase).toBe("cancelled");
    await act(async () => calls[0].resolve(RESULT)); // the engine finished anyway
    expect(latest.state.phase).toBe("cancelled");
  });

  it("choosing another file during a run stops it and ignores its result", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    await act(async () => latest.selectFile(video()));
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(latest.state.phase).toBe("idle");
    await act(async () => calls[0].resolve(RESULT));
    expect(latest.state.phase).toBe("idle");
  });

  it("turns failures into CaptionErrors the screen can explain", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));

    await act(async () => latest.start());
    await act(async () => calls[0].reject(new ModelLoadError("integrity", "hash differs")));
    expect(latest.state.phase === "failed" && latest.state.error.code).toBe("model-download");

    await act(async () => latest.retry());
    await act(async () => calls[1].reject(new CaptionError("no-audio", "none")));
    expect(latest.state.phase === "failed" && latest.state.error.code).toBe("no-audio");

    await act(async () => latest.retry());
    await act(async () => calls[2].reject(new TypeError("boom")));
    expect(latest.state.phase === "failed" && latest.state.error.code).toBe("internal");
  });

  it("a cancel reported by the pipeline is a cancel, not a failure", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    await act(async () => calls[0].reject(new CaptionError("aborted", "stopped by the engine")));
    expect(latest.state.phase).toBe("cancelled");
  });

  it("shows a retryable interruption when the browser stops the model by itself", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());

    // The browser raised AbortError on its own: the visitor did not touch Cancel.
    await act(async () => calls[0].reject(new DOMException("the GPU went away", "AbortError")));
    expect(latest.state.phase).toBe("failed");
    expect(latest.state.phase === "failed" && latest.state.error.code).toBe("interrupted");

    // The pipeline can wrap that same browser error as an ordinary inference failure.
    await act(async () => latest.retry());
    await act(async () => calls[1].reject(new CaptionError("inference", "the model failed", { cause: new DOMException("worker killed", "AbortError") })));
    expect(latest.state.phase === "failed" && latest.state.error.code).toBe("interrupted");
  });

  it("never shows progress going backwards, and passes partial captions on", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    const report = (fraction: number) => calls[0].options.onProgress?.({ stage: "transcribing", fraction, message: "x" });
    await act(async () => report(0.5));
    await act(async () => report(0.3));
    await settle();
    expect(latest.state.phase === "running" && latest.state.progress.fraction).toBe(0.5);
    const events = [{ index: 0, startMs: 0, endMs: 1000, lines: [] }];
    await act(async () => calls[0].options.onPartial?.(events, []));
    await settle();
    expect(latest.state.phase === "running" && latest.state.events).toEqual(events);
  });

  it("deleting the model empties the store, frees memory, and asks again next time", async () => {
    const { pipeline, dispose } = controllable();
    const store = memoryStore();
    await store.put(storeKey(FILE), new Uint8Array(FILE.bytes));
    await mount(runtimeWith(store, pipeline));
    expect(latest.modelStatus.state).toBe("cached");
    let removed = 0;
    await act(async () => {
      removed = await latest.removeModel();
    });
    expect(removed).toBe(1);
    expect(store.keys()).toEqual([]);
    expect(dispose).toHaveBeenCalled();
    expect(latest.modelStatus.state).toBe("missing");
  });

  it("accepts a bare pipeline from the factory (no manifest, so no consent step)", async () => {
    const { pipeline, calls } = controllable();
    await act(async () => {
      root.render(createElement(() => ((latest = useCaptionJob(() => pipeline)), null)));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.runtimeStatus).toBe("ready");
    expect(latest.modelStatus.state).toBe("none");
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    expect(calls).toHaveLength(1);
  });

  it("frees the model when the page is left", async () => {
    const { pipeline, dispose } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => root.unmount());
    expect(dispose).toHaveBeenCalled();
    root = createRoot(container); // so afterEach can unmount
  });

  it("applies the glossary to a finished result without touching timings or other words", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null), ["Mumma", "Cutmoor"]);
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());

    const engineResult: CaptionResult = {
      ...RESULT,
      words: [
        { text: "Muma", startMs: 0, endMs: 400, confidence: 0.6, index: 0, windowIndex: 0 },
        { text: "cutmoor", startMs: 500, endMs: 900, confidence: 0.7, index: 1, windowIndex: 0 },
        { text: "Hello", startMs: 1000, endMs: 1400, confidence: 0.8, index: 2, windowIndex: 0 },
      ],
    };
    await act(async () => calls[0].resolve(engineResult));

    const state = latest.state;
    expect(state.phase).toBe("done");
    if (state.phase !== "done") return;
    expect(state.result).not.toBe(engineResult);
    expect(state.result.words.map((item) => item.text)).toEqual(["Mumma", "Cutmoor", "Hello"]);
    expect(state.result.words[0]).toMatchObject({ startMs: 0, endMs: 400, confidence: 0.6, index: 0, windowIndex: 0 });
    expect(state.result.words[1]).toMatchObject({ startMs: 500, endMs: 900, confidence: 0.7, index: 1, windowIndex: 0 });
  });

  it("passes a finished result through unchanged when there is no glossary", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null));
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());
    await act(async () => calls[0].resolve(RESULT));

    const state = latest.state;
    expect(state.phase).toBe("done");
    if (state.phase !== "done") return;
    expect(state.result).toBe(RESULT);
  });

  it("applies the glossary to the first captions shown while a job runs", async () => {
    const { pipeline, calls } = controllable();
    await mount(runtimeWith(null, pipeline, null), ["Mumma"]);
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());

    const words: Word[] = [
      { text: "Muma", startMs: 0, endMs: 400, confidence: 0.6, index: 0, windowIndex: 0 },
      { text: "video", startMs: 500, endMs: 900, confidence: 0.7, index: 1, windowIndex: 0 },
    ];
    const events: CaptionEvent[] = [{ index: 0, startMs: 0, endMs: 900, lines: [[words[0], words[1]]] }];
    await act(async () => calls[0].options.onPartial?.(events, words));
    await settle();

    const state = latest.state;
    expect(state.phase).toBe("running");
    if (state.phase !== "running") return;
    expect(state.events[0].lines[0].map((item) => item.text)).toEqual(["Mumma", "video"]);
    expect(state.events[0].lines[0]).toHaveLength(2);
    expect(state.events[0].endMs).toBe(900);
  });

  it("uses a glossary typed while the job is already running", async () => {
    const { pipeline, calls } = controllable();
    const runtime = runtimeWith(null, pipeline, null);
    await mount(runtime);
    await act(async () => latest.selectFile(video()));
    await act(async () => latest.start());

    // The visitor types the name in the settings card after pressing the button.
    await act(async () => {
      root.render(createElement(Probe, { runtime, glossary: ["Mumma"] }));
    });
    const engineResult: CaptionResult = {
      ...RESULT,
      words: [{ text: "Muma", startMs: 0, endMs: 400, confidence: 1, index: 0, windowIndex: 0 }],
    };
    await act(async () => calls[0].resolve(engineResult));

    const state = latest.state;
    expect(state.phase).toBe("done");
    if (state.phase !== "done") return;
    expect(state.result.words[0].text).toBe("Mumma");
  });
});
