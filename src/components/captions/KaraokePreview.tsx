import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Film } from "lucide-react";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import type { CaptionEvent } from "../../lib/captioning/types";
import { fontWeightFor } from "../../lib/captioning/burn-in/font-stack";
import { displayText, isNumberToken, wordColor, wordState } from "../../lib/captioning/burn-in/word-look";
import { fitRect, type ActivePosition } from "./find-active";

interface Props {
  url: string | null;
  fileName: string | null;
  events: CaptionEvent[];
  position: ActivePosition | null;
  style: CaptionStyle;
  /** Gives the page the <video> element, so it can follow the clock and seek. */
  videoRef: (element: HTMLVideoElement | null) => void;
  /** Small label in the corner, e.g. "Preview". */
  badge: string | null;
  children?: ReactNode;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The video with the caption on top, the active word lit. The caption is HTML laid over the
 * video, positioned on the video picture itself (not the black bars around it), and its size
 * follows the picture's height, so it looks the same at any window size.
 */
export function KaraokePreview({ url, fileName, events, position, style, videoRef, badge, children }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const [box, setBox] = useState<Box>({ x: 0, y: 0, width: 0, height: 0 });
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const video = elementRef.current;
      const next = fitRect(stage.clientWidth, stage.clientHeight, video?.videoWidth ?? 0, video?.videoHeight ?? 0);
      setBox((old) =>
        Math.abs(old.x - next.x) < 0.5 && Math.abs(old.y - next.y) < 0.5 && Math.abs(old.width - next.width) < 0.5 && Math.abs(old.height - next.height) < 0.5
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const video = elementRef.current;
    video?.addEventListener("loadedmetadata", measure);
    return () => {
      observer.disconnect();
      video?.removeEventListener("loadedmetadata", measure);
    };
  }, [url]);

  const event = position ? events[position.event] : undefined;
  const fontSize = Math.max(10, box.height * style.fontScale);
  // The spoken word as a position across the whole caption (all lines), -1 before the first word.
  let active = -1;
  if (event && position && position.word >= 0) {
    active = position.word;
    for (let l = 0; l < position.line; l += 1) active += event.lines[l].length;
  }
  const blockStyle = {
    fontSize,
    fontFamily: style.fontFamily,
    fontWeight: fontWeightFor(style),
    color: style.textColor,
    "--cap-box": style.activeBox ?? "transparent",
  } as CSSProperties;
  let flat = -1;

  return (
    <div className="job-screen cap-stage" ref={stageRef}>
      {url && !failed ? (
        <video
          key={url}
          ref={(element) => {
            elementRef.current = element;
            videoRef(element);
          }}
          className="cap-video"
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={fileName ? `Preview of ${fileName} with captions` : "Video preview with captions"}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="demo-center">
          <Film size={22} aria-hidden="true" />
          <span>{failed ? "This browser cannot play the file here, but it may still be captioned" : "Your video appears here"}</span>
        </div>
      )}

      {event && box.width > 0 && (
        <div
          className="cap-overlay"
          aria-hidden="true"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        >
          <div
            className={`cap-block cap-bg-${style.background} cap-pos-${style.position}${style.activeBox ? " cap-boxed" : ""}`}
            style={blockStyle}
          >
            {event.lines.map((line, lineIndex) => (
              <div className="cap-line" key={lineIndex}>
                {line.map((word) => {
                  flat += 1;
                  const state = wordState(flat, active);
                  const text = displayText(word.text, style);
                  return (
                    <span
                      key={word.index}
                      className="cap-word"
                      style={{ color: wordColor(text, state, style) }}
                      data-state={state}
                      data-active={state === "active" ? "true" : undefined}
                      data-number={style.highlightNumbers && isNumberToken(text) ? "true" : undefined}
                      data-hidden={style.reveal === "spoken" && state === "upcoming" ? "true" : undefined}
                    >
                      {text}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {badge && <span className="demo-badge">{badge}</span>}
      {children}
    </div>
  );
}
