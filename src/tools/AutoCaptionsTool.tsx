import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { describeLowSpeech } from "../components/captions/low-speech";
import { FileDrop } from "../components/FileDrop";
import { KaraokePreview } from "../components/captions/KaraokePreview";
import { CaptionEditor } from "../components/captions/CaptionEditor";
import { CustomizePanel } from "../components/captions/CustomizePanel";
import { OutputBody, PanelFrame } from "../components/captions/OutputPanel";
import type { SafeAreaKey } from "../components/captions/SafeAreaOverlay";
import { ConsentCard, ProgressCard, SettingsCard, UnavailableCard } from "../components/captions/StageCards";
import type { CaptionRuntimeFactory } from "../components/captions/runtime-types";
import { CAPTION_STYLES } from "../components/captions/styles";
import { parseGlossary } from "../components/captions/glossary";
import { useCaptionEdits } from "../components/captions/useCaptionEdits";
import { usePlayhead } from "../components/captions/usePlayhead";
import { useCaptionJob } from "../hooks/useCaptionJob";
import { useElapsed } from "../hooks/useElapsed";
import type { CaptionStyle } from "../lib/captioning/contracts";
import { customFields } from "../lib/captioning/saved-looks";

/**
 * Auto captions: drop a video, get word-timed captions, fix them, preview them with the spoken
 * word lit, and export. Everything runs in this tab. The left column is the working area (a
 * fixed-size card that swaps between settings, consent, progress and the editor), the right
 * column is the output panel (preview, style, downloads). Both keep their size in every state, so
 * nothing on the page moves while a job runs.
 *
 * `factory` is for tests; the page normally finds the engine on `window` (see runtime-types.ts).
 */
