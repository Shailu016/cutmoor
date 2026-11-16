import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptionJobState, CaptionLanguage, CaptionResult, PipelineProgress } from "../lib/captioning/contracts";
import { cachedFileNames, deleteModel, describeDownload, type ModelManifest, type ModelStore } from "../lib/captioning/model-loader";
import type { CaptionEvent } from "../lib/captioning/types";
import { releaseBlobUrl } from "../lib/blob-url";
import { readVideoMeta, type VideoMeta } from "../lib/media";
import { monotonicProgress, toCaptionError } from "../components/captions/messages";
import { applyGlossary, applyGlossaryToEvents } from "../components/captions/glossary";
import { loadRuntime, releaseRuntime, type CaptionRuntime, type CaptionRuntimeFactory } from "../components/captions/runtime-types";

export type RuntimeStatus = "checking" | "ready" | "unavailable";

export interface ModelStatus {
  /** "unknown" until the first check finishes; "none" when this build has nothing to download. */
  state: "unknown" | "none" | "cached" | "missing";
  /** Bytes the full model set takes, or 0. */
  totalBytes: number;
}

export interface CaptionJob {
  runtimeStatus: RuntimeStatus;
  runtime: CaptionRuntime | null;
  file: File | null;
  meta: VideoMeta | null;
  /** Object URL of the chosen file, for the preview player. */
  previewUrl: string | null;
  language: CaptionLanguage;
  setLanguage: (language: CaptionLanguage) => void;
  /** "speech": read what the voice detector calls speech. "everything": read the file except stretches the vocal-activity detector is confident are instrumental (songs and music). */
  detection: "speech" | "everything";
  setDetection: (detection: "speech" | "everything") => void;
  state: CaptionJobState;
  /** performance.now() when the current run began, or null. */
  startedAt: number | null;
  modelStatus: ModelStatus;
  selectFile: (file: File) => void;
  clearFile: () => void;
  /** Starts the job, or asks for consent first when the model still has to be downloaded. */
  start: () => void;
  /** The visitor said yes to the download. */
  approveDownload: () => void;
  /** The visitor said no to the download: back to the settings. */
  declineDownload: () => void;
  cancel: () => void;
  retry: () => void;
  /** Deletes the stored model files. Returns how many were removed. */
  removeModel: () => Promise<number>;
}

const IDLE: CaptionJobState = { phase: "idle" };
const THROTTLE_MS = 100;
/** After this long with no job running, the speech model is unloaded to free memory; the next job starts it again. */
export const IDLE_UNLOAD_MS = 10 * 60 * 1000;

/** Starting the model ahead of time costs memory and power, so not on a data-saver connection or a device that reports little memory. */
function mayPrewarm(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  return nav.deviceMemory === undefined || nav.deviceMemory >= 4;
}

/**
 * Drives the captioning pipeline for the tool page and exposes it as a `CaptionJobState`.
 *
 * Privacy: nothing here makes a network request. The only network access in the whole feature is
 * the model download, and that happens inside the engine the factory builds, after the visitor
 * has said yes in the consent card.
 *
 * `factory` defaults to `window.__cutmoorCaptionPipelineFactory`. Without one the tool shows
 * "not available in this build" instead of failing.
 *
 * `glossary` is the visitor's names and special words (already parsed). It is applied where a
 * finished result is stored and to the first captions shown while the job runs, so the editor,
 * preview and exports all agree.
 */
/** Disposes a runtime and drops it from the cache, so nothing can hand the disposed one out again. */
function retireRuntime(runtime: CaptionRuntime, factory: CaptionRuntimeFactory | null): void {
  if (factory) releaseRuntime(factory);
  void runtime.pipeline.dispose().catch(() => undefined);
}

