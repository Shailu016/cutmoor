import { useEffect, useState } from "react";
import { AlertTriangle, Check, Download, ImageIcon, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { sourceLabel } from "../lib/image";
import { formatElapsed } from "../lib/results";
import { useElapsed } from "../hooks/useElapsed";
import { ResultSummary } from "./ResultSummary";
import { ScreenMedia } from "./ScreenMedia";
import type { ImageJob } from "../hooks/useImageJob";

/**
 * The output panel of every image tool. Same layout rule as the video panel:
 * a fixed height, an always-present 16:9 screen, and a detail area that scrolls
 * inside itself, so no state can move the page.
 */
export function ImageJobPanel({ job, idleHint }: { job: ImageJob; idleHint: string }) {
  const { phase, progress, result, error, file, meta, sourcePreview, loadingNote, startedAt, wasCancelled, cancel, clear } = job;
  const percent = Math.round(progress * 100);
  const elapsed = useElapsed(startedAt, phase === "working");
  const [view, setView] = useState<"before" | "after">("after");

  useEffect(() => {
    setView("after");
  }, [result?.url]);

  const canCompare = phase === "done" && Boolean(result) && Boolean(sourcePreview);
  const showingResult = phase === "done" && Boolean(result) && (view === "after" || !sourcePreview);

  return (
    <aside className="job-panel image-job-panel" aria-live="polite">
      <div className="job-head">
        <span className="mono-label">Output</span>
        <span className={`job-state job-state-${phase}`}>
          {phase === "idle" && "Waiting"}
          {phase === "loading" && "Reading"}
          {phase === "ready" && (wasCancelled ? "Cancelled" : "Ready")}
          {phase === "working" && "Working"}
          {phase === "done" && "Complete"}
          {phase === "error" && "Failed"}
        </span>
      </div>

      <div className="job-screen">
        {showingResult && result ? (
          <ScreenMedia kind="image" url={result.url} label="Image after processing" />
        ) : sourcePreview && phase !== "idle" && phase !== "error" && phase !== "loading" ? (
          <ScreenMedia kind="image" url={sourcePreview} label={phase === "done" ? "Image before processing" : "Preview of the selected image"} />
        ) : (
          <div className="demo-center">
            {phase === "loading" ? <Loader2 size={22} className="spin" aria-hidden="true" /> : phase === "error" ? <AlertTriangle size={22} aria-hidden="true" /> : <ImageIcon size={22} aria-hidden="true" />}
            <span>{phase === "loading" ? loadingNote : phase === "error" ? "Nothing to show" : "Your image appears here"}</span>
          </div>
        )}
        {phase === "working" && <div className="demo-dim" aria-hidden="true" />}
        {(phase === "ready" || phase === "working" || phase === "done") && (
          <span className="demo-badge">{phase === "done" ? (showingResult ? "After" : "Before") : "Source"}</span>
        )}
        {canCompare && (
          <div className="demo-switch" role="group" aria-label="Compare before and after">
            {(["before", "after"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={view === item} className={view === item ? "active" : undefined} onClick={() => setView(item)}>
                {item === "before" ? "Before" : "After"}
              </button>
            ))}
          </div>
        )}
        {phase === "working" && (
          <div className="demo-info" aria-hidden="true">
            <div className="demo-progress">
              <span style={{ width: `${Math.max(3, percent)}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="job-body">
        {phase === "idle" && (
          <>
            <p className="job-idle">{idleHint}</p>
            <div className="job-trust">
              <ShieldCheck size={16} />
              <span>Your image is decoded and encoded in this tab. Nothing is uploaded.</span>
            </div>
          </>
        )}

        {phase === "loading" && (
          <>
            <div className="progress-top">
              <span>{loadingNote}</span>
              <Loader2 size={15} className="spin" />
            </div>
            <div className="progress-track" role="progressbar" aria-label={loadingNote} aria-valuetext="Loading">
              <div className="progress-fill indeterminate" style={{ width: "42%" }} />
            </div>
            <p className="job-note">
              {loadingNote.includes("HEIC")
                ? "The HEIC decoder is about 3 MB and is downloaded once, only for this file. It stays in the browser cache."
                : "The browser is reading the pixels and dimensions locally."}
            </p>
          </>
        )}

        {phase === "ready" && (
          <>
            {meta && file && (
              <div className="image-meta-row">
                <span>
                  {meta.width}×{meta.height}
                </span>
                <span>{formatBytes(file.size)}</span>
                <span>{sourceLabel(meta.kind)}</span>
                {meta.hasAlpha && <span>Transparency</span>}
              </div>
            )}
            {wasCancelled && (
              <p className="job-note job-note-cancelled" role="status">
                Job cancelled. Nothing was changed and your image is still loaded.
              </p>
            )}
            <p className="job-idle">Choose your settings, then run the tool.</p>
            <div className="job-trust">
              <ShieldCheck size={16} />
              <span>No upload endpoint. The original file stays untouched.</span>
            </div>
          </>
        )}

        {phase === "working" && (
          <>
            <div className="progress-top">
              <span>{progress === 0 ? "Starting…" : "Rendering and encoding…"}</span>
              <span>{percent}%</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${percent} percent`}
            >
              <div className="progress-fill" style={{ width: `${Math.max(3, percent)}%` }} />
            </div>
            <p className="job-elapsed">Elapsed {formatElapsed(elapsed)}</p>
            <p className="job-note">
              Canvas work happens on your device. Large photos and target-size searches take a few seconds longer than a
              simple resize.
            </p>
            <button className="button button-ghost button-small" type="button" onClick={cancel}>
              <X size={15} /> Cancel job
            </button>
          </>
        )}

        {phase === "done" && result && (
          <>
            <div className="result-badge">
              <Check size={16} /> Your image is ready
            </div>
            <a className="button button-primary button-block" href={result.url} download={result.name}>
              <Download size={17} /> Download
            </a>
            {file && meta && (
              <ResultSummary
                original={{ name: file.name, bytes: file.size, format: sourceLabel(meta.kind), detail: `${meta.width}×${meta.height}` }}
                processed={{ name: result.name, bytes: result.size, format: sourceLabel(result.format), detail: `${result.width}×${result.height}` }}
                processMs={result.processMs}
              />
            )}
            {result.note && <p className="job-note">{result.note}</p>}
            <button className="button button-ghost button-block" type="button" onClick={clear}>
              <RotateCcw size={15} /> Process another image
            </button>
            <p className="job-note">The download link lives only in this tab. Reloading the page removes it.</p>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="result-badge result-badge-error">
              <AlertTriangle size={16} /> The image could not be read or processed
            </div>
            <p className="job-error" role="alert">{error}</p>
            <button className="button button-ghost button-block" type="button" onClick={clear}>
              <RotateCcw size={15} /> Try another image
            </button>
            <p className="job-note">
              Common causes: the file is not a supported image, a HEIC variant cannot be decoded, or the photo is larger
              than the browser canvas can hold. Keep the original file.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
