import { useEffect, useState } from "react";
import { computeDrawRect, drawToCanvas, fitDimensions, type ImageFit, type LoadedImage } from "../lib/image";

const PREVIEW_MAX = 440;

interface CropFrame {
  width: number;
  height: number;
  fit: ImageFit;
}

/**
 * Live preview of an image crop. The preview is drawn with exactly the same
 * geometry as the export, so what the user sees is what gets encoded.
 */
export function LiveCropPreview({
  source,
  width,
  height,
  fit,
  background,
  label,
}: {
  source: LoadedImage | null;
  width: number;
  height: number;
  fit: ImageFit;
  background: string | null;
  label: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setPreview(null);
      return;
    }
    try {
      const box = fitDimensions(width, height, PREVIEW_MAX, PREVIEW_MAX);
      const canvas = drawToCanvas(source, {
        width: box.width,
        height: box.height,
        fit,
        background,
        format: background ? "jpeg" : "png",
      });
      setPreview(background ? canvas.toDataURL("image/jpeg", 0.82) : canvas.toDataURL("image/png"));
    } catch {
      setPreview(null);
    }
  }, [source, width, height, fit, background]);

  if (!source) return null;

  return (
    <figure className="crop-preview">
      <div className="crop-preview-media">
        {preview ? (
          <span className="crop-preview-canvas">
            <img src={preview} alt={`Preview of the cropped result at ${width} by ${height} pixels`} />
          </span>
        ) : (
          <div className="crop-preview-empty">Preparing preview…</div>
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/**
 * Live crop preview for video. One frame is decoded from the source clip and
 * cropped with the same cover/contain geometry the export uses.
 */
export function VideoCropPreview({
  src,
  width,
  height,
  fit,
  label,
}: {
  src: string | null;
  width: number;
  height: number;
  fit: "crop" | "pad";
  label: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    const draw = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;
      try {
        const box = fitDimensions(width, height, PREVIEW_MAX, PREVIEW_MAX);
        const canvas = document.createElement("canvas");
        canvas.width = box.width;
        canvas.height = box.height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = "#000000";
        context.fillRect(0, 0, box.width, box.height);
        const rect = computeDrawRect(video.videoWidth, video.videoHeight, box.width, box.height, fit);
        context.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
        setPreview(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        setPreview(null);
      }
    };

    const onLoaded = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = duration > 0 ? Math.min(0.4, duration / 4) : 0;
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("seeked", draw);
    video.addEventListener("error", () => setPreview(null));
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("seeked", draw);
      video.removeAttribute("src");
      video.load();
    };
  }, [src, width, height, fit]);

  if (!src) return null;

  return (
    <figure className="crop-preview">
      <div className="crop-preview-media">
        {preview ? (
          <span className="crop-preview-canvas">
            <img src={preview} alt={`Preview of the cropped frame at ${width} by ${height} pixels`} />
          </span>
        ) : (
          <div className="crop-preview-empty">Preparing preview…</div>
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
