import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Link } from "./Link";
import { ArrowRight, Check, Download, Info, Loader2, Play, RotateCcw, TriangleAlert, X } from "lucide-react";
import { ScreenMedia } from "./ScreenMedia";
import { WalkthroughVideo } from "./WalkthroughVideo";
import { useElapsed } from "../hooks/useElapsed";
import { usePrefersReducedMotion } from "../hooks/useMotionPrefs";
import { useImageJob } from "../hooks/useImageJob";
import { useMediaJob } from "../hooks/useMediaJob";
import {
  DEMO_SCENARIOS,
  demoImageTargetBytes,
  demoOutputName,
  demoVideoArgs,
  optionById,
  scenarioById,
  type DemoId,
  type DemoScenario,
  type OutputKind,
} from "../lib/demo";
import { baseName, extensionOf, formatBytes, formatDuration } from "../lib/format";
import { compressToTarget, sourceLabel } from "../lib/image";
import { compareSizes, formatElapsed, formatPercent } from "../lib/results";
import { SAMPLE_CLIP, SAMPLE_PHOTO, sampleClipUrl, samplePhotoUrl } from "../lib/samples";

type Mode = "walkthrough" | "live";
type Phase = "idle" | "loading" | "ready" | "working" | "done" | "error";
type View = "before" | "after";

interface SourceInfo {
  url: string | null;
  kind: "video" | "image";
  name: string;
  bytes: number;
  format: string;
  detail: string;
}

interface ResultInfo {
  url: string;
  name: string;
  bytes: number;
  format: string;
  kind: OutputKind;
  processMs: number;
  engineLoadMs: number;
}

const LOAD_NOTEWORTHY_MS = 500;

/**
 * The homepage demo. Layout rule: the screen is always 16:9 and the control
 * area has a fixed height, so no state, tab or result can move the page.
 * Every tab runs one real tool on a real sample, with the same settings as the
 * tool page. Until you press "Try it live", the screen plays a recording of
 * exactly that run, and says so.
 */