export function AutoCaptionsTool({ factory }: { factory?: CaptionRuntimeFactory }) {
  const tiers = window.__cutmoorCaptionTiers ?? [];
  const [tier, setTier] = useState(tiers[0]?.id ?? "");
  // Names and special words, kept as typed. The parsed list goes to the job so a finished
  // transcript already has the visitor's spellings; the textarea itself keeps the raw text.
  const [glossaryText, setGlossaryText] = useState("");
  const glossary = useMemo(() => parseGlossary(glossaryText), [glossaryText]);
  // The visitor's own words for the audio, optional and kept as typed. The pipeline places them on
  // the sound instead of guessing them; a blank box means ordinary captioning.
  const [lyricsText, setLyricsText] = useState("");
  // Set by the result panel's nudge: show the settings card (the lyrics box lives there) and focus that box.
  // A counter, not a flag: clicking the still-visible nudge a second time must focus the box again.
  const [lyricsBoxRequest, setLyricsBoxRequest] = useState(0);
  const requestLyricsBox = useCallback(() => setLyricsBoxRequest((count) => count + 1), []);
  const job = useCaptionJob(factory, tier, glossary, lyricsText);
  const { state, runtime } = job;
  const result = state.phase === "done" ? state.result : null;
  const edits = useCaptionEdits(result ? result.words : null);
  const [styleId, setStyleId] = useState<CaptionStyle["id"]>("clean");
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [highlightNumbers, setHighlightNumbers] = useState(true);
  // What the visitor changed on top of the preset (font, size, outline, position, animation...).
  // Picking another preset clears it; an absent field always means "as the preset has it".
  const [custom, setCustom] = useState<Partial<CaptionStyle>>({});
  const [safeArea, setSafeArea] = useState<SafeAreaKey | null>(null);
  const style: CaptionStyle = { ...CAPTION_STYLES[styleId], ...custom, highlightNumbers };
  const patchStyle = useCallback((patch: Partial<CaptionStyle>) => {
    setCustom((old) => {
      const next: Partial<CaptionStyle> = { ...old, ...patch };
      // A field set back to undefined means "reset to the preset": drop it so the preset shows through.
      for (const key of Object.keys(next) as (keyof CaptionStyle)[]) if (next[key] === undefined) delete next[key];
      return next;
    });
  }, []);
  const chooseStyle = useCallback((id: CaptionStyle["id"]) => {
    setStyleId(id);
    setCustom({});
  }, []);
  const applyLook = useCallback((look: CaptionStyle) => {
    setStyleId(look.id);
    setCustom(customFields(look));
  }, []);
  const toggleSafeArea = useCallback((key: SafeAreaKey) => setSafeArea((old) => (old === key ? null : key)), []);

  // What the preview shows: the finished (and edited) captions, or the first captions while it works.
  const liveEvents = state.phase === "running" ? state.events : result ? edits.events : [];
  const playhead = usePlayhead(video, result ? edits.words : [], liveEvents);
  const elapsed = useElapsed(job.startedAt, state.phase === "running");

  // Seeking from the editor moves the video but never starts it.
  const seek = useCallback(
    (ms: number) => {
      if (video && Number.isFinite(ms)) video.currentTime = Math.max(0, ms / 1000);
    },
    [video],
  );

  // New file or a fresh run: back to the default look.
  const fileKey = job.file;
  useEffect(() => {
    setStyleId("clean");
    setCustom({});
    setSafeArea(null);
  }, [fileKey]);

  // A new file starts on the settings card anyway, so a pending lyrics request must not leak into it.
  useEffect(() => setLyricsBoxRequest(0), [fileKey]);

  // The settings card renders in the same commit, so this effect runs with the box in the page. The box sits
  // inside a collapsed <details>; opening it is what makes the textarea visible and focusable. The counter
  // dependency means a second click while the card is already shown focuses the box again.
  useEffect(() => {
    if (lyricsBoxRequest === 0) return;
    const field = document.getElementById("cap-lyrics-input");
    if (!(field instanceof HTMLTextAreaElement)) return;
    const details = field.closest("details");
    if (details && !details.open) details.open = true;
    field.focus();
  }, [lyricsBoxRequest]);

  const lowSpeech = result ? describeLowSpeech(edits.words.length, result.stats, tier !== "high") : null;
  const busy = state.phase === "running" || state.phase === "needs-consent";
  const hasFile = job.file !== null;
  const isVideo = (job.meta?.hasVideo ?? true) && hasFile;
  // A file with no picture to draw (an MP3, or a video this browser cannot decode) gets an explanation instead of a black box.
  const isAudioFile = Boolean(job.file && (job.file.type.startsWith("audio/") || /.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i.test(job.file.name)));
  const noPicture: "audio" | "undecodable" | null = !hasFile ? null : isAudioFile ? "audio" : job.meta && !job.meta.hasVideo ? "undecodable" : null;

  const panelState = (() => {
    if (!hasFile) return { label: "Waiting", className: "job-state-idle", phase: "idle" as const };
    switch (state.phase) {
      case "running":
        return { label: "Working", className: "job-state-working", phase: "working" as const };
      case "done":
        return { label: "Complete", className: "job-state-done", phase: "done" as const };
      case "failed":
        return { label: "Failed", className: "job-state-error", phase: "failed" as const };
      case "needs-consent":
        return { label: "Ready", className: "job-state-ready", phase: "consent" as const };
      default:
        return { label: "Ready", className: "job-state-ready", phase: "ready" as const };
    }
  })();

  const hint = (() => {
    if (!hasFile) return "Choose a video or an audio file. Cutmoor listens to it on your device and writes captions with the time of every word.";
    if (state.phase === "running") return "Reading the sound and writing captions. The first ones show here as soon as they are found.";
    if (state.phase === "needs-consent") return "Waiting for your answer about the one-time model download.";
    if (state.phase === "failed") return "The job did not finish. The card on the left says what happened.";
    return "File ready. Press Generate captions.";
  })();

  let stage: ReactNode = null;
  if (job.runtimeStatus !== "ready") {
    stage = <UnavailableCard checking={job.runtimeStatus === "checking"} />;
  } else if (hasFile) {
    if (state.phase === "needs-consent") {
      stage = (
        <ConsentCard
          totalBytes={state.download.totalBytes}
          hosts={state.download.hosts}
          fileCount={state.download.fileCount}
          onApprove={job.approveDownload}
          onDecline={job.declineDownload}
        />
      );
    } else if (state.phase === "running") {
      stage = <ProgressCard progress={state.progress} events={state.events} elapsedMs={elapsed} onCancel={job.cancel} />;
    } else if (state.phase === "done" && result && lyricsBoxRequest === 0) {
      stage = (
        <div className="settings-card cap-stage-card cap-stage-editor">
          {lowSpeech && (
            <div className="cap-note cap-lowspeech" role="status">
              <strong>{lowSpeech.title}</strong>
              <p>{lowSpeech.detail}</p>
            </div>
          )}
          <CaptionEditor edits={edits} onSeek={seek} playingWord={playhead.wordIndex} playing={playhead.playing} uncovered={result.uncoveredSpeech} />
        </div>
      );
    } else {
      stage = (
        <SettingsCard
          tiers={tiers}
          tier={tier}
          onTier={setTier}
          modelStatus={job.modelStatus}
          modelLabel={runtime?.label ?? "The speech model"}
          onRemoveModel={() => void job.removeModel()}
          onStart={() => {
            setLyricsBoxRequest(0);
            job.start();
          }}
          failure={state.phase === "failed" ? state.error : null}
          cancelled={state.phase === "cancelled"}
          onRetry={job.retry}
          durationSeconds={job.meta?.duration ?? 0}
          testDouble={Boolean(runtime?.isTestDouble)}
          glossary={glossaryText}
          onGlossary={setGlossaryText}
          lyrics={lyricsText}
          onLyrics={setLyricsText}
          busy={busy}
        />
      );
    }
  }

  return (
    <div className="tool-workbench captions-bench">
      <section className="tool-input" aria-label="Your video and caption settings">
        <FileDrop
          file={job.file}
          meta={job.meta ? { width: job.meta.width, height: job.meta.height, duration: job.meta.duration } : null}
          onFile={job.selectFile}
          onClear={job.clearFile}
          accept="video/*,audio/*"
          hint="MP4, MOV, WebM or MKV video, or an MP3 or WAV recording. Long files work; phones are slower than computers."
          disabled={busy}
        />
        {hasFile || job.runtimeStatus === "unavailable" ? stage : null}
      </section>

      <PanelFrame
        state={panelState}
        screen={
          <KaraokePreview
            url={job.previewUrl}
            fileName={job.file?.name ?? null}
            events={liveEvents}
            position={playhead.position}
            style={style}
            videoRef={setVideo}
            onAnchorChange={(anchorX, anchorY) => patchStyle({ anchorX, anchorY })}
            safeArea={safeArea}
            noPicture={noPicture}
            badge={hasFile ? (result ? "Preview" : state.phase === "running" ? "First captions" : "Source") : null}
          >
            {state.phase === "running" && <div className="demo-dim cap-dim" aria-hidden="true" />}
          </KaraokePreview>
        }
      >
        <OutputBody
          phase={panelState.phase}
          hint={hint}
          testDouble={Boolean(runtime?.isTestDouble)}
          file={job.file}
          events={edits.events}
          result={result}
          wordCount={edits.words.length}
          edited={edits.edited}
          styleId={styleId}
          onStyle={chooseStyle}
          style={style}
          customize={
            <CustomizePanel
              style={style}
              onChange={patchStyle}
              onApplyLook={applyLook}
              safeArea={safeArea}
              onSafeArea={toggleSafeArea}
              wordsPerCaption={edits.wordsPerCaption}
              onWordsPerCaption={edits.setWordsPerCaption}
              script={edits.script}
              onScript={edits.setScript}
              hasDevanagari={edits.hasDevanagari}
            />
          }
          highlightNumbers={highlightNumbers}
          onHighlightNumbers={setHighlightNumbers}
          burnIn={runtime?.burnIn ?? null}
          onSeek={seek}
          onStartOver={job.clearFile}
          onUseLyrics={requestLyricsBox}
          isVideo={isVideo}
        />
      </PanelFrame>
    </div>
  );
}
