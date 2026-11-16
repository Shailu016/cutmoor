import { CaptionError, type CaptionErrorCode, type PipelineProgress } from "../../lib/captioning/contracts";
import { ModelLoadError } from "../../lib/captioning/model-loader";
import { formatBytes } from "../../lib/format";

/**
 * Words for the visitor. Every failure the pipeline can report has a plain-English title, what
 * most likely happened, and what to try. Nothing here shows a raw error string or a stack trace.
 */
export interface ErrorCopy {
  title: string;
  detail: string;
  /** Whether trying the same file again can help. */
  canRetry: boolean;
}

export const ERROR_COPY: Record<CaptionErrorCode, ErrorCopy> = {
  aborted: {
    title: "Job stopped",
    detail: "You stopped the job. Nothing was saved and your file is still loaded.",
    canRetry: true,
  },
  "unsupported-file": {
    title: "This browser cannot read the sound in this file",
    detail:
      "The file is in a format or codec this browser cannot decode. An MP4 with H.264 video and AAC sound, a WAV or an MP3 usually works. You can convert the file first with the Convert video tool, then come back.",
    canRetry: false,
  },
  "no-audio": {
    title: "This file has no sound",
    detail: "There is no audio track in the file, so there is nothing to caption. Check that you chose the right file.",
    canRetry: false,
  },
  "no-speech": {
    title: "No speech found",
    detail:
      "The sound was readable, but nobody seemed to be talking. Music, background noise or a very quiet recording can look like this. Try a clip where the voice is clearer.",
    canRetry: false,
  },
  "model-download": {
    title: "The speech model did not download",
    detail:
      "The connection dropped or the model server did not answer, so nothing was loaded. Check your internet connection and try again. Files that finished downloading are kept. Your video was never involved: only the model file is downloaded.",
    canRetry: true,
  },
  "model-load": {
    title: "The speech model would not start",
    detail:
      "The model downloaded but this device could not start it, usually because it ran out of memory. Close other tabs and apps and try again, or use a desktop computer with Chrome or Edge.",
    canRetry: true,
  },
  "device-lost": {
    title: "The graphics chip stopped responding",
    detail:
      "Your device reset its graphics chip while the model was running, and the slower backup mode could not finish either. Close heavy tabs and try again. A shorter clip also helps.",
    canRetry: true,
  },
  interrupted: {
    title: "The browser stopped the speech model",
    detail:
      "This was not your stop: the browser or the graphics chip interrupted the model while it was reading the sound. Nothing was saved, and your file is still loaded. Trying again usually works; closing heavy tabs first can help.",
    canRetry: true,
  },
  inference: {
    title: "The model failed on part of the audio",
    detail: "The speech model hit a problem while reading a section of the sound. Try again. If it keeps happening, try a shorter clip.",
    canRetry: true,
  },
  export: {
    title: "Could not make that file",
    detail:
      "The export did not finish. The caption text is still here, so you can download an SRT or VTT file instead. For a video with captions burned in, try Chrome or Edge on a computer.",
    canRetry: true,
  },
  internal: {
    title: "Something unexpected went wrong",
    detail: "The captioning tool hit a problem it did not expect. Reload the page and try again. If it keeps happening, try a shorter clip.",
    canRetry: true,
  },
};

export function describeCaptionError(error: CaptionError): ErrorCopy {
  return ERROR_COPY[error.code] ?? ERROR_COPY.internal;
}

/**
 * Turns whatever was thrown into a CaptionError, so the screen only ever deals with one kind.
 *
 * Only the visitor's own stop is a cancel. The browser raises the same `AbortError` name when it
 * stops the model by itself (a GPU reset, a killed worker, a dropped tab), and that is a failure
 * worth a retry card, not "Stopped. Nothing was saved". ORT-web does not always use that name (see
 * `isAbortLike`), and the pipeline can wrap the browser-side error in a `CaptionError("inference")`,
 * so the cause chain is inspected too.
 */
export function toCaptionError(error: unknown, signal?: AbortSignal): CaptionError {
  // The visitor's own stop wins over everything else: nothing that happened after it is a failure.
  if (signal?.aborted) return new CaptionError("aborted", "Cancelled.", { cause: error });
  if (error instanceof CaptionError) {
    if (error.code === "inference" && isAbortLike(error.cause)) return interrupted(error);
    return error;
  }
  if (error instanceof ModelLoadError) {
    return error.code === "aborted"
      ? new CaptionError("aborted", "The download was cancelled.", { cause: error })
      : new CaptionError("model-download", error.message, { cause: error });
  }
  // Without an aborted signal, an AbortError is the browser giving up on the model, not the visitor.
  if (isAbortLike(error)) return interrupted(error);
  return new CaptionError("internal", error instanceof Error ? error.message : "Unknown error.", { cause: error });
}

function interrupted(cause: unknown): CaptionError {
  return new CaptionError("interrupted", "The browser stopped the speech model before the job finished.", { cause });
}

/**
 * True for a browser abort anywhere in an error's cause chain (the pipeline wraps the engine's error).
 *
 * The name `AbortError` is the documented shape, but ORT-web does not always raise a DOMException: after a
 * device loss the same abort can surface as `Error("Aborted")` or as an error carrying `code === 20`
 * (`DOMException.ABORT_ERR`). All three mean the browser/GPU gave up on the model, not that the visitor did
 * (the signal check in `toCaptionError` runs first, so a real stop never reaches here).
 */
function isAbortLike(error: unknown, depth = 0): boolean {
  if (depth > 8 || error === null || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; cause?: unknown; code?: unknown; message?: unknown };
  if (candidate.name === "AbortError") return true;
  if (candidate.code === 20) return true;
  if (/^abort(ed)?$/i.test(String(candidate.message ?? ""))) return true;
  return isAbortLike(candidate.cause, depth + 1);
}

export interface ProgressView {
  /** Short line for the heading, e.g. "Transcribing 2 of 5". */
  label: string;
  /** 0 to 100, whole number. */
  percent: number;
  /** Second line, or null. For a download it says how many megabytes have arrived. */
  detail: string | null;
}

/** What to show for a progress report. The percentage is the pipeline's own fraction, clamped to 0..100, never invented. */
export function describeProgress(progress: PipelineProgress): ProgressView {
  const fraction = Number.isFinite(progress.fraction) ? Math.min(1, Math.max(0, progress.fraction)) : 0;
  const download = progress.download;
  const downloading = progress.stage === "loading-model" && download && download.totalBytes > 0 && download.loadedBytes < download.totalBytes;
  const preparing = progress.stage === "loading-model" && !downloading;
  return {
    label: downloading ? "Downloading the speech model (one time)" : preparing ? "Starting the speech model on your device" : progress.message || "Working",
    percent: Math.round(fraction * 100),
    detail: downloading
      ? `${formatBytes(download.loadedBytes)} of ${formatBytes(download.totalBytes)}`
      : preparing
        ? "Nothing is stuck. The first start can take a minute or two, longer with the larger model."
        : null,
  };
}

/** Keeps a job's progress from ever going backwards, whatever order reports arrive in. */
export function monotonicProgress(previousFraction: number, progress: PipelineProgress): PipelineProgress {
  const next = Number.isFinite(progress.fraction) ? progress.fraction : 0;
  const fraction = Math.min(1, Math.max(previousFraction, next, 0));
  return fraction === progress.fraction ? progress : { ...progress, fraction };
}
