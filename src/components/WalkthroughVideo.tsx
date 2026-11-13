import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { usePrefersReducedMotion, useSaveData } from "../hooks/useMotionPrefs";
import { walkthroughPosterUrl, walkthroughUrl, type DemoId } from "../lib/demo";

/**
 * A recording of the live demo screen for one tool. It fills the screen
 * exactly, loads nothing but its poster until it is on screen, and does not
 * start by itself for visitors who asked for less motion or a data saver.
 */
export function WalkthroughVideo({ id, label }: { id: DemoId; label: string }) {
  const base = import.meta.env.BASE_URL;
  const ref = useRef<HTMLVideoElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const saveData = useSaveData();
  const autoplay = !reducedMotion && !saveData;
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setFailed(false);
    setPlaying(false);
  }, [id]);

  // Play only while the demo is on screen, and stop when it leaves.
  useEffect(() => {
    const video = ref.current;
    if (!video || !autoplay || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.4 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [id, autoplay]);

  if (failed) {
    return (
      <img
        className="demo-media demo-poster-only"
        src={walkthroughPosterUrl(base, id)}
        alt={`${label}: a still from the walkthrough`}
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }

  return (
    <>
      <video
        key={id}
        ref={ref}
        className="demo-media"
        src={walkthroughUrl(base, id)}
        poster={walkthroughPosterUrl(base, id)}
        muted
        loop
        playsInline
        preload="none"
        aria-label={`${label}: a recorded walkthrough of the demo`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      {!autoplay && !playing && (
        <button
          type="button"
          className="demo-play"
          onClick={() => ref.current?.play().catch(() => undefined)}
          aria-label={`Play the ${label} walkthrough`}
        >
          <Play size={22} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
