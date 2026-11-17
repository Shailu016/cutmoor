import { useEffect, useRef } from "react";
import { AlertTriangle, CloudDownload, Loader2, RotateCcw, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import type { CaptionError, PipelineProgress } from "../../lib/captioning/contracts";
import type { CaptionEvent } from "../../lib/captioning/types";
import { formatBytes } from "../../lib/format";
import { formatElapsed } from "../../lib/results";
import type { ModelStatus } from "../../hooks/useCaptionJob";
import type { CaptionTier } from "./runtime-types";
import { describeCaptionError, describeProgress } from "./messages";
import { formatClock } from "./time";

/**
 * True when this browser can plausibly run the large model: WebGPU is there, and the device does not report very little memory
 * (`navigator.deviceMemory` is only in Chromium and caps at 8; absent means "unknown", which we allow).
 */
export function gpuCanRunLargeModel(): boolean {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory === undefined || memory >= 4;
}

interface SettingsProps {
  tiers?: CaptionTier[];
  tier?: string;
  onTier?: (id: string) => void;
  modelStatus: ModelStatus;
  modelLabel: string;
  onRemoveModel: () => void;
  onStart: () => void;
  /** A previous run's failure, or a note that it was cancelled. */
  failure: CaptionError | null;
  cancelled: boolean;
  onRetry: () => void;
  durationSeconds: number;
  testDouble: boolean;
  /** Text the visitor typed in the names and special words box. */
  glossary?: string;
  onGlossary?: (value: string) => void;
  /**
   * The visitor's own lyrics or script, optional. The pipeline places these words on the audio
   * instead of guessing them; the text never leaves the device.
   */
  lyrics?: string;
  onLyrics?: (value: string) => void;
  /** Disables the inputs while a job is running or waiting for consent. */
  busy?: boolean;
}

/** The first card: choose the language and start. After a failure it also explains what happened. */
export function SettingsCard({ tiers = [], tier = "", onTier, modelStatus, modelLabel, onRemoveModel, onStart, failure, cancelled, onRetry, durationSeconds, testDouble, glossary = "", onGlossary, lyrics = "", onLyrics, busy = false }: SettingsProps) {
  const copy = failure ? describeCaptionError(failure) : null;

  return (
    <div className="settings-card cap-stage-card">
      {copy && (
        <div className="cap-alert" role="alert">
          <strong>
            <AlertTriangle size={16} aria-hidden="true" /> {copy.title}
          </strong>
          <p>{copy.detail}</p>
          {copy.canRetry && (
            <button type="button" className="button button-ghost button-small" onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      )}
      {cancelled && !copy && (
        <p className="cap-note" role="status">
          Stopped. Nothing was saved and your file is still loaded.
        </p>
      )}

      <div className="settings-head">
        <span className="mono-label">01 · Speech model</span>
      </div>
      {tiers.length > 1 && (
        <>
          <div className="segmented" role="group" aria-label="Speech model">
            {tiers.map((item) => {
              const unavailable = Boolean(item.needsGpu) && !gpuCanRunLargeModel();
              return (
                <button key={item.id} type="button" className={tier === item.id ? "segment active" : "segment"} aria-pressed={tier === item.id} disabled={unavailable} onClick={() => onTier?.(item.id)}>
                  {item.name}
                </button>
              );
            })}
          </div>
          <p className="settings-note">
            {tiers.find((item) => item.id === tier)?.detail}
            {tiers.some((item) => item.needsGpu) && !gpuCanRunLargeModel() ? " The more accurate model needs a browser with WebGPU (recent Chrome or Edge on a computer with at least 4 GB of memory)." : ""}
          </p>
        </>
      )}
      <p className="settings-note">
        {testDouble
          ? "Test mode: a stand-in engine writes made-up sample sentences. These captions are not a real transcript."
          : modelStatus.state === "cached"
            ? `${modelLabel} is saved in this browser (${formatBytes(modelStatus.totalBytes)}), so it starts straight away.`
            : modelStatus.state === "missing"
              ? `${modelLabel} downloads once (${formatBytes(modelStatus.totalBytes)}) and is kept in this browser for next time. You will be asked before anything downloads.`
              : "The speech model runs on your device. Your video and its sound are never uploaded."}
        {modelStatus.state === "cached" && !testDouble && (
          <>
            {" "}
            <button type="button" className="cap-linkbutton" onClick={onRemoveModel}>
              <Trash2 size={13} aria-hidden="true" /> Delete saved model
            </button>
          </>
        )}
      </p>

      <details className="cap-glossary">
        <summary>
          <span className="mono-label">02 · Names and special words (optional)</span>
        </summary>
        <div className="cap-glossary-body">
          <label className="cap-glossary-label" htmlFor="cap-glossary-input">
            Names and special words
          </label>
          <textarea
            id="cap-glossary-input"
            className="cap-glossary-input"
            value={glossary}
            onChange={(event) => onGlossary?.(event.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Mumma, Rahul, Cutmoor"
            aria-describedby="cap-glossary-hint"
          />
          <p id="cap-glossary-hint" className="settings-note">
            Separate with commas. Example: Mumma, Rahul, Study Point, Lucknow. The model is told to expect these, and a heard word that sounds like one is changed to your spelling.
          </p>
        </div>
      </details>

      <details className="cap-glossary">
        <summary>
          <span className="mono-label">03 · Lyrics or script (optional)</span>
        </summary>
        <div className="cap-glossary-body">
          <label className="cap-glossary-label" htmlFor="cap-lyrics-input">
            Lyrics or script
          </label>
          <textarea
            id="cap-lyrics-input"
            className="cap-glossary-input"
            value={lyrics}
            onChange={(event) => onLyrics?.(event.target.value)}
            disabled={busy}
            rows={4}
            placeholder={"Tum ho to har safar aasan lagta hai\nTum ho to mushkil bhi aasan lagta hai"}
            aria-describedby="cap-lyrics-hint"
          />
          <p id="cap-lyrics-hint" className="settings-note">
            Paste the lyrics or the script and Cutmoor lines the words up with the audio instead of guessing. The text stays in this browser and is never uploaded.
          </p>
          {tier !== "high" && (
            <p className="settings-note">Timing from your words is most precise with High accuracy. On Draft it is a rougher estimate, and some lines may fall back to ordinary captioning.</p>
          )}
          <p className="cap-privacy">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Nothing in this box is uploaded or saved after you leave the page.</span>
          </p>
        </div>
      </details>

      <button className="button button-primary button-block button-lg" type="button" onClick={onStart}>
        <Sparkles size={17} aria-hidden="true" /> Generate captions
      </button>
      <p className="settings-footnote">
        {durationSeconds > 0 ? `${formatClock(durationSeconds * 1000)} of audio · ` : ""}Runs in this tab · keep it open while it works
      </p>
    </div>
  );
}

interface ConsentProps {
  totalBytes: number;
  hosts: string[];
  fileCount: number;
  onApprove: () => void;
  onDecline: () => void;
}

/** Asks before anything is downloaded, with the facts a visitor needs to say yes. */
export function ConsentCard({ totalBytes, hosts, fileCount, onApprove, onDecline }: ConsentProps) {
  const approve = useRef<HTMLButtonElement>(null);
  useEffect(() => approve.current?.focus(), []);
  const hostText = hosts.map((host) => host.replace(/^https?:\/\//, "")).join(", ");
  return (
    <div className="settings-card cap-stage-card" role="group" aria-labelledby="cap-consent-title">
      <div className="settings-head">
        <span className="mono-label">One-time download</span>
      </div>
      <h3 id="cap-consent-title" className="cap-consent-title">
        <CloudDownload size={20} aria-hidden="true" /> Download the speech model?
      </h3>
      <dl className="cap-facts">
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(totalBytes)}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{fileCount}</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>{hostText || "our model host"}</dd>
        </div>
      </dl>
      <p className="settings-note">
        Wi-Fi is recommended: this is a large file. It downloads once and is saved in this browser, so next time the captions start straight away. You can delete it any time from this page.
      </p>
      <p className="cap-privacy">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>Only the model file is downloaded. Your video, its sound, the text and the file name stay on this device.</span>
      </p>
      <div className="cap-button-row">
        <button ref={approve} type="button" className="button button-primary button-lg" onClick={onApprove}>
          Download and start
        </button>
        <button type="button" className="button button-ghost button-lg" onClick={onDecline}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface ProgressProps {
  progress: PipelineProgress;
  events: CaptionEvent[];
  elapsedMs: number;
  onCancel: () => void;
}

/** Progress while the job runs, with the first captions appearing as soon as they exist. */
export function ProgressCard({ progress, events, elapsedMs, onCancel }: ProgressProps) {
  const view = describeProgress(progress);
  const listRef = useRef<HTMLOListElement>(null);
  // Announce at most every 10 percent or when the stage changes, so a screen reader is not flooded.
  const announced = `${view.label}. ${Math.floor(view.percent / 10) * 10} percent.`;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [events.length]);

  return (
    <div className="settings-card cap-stage-card">
      <div className="settings-head">
        <span className="mono-label">Working</span>
        <span className="settings-hint">Elapsed {formatElapsed(elapsedMs)}</span>
      </div>
      <div className="cap-progress">
        <div className="cap-progress-top">
          <strong>{view.label}</strong>
          <span>{view.percent}%</span>
        </div>
        <div
          className="cap-track"
          role="progressbar"
          aria-label="Caption progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          aria-valuetext={`${view.label}, ${view.percent} percent`}
        >
          <div className="cap-fill" style={{ width: `${Math.max(2, view.percent)}%` }} />
        </div>
        {view.detail && <p className="settings-footnote">{view.detail}</p>}
      </div>
      <p className="cap-sr" role="status" aria-live="polite">
        {announced}
      </p>

      <div className="settings-head">
        <span className="mono-label">First captions</span>
        <span className="settings-hint">{events.length === 0 ? "None yet" : `${events.length} so far`}</span>
      </div>
      <ol className="cap-partial" ref={listRef} aria-label="Captions found so far">
        {events.length === 0 && (
          <li className="cap-partial-empty">
            <Loader2 size={15} className="spin" aria-hidden="true" /> Captions appear here as each part of the sound is read.
          </li>
        )}
        {events.map((event) => (
          <li key={event.index}>
            <span className="mono-label">{formatClock(event.startMs)}</span>
            <span>{event.lines.map((line) => line.map((word) => word.text).join(" ")).join(" ")}</span>
          </li>
        ))}
      </ol>

      <button className="button button-ghost button-block" type="button" onClick={onCancel}>
        <X size={15} aria-hidden="true" /> Cancel
      </button>
    </div>
  );
}

/** Shown in the stage when this build has no captioning engine. */
export function UnavailableCard({ checking }: { checking: boolean }) {
  return (
    <div className="settings-card cap-stage-card">
      <div className="settings-head">
        <span className="mono-label">{checking ? "Checking" : "Not available"}</span>
      </div>
      {checking ? (
        <p className="settings-note" role="status">
          Checking this browser…
        </p>
      ) : (
        <>
          <h3 className="cap-consent-title">
            <AlertTriangle size={20} aria-hidden="true" /> Add captions is not available in this build
          </h3>
          <p className="settings-note">
            The speech engine is not switched on here. Nothing was uploaded and nothing is broken on your side. The other Cutmoor tools work as usual, and the subtitle converter can still turn an SRT file into VTT.
          </p>
        </>
      )}
    </div>
  );
}
