import { AlertTriangle, Check, Download, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { savingsPercent, sourceLabel } from "../lib/image";
import type { ImageJob } from "../hooks/useImageJob";

export function ImageJobPanel({ job, idleHint }: { job: ImageJob; idleHint: string }) {
  const { phase, progress, result, error, file, meta, sourcePreview, loadingNote, cancel, clear } = job;
  const percent = Math.round(progress * 100);
  const savings = result && file ? savingsPercent(file.size, result.size) : null;

  return (
    <aside className="job-panel image-job-panel" aria-live="polite">
      <div className="job-head">
        <span className="mono-label">Output</span>
        <span className={`job-state job-state-${phase}`}>
          {phase === "idle" && "Waiting"}
          {phase === "loading" && "Reading"}
          {phase === "ready" && "Ready"}
          {phase === "working" && "Working"}
          {phase === "done" && "Complete"}
          {phase === "error" && "Failed"}
        </span>
      </div>

      {phase === "idle" && (
        <div className="job-body">
          <p className="job-idle">{idleHint}</p>
          <div className="job-trust">
            <ShieldCheck size={16} />
            <span>Your image is decoded and encoded in this tab. Nothing is uploaded.</span>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="job-body">
          <div className="progress-top">
            <span>{loadingNote}</span>
            <Loader2 size={15} className="spin" />
          </div>
          <div className="progress-track" role="progressbar" aria-label={loadingNote}>
            <div className="progress-fill indeterminate" style={{ width: "42%" }} />
          </div>
          <p className="job-note">
            {loadingNote.includes("HEIC")
              ? "The HEIC decoder is about 3 MB and is downloaded once, only for this file. It stays in the browser cache."
              : "The browser is reading the pixels and dimensions locally."}
          </p>
        </div>
      )}

      {phase === "ready" && (
        <div className="job-body">
          {sourcePreview && (
            <figure className="image-preview">
              <img src={sourcePreview} alt="Preview of the selected image" />
              <figcaption>Source preview</figcaption>
            </figure>
          )}
          {meta && file && (
            <div className="image-meta-row">
              <span>
                {meta.width}×{meta.height}
              </span>
              <span>{formatBytes(file.size)}</span>
              <span>{sourceLabel(meta.kind)}</span>
            </div>
          )}
          <p className="job-idle">Choose your settings, then run the tool.</p>
          <div className="job-trust">
            <ShieldCheck size={16} />
            <span>No upload endpoint. The original file stays untouched.</span>
          </div>
        </div>
      )}

      {phase === "working" && (
        <div className="job-body">
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
          >
            <div className="progress-fill" style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <p className="job-note">
            Canvas work happens on your device. Large photos and target-size searches take a few seconds longer than a
            simple resize.
          </p>
          <button className="button button-ghost button-small" type="button" onClick={cancel}>
            <X size={15} /> Cancel job
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="job-body">
          <div className="result-badge">
            <Check size={16} /> Your image is ready
          </div>

          <div className="image-compare">
            {sourcePreview && (
              <figure>
                <img src={sourcePreview} alt="Image before processing" />
                <figcaption>Before</figcaption>
              </figure>
            )}
            <figure>
              <img src={result.url} alt="Image after processing" />
              <figcaption>After</figcaption>
            </figure>
          </div>

          <div className="result-file">
            <strong title={result.name}>{result.name}</strong>
            <span>{formatBytes(result.size)}</span>
          </div>

          <div className="image-result-stats">
            <span>
              {result.width}×{result.height}
            </span>
            <span>{sourceLabel(result.format)}</span>
            {savings !== null && (
              <span className={savings >= 0 ? "stat-good" : "stat-warn"}>
                {savings >= 0 ? `${savings}% smaller` : `${Math.abs(savings)}% larger`}
              </span>
            )}
          </div>

          {result.note && <p className="job-note">{result.note}</p>}

          <a className="button button-primary button-block" href={result.url} download={result.name}>
            <Download size={17} /> Download
          </a>
          <button className="button button-ghost button-block" type="button" onClick={clear}>
            <RotateCcw size={15} /> Process another image
          </button>
          <p className="job-note">The download link lives only in this tab. Reloading the page removes it.</p>
        </div>
      )}

      {phase === "error" && (
        <div className="job-body">
          <div className="result-badge result-badge-error">
            <AlertTriangle size={16} /> The image could not be processed
          </div>
          <p className="job-error">{error}</p>
          <button className="button button-ghost button-block" type="button" onClick={clear}>
            <RotateCcw size={15} /> Try another image
          </button>
          <p className="job-note">
            Common causes: the file is not a supported image, a HEIC variant cannot be decoded, or the photo is larger
            than the browser canvas can hold. Keep the original file.
          </p>
        </div>
      )}

      {phase === "working" && (
        <div className="job-spinner" aria-hidden="true">
          <Loader2 size={18} className="spin" />
        </div>
      )}
    </aside>
  );
}
