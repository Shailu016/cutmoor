import { useCallback, useEffect, useRef, useState } from "react";
import { releaseBlobUrl } from "../lib/blob-url";
import { onFFmpegLog, onFFmpegProgress, resetFFmpeg, runFFmpeg, runFFmpegJob, type JobInputs } from "../lib/ffmpeg";
import { describeJobError } from "../lib/ffmpeg-errors";
import { readVideoMeta, type VideoMeta } from "../lib/media";
import { holdScreenAwake } from "../lib/wake-lock";

export type JobPhase = "idle" | "ready" | "working" | "done" | "error";

export interface JobResult {
  url: string;
  name: string;
  size: number;
  /** Measured processing time. Excludes the one-time encoder download. */
  processMs: number;
  /** Measured encoder download and start-up time for this run; near zero when already loaded. */
  engineLoadMs: number;
  /** Something worth saying about this result. */
  note?: string;
}

/** What a job that does not go through the FFmpeg runner can report while it works. */
export interface CustomJobContext {
  signal: AbortSignal;
  setProgress: (value: number) => void;
  setStatus: (text: string | null) => void;
  setOutputBytes: (bytes: number) => void;
  log: (message: string) => void;
}

export interface CustomJobOutput {
  blob: Blob;
  note?: string;
  /** Frees storage kept for the result, once it is replaced or cleared. */
  release?: () => void | Promise<void>;
}

export interface MediaJob {
  file: File | null;
  meta: VideoMeta | null;
  phase: JobPhase;
  progress: number;
  logs: string[];
  result: JobResult | null;
  error: string | null;
  previewUrl: string | null;
  /** performance.now() when the current run started, or null when idle. */
  startedAt: number | null;
  /** True after the user cancelled the last run, until the next run or file. */
  wasCancelled: boolean;
  /** What a custom job is doing right now, in plain words. */
  status: string | null;
  /** Bytes a custom job has written so far. */
  outputBytes: number;
  selectFile: (file: File) => Promise<void>;
  clear: () => void;
  run: (outputName: string, buildArgs: (inputName: string) => string[]) => Promise<void>;
  /**
   * Like `run`, for tools with several inputs (a second clip, a logo, a sound track). `inputs` are written to the
   * encoder in order; the first should be the chosen file. With `probe`, `build` also receives what the encoder
   * found in each file (audio or not, length, frame rate).
   */
  runMulti: (outputName: string, inputs: Array<File | Blob>, build: (inputs: JobInputs) => string[], options?: { probe?: boolean }) => Promise<void>;
  /** Runs work that reports its own progress, with the same result, error and cancel handling as other jobs. */
  runCustom: (outputName: string, work: (context: CustomJobContext) => Promise<CustomJobOutput>) => Promise<void>;
  cancel: () => void;
}

/**
 * Shared job state for every ffmpeg tool: file pick, metadata, progress,
 * result blob, cleanup. Keeping this in one place is what makes the tools
 * consistent and stops each page from leaking object URLs.
 */
