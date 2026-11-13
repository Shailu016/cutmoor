import { useEffect, useRef } from "react";
import { Music } from "lucide-react";

export type ScreenKind = "video" | "audio" | "image";

/**
 * Shows one piece of media inside a fixed-size screen (the homepage demo and
 * every tool's output panel). It always fills its container, whatever the media
 * is, so swapping source for result never changes the layout.
 */
export function ScreenMedia({
  kind,
  url,
  label,
  playing = false,
  reducedMotion = false,
  controls = false,
  onError,
}: {
  kind: ScreenKind;
  url: string | null;
  label: string;
  /** Autoplay muted and looping (the demo). Tool panels leave this off and show controls instead. */
  playing?: boolean;
  reducedMotion?: boolean;
  controls?: boolean;
  /** Called when the browser cannot show this media (e.g. an output format it cannot play). */
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing && !reducedMotion) video.play().catch(() => undefined);
    else video.pause();
  }, [playing, reducedMotion, url]);

  if (!url) return <div className="demo-media demo-blank" />;
  if (kind === "image") return <img className="demo-media" src={url} alt={label} onError={onError} />;
  if (kind === "audio") {
    return (
      <div className="demo-audio">
        <Music size={28} aria-hidden="true" />
        <audio src={url} controls preload="metadata" aria-label={label} onError={onError} />
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      key={url}
      className="demo-media"
      src={url}
      muted
      loop={playing}
      playsInline
      preload="metadata"
      controls={controls || reducedMotion}
      aria-label={label}
      onError={onError}
    />
  );
}