export function useCaptionJob(factory?: CaptionRuntimeFactory, tier?: string, glossary: readonly string[] = [], lyrics = ""): CaptionJob {
  const [runtime, setRuntime] = useState<CaptionRuntime | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("checking");
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState<CaptionLanguage>("hinglish");
  const [detection, setDetection] = useState<"speech" | "everything">("everything");
  const detectionRef = useRef(detection);
  detectionRef.current = detection;
  const [state, setState] = useState<CaptionJobState>(IDLE);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: "unknown", totalBytes: 0 });
  // Which runtime `modelStatus` was worked out for. A status for one model must never be read as the status of another.
  const [statusRuntime, setStatusRuntime] = useState<CaptionRuntime | null>(null);

  const previewUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const fileIdRef = useRef(0);
  const consentRef = useRef(false);
  const runtimeRef = useRef<CaptionRuntime | null>(null);
  const fileRef = useRef<File | null>(null);
  const languageRef = useRef<CaptionLanguage>("hinglish");
  languageRef.current = language;
  // The glossary is read when a result arrives, not captured when the run starts, so a
  // visitor can type names in the settings card and get them on that same run.
  const glossaryRef = useRef<readonly string[]>(glossary);
  glossaryRef.current = glossary;
  // The pasted lyrics are also read at run time, for the same reason: typing them after a run must work on the next one.
  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  // Read once on mount: a caller passing a new function every render must not restart the engine.
  const factoryRef = useRef(factory);
  /** Set while "Delete saved model" is working; see `begin`. */
  const removalRef = useRef<Promise<unknown> | null>(null);
  // Which factory the live runtime came from, and which one the visitor wants now (they differ while a tier switch is loading).
  const runtimeFactoryRef = useRef<CaptionRuntimeFactory | null>(null);
  const wantedFactoryRef = useRef<CaptionRuntimeFactory | null>(null);

  // ---- find the engine -------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let resolved: CaptionRuntimeFactory | undefined = factoryRef.current;
      if (!resolved && import.meta.env.DEV) {
        // Development only: `?captions-test` swaps in a fake engine so the screen can be tried without any model. It wins over
        // the real engine, which is registered whenever the model list exists. The branch is removed from production builds, so the fake can never ship.
        const mode = new URLSearchParams(window.location.search).get("captions-test");
        if (mode !== null) {
          const dev = await import("../components/captions/dev-runtime");
          resolved = dev.createUiTestRuntimeFactory(mode);
        }
      }
      resolved ??= window.__cutmoorCaptionTiers?.find((item) => item.id === tier)?.factory ?? window.__cutmoorCaptionPipelineFactory;
      if (cancelled) return;
      if (!resolved) {
        setRuntimeStatus("unavailable");
        return;
      }
      wantedFactoryRef.current = resolved;
      try {
        const loaded = await loadRuntime(resolved);
        if (cancelled) {
          // This load was abandoned (the visitor changed model while it ran). Free it unless the same factory is still wanted.
          if (wantedFactoryRef.current !== resolved && runtimeRef.current !== loaded) retireRuntime(loaded, resolved);
          return;
        }
        // Switching model: free the one we are leaving.
        const previous = runtimeRef.current;
        if (previous && previous !== loaded) retireRuntime(previous, runtimeFactoryRef.current);
        runtimeRef.current = loaded;
        runtimeFactoryRef.current = resolved;
        // A new model has not been checked yet: forget the old model's status so nothing acts on it.
        setModelStatus({ state: "unknown", totalBytes: 0 });
        setStatusRuntime(null);
        setRuntime(loaded);
        setRuntimeStatus("ready");
      } catch {
        if (!cancelled) setRuntimeStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tier]);

  // ---- warm-up and idle unload ------------------------------------------------------------

  // When a file is chosen and the model is already saved in this browser (so nothing needs downloading), start the model now:
  // the visitor spends time reading the settings anyway. Never before they have agreed to a download.
  const warmedRef = useRef<WeakSet<object>>(new WeakSet());
  useEffect(() => {
    if (!runtime || !file || modelStatus.state !== "cached" || statusRuntime !== runtime) return;
    if (state.phase === "running" || state.phase === "needs-consent") return;
    if (warmedRef.current.has(runtime) || !mayPrewarm()) return;
    warmedRef.current.add(runtime);
    void runtime.pipeline.prewarm?.();
  }, [runtime, file, modelStatus.state, statusRuntime, state.phase]);

  // After ten quiet minutes the model is unloaded (its memory can be several hundred MB of GPU); the next job loads it again.
  useEffect(() => {
    if (!runtime || state.phase === "running" || state.phase === "needs-consent") return;
    const timer = setTimeout(() => {
      warmedRef.current.delete(runtime);
      void runtime.pipeline.unloadModels?.();
    }, IDLE_UNLOAD_MS);
    return () => clearTimeout(timer);
  }, [runtime, state.phase, file]);

  const refreshModelStatus = useCallback(async (target: CaptionRuntime | null) => {
    // The answer is shown only if this model is still the current one when it arrives: a slow check for the model the visitor has
    // just left must not overwrite the status of the one they chose.
    const stillCurrent = () => runtimeRef.current === target;
    if (!target || !target.manifest || !target.store) {
      if (stillCurrent()) {
        setModelStatus({ state: "none", totalBytes: 0 });
        setStatusRuntime(target);
      }
      return;
    }
    try {
      const cached = await cachedFileNames(target.manifest, target.store);
      const info = describeDownload(target.manifest, cached);
      const total = target.manifest.files.reduce((sum, item) => sum + item.bytes, 0);
      if (!stillCurrent()) return;
      setModelStatus({ state: info.alreadyDownloaded ? "cached" : "missing", totalBytes: total });
      setStatusRuntime(target);
    } catch {
      if (!stillCurrent()) return;
      setModelStatus({ state: "unknown", totalBytes: 0 });
      setStatusRuntime(target);
    }
  }, []);

  useEffect(() => {
    if (runtimeStatus === "ready") void refreshModelStatus(runtime);
  }, [runtimeStatus, runtime, refreshModelStatus]);

  // ---- file ------------------------------------------------------------------------------

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) {
      releaseBlobUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const stopRun = useCallback(() => {
    runIdRef.current += 1; // anything still in flight becomes stale and is ignored
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const selectFile = useCallback(
    (next: File) => {
      stopRun();
      releasePreview();
      const id = (fileIdRef.current += 1);
      const url = URL.createObjectURL(next);
      previewUrlRef.current = url;
      fileRef.current = next;
      setFile(next);
      setPreviewUrl(url);
      setMeta(null);
      setState(IDLE);
      setStartedAt(null);
      void readVideoMeta(next).then((read) => {
        if (fileIdRef.current === id) setMeta(read);
      });
    },
    [releasePreview, stopRun],
  );

  const clearFile = useCallback(() => {
    stopRun();
    fileIdRef.current += 1;
    fileRef.current = null;
    releasePreview();
    setFile(null);
    setMeta(null);
    setState(IDLE);
    setStartedAt(null);
  }, [releasePreview, stopRun]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      if (previewUrlRef.current) releaseBlobUrl(previewUrlRef.current);
      // Free the model's memory when the visitor leaves the page, and forget it so coming back builds a fresh one.
      if (runtimeRef.current) retireRuntime(runtimeRef.current, runtimeFactoryRef.current);
      runtimeRef.current = null;
      runtimeFactoryRef.current = null;
    };
  }, []);

  // ---- running ---------------------------------------------------------------------------

  const execute = useCallback(
    async (target: CaptionRuntime, input: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = (runIdRef.current += 1);
      const isCurrent = () => runIdRef.current === runId;

      const started = performance.now();
      setStartedAt(started);
      const first: PipelineProgress = { stage: "reading-audio", fraction: 0, message: "Starting" };
      setState({ phase: "running", progress: first, events: [] });

      // Progress can arrive many times a second (every downloaded chunk). Showing it that often
      // would just make the page stutter, so the latest values are published about ten times a second.
      let highest = 0;
      let latestProgress = first;
      let latestEvents: CaptionEvent[] = [];
      let timer: number | undefined;
      const publish = () => {
        timer = undefined;
        if (!isCurrent()) return;
        setState((current) => (current.phase === "running" ? { phase: "running", progress: latestProgress, events: latestEvents } : current));
      };
      const schedule = () => {
        if (timer === undefined) timer = window.setTimeout(publish, THROTTLE_MS);
      };

      try {
        const result: CaptionResult = await target.pipeline.run(input, {
          language: languageRef.current,
          signal: controller.signal,
          glossary: glossaryRef.current,
          lyrics: lyricsRef.current.trim() === "" ? undefined : lyricsRef.current,
          detection: detectionRef.current,
          onProgress: (progress) => {
            const safe = monotonicProgress(highest, progress);
            highest = safe.fraction;
            latestProgress = safe;
            schedule();
          },
          onPartial: (events, words) => {
            latestEvents = applyGlossaryToEvents(events, words, glossaryRef.current);
            schedule();
          },
        });
        if (timer !== undefined) window.clearTimeout(timer);
        if (!isCurrent()) return;
        if (controller.signal.aborted) {
          setState({ phase: "cancelled" });
          return;
        }
        setState({ phase: "done", result: applyGlossary(result, glossaryRef.current) });
        void refreshModelStatus(target);
      } catch (error) {
        if (timer !== undefined) window.clearTimeout(timer);
        if (!isCurrent()) return;
        const failure = toCaptionError(error, controller.signal);
        setState(failure.code === "aborted" ? { phase: "cancelled" } : { phase: "failed", error: failure });
        if (failure.code === "model-download") void refreshModelStatus(target);
      } finally {
        if (isCurrent()) abortRef.current = null;
      }
    },
    [refreshModelStatus],
  );

  const begin = useCallback(
    async (skipConsent: boolean) => {
      // Deleting the saved model replaces the runtime; a Start pressed meanwhile waits for the fresh one instead of using the disposed one.
      if (removalRef.current) await removalRef.current.catch(() => undefined);
      const target = runtimeRef.current;
      const input = fileRef.current;
      if (!target || !input) return;
      const ticket = (runIdRef.current += 1); // so a click that is overtaken by Cancel or a new file is dropped
      if (!skipConsent && !consentRef.current && target.manifest && target.store) {
        try {
          const cached = await cachedFileNames(target.manifest, target.store);
          const info = describeDownload(target.manifest, cached);
          if (runIdRef.current !== ticket) return;
          if (!info.alreadyDownloaded) {
            setState({ phase: "needs-consent", download: { totalBytes: info.totalBytes, hosts: info.hosts, fileCount: info.fileCount } });
            return;
          }
        } catch {
          // If the store cannot be read, ask anyway: a visitor is never downloaded to without a yes.
          if (runIdRef.current !== ticket) return;
          const total = target.manifest.files.reduce((sum, item) => sum + item.bytes, 0);
          setState({ phase: "needs-consent", download: { totalBytes: total, hosts: describeDownload(target.manifest).hosts, fileCount: target.manifest.files.length } });
          return;
        }
      }
      if (runIdRef.current !== ticket) return;
      await execute(target, input);
    },
    [execute],
  );

  const start = useCallback(() => void begin(false), [begin]);

  const approveDownload = useCallback(() => {
    consentRef.current = true;
    void begin(true);
  }, [begin]);

  const declineDownload = useCallback(() => {
    stopRun();
    setState(IDLE);
  }, [stopRun]);

  const cancel = useCallback(() => {
    stopRun();
    setState((current) => (current.phase === "running" || current.phase === "needs-consent" ? { phase: "cancelled" } : current));
    setStartedAt(null);
  }, [stopRun]);

  const retry = useCallback(() => void begin(false), [begin]);

  const removeModel = useCallback((): Promise<number> => {
    const target = runtimeRef.current;
    if (!target?.manifest || !target.store) return Promise.resolve(0);
    stopRun();
    setState((current) => (current.phase === "running" || current.phase === "needs-consent" ? IDLE : current));
    const factoryOfTarget = runtimeFactoryRef.current;
    const work = (async () => {
      let removed = 0;
      try {
        // Release the model from memory first, so the files can be removed and nothing keeps using them.
        await target.pipeline.dispose().catch(() => undefined);
        removed = await deleteModel(target.manifest as ModelManifest, target.store as ModelStore);
      } catch {
        // The files could not be removed. The runtime was disposed all the same, so it still has to be replaced below.
        removed = 0;
      } finally {
        // Whatever happened, the earlier "yes, download" belongs to the old situation: ask again next time.
        consentRef.current = false;
      }
      // The disposed runtime must not be reused: build a fresh one for the next run, unless the visitor switched model meanwhile.
      if (factoryOfTarget) releaseRuntime(factoryOfTarget);
      const stillWanted = () => !!factoryOfTarget && runtimeFactoryRef.current === factoryOfTarget && wantedFactoryRef.current === factoryOfTarget;
      if (stillWanted()) {
        try {
          const fresh = await loadRuntime(factoryOfTarget as CaptionRuntimeFactory);
          // The visitor may have chosen the other model while this one was being rebuilt: then this one is not wanted any more.
          if (stillWanted()) {
            runtimeRef.current = fresh;
            setRuntime(fresh);
            await refreshModelStatus(fresh);
          } else {
            retireRuntime(fresh, factoryOfTarget as CaptionRuntimeFactory);
          }
        } catch {
          setRuntimeStatus("unavailable");
        }
      } else {
        await refreshModelStatus(runtimeRef.current);
      }
      return removed;
    })();
    removalRef.current = work;
    const clear = () => {
      if (removalRef.current === work) removalRef.current = null;
    };
    work.then(clear, clear);
    return work;
  }, [refreshModelStatus, stopRun]);

  return {
    runtimeStatus,
    runtime,
    file,
    meta,
    previewUrl,
    language,
    setLanguage,
    detection,
    setDetection,
    state,
    startedAt,
    modelStatus,
    selectFile,
    clearFile,
    start,
    approveDownload,
    declineDownload,
    cancel,
    retry,
    removeModel,
  };
}
