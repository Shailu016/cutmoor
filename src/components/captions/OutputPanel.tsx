import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Check, Download, FileJson, FileText, Film, RotateCcw, ShieldCheck, X } from "lucide-react";
import { CaptionError, type BurnInExporter, type CaptionResult, type CaptionStyle } from "../../lib/captioning/contracts";
import { toSrt, toVtt, toWordJson } from "../../lib/captioning/export";
import type { CaptionEvent, SpeechInterval } from "../../lib/captioning/types";
import { releaseBlobUrl } from "../../lib/blob-url";
import { formatBytes } from "../../lib/format";
import { describeCaptionError, toCaptionError } from "./messages";
import { CAPTION_STYLES, CAPTION_STYLE_LABELS, CAPTION_STYLE_ORDER } from "./styles";
import { captionFileName, formatClock } from "./time";
import { describeUnreadSinging } from "./unread-singing";

/** Saves a Blob through a temporary link. The link is released a moment later, so nothing stays in memory. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  releaseBlobUrl(url, 4000);
}

interface PanelProps {
  phase: "idle" | "ready" | "consent" | "working" | "done" | "failed";
  /** One plain sentence about what is going on, for the states before there is a result. */
  hint: string;
  testDouble: boolean;
  /** Everything below is only used when phase is "done". */
  file: File | null;
  events: CaptionEvent[];
  result: CaptionResult | null;
  wordCount: number;
  edited: boolean;
  styleId: CaptionStyle["id"];
  onStyle: (id: CaptionStyle["id"]) => void;
  /** The full style to burn in: the preset plus the visitor's custom fields and the number highlight. Omitted when the panel is used alone (then the preset and the highlight switch are used). */
  style?: CaptionStyle;
  /** The customize card (look, position, words, motion, saved looks), shown under the presets. */
  customize?: ReactNode;
  /** Numbers, prices, percentages and years in the accent colour. */
  highlightNumbers: boolean;
  onHighlightNumbers: (on: boolean) => void;
  burnIn: BurnInExporter | null;
  onSeek: (ms: number) => void;
  onStartOver: () => void;
  /** Opens the settings card and puts the cursor in the lyrics box; omitted when the panel is used alone. */
  onUseLyrics?: () => void;
  isVideo: boolean;
}

interface BurnState {
  status: "idle" | "running" | "done" | "failed";
  fraction: number;
  url: string | null;
  name: string;
  size: number;
  error: CaptionError | null;
}

const BURN_IDLE: BurnState = { status: "idle", fraction: 0, url: null, name: "", size: 0, error: null };

