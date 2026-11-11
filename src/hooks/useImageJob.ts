import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPreview,
  detectAlpha,
  loadImage,
  type ImageFormat,
  type ImageMeta,
  type LoadedImage,
} from "../lib/image";

export type ImageJobPhase = "idle" | "loading" | "ready" | "working" | "done" | "error";

export interface ImageJobResult {
  url: string;
  name: string;
  size: number;
  width: number;
  height: number;
  format: ImageFormat;
  note?: string;
}

export interface ImageTaskContext {
  loaded: LoadedImage;
  onProgress: (value: number) => void;
  signal: AbortSignal;
}

export interface ImageTaskResult {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  format: ImageFormat;
  note?: string;
}

export interface ImageJob {
  file: File | null;
  meta: ImageMeta | null;
  phase: ImageJobPhase;
  progress: number;
  loadingNote: string;
  result: ImageJobResult | null;
  error: string | null;
  sourcePreview: string | null;
  source: LoadedImage | null;
  selectFile: (file: File) => Promise<void>;
  clear: () => void;
  run: (task: (context: ImageTaskContext) => Promise<ImageTaskResult>) => Promise<void>;
  cancel: () => void;
}

/**
 * Shared state for the image tools. The decoded source is kept alive between
 * settings changes so a second run does not pay for decoding again. Every
 * object URL is owned here and released on clear, replace, or unmount.
 */
export function useImageJob(): ImageJob {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [phase, setPhase] = useState<ImageJobPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [loadingNote, setLoadingNote] = useState("Reading the image…");
  const [result, setResult] = useState<ImageJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [source, setSource] = useState<LoadedImage | null>(null);

  const loadedRef = useRef<LoadedImage | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workingRef = useRef(false);
  const tokenRef = useRef(0);

  const releaseLoaded = useCallback(() => {
    if (loadedRef.current) {
      loadedRef.current.release();
      loadedRef.current = null;
    }
  }, []);

  const releaseResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      abortRef.current?.abort();
      releaseLoaded();
      releaseResult();
    };
  }, [releaseLoaded, releaseResult]);

  const clear = useCallback(() => {
    tokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    workingRef.current = false;
    releaseLoaded();
    releaseResult();
    setFile(null);
    setMeta(null);
    setPhase("idle");
    setProgress(0);
    setLoadingNote("Reading the image…");
    setResult(null);
    setError(null);
    setSourcePreview(null);
    setSource(null);
  }, [releaseLoaded, releaseResult]);

  const selectFile = useCallback(
    async (next: File) => {
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      abortRef.current?.abort();
      abortRef.current = null;
      workingRef.current = false;
      releaseLoaded();
      releaseResult();
      setFile(next);
      setMeta(null);
      setPhase("loading");
      setProgress(0);
      setLoadingNote("Reading the image…");
      setResult(null);
      setError(null);
      setSourcePreview(null);
      setSource(null);

      try {
        const loaded = await loadImage(next, {
          onStatus: (status) => {
            if (tokenRef.current !== token) return;
            setLoadingNote(status === "heic-decoder" ? "Loading the local HEIC decoder…" : "Reading the image…");
          },
        });
        if (tokenRef.current !== token) {
          loaded.release();
          return;
        }
        loadedRef.current = loaded;
        const hasAlpha = detectAlpha(loaded);
        setMeta({
          width: loaded.width,
          height: loaded.height,
          kind: loaded.kind,
          hasAlpha,
        });
        setSourcePreview(createPreview(loaded, hasAlpha));
        setSource(loaded);
        setPhase("ready");
      } catch (loadError) {
        if (tokenRef.current !== token) return;
        const message =
          loadError instanceof Error
            ? loadError.message
            : "This image could not be read. Try a JPEG, PNG, WebP, AVIF, GIF, BMP, or HEIC file.";
        setError(message);
        setPhase("error");
      }
    },
    [releaseLoaded, releaseResult],
  );

  const run = useCallback(
    async (task: (context: ImageTaskContext) => Promise<ImageTaskResult>) => {
      if (!loadedRef.current || !file) return;
      if (workingRef.current || phase === "working") return;

      workingRef.current = true;
      abortRef.current?.abort();
      abortRef.current = null;
      releaseResult();
      const controller = new AbortController();
      abortRef.current = controller;
      const token = tokenRef.current;

      setPhase("working");
      setProgress(0);
      setResult(null);
      setError(null);

      try {
        const output = await task({
          loaded: loadedRef.current,
          signal: controller.signal,
          onProgress: (value) => {
            if (tokenRef.current !== token) return;
            if (!Number.isFinite(value)) return;
            setProgress(Math.max(0, Math.min(1, value)));
          },
        });
        if (tokenRef.current !== token || controller.signal.aborted) return;
        const url = URL.createObjectURL(output.blob);
        resultUrlRef.current = url;
        setResult({
          url,
          name: output.name,
          size: output.blob.size,
          width: output.width,
          height: output.height,
          format: output.format,
          note: output.note,
        });
        setProgress(1);
        setPhase("done");
      } catch (jobError) {
        if (tokenRef.current !== token) return;
        if (controller.signal.aborted || (jobError instanceof DOMException && jobError.name === "AbortError")) {
          if (abortRef.current === controller) {
            setPhase(loadedRef.current ? "ready" : "idle");
            setProgress(0);
          }
          return;
        }
        const message =
          jobError instanceof Error
            ? jobError.message
            : "The image could not be processed. Try another file or a different format.";
        setError(message);
        setPhase("error");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          workingRef.current = false;
        }
      }
    },
    [file, phase, releaseResult],
  );

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    workingRef.current = false;
    setPhase(loadedRef.current ? "ready" : "idle");
    setProgress(0);
    setError(null);
  }, []);

  return {
    file,
    meta,
    phase,
    progress,
    loadingNote,
    result,
    error,
    sourcePreview,
    source,
    selectFile,
    clear,
    run,
    cancel,
  };
}
