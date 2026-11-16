import { useEffect, useRef, useState } from "react";
import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { findActive, findWordAtTime, type ActivePosition } from "./find-active";

export interface Playhead {
  /** The caption block and word being spoken, or null between captions. */
  position: ActivePosition | null;
  /** Index in the word list of the word being spoken right now, or -1 in a silence. */
  wordIndex: number;
  /** True while the video is playing. */
  playing: boolean;
}

const NONE: Playhead = { position: null, wordIndex: -1, playing: false };

function samePosition(a: ActivePosition | null, b: ActivePosition | null): boolean {
  return a === b || (a !== null && b !== null && a.event === b.event && a.line === b.line && a.word === b.word);
}

/**
 * Follows a video's clock and reports which caption and word are current. While the video plays it
 * checks on every animation frame (about 60 times a second), so the highlight lands on the frame
 * the word starts. While paused it only checks when the position changes. React is told only when
 * the answer changes (a few times a second), not on every frame.
 */
export function usePlayhead(video: HTMLVideoElement | null, words: Word[], events: CaptionEvent[]): Playhead {
  const [playhead, setPlayhead] = useState<Playhead>(NONE);
  const latest = useRef({ words, events });
  const lastRef = useRef<Playhead>(NONE);
  const tickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    latest.current = { words, events };
    tickRef.current();
  }, [words, events]);

  useEffect(() => {
    if (!video) {
      lastRef.current = NONE;
      setPlayhead(NONE);
      return;
    }
    let frame = 0;
    const tick = () => {
      const timeMs = Math.round(video.currentTime * 1000);
      const { words: w, events: e } = latest.current;
      const position = findActive(e, timeMs);
      const at = findWordAtTime(w, timeMs);
      const wordIndex = at.index >= 0 && at.distanceMs === 0 ? at.index : -1;
      const playing = !video.paused && !video.ended;
      const last = lastRef.current;
      if (samePosition(position, last.position) && wordIndex === last.wordIndex && playing === last.playing) return;
      const next = { position, wordIndex, playing };
      lastRef.current = next;
      setPlayhead(next);
    };
    tickRef.current = tick;

    const loop = () => {
      tick();
      frame = !video.paused && !video.ended ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (frame === 0) frame = requestAnimationFrame(loop);
      tick();
    };
    const once = () => tick();

    video.addEventListener("play", start);
    video.addEventListener("playing", start);
    for (const name of ["pause", "ended", "seeked", "seeking", "timeupdate", "loadeddata"] as const) video.addEventListener(name, once);
    if (!video.paused) start();
    else tick();

    return () => {
      video.removeEventListener("play", start);
      video.removeEventListener("playing", start);
      for (const name of ["pause", "ended", "seeked", "seeking", "timeupdate", "loadeddata"] as const) video.removeEventListener(name, once);
      if (frame !== 0) cancelAnimationFrame(frame);
      tickRef.current = () => undefined;
    };
  }, [video]);

  return playhead;
}
