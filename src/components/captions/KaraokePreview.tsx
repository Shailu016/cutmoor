import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { AudioLines, Film } from "lucide-react";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { buildFontStack, cssFont, cssFontFamily, resolvedFontWeight } from "../../lib/captioning/burn-in/font-stack";
import { animationDurationMs, animationFrame, animationText, captionCharCount, type AnimationFrame } from "../../lib/captioning/burn-in/animations";
import { preloadCaptionFont } from "../../lib/captioning/burn-in/font-catalog";
import { boxFor, outlineFor, shadowFor } from "../../lib/captioning/burn-in/look";
import {
  captionSafeArea,
  effectiveAnchor,
  nudgeAnchor,
  placeBlock,
  type SafeArea,
  type Size,
} from "../../lib/captioning/burn-in/position";
import { layoutEvent } from "../../lib/captioning/burn-in/renderer";
import { isNumberToken, wordColor, wordState } from "../../lib/captioning/burn-in/word-look";
import { usePrefersReducedMotion } from "../../hooks/useMotionPrefs";
import { anchorForDrag, fitRect, grabOffsetFromRect, type ActivePosition, type ClientRectLike } from "./find-active";
import { SafeAreaOverlay, type SafeAreaKey } from "./SafeAreaOverlay";

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
  /** Called while the caption is dragged or moved with the arrow keys. Omit for a read-only preview. */
  onAnchorChange?: (anchorX: number, anchorY: number) => void;
  /** Draws an approximate platform safe-area guide. Preview only; never exported. */
  safeArea?: SafeAreaKey | null;
  /** Set when the file has no picture to draw: "audio" for sound-only files, "undecodable" for a video this browser cannot draw. */
  noPicture?: "audio" | "undecodable" | null;
  children?: ReactNode;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  picture: ClientRectLike;
  grab: { x: number; y: number };
  blockSize: Size;
  safe: SafeArea;
}

/**
 * Entry animation for the live preview only. The burned-in MP4 always renders the animation the
 * visitor chose; here their system's reduced-motion setting wins. One clock per caption, started
 * when it becomes the current one, using the same pure frame function as the canvas export
 * (animationFrame) so both look alike.
 */