export function useMediaJob(): MediaJob {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [wasCancelled, setWasCancelled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [outputBytes, setOutputBytes] = useState(0);

  const abort = useRef<AbortController | null>(null);
  const releaseStorage = useRef<(() => void | Promise<void>) | null>(null);
  const resultUrl = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const subscriptions = useRef<Array<() => void>>([]);
  /** Changes whenever the current run ends early or a new one starts, so late results from an old run are ignored. */
  const currentRun = useRef(0);

  const releaseResult = useCallback(() => {
    if (resultUrl.current) {
      releaseBlobUrl(resultUrl.current);
      resultUrl.current = null;
    }
    void releaseStorage.current?.();
    releaseStorage.current = null;
  }, []);

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) {
      releaseBlobUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const unsubscribeAll = useCallback(() => {
    subscriptions.current.forEach((unsubscribe) => unsubscribe());
    subscriptions.current = [];
  }, []);

  useEffect(() => {
    return () => {
      releaseResult();
      releasePreview();
      unsubscribeAll();
    };
  }, [releaseResult, releasePreview, unsubscribeAll]);

  const selectFile = useCallback(
    async (next: File) => {
      releaseResult();
      releasePreview();
      unsubscribeAll();
      currentRun.current += 1;
      setFile(next);
      setResult(null);
      setError(null);
      setProgress(0);
      setLogs([]);
      setPhase("ready");
      setMeta(null);
      setStartedAt(null);
      setWasCancelled(false);
      setStatus(null);
      setOutputBytes(0);
      const url = URL.createObjectURL(next);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      const nextMeta = await readVideoMeta(next);
      setMeta(nextMeta);
    },
    [releaseResult, releasePreview, unsubscribeAll],
  );

  const clear = useCallback(() => {
    releaseResult();
    releasePreview();
    unsubscribeAll();
    currentRun.current += 1;
    abort.current?.abort();
    setStatus(null);
    setOutputBytes(0);
    setFile(null);
    setMeta(null);
    setPhase("idle");
    setProgress(0);
    setLogs([]);
    setResult(null);
    setError(null);
    setStartedAt(null);
    setWasCancelled(false);
  }, [releaseResult, releasePreview, unsubscribeAll]);

  /** Shared by `run` and `runMulti`: progress, result, error and cleanup are the same whatever the command is. */
  const execute = useCallback(
    async (
      outputName: string,
      work: (onTimings: (value: { engineLoadMs: number; processMs: number }) => void) => Promise<Blob | CustomJobOutput>,
      encoderProgress = true,
    ) => {
      releaseResult();
      unsubscribeAll();
      currentRun.current += 1;
      const run = currentRun.current;
      setPhase("working");
      setProgress(0);
      setLogs([]);
      setResult(null);
      setError(null);
      setWasCancelled(false);
      setStatus(null);
      setOutputBytes(0);
      const started = performance.now();
      setStartedAt(started);
      const releaseScreen = holdScreenAwake();
      let timings = { engineLoadMs: 0, processMs: 0 };

      subscriptions.current.push(
        onFFmpegLog((message) => {
          // The wasm core prints "Aborted()" when a job's filesystem is torn
          // down even on success; it reads like an error, so drop it.
          if (!message || message === "Aborted()") return;
          setLogs((previous) => [...previous.slice(-6), message]);
        }),
      );
      if (encoderProgress) {
        subscriptions.current.push(
          onFFmpegProgress((value) => {
            setProgress(value);
          }),
        );
      }

      try {
        const finished = await work((measured) => {
          timings = measured;
        });
        const output = finished instanceof Blob ? { blob: finished } : finished;
        if (run !== currentRun.current) {
          await output.release?.();
          return;
        }
        if (!timings.processMs) timings = { engineLoadMs: 0, processMs: performance.now() - started };
        const url = URL.createObjectURL(output.blob);
        resultUrl.current = url;
        releaseStorage.current = output.release ?? null;
        setResult({ url, name: outputName, size: output.blob.size, note: output.note, ...timings });
        setStatus(null);
        setProgress(1);
        setPhase("done");
      } catch (jobError) {
        if (run !== currentRun.current) return;
        setError(describeJobError(jobError));
        setStatus(null);
        setPhase("error");
        // A failed job can leave the wasm worker in a bad state. Throw it away
        // so the next attempt starts from a clean instance.
        resetFFmpeg();
      } finally {
        releaseScreen();
        if (run === currentRun.current) unsubscribeAll();
      }
    },
    [releaseResult, unsubscribeAll],
  );

  const run = useCallback(
    async (outputName: string, buildArgs: (inputName: string) => string[]) => {
      if (!file) return;
      await execute(outputName, (onTimings) => runFFmpeg({ file, outputName, args: buildArgs, onTimings }));
    },
    [file, execute],
  );

  const runMulti = useCallback(
    async (outputName: string, inputs: Array<File | Blob>, build: (inputs: JobInputs) => string[], options?: { probe?: boolean }) => {
      if (!file || inputs.length === 0) return;
      await execute(outputName, (onTimings) => runFFmpegJob({ inputs, outputName, build, probe: options?.probe, onTimings }));
    },
    [file, execute],
  );

  const runCustom = useCallback(
    async (outputName: string, work: (context: CustomJobContext) => Promise<CustomJobOutput>) => {
      if (!file) return;
      const controller = new AbortController();
      abort.current = controller;
      await execute(
        outputName,
        () =>
          work({
            signal: controller.signal,
            setProgress: (value) => {
              if (!controller.signal.aborted) setProgress(value);
            },
            setStatus: (text) => {
              if (!controller.signal.aborted) setStatus(text);
            },
            setOutputBytes: (bytes) => {
              if (!controller.signal.aborted) setOutputBytes(bytes);
            },
            log: (message) => {
              if (!controller.signal.aborted) setLogs((previous) => [...previous.slice(-6), message]);
            },
          }),
        false,
      );
    },
    [file, execute],
  );

  const cancel = useCallback(() => {
    currentRun.current += 1;
    abort.current?.abort();
    resetFFmpeg();
    unsubscribeAll();
    setPhase(file ? "ready" : "idle");
    setProgress(0);
    setError(null);
    setStartedAt(null);
    setStatus(null);
    setOutputBytes(0);
    setWasCancelled(true);
    setLogs((previous) => [...previous, "Job cancelled."]);
  }, [file, unsubscribeAll]);

  return {
    file,
    meta,
    phase,
    progress,
    logs,
    result,
    error,
    previewUrl,
    startedAt,
    wasCancelled,
    status,
    outputBytes,
    selectFile,
    clear,
    run,
    runMulti,
    runCustom,
    cancel,
  };
}
