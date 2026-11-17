import { useEffect, useState } from "react";
import { AlertTriangle, Check, Download, Film, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { extensionOf, formatBytes, formatDuration } from "../lib/format";
import { formatElapsed } from "../lib/results";
import { useElapsed } from "../hooks/useElapsed";
import { ResultSummary } from "./ResultSummary";
import { ScreenMedia, type ScreenKind } from "./ScreenMedia";
import type { MediaJob } from "../hooks/useMediaJob";

type PreviewKind = ScreenKind | null;

function previewKind(name: string): PreviewKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "opus", "aac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  return null;
}

/**
 * The output panel of every video and audio tool. Layout rule: the panel has a
 * fixed height, the screen is always 16:9, and the detail area below scrolls
 * inside itself, so no state (waiting, ready, working, done, failed) can move
 * the page.
 */
export function JobPanel({ job, idleHint }: { job: MediaJob; idleHint: string }) {
  const { phase, progress, result, error, logs, file, meta, previewUrl, startedAt, wasCancelled, cancel, clear } = job;
  const loadingEncoder = phase === "working" && progress === 0;
  // Progress is only shown as a percentage when the encoder can measure it: it needs the source duration.
  const measurable = !loadingEncoder && (meta ? meta.duration > 0 : true);
  const elapsed = useElapsed(startedAt, phase === "working");
  const originalDetail = meta
    ? [meta.width > 0 && meta.height > 0 ? `${meta.width}×${meta.height}` : null, meta.duration > 0 ? formatDuration(meta.duration) : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  // A GIF or a picture (the GIF, slideshow and watermark tools take them) is shown as a picture, not as a sound.
  const sourceIsImage = Boolean(file && (file.type.startsWith("image/") || /\.(gif|png|jpe?g|webp)$/i.test(file.name)));
  const sourceKind: ScreenKind | null = previewUrl && meta ? (sourceIsImage ? "image" : meta.width > 0 && meta.height > 0 ? "video" : "audio") : null;
  const resultKind = result ? previewKind(result.name) : null;
  const [previewFailed, setPreviewFailed] = useState(false);
  const [view, setView] = useState<"before" | "after">("after");

  useEffect(() => {
    setPreviewFailed(false);
    setView("after");
  }, [result?.url]);

  const canCompare = phase === "done" && Boolean(result) && Boolean(resultKind) && !previewFailed;
  const showingResult = canCompare && view === "after";

  return (
    <aside className="job-panel" aria-live="polite">
      <div className="job-head">
        <span className="mono-label">Output</span>
        <span className={`job-state job-state-${phase}`}>
          {phase === "idle" && "Waiting"}
          {phase === "ready" && (wasCancelled ? "Cancelled" : "Ready")}
          {phase === "working" && "Working"}
          {phase === "done" && "Complete"}
          {phase === "error" && "Failed"}
        </span>
      </div>

      <div className="job-screen">
        {showingResult && result && resultKind ? (
          <ScreenMedia kind={resultKind} url={result.url} controls label={`Result: ${result.name}`} onError={() => setPreviewFailed(true)} />
        ) : sourceKind && phase !== "idle" && phase !== "error" ? (
          <ScreenMedia kind={sourceKind} url={previewUrl} controls label={file ? `Source: ${file.name}` : "Source preview"} />
        ) : (
          <div className="demo-center">
            {phase === "error" ? <AlertTriangle size={22} aria-hidden="true" /> : <Film size={22} aria-hidden="true" />}
            <span>{phase === "error" ? "Nothing to show" : "Your file appears here"}</span>
          </div>
        )}
        {phase === "working" && <div className="demo-dim" aria-hidden="true" />}
        {(phase === "ready" || phase === "working" || canCompare) && (
          <span className="demo-badge">{canCompare ? (view === "after" ? "After" : "Before") : "Source"}</span>
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
              <span className={measurable ? undefined : "indeterminate"} style={measurable ? { width: `${Math.max(2, progress * 100)}%` } : undefined} />
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
              <span>Your file is read and written locally. Nothing is uploaded.</span>
            </div>
          </>
        )}

        {phase === "ready" && (
          <>
            {wasCancelled && (
              <p className="job-note job-note-cancelled" role="status">
                Job cancelled. Nothing was changed and your file is still loaded.
              </p>
            )}
            <p className="job-idle">{file ? "File ready. Choose your settings, then run the tool." : "Choose a file to begin."}</p>
            {meta && file && (
              <div className="meta-row">
                {meta.duration > 0 && <span>{formatDuration(meta.duration)}</span>}
                {meta.width > 0 && meta.height > 0 && (
                  <span>
                    {meta.width}×{meta.height}
                  </span>
                )}
                <span>{formatBytes(file.size)}</span>
              </div>
            )}
            <div className="job-trust">
              <ShieldCheck size={16} />
              <span>The first run loads the encoder once. Later runs start faster.</span>
            </div>
          </>
        )}

        {phase === "working" && (
          <>
            <div className="progress-top">
              <span>{loadingEncoder ? "Loading the encoder…" : "Encoding…"}</span>
              <span>{measurable ? `${Math.round(progress * 100)}%` : "Working"}</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={measurable ? Math.round(progress * 100) : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={measurable ? `${Math.round(progress * 100)} percent` : "In progress"}
            >
              <div
                className={`progress-fill ${measurable ? "" : "indeterminate"}`}
                style={measurable ? { width: `${Math.max(2, progress * 100)}%` } : undefined}
              />
            </div>
            <p className="job-elapsed">Elapsed {formatElapsed(elapsed)}</p>
            <p className="job-note">
              {loadingEncoder
                ? "The ~32 MB encoder is downloading once and will be cached by your browser."
                : "Keep this tab open. Encoding uses your device's CPU, so it may take a little while."}
            </p>
            <button className="button button-ghost button-small" type="button" onClick={cancel}>
              <X size={15} /> Cancel job
            </button>
          </>
        )}

        {phase === "done" && result && (
          <>
            <div className="result-badge">
              <Check size={16} /> Your file is ready
            </div>
            <a className="button button-primary button-block" href={result.url} download={result.name}>
              <Download size={17} /> Download
            </a>
            {file && (
              <ResultSummary
                original={{ name: file.name, bytes: file.size, format: extensionOf(file.name).toUpperCase() || "FILE", detail: originalDetail || undefined }}
                processed={{ name: result.name, bytes: result.size, format: extensionOf(result.name).toUpperCase() }}
                processMs={result.processMs}
                engineLoadMs={result.engineLoadMs}
              />
            )}
            {previewFailed && (
              <p className="job-note">
                This browser cannot preview the output format inline. Download the file to check it in your media player.
              </p>
            )}
            <button className="button button-ghost button-block" type="button" onClick={clear}>
              <RotateCcw size={15} /> Start another file
            </button>
            <p className="job-note">The download link lives only in this tab. Reloading the page removes it.</p>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="result-badge result-badge-error">
              <AlertTriangle size={16} /> The job did not finish
            </div>
            <p className="job-error" role="alert">{error}</p>
            <button className="button button-ghost button-block" type="button" onClick={clear}>
              <RotateCcw size={15} /> Try another file
            </button>
            <p className="job-note">
              Common causes: the file is larger than the tab's memory, the format is unusual, or the encoder was
              interrupted. Keep the original file.
            </p>
          </>
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
      </div>
    </aside>
  );
}
