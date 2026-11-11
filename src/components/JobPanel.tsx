import { AlertTriangle, Check, Download, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import type { MediaJob } from "../hooks/useMediaJob";

export function JobPanel({ job, idleHint }: { job: MediaJob; idleHint: string }) {
  const { phase, progress, result, error, logs, file, cancel, clear } = job;
  const loadingEncoder = phase === "working" && progress === 0;

  return (
    <aside className="job-panel" aria-live="polite">
      <div className="job-head">
        <span className="mono-label">Output</span>
        <span className={`job-state job-state-${phase}`}>
          {phase === "idle" && "Waiting"}
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
            <span>Your file is read and written locally. Nothing is uploaded.</span>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <div className="job-body">
          <p className="job-idle">
            {file ? "File ready. Choose your settings, then run the tool." : "Choose a file to begin."}
          </p>
          <div className="job-trust">
            <ShieldCheck size={16} />
            <span>The first run loads the encoder once. Later runs start faster.</span>
          </div>
        </div>
      )}

      {phase === "working" && (
        <div className="job-body">
          <div className="progress-top">
            <span>{loadingEncoder ? "Loading the encoder…" : "Encoding…"}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="progress-track" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`progress-fill ${loadingEncoder ? "indeterminate" : ""}`} style={{ width: `${Math.max(2, progress * 100)}%` }} />
          </div>
          <p className="job-note">
            {loadingEncoder
              ? "The ~32 MB encoder is downloading once and will be cached by your browser."
              : "Keep this tab open. Encoding uses your device's CPU, so it may take a little while."}
          </p>
          <button className="button button-ghost button-small" type="button" onClick={cancel}>
            <X size={15} /> Cancel job
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="job-body">
          <div className="result-badge">
            <Check size={16} /> Your file is ready
          </div>
          <div className="result-file">
            <strong title={result.name}>{result.name}</strong>
            <span>{formatBytes(result.size)}</span>
          </div>
          <a className="button button-primary button-block" href={result.url} download={result.name}>
            <Download size={17} /> Download
          </a>
          <button className="button button-ghost button-block" type="button" onClick={clear}>
            <RotateCcw size={15} /> Start another file
          </button>
          <p className="job-note">The download link lives only in this tab. Reloading the page removes it.</p>
        </div>
      )}

      {phase === "error" && (
        <div className="job-body">
          <div className="result-badge result-badge-error">
            <AlertTriangle size={16} /> The job did not finish
          </div>
          <p className="job-error">{error}</p>
          <button className="button button-ghost button-block" type="button" onClick={clear}>
            <RotateCcw size={15} /> Try another file
          </button>
          <p className="job-note">
            Common causes: the file is larger than the tab's memory, the format is unusual, or the encoder was
            interrupted. Keep the original file.
          </p>
        </div>
      )}

      {logs.length > 0 && phase !== "idle" && (
        <details className="job-log">
          <summary>Encoder log</summary>
          <pre>{logs.join("\n")}</pre>
        </details>
      )}

      {phase === "working" && (
        <div className="job-spinner" aria-hidden="true">
          <Loader2 size={18} className="spin" />
        </div>
      )}
    </aside>
  );
}
