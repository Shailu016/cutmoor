import { useCallback, useEffect, useRef, useState } from "react";
import { onFFmpegLog, onFFmpegProgress, resetFFmpeg, runFFmpeg } from "../lib/ffmpeg";
import { readVideoMeta, type VideoMeta } from "../lib/media";

export type JobPhase = "idle" | "ready" | "working" | "done" | "error";

export interface JobResult {
  url: string;
  name: string;
  size: number;
}

export interface MediaJob {
  file: File | null;
  meta: VideoMeta | null;
  phase: JobPhase;
  progress: number;
  logs: string[];
  result: JobResult | null;
  error: string | null;
  selectFile: (file: File) => Promise<void>;
  clear: () => void;
  run: (outputName: string, buildArgs: (inputName: string) => string[]) => Promise<void>;
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

  const resultUrl = useRef<string | null>(null);
  const subscriptions = useRef<Array<() => void>>([]);
  const cancelled = useRef(false);

  const releaseResult = useCallback(() => {
    if (resultUrl.current) {
      URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = null;
    }
  }, []);

  const unsubscribeAll = useCallback(() => {
    subscriptions.current.forEach((unsubscribe) => unsubscribe());
    subscriptions.current = [];
  }, []);

  useEffect(() => {
    return () => {
      releaseResult();
      unsubscribeAll();
    };
  }, [releaseResult, unsubscribeAll]);

  const selectFile = useCallback(
    async (next: File) => {
      releaseResult();
      unsubscribeAll();
      cancelled.current = false;
      setFile(next);
      setResult(null);
      setError(null);
      setProgress(0);
      setLogs([]);
      setPhase("ready");
      setMeta(null);
      const nextMeta = await readVideoMeta(next);
      setMeta(nextMeta);
    },
    [releaseResult, unsubscribeAll],
  );

  const clear = useCallback(() => {
    releaseResult();
    unsubscribeAll();
    cancelled.current = true;
    setFile(null);
    setMeta(null);
    setPhase("idle");
    setProgress(0);
    setLogs([]);
    setResult(null);
    setError(null);
  }, [releaseResult, unsubscribeAll]);

  const run = useCallback(
    async (outputName: string, buildArgs: (inputName: string) => string[]) => {
      if (!file) return;
      releaseResult();
      unsubscribeAll();
      cancelled.current = false;
      setPhase("working");
      setProgress(0);
      setLogs([]);
      setResult(null);
      setError(null);

      subscriptions.current.push(
        onFFmpegLog((message) => {
          // The wasm core prints "Aborted()" when a job's filesystem is torn
          // down even on success; it reads like an error, so drop it.
          if (!message || message === "Aborted()") return;
          setLogs((previous) => [...previous.slice(-6), message]);
        }),
      );
      subscriptions.current.push(
        onFFmpegProgress((value) => {
          setProgress(value);
        }),
      );

      try {
        const blob = await runFFmpeg({ file, outputName, args: buildArgs });
        if (cancelled.current) return;
        const url = URL.createObjectURL(blob);
        resultUrl.current = url;
        setResult({ url, name: outputName, size: blob.size });
        setProgress(1);
        setPhase("done");
      } catch (jobError) {
        if (cancelled.current) return;
        // The ffmpeg worker reports failures as strings, so handle both shapes.
        const message =
          jobError instanceof Error
            ? jobError.message
            : typeof jobError === "string" && jobError.trim()
              ? jobError
              : "The encoder failed. Try a smaller file or a different format.";
        setError(message);
        setPhase("error");
        // A failed job can leave the wasm worker in a bad state. Throw it away
        // so the next attempt starts from a clean instance.
        resetFFmpeg();
      } finally {
        unsubscribeAll();
      }
    },
    [file, releaseResult, unsubscribeAll],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    resetFFmpeg();
    unsubscribeAll();
    setPhase(file ? "ready" : "idle");
    setProgress(0);
    setError(null);
    setLogs((previous) => [...previous, "Job cancelled."]);
  }, [file, unsubscribeAll]);

  return { file, meta, phase, progress, logs, result, error, selectFile, clear, run, cancel };
}