function useEntryAnimation(event: CaptionEvent | undefined, style: CaptionStyle, reducedMotion: boolean): AnimationFrame | null {
  const [running, setRunning] = useState<{ event: CaptionEvent; frame: AnimationFrame } | null>(null);
  const animation = style.animation ?? "none";
  const duration = animationDurationMs(style.animationMs);

  useEffect(() => {
    if (!event || reducedMotion || animation === "none" || duration <= 0 || typeof requestAnimationFrame !== "function") {
      setRunning(null);
      return;
    }
    const total = captionCharCount(event, style.uppercase);
    const started = typeof performance !== "undefined" ? performance.now() : 0;
    let raf = 0;
    const tick = () => {
      const t = typeof performance !== "undefined" ? Math.min(1, (performance.now() - started) / duration) : 1;
      setRunning(t >= 1 ? null : { event, frame: animationFrame(animation, t, total) });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [event, animation, duration, reducedMotion, style.uppercase]);

  // A frame from the previous caption must never flash on the new one.
  return running && running.event === event ? running.frame : null;
}

/**
 * The video with the caption on top, the active word lit. The caption is HTML laid over the
 * video, positioned on the video picture itself (not the black bars around it), and its size
 * follows the picture's height, so it looks the same at any window size.
 *
 * The preview uses the SAME `layoutEvent` as the burned-in renderer (same canvas measurement,
 * font shrink and line wrapping) and the same `placeBlock` maths, so a dragged caption lands
 * in the MP4 exactly where it appears here. With `onAnchorChange` the visitor can drag the
 * caption (mouse or touch) or use the arrow keys while it is focused.
 */
export function KaraokePreview({ url, fileName, events, position, style, videoRef, badge, onAnchorChange, safeArea = null, noPicture = null, children }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [box, setBox] = useState<Box>({ x: 0, y: 0, width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fontEpoch, setFontEpoch] = useState(0);
  const hintId = useId();

  useEffect(() => setFailed(false), [url]);

  // The chosen font's CSS is a lazy chunk. Once it has loaded, measure again so the preview lays
  // text out with the real face (the same thing the renderer waits for before the first frame).
  useEffect(() => {
    if (!style.fontKey) return;
    let alive = true;
    void preloadCaptionFont(style.fontKey).then(() => {
      if (alive) setFontEpoch((epoch) => epoch + 1);
    });
    return () => {
      alive = false;
    };
  }, [style.fontKey]);


  // Canvas measurements taken before a webfont finishes loading use a fallback; measure again
  // once the page's fonts are ready so the preview matches what the renderer will draw.
  useEffect(() => {
    let alive = true;
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts?.ready) return;
    void fonts.ready.then(() => {
      if (alive) setFontEpoch((epoch) => epoch + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

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
  const reducedMotion = usePrefersReducedMotion();
  const entry = useEntryAnimation(event, style, reducedMotion);
  const interactive = typeof onAnchorChange === "function";

  // One layout for both renderers. `layoutEvent` is pure; the canvas only provides the same
  // text measurement the burn-in renderer uses.
  const laidOut = useMemo(() => {
    if (!event || box.width <= 0 || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    const measure = (text: string, fontPx: number) => {
      context.font = cssFont(style, fontPx);
      return context.measureText(text).width;
    };
    const next = layoutEvent(event, measure, style, box.width, box.height);
    // The renderer puts exactly one measured space between words; the HTML uses the same gap
    // so a line's natural width stays close to the canvas width instead of drifting.
    return { layout: next, spacePx: measure(" ", next.fontPx) };
  }, [
    event,
    box.width,
    box.height,
    style.fontScale,
    style.sizeMul,
    style.fontKey,
    style.fontFamily,
    style.fontWeight,
    style.id,
    style.background,
    style.position,
    style.uppercase,
    style.activeBox,
    style.anchorX,
    style.anchorY,
    style.align,
    fontEpoch,
  ]);

  const layout = laidOut?.layout ?? null;
  const spacePx = laidOut?.spacePx ?? 0;
  const blockSize: Size | null = layout ? { width: layout.bounds.right - layout.bounds.left, height: layout.bounds.bottom - layout.bounds.top } : null;
  const rect = blockSize ? placeBlock(style, blockSize, box.width, box.height) : null;
  const anchor = effectiveAnchor(style);

  // The active word by its stable transcript index: layoutEvent can split a hopeless long
  // word, but the word's `index` still identifies every piece.
  const activeWord: Word | undefined = event && position && position.word >= 0 ? event.lines[position.line]?.[position.word] : undefined;
  const activeIndex = layout && activeWord ? layout.words.findIndex((word) => word.index === activeWord.index) : -1;

  // Inline only what the custom fields ask for, so a preset with none of them keeps the exact CSS
  // path it had before (same family string, same weight, same classes).
  const fontPx = layout?.fontPx ?? 0;
  const outline = outlineFor(style, fontPx);
  const shadow = shadowFor(style, fontPx);
  const resolvedBox = boxFor(style);
  const blockStyle = {
    fontSize: fontPx,
    fontFamily: style.fontKey ? buildFontStack(cssFontFamily(style)) : style.fontFamily,
    fontWeight: resolvedFontWeight(style),
    color: style.textColor,
    "--cap-box": style.activeBox ?? "transparent",
    // The same frame the canvas export draws, expressed as a CSS transform.
    opacity: entry ? entry.opacity : undefined,
    transform: entry ? `translate(${entry.dx}em, ${entry.dy}em) scale(${entry.scale})` : undefined,
    transformOrigin: "center",
  } as CSSProperties;
  if (style.outlineWidth !== undefined || (style.outlineColor !== undefined && outline)) {
    blockStyle.WebkitTextStrokeWidth = `${outline?.widthPx ?? 0}px`;
    blockStyle.WebkitTextStrokeColor = outline?.color ?? style.outlineColor ?? "#000000";
    blockStyle.paintOrder = "stroke fill";
  }
  if (style.shadow !== undefined) {
    blockStyle.textShadow = shadow ? `${shadow.offsetXPx}px ${shadow.offsetYPx}px ${shadow.blurPx}px ${shadow.color}` : "none";
  }
  if (style.boxOpacity !== undefined || style.boxColor !== undefined) {
    blockStyle.background = resolvedBox?.color ?? "transparent";
  }

  const onPointerDown = (pointerEvent: PointerEvent<HTMLDivElement>) => {
    if (!interactive || !onAnchorChange || !blockSize) return;
    if (pointerEvent.pointerType === "mouse" && pointerEvent.button !== 0) return;
    const element = pointerEvent.currentTarget;
    const pictureElement = element.parentElement;
    if (!pictureElement) return;
    const blockRect = element.getBoundingClientRect();
    const pictureRect = pictureElement.getBoundingClientRect();
    if (!(blockRect.width > 0 && blockRect.height > 0 && pictureRect.width > 0 && pictureRect.height > 0)) return;
    pointerEvent.preventDefault();
    element.focus({ preventScroll: true });
    try {
      element.setPointerCapture(pointerEvent.pointerId);
    } catch {
      /* pointer capture is a nicety: without it the drag still works while the pointer stays over the block */
    }
    dragRef.current = {
      pointerId: pointerEvent.pointerId,
      picture: { left: pictureRect.left, top: pictureRect.top, width: pictureRect.width, height: pictureRect.height },
      grab: grabOffsetFromRect(
        { left: blockRect.left, top: blockRect.top, width: blockRect.width, height: blockRect.height },
        pointerEvent.clientX,
        pointerEvent.clientY,
      ),
      blockSize,
      safe: captionSafeArea(pictureRect.width, pictureRect.height),
    };
    setDragging(true);
  };

  const onPointerMove = (pointerEvent: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId || !onAnchorChange) return;
    pointerEvent.preventDefault();
    const next = anchorForDrag({
      picture: drag.picture,
      grab: drag.grab,
      clientX: pointerEvent.clientX,
      clientY: pointerEvent.clientY,
      blockSize: drag.blockSize,
      safe: drag.safe,
    });
    onAnchorChange(next.x, next.y);
  };

  const endDrag = (pointerEvent: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== pointerEvent.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      if (pointerEvent.currentTarget.hasPointerCapture(pointerEvent.pointerId)) {
        pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
      }
    } catch {
      /* the pointer may already be gone */
    }
  };

  const onKeyDown = (keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || !onAnchorChange) return;
    const step = keyEvent.shiftKey ? 0.05 : 0.01;
    let dx = 0;
    let dy = 0;
    if (keyEvent.key === "ArrowLeft") dx = -step;
    else if (keyEvent.key === "ArrowRight") dx = step;
    else if (keyEvent.key === "ArrowUp") dy = -step;
    else if (keyEvent.key === "ArrowDown") dy = step;
    else return;
    keyEvent.preventDefault();
    const next = nudgeAnchor(anchor, dx, dy);
    onAnchorChange(next.x, next.y);
  };

  // Typewriter cuts each word at a code-point offset counted across the whole caption, like the canvas does.
  const charOffsets: number[] = [];
  if (layout) {
    let offset = 0;
    for (const line of layout.lines) {
      for (const placed of line.words) {
        charOffsets[placed.wordIndex] = offset;
        offset += [...layout.words[placed.wordIndex].text].length;
      }
    }
  }

  return (
    <div className="job-screen cap-stage" ref={stageRef}>
      {url && !failed && noPicture && (
        // Behind the (transparent) player, so its controls stay on top. Without this an audio file looks like a broken, black video.
        <div className="cap-nopic" role="note">
          <AudioLines size={26} aria-hidden="true" />
          <strong>{noPicture === "audio" ? "Audio only" : "Picture not available"}</strong>
          <span>
            {noPicture === "audio"
              ? "This file has no picture. Play it to hear the sound; the captions show here over a dark background."
              : "This browser cannot draw this video's picture. The sound and the captions still work; the burned-in MP4 needs a picture the browser can read."}
          </span>
        </div>
      )}
      {url && !failed ? (
        <video
          key={url}
          ref={(element) => {
            elementRef.current = element;
            videoRef(element);
          }}
          className={noPicture ? "cap-video cap-video-nopic" : "cap-video"}
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

      {event && layout && layout.lines.length > 0 && rect && box.width > 0 && (
        <div className="cap-overlay" aria-hidden={interactive ? undefined : "true"} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
          <div
            ref={blockRef}
            role={interactive ? "group" : undefined}
            aria-label={interactive ? "Caption position. Drag it or use the arrow keys to move it." : undefined}
            aria-describedby={interactive ? hintId : undefined}
            tabIndex={interactive ? 0 : undefined}
            className={`cap-block cap-bg-${style.background}${style.activeBox ? " cap-boxed" : ""}`}
            style={{
              ...blockStyle,
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              maxWidth: "none",
              boxSizing: "border-box",
              padding: 0,
              lineHeight: `${layout.rowHeight}px`,
              visibility: "visible",
              zIndex: 1,
              userSelect: "none",
              pointerEvents: interactive ? "auto" : "none",
              touchAction: interactive ? "none" : undefined,
              cursor: interactive ? (dragging ? "grabbing" : "grab") : undefined,
              outlineOffset: 2,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            {layout.lines.map((line, lineIndex) => {
              const align = style.align ?? "center";
              // Pin the edge the visitor chose. The DOM measures text slightly differently from
              // the canvas, so the line flows from that edge instead of placing every word
              // absolutely (which would let a wider glyph run into the next word).
              const placement: CSSProperties =
                align === "right"
                  ? { right: rect.width - (line.x - rect.left + line.width) }
                  : align === "center"
                    ? { left: line.x - rect.left + line.width / 2, transform: "translateX(-50%)" }
                    : { left: line.x - rect.left };
              return (
                <div
                  className="cap-line"
                  key={lineIndex}
                  style={{
                    position: "absolute",
                    top: line.y - rect.top - layout.rowHeight / 2,
                    height: layout.rowHeight,
                    lineHeight: `${layout.rowHeight}px`,
                    whiteSpace: "nowrap",
                    ...placement,
                  }}
                >
                  {line.words.map((placed, wordPosition) => {
                    const word = layout.words[placed.wordIndex];
                    const state = wordState(placed.wordIndex, activeIndex);
                    return (
                      <span
                        key={`${placed.wordIndex}-${word.index}`}
                        className="cap-word"
                        style={{
                          margin: 0,
                          marginRight: wordPosition < line.words.length - 1 ? spacePx : 0,
                          color: wordColor(word.text, state, style),
                        }}
                        data-state={state}
                        data-active={state === "active" ? "true" : undefined}
                        data-number={style.highlightNumbers && isNumberToken(word.text) ? "true" : undefined}
                        data-hidden={style.reveal === "spoken" && state === "upcoming" ? "true" : undefined}
                      >
                        {animationText(word.text, charOffsets[placed.wordIndex] ?? 0, entry)}
                      </span>
                    );
                  })}
                </div>
              );
            })}
            {interactive && (
              <span id={hintId} className="cap-sr">
                Drag the caption or use the arrow keys to move it. Hold Shift for bigger steps.
              </span>
            )}
          </div>
        </div>
      )}

      {box.width > 0 && <SafeAreaOverlay safeArea={safeArea} picture={box} />}

      {badge && <span className="demo-badge">{badge}</span>}
      {children}
    </div>
  );
}
