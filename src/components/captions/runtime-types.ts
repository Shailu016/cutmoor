import type { BurnInExporter, CaptionPipeline } from "../../lib/captioning/contracts";
import type { ModelManifest, ModelStore } from "../../lib/captioning/model-loader";

/**
 * What the page needs from the captioning engine, handed in by whoever wires the real parts
 * together. The tool page never imports the engine itself: that keeps the model code out of the
 * page until it is needed, and lets tests run the whole screen against a stand-in.
 */
export interface CaptionRuntime {
  pipeline: CaptionPipeline;
  /** The model files, so the page can show their size before anything is downloaded. Null when there is nothing to download. */
  manifest: ModelManifest | null;
  /** Where downloaded model files are kept, so the page can tell whether a download is needed and can delete them. */
  store: ModelStore | null;
  /** Burned-in MP4 export, or null when this build has none. */
  burnIn: BurnInExporter | null;
  /** Shown to the visitor, e.g. the model's name. */
  label: string;
  /** True for a fake engine used to test the screen. The page then says so, loudly. */
  isTestDouble?: boolean;
}

/** A factory may return the full runtime, or just a pipeline when nothing else is needed. */
export type CaptionRuntimeFactory = () => CaptionRuntime | CaptionPipeline | Promise<CaptionRuntime | CaptionPipeline>;

/** A choice of speech model: smaller and quicker, or bigger and more accurate. */
export interface CaptionTier {
  id: string;
  name: string;
  detail: string;
  /** True when this model needs WebGPU; the picker disables it where there is none. */
  needsGpu?: boolean;
  factory: CaptionRuntimeFactory;
}

declare global {
  interface Window {
    /** Optional list of models to choose from. The first is the default. */
    __cutmoorCaptionTiers?: CaptionTier[];
    /** Set by the build that ships the captioning engine. Absent means "not available in this build". */
    __cutmoorCaptionPipelineFactory?: CaptionRuntimeFactory;
  }
}

function isPipeline(value: CaptionRuntime | CaptionPipeline): value is CaptionPipeline {
  return typeof (value as CaptionPipeline).run === "function" && !("pipeline" in value);
}

export function normalizeRuntime(value: CaptionRuntime | CaptionPipeline): CaptionRuntime {
  if (isPipeline(value)) {
    return { pipeline: value, manifest: null, store: null, burnIn: null, label: "Speech model" };
  }
  return value;
}

// One runtime per factory, so React's double-mounting in development does not build two engines.
const runtimes = new WeakMap<CaptionRuntimeFactory, Promise<CaptionRuntime>>();

/**
 * Forgets the cached runtime for a factory, so the next `loadRuntime` builds a fresh one. Call it whenever a runtime has been
 * disposed: a disposed pipeline can never run again, and handing it out from the cache would make the tool fail on the next visit.
 */
export function releaseRuntime(factory: CaptionRuntimeFactory): void {
  runtimes.delete(factory);
}

export function loadRuntime(factory: CaptionRuntimeFactory): Promise<CaptionRuntime> {
  let pending = runtimes.get(factory);
  if (!pending) {
    pending = Promise.resolve()
      .then(factory)
      .then(normalizeRuntime);
    // A failed start must not be cached forever: the next visit may work.
    pending.catch(() => runtimes.delete(factory));
    runtimes.set(factory, pending);
  }
  return pending;
}