/** The body of the dark output panel: what is happening, then style and downloads once there is a result. */
export function OutputBody({ phase, hint, testDouble, file, events, result, wordCount, edited, styleId, onStyle, style: styleProp, customize, highlightNumbers, onHighlightNumbers, burnIn, onSeek, onStartOver, onUseLyrics, isVideo }: PanelProps) {
  // Any change to the look (preset, custom field, number highlight) makes a finished burned-in video out of date.
  const fullStyle: CaptionStyle = styleProp ?? { ...CAPTION_STYLES[styleId], highlightNumbers };
  const styleKey = JSON.stringify(fullStyle);
  const [burn, setBurn] = useState<BurnState>(BURN_IDLE);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [saved, setSaved] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const dropBurnResult = useCallback(() => {
    if (urlRef.current) {
      releaseBlobUrl(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setSupported(null);
    if (!burnIn || !isVideo) {
      setSupported(false);
      return;
    }
    burnIn
      .isSupported()
      .then((ok) => alive && setSupported(ok))
      .catch(() => alive && setSupported(false));
    return () => {
      alive = false;
    };
  }, [burnIn, isVideo]);

  // The burned-in video shows the captions as they were, so any edit or style change makes it out of date.
  useEffect(() => {
    controllerRef.current?.abort();
    dropBurnResult();
    setBurn(BURN_IDLE);
  }, [events, styleKey, file, dropBurnResult]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      dropBurnResult();
    },
    [dropBurnResult],
  );

  const exportText = (kind: "srt" | "vtt" | "json") => {
    if (!file) return;
    const text = kind === "srt" ? toSrt(events) : kind === "vtt" ? toVtt(events) : toWordJson(events);
    const type = kind === "json" ? "application/json" : kind === "vtt" ? "text/vtt" : "application/x-subrip";
    const name = captionFileName(file.name, kind);
    saveBlob(new Blob([text], { type: `${type};charset=utf-8` }), name);
    setSaved(`${name} saved to your downloads.`);
  };

  const runBurn = async () => {
    if (!file || !burnIn) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    dropBurnResult();
    setBurn({ ...BURN_IDLE, status: "running" });
    try {
      const blob = await burnIn.export({
        file,
        events,
        style: fullStyle,
        signal: controller.signal,
        onProgress: (fraction) => setBurn((old) => (old.status === "running" ? { ...old, fraction: Math.max(old.fraction, Math.min(1, fraction)) } : old)),
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setBurn({ status: "done", fraction: 1, url, name: captionFileName(file.name, "mp4").replace("-captions.mp4", "-with-captions.mp4"), size: blob.size, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = toCaptionError(error, controller.signal);
      setBurn({ ...BURN_IDLE, status: "failed", error: failure.code === "aborted" ? null : new CaptionError("export", failure.message, { cause: failure }) });
    }
  };

  const cancelBurn = () => {
    controllerRef.current?.abort();
    setBurn(BURN_IDLE);
  };

  if (phase !== "done" || !result) {
    return (
      <>
        <p className="job-idle">{hint}</p>
        {testDouble && (
          <p className="cap-testbanner" role="note">
            <AlertTriangle size={15} aria-hidden="true" /> Test mode: the captions are made-up sample text, not a transcript of this video.
          </p>
        )}
        <div className="job-trust">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Your video, its sound and the captions never leave this device.</span>
        </div>
      </>
    );
  }

  const uncovered: SpeechInterval[] = result.uncoveredSpeech;
  // A song that left singing unread gets one calm way out: the visitor's own words. Never on the test double.
  const unread = testDouble ? null : describeUnreadSinging(result);
  const burning = burn.status === "running";
  // Set only when the visitor pasted lyrics or a script: how much of their own text was placed.
  const lyrics = result.stats.lyrics;
  const lyricWords = lyrics ? lyrics.placed + lyrics.unmatched : 0;
  // Placed words whose timing was only predicted (no aligner on this tier): the panel must say so plainly.
  const approximate = typeof lyrics?.approximate === "number" && Number.isFinite(lyrics.approximate) && lyrics.approximate > 0 ? lyrics.approximate : 0;

  return (
    <>
      {testDouble && (
        <p className="cap-testbanner" role="note">
          <AlertTriangle size={15} aria-hidden="true" /> Test mode: made-up sample text.
        </p>
      )}
      <div className="result-badge">
        <Check size={16} aria-hidden="true" /> {edited ? "Captions ready (edited)" : "Captions ready"}
      </div>

      {unread && (
        <p className="cap-note">
          <span>{unread.message}</span>
          {onUseLyrics && (
            <>
              {" "}
              <button type="button" className="button button-ghost button-small" onClick={onUseLyrics}>
                {unread.actionLabel}
              </button>
            </>
          )}
        </p>
      )}

      <div className="cap-section">
        <span className="mono-label">Caption style</span>
        <div className="cap-styles" role="group" aria-label="Caption style">
          {CAPTION_STYLE_ORDER.map((id) => {
            const style = CAPTION_STYLES[id];
            // The second sample shows what changes as words are said: the lit word, or (karaoke) a word still to come.
            const second = style.activeColor === style.textColor && style.upcomingColor ? style.upcomingColor : style.activeColor;
            return (
              <button key={id} type="button" className={styleId === id ? "cap-style active" : "cap-style"} aria-pressed={styleId === id} onClick={() => onStyle(id)}>
                <span
                  className={`cap-swatch cap-bg-${style.background}${style.uppercase ? " cap-swatch-upper" : ""}`}
                  style={style.activeBox ? ({ "--cap-box": style.activeBox } as CSSProperties) : undefined}
                  aria-hidden="true"
                >
                  <span style={{ color: style.textColor }}>Aa </span>
                  <span className={style.activeBox ? "cap-swatch-box" : undefined} style={{ color: second }}>
                    Aa
                  </span>
                </span>
                <span className="cap-style-name">{CAPTION_STYLE_LABELS[id].name}</span>
                <span className="cap-style-detail">{CAPTION_STYLE_LABELS[id].detail}</span>
              </button>
            );
          })}
        </div>
        <label className="cap-toggle">
          <input type="checkbox" checked={highlightNumbers} onChange={(e) => onHighlightNumbers(e.target.checked)} />
          Highlight numbers, prices and years
        </label>
      </div>

      {customize}

      <div className="cap-section">
        <span className="mono-label">Download</span>
        <div className="cap-exports">
          <button type="button" className="button button-primary" onClick={() => exportText("srt")} disabled={events.length === 0}>
            <FileText size={16} aria-hidden="true" /> SRT
          </button>
          <button type="button" className="button button-primary" onClick={() => exportText("vtt")} disabled={events.length === 0}>
            <FileText size={16} aria-hidden="true" /> VTT
          </button>
          <button type="button" className="button button-ghost" onClick={() => exportText("json")} disabled={events.length === 0}>
            <FileJson size={16} aria-hidden="true" /> Word JSON
          </button>
        </div>

        {supported === false || !burnIn ? (
          <p className="job-note">
            {isVideo
              ? "Burning captions into a video needs a browser feature this one lacks (WebCodecs video encoding). SRT and VTT work everywhere, and Chrome or Edge on a computer can usually make the video."
              : "This file has no picture, so there is no video to burn captions into. SRT and VTT work with any player."}
          </p>
        ) : burn.status === "done" && burn.url ? (
          <a className="button button-primary button-block" href={burn.url} download={burn.name}>
            <Download size={17} aria-hidden="true" /> Download MP4 with captions ({formatBytes(burn.size)})
          </a>
        ) : burning ? (
          <div className="cap-burn" role="group" aria-label="Making the captioned video">
            <div className="progress-top">
              <span>Making the captioned video…</span>
              <span>{Math.round(burn.fraction * 100)}%</span>
            </div>
            <div className="progress-track" role="progressbar" aria-label="Video export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(burn.fraction * 100)}>
              <div className="progress-fill" style={{ width: `${Math.max(2, burn.fraction * 100)}%` }} />
            </div>
            <button type="button" className="button button-ghost button-small" onClick={cancelBurn}>
              <X size={14} aria-hidden="true" /> Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="button button-ghost button-block" onClick={() => void runBurn()} disabled={supported === null || events.length === 0}>
            <Film size={16} aria-hidden="true" /> Make MP4 with captions burned in
          </button>
        )}

        {burn.status === "failed" && burn.error && (
          <p className="job-error" role="alert">
            {describeCaptionError(burn.error).title}. {describeCaptionError(burn.error).detail}
          </p>
        )}
        <p className="cap-sr" role="status" aria-live="polite">
          {saved}
        </p>
      </div>

      {uncovered.length > 0 && (
        <div className="cap-section">
          <span className="mono-label">Check these spots</span>
          <p className="job-note">Speech was heard here but no words were found. Listen and add them if needed.</p>
          <div className="cap-spots">
            {uncovered.slice(0, 6).map((gap) => (
              <button key={gap.startMs} type="button" className="chip" onClick={() => onSeek(gap.startMs)}>
                {formatClock(gap.startMs)} to {formatClock(gap.endMs)}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="job-note">
        {wordCount} words · {events.length} captions · {result.stats.windows} {result.stats.windows === 1 ? "part" : "parts"} read
        {result.stats.flaggedWindows > 0 ? ` · ${result.stats.flaggedWindows} unsure ${result.stats.flaggedWindows === 1 ? "part was" : "parts were"} checked more strictly` : ""}. Machine captions can be wrong: read them through before you publish.
      </p>
      {result.stats.inferredWords ? (
        <p className="job-note">
          Some lines were filled in from a repeated section of the song: {result.stats.inferredWords}{" "}
          {result.stats.inferredWords === 1 ? "word is" : "words are"} marked uncertain, so check them against the audio.
        </p>
      ) : null}
      {lyrics && lyrics.unsupported ? (
        <p className="cap-note">
          Timing from your words needs High accuracy on this device, so these captions come from the audio alone. Your
          words were not used.
        </p>
      ) : lyrics && lyrics.lines > 0 && lyricWords > 0 ? (
        <p className="cap-note">
          Your words: {lyrics.placed} of {lyricWords} placed.
          {lyrics.uncertain > 0 ? ` ${lyrics.uncertain} ${lyrics.uncertain === 1 ? "word is" : "words are"} marked uncertain, so check ${lyrics.uncertain === 1 ? "it" : "them"} against the audio.` : ""}
          {approximate > 0
            ? ` ${approximate} of these words were placed by working out where they fall in the song, not by checking each one against the audio, so treat their timing as approximate.`
            : ""}
          {lyrics.unmatched > 0 && lyrics.unmatchedLines.length > 0
            ? ` These lines were not found in the audio: ${lyrics.unmatchedLines
                .slice(0, 5)
                .map((line) => `\u201c${line}\u201d`)
                .join(", ")}${lyrics.unmatchedLines.length > 5 ? ", and more" : ""}. They were left out rather than forced in.`
            : ""}
        </p>
      ) : null}

      <button className="button button-ghost button-block" type="button" onClick={onStartOver}>
        <RotateCcw size={15} aria-hidden="true" /> Start another file
      </button>
    </>
  );
}

export function PanelFrame({ state, children, screen }: { state: { label: string; className: string }; children: ReactNode; screen: ReactNode }) {
  return (
    <aside className="job-panel cap-panel" aria-label="Captioned preview and downloads">
      <div className="job-head">
        <span className="mono-label">Output</span>
        <span className={`job-state ${state.className}`}>{state.label}</span>
      </div>
      {screen}
      <div className="job-body">{children}</div>
    </aside>
  );
}