export function DemoStage() {
  const base = import.meta.env.BASE_URL;
  const reducedMotion = usePrefersReducedMotion();
  const media = useMediaJob();
  const image = useImageJob();

  const [activeId, setActiveId] = useState<DemoId>("compress");
  const [optionId, setOptionId] = useState<string>(scenarioById("compress").defaultOption);
  const [mode, setMode] = useState<Mode>("walkthrough");
  const [view, setView] = useState<View>("after");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // True for a moment while the previous media is taken off screen, before its blob URL is released.
  const [hold, setHold] = useState(false);
  const loadToken = useRef(0);

  const scenario = scenarioById(activeId);
  const option = optionById(scenario, optionId);
  const isImage = scenario.source === "image";
  const job = isImage ? image : media;

  // ---- one view of whichever job is active ----
  let phase: Phase = "idle";
  if (loading) phase = "loading";
  else if (loadError) phase = "error";
  else if (isImage ? image.phase === "loading" : false) phase = "loading";
  else if (job.phase === "ready" || job.phase === "working" || job.phase === "done" || job.phase === "error") phase = job.phase;

  const file = job.file;
  const source: SourceInfo | null = file
    ? isImage
      ? {
          url: image.sourcePreview,
          kind: "image",
          name: file.name,
          bytes: file.size,
          format: image.meta ? sourceLabel(image.meta.kind) : SAMPLE_PHOTO.format,
          detail: image.meta ? `${image.meta.width}×${image.meta.height}` : "",
        }
      : {
          url: media.previewUrl,
          kind: "video",
          name: file.name,
          bytes: file.size,
          format: extensionOf(file.name).toUpperCase() || "MP4",
          detail: media.meta
            ? [media.meta.width > 0 ? `${media.meta.width}×${media.meta.height}` : null, media.meta.duration > 0 ? formatDuration(media.meta.duration) : null]
                .filter(Boolean)
                .join(" · ")
            : "",
        }
    : null;

  let result: ResultInfo | null = null;
  if (isImage && image.result) {
    result = {
      url: image.result.url,
      name: image.result.name,
      bytes: image.result.size,
      format: sourceLabel(image.result.format),
      kind: "image",
      processMs: image.result.processMs,
      engineLoadMs: 0,
    };
  } else if (!isImage && media.result) {
    result = {
      url: media.result.url,
      name: media.result.name,
      bytes: media.result.size,
      format: extensionOf(media.result.name).toUpperCase(),
      kind: option.output,
      processMs: media.result.processMs,
      engineLoadMs: media.result.engineLoadMs,
    };
  }

  const errorMessage = loadError ?? (job.phase === "error" ? job.error : null);
  const wasCancelled = job.wasCancelled;
  const elapsed = useElapsed(job.startedAt, phase === "working");
  const loadingEncoder = !isImage && phase === "working" && media.progress === 0;
  const measurable = isImage
    ? image.progress > 0
    : !loadingEncoder && (media.meta ? media.meta.duration > 0 : true);

  useEffect(() => {
    setView("after");
  }, [result?.url]);

  // ---- actions ----
  /**
   * Run a change that releases media (a new run, a reset, a tab switch) after
   * taking the old media off screen. Releasing a blob URL while a video is still
   * playing it makes the browser log a failed request.
   */
  const releaseThen = (change: () => void) => {
    flushSync(() => setHold(true));
    change();
    setHold(false);
  };

  const resetAll = useCallback(() => {
    loadToken.current += 1;
    media.clear();
    image.clear();
    setLoading(false);
    setLoadError(null);
  }, [media.clear, image.clear]);

  const loadSample = useCallback(
    async (target: DemoScenario) => {
      const token = ++loadToken.current;
      setLoading(true);
      setLoadError(null);
      try {
        const wantsImage = target.source === "image";
        const response = await fetch(wantsImage ? samplePhotoUrl(base) : sampleClipUrl(base));
        if (!response.ok) throw new Error(`The sample could not be loaded (${response.status}).`);
        const blob = await response.blob();
        if (token !== loadToken.current) return;
        if (wantsImage) {
          media.clear();
          await image.selectFile(new File([blob], SAMPLE_PHOTO.fileName, { type: "image/jpeg" }));
        } else {
          image.clear();
          await media.selectFile(new File([blob], SAMPLE_CLIP.fileName, { type: "video/mp4" }));
        }
      } catch (error) {
        if (token === loadToken.current) setLoadError(error instanceof Error ? error.message : "The sample could not be loaded.");
      } finally {
        if (token === loadToken.current) setLoading(false);
      }
    },
    [base, media.clear, media.selectFile, image.clear, image.selectFile],
  );

  const selectTab = (id: DemoId) => {
    if (id === activeId) return;
    const next = scenarioById(id);
    releaseThen(() => {
      resetAll();
      setActiveId(id);
      setOptionId(next.defaultOption);
    });
    if (mode === "live") void loadSample(next);
  };

  const startLive = () => {
    setMode("live");
    void loadSample(scenario);
  };

  const backToRecording = () => {
    releaseThen(() => {
      resetAll();
      setMode("walkthrough");
    });
  };

  const run = () => {
    if (isImage) {
      const imageFile = image.file;
      if (!imageFile) return;
      const output = demoOutputName(baseName(imageFile.name), "image", optionId);
      const targetBytes = demoImageTargetBytes(optionId);
      releaseThen(() => void image.run(async ({ loaded, onProgress, signal }) => {
        const compressed = await compressToTarget(loaded, {
          targetBytes,
          format: "jpeg",
          maxWidth: loaded.width,
          maxHeight: loaded.height,
          allowDownscale: true,
          onProgress,
          signal,
        });
        return { blob: compressed.blob, name: output, width: compressed.width, height: compressed.height, format: "jpeg" as const, note: compressed.note };
      }));
      return;
    }
    const videoFile = media.file;
    if (!videoFile) return;
    const output = demoOutputName(baseName(videoFile.name), scenario.id, optionId);
    const duration = media.meta?.duration || SAMPLE_CLIP.durationSeconds;
    releaseThen(() => void media.run(output, (input) => demoVideoArgs(scenario.id, optionId, { input, output, durationSeconds: duration })));
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = DEMO_SCENARIOS.length - 1;
    let next = index;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    selectTab(DEMO_SCENARIOS[next].id);
    document.getElementById(`demo-tab-${DEMO_SCENARIOS[next].id}`)?.focus();
  };

  const live = mode === "live";
  const canChoose = live && (phase === "ready" || phase === "done");
  const sameKind = result ? (result.kind === "video" && source?.kind === "video") || (result.kind === "image" && source?.kind === "image") : false;

  return (
    <div className="demo" data-mode={mode} data-phase={phase}>
      <div className="demo-head">
        <span className="mono-label">{live ? "Live demo" : "Walkthrough"}</span>
        <span className="demo-note">{live ? "Running in this tab, on a real file." : "A recording of the live demo."}</span>
      </div>

      <div className="demo-tabs" role="tablist" aria-label="Choose a tool to see">
        {DEMO_SCENARIOS.map((item, index) => (
          <button
            key={item.id}
            id={`demo-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={item.id === activeId}
            aria-controls="demo-panel"
            tabIndex={item.id === activeId ? 0 : -1}
            className={item.id === activeId ? "demo-tab active" : "demo-tab"}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${activeId}`} className="demo-panel">
        <div className="demo-screen">
          {!live && <WalkthroughVideo id={scenario.id} label={scenario.toolName} />}

          {live && !hold && source && phase !== "loading" && (
            <ScreenMedia
              kind={view === "after" && result ? result.kind : source.kind}
              url={view === "after" && result ? result.url : source.url}
              playing={phase === "ready" || phase === "done"}
              reducedMotion={reducedMotion}
              label={view === "after" && result ? `Result: ${result.name}` : `Sample: ${source.name}`}
            />
          )}

          {live && (phase === "loading" || phase === "error") && (
            <div className="demo-center" role={phase === "error" ? "alert" : "status"}>
              {phase === "loading" ? <Loader2 className="spin" size={22} aria-hidden="true" /> : <TriangleAlert size={22} aria-hidden="true" />}
              <span>{phase === "loading" ? "Loading the sample…" : errorMessage}</span>
            </div>
          )}

          {live && phase === "working" && <div className="demo-dim" aria-hidden="true" />}

          {live && phase !== "loading" && phase !== "error" && source && (
            <span className="demo-badge">{phase === "done" ? (view === "after" ? "After" : "Before") : "Sample"}</span>
          )}

          {live && phase === "done" && result && (
            <div className="demo-switch" role="group" aria-label="Compare before and after">
              {(["before", "after"] as const).map((item) => (
                <button key={item} type="button" aria-pressed={view === item} className={view === item ? "active" : undefined} onClick={() => setView(item)}>
                  {item === "before" ? "Before" : "After"}
                </button>
              ))}
            </div>
          )}

          {live && (phase === "ready" || phase === "working" || phase === "done") && source && (
            <div className="demo-info">
              {phase === "ready" && (
                <div className="demo-info-main">
                  <strong>{source.name}</strong>
                  <span>
                    {formatBytes(source.bytes)} · {source.format}
                    {source.detail ? ` · ${source.detail}` : ""}
                  </span>
                </div>
              )}
              {phase === "working" && (
                <>
                  <div className="demo-info-main">
                    <strong>{loadingEncoder ? "Loading the encoder…" : isImage ? "Compressing…" : "Encoding…"}</strong>
                    <span>
                      {measurable ? `${Math.round(job.progress * 100)}% · ` : ""}
                      {formatElapsed(elapsed)}
                    </span>
                  </div>
                  <div
                    className="demo-progress"
                    role="progressbar"
                    aria-label="Progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={measurable ? Math.round(job.progress * 100) : undefined}
                    aria-valuetext={measurable ? `${Math.round(job.progress * 100)} percent` : "In progress"}
                  >
                    <span className={measurable ? undefined : "indeterminate"} style={measurable ? { width: `${Math.max(2, job.progress * 100)}%` } : undefined} />
                  </div>
                </>
              )}
              {phase === "done" && result && <ResultLine source={source} result={result} sameKind={sameKind} />}
            </div>
          )}
        </div>

        <div className="demo-controls">
          {!live && (
            <>
              <p className="demo-blurb">{scenario.blurb}</p>
              <div className="demo-row">
                <button type="button" className="button button-primary demo-button" onClick={startLive}>
                  <Play size={16} aria-hidden="true" /> Try it live
                </button>
                <Link className="demo-link" to={`/tools/${scenario.tool}`}>
                  {scenario.toolName} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </>
          )}

          {live && (
            <>
              {canChoose ? (
                <div className="demo-row demo-chips" role="group" aria-label={scenario.optionsLabel}>
                  <span className="demo-chips-label">{scenario.optionsLabel}</span>
                  {scenario.options.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === optionId ? "chip active" : "chip"}
                      aria-pressed={item.id === optionId}
                      onClick={() => setOptionId(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="demo-blurb" role={phase === "error" ? "alert" : undefined}>
                  {phase === "loading" && "Loading the sample…"}
                  {phase === "working" && (isImage ? "Compressing in your browser. Keep this tab open." : "Encoding on your device. Keep this tab open.")}
                  {phase === "error" && (errorMessage ?? "Something went wrong.")}
                  {phase === "idle" && wasCancelled && "Cancelled."}
                </p>
              )}

              <div className="demo-row">
                {canChoose && (
                  <button type="button" className="button button-primary demo-button" onClick={run}>
                    {phase === "done" ? "Run again" : `Run ${scenario.label.toLowerCase()}`}
                  </button>
                )}
                {phase === "done" && result && (
                  <a className="button button-ghost demo-button" href={result.url} download={result.name}>
                    <Download size={15} aria-hidden="true" /> Download
                  </a>
                )}
                {phase === "working" && (
                  <button type="button" className="button button-ghost demo-button" onClick={job.cancel}>
                    <X size={15} aria-hidden="true" /> Cancel
                  </button>
                )}
                {(phase === "ready" || phase === "done" || phase === "error") && (
                  <button type="button" className="button button-ghost demo-button" onClick={backToRecording}>
                    <RotateCcw size={14} aria-hidden="true" /> Reset
                  </button>
                )}
                {phase === "ready" && wasCancelled && <span className="demo-flag">Cancelled</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The honest before/after line shown over the result. */
function ResultLine({ source, result, sameKind }: { source: SourceInfo; result: ResultInfo; sameKind: boolean }) {
  const comparison = compareSizes(source.bytes, result.bytes);
  const showLoad = result.engineLoadMs >= LOAD_NOTEWORTHY_MS;

  return (
    <div role="status">
      <div className="demo-info-main">
        <strong>
          {formatBytes(source.bytes)} <ArrowRight size={13} aria-hidden="true" /> {formatBytes(result.bytes)}
        </strong>
        {comparison.change === "smaller" && sameKind && comparison.percent !== null && (
          <span className="demo-verdict demo-verdict-good">
            <Check size={12} aria-hidden="true" /> {formatPercent(comparison.percent)} smaller · {formatBytes(comparison.savedBytes)} saved
          </span>
        )}
        {comparison.change === "larger" && sameKind && comparison.percent !== null && (
          <span className="demo-verdict demo-verdict-warn">
            <TriangleAlert size={12} aria-hidden="true" /> {formatPercent(comparison.percent)} larger
          </span>
        )}
        {comparison.change === "same" && sameKind && <span className="demo-verdict">Same size</span>}
        {comparison.change === "invalid" && (
          <span className="demo-verdict demo-verdict-warn">
            <TriangleAlert size={12} aria-hidden="true" /> Output could not be measured
          </span>
        )}
        {!sameKind && comparison.change !== "invalid" && (
          <span className="demo-verdict">
            <Info size={12} aria-hidden="true" /> New format, not a like-for-like size
          </span>
        )}
      </div>
      <div className="demo-info-sub">
        {formatElapsed(result.processMs)} · {result.format}
        {showLoad ? ` · +${formatElapsed(result.engineLoadMs)} one-time encoder download` : ""}
      </div>
    </div>
  );
}
