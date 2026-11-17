import { useEffect, useMemo, useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { ImageOutputControls } from "../../components/ImageOutput";
import { PictureStage } from "../../components/PictureStage";
import { Chips, RunButton, SettingsHead } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { baseName } from "../../lib/format";
import { canvasToBlob, formatExtension, MAX_CANVAS_EDGE, type ImageFormat } from "../../lib/image";
import { clampBox, CROP_ASPECTS, largestBox, refitBox, roundBox, type Box } from "../../lib/crop";

export function CropImageTool() {
  const job = useImageJob();
  const [aspectId, setAspectId] = useState("free");
  const [circle, setCircle] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState("#ffffff");
  const busy = job.phase === "working";
  const meta = job.meta;

  const ratio = circle ? 1 : (CROP_ASPECTS.find((aspect) => aspect.id === aspectId)?.ratio ?? null);

  // A new picture starts with the biggest box of the chosen shape.
  useEffect(() => {
    if (meta) setBox(largestBox(meta.width, meta.height, ratio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // Choosing a shape re-fits the current box to it, keeping its centre.
  useEffect(() => {
    if (meta) setBox((current) => (current ? refitBox(current, ratio, meta.width, meta.height) : largestBox(meta.width, meta.height, ratio)));
  }, [ratio, meta]);

  // A circle needs transparent corners, which only PNG and WebP can hold.
  useEffect(() => {
    if (circle && format === "jpeg") setFormat("png");
  }, [circle, format]);

  const pixels = useMemo(() => (box && meta ? roundBox(box, meta.width, meta.height) : null), [box, meta]);
  const outputName = `${baseName(job.file?.name ?? "image")}-cropped.${formatExtension(format)}`;

  const run = () => {
    if (!job.meta || !pixels) return;
    job.run(async ({ loaded, onProgress, signal }) => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(0.2);
      if (pixels.w > MAX_CANVAS_EDGE || pixels.h > MAX_CANVAS_EDGE) throw new Error("That crop is larger than the browser can draw. Make the box smaller.");
      const canvas = document.createElement("canvas");
      canvas.width = pixels.w;
      canvas.height = pixels.h;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not create a canvas. Try a smaller picture.");
      if (format === "jpeg") {
        context.fillStyle = background;
        context.fillRect(0, 0, pixels.w, pixels.h);
      }
      if (circle) {
        context.beginPath();
        context.ellipse(pixels.w / 2, pixels.h / 2, pixels.w / 2, pixels.h / 2, 0, 0, Math.PI * 2);
        context.clip();
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(loaded.source, pixels.x, pixels.y, pixels.w, pixels.h, 0, 0, pixels.w, pixels.h);
      onProgress(0.7);
      const blob = await canvasToBlob(canvas, format, quality / 100);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(1);
      return {
        blob,
        name: outputName,
        width: pixels.w,
        height: pixels.h,
        format,
        note: circle ? "The corners outside the circle are transparent in PNG and WebP." : undefined,
      };
    });
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif"
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. Drag the box to choose what to keep."
          kind="image"
          disabled={busy}
        />

        {job.file && meta && box && job.sourcePreview && pixels && (
          <div className="settings-card">
            <SettingsHead label="01 · Crop area" hint={`${pixels.w}×${pixels.h} px`} />
            <PictureStage
              mode="crop"
              src={job.sourcePreview}
              picture={{ width: meta.width, height: meta.height }}
              alt="Your picture with the crop area on it"
              box={box}
              ratio={ratio}
              circle={circle}
              disabled={busy}
              onBoxChange={(next) => setBox(clampBox(next, meta.width, meta.height, 1))}
            />
            <SettingsHead label="02 · Shape" />
            <Chips
              label="Crop shape"
              value={aspectId}
              disabled={busy || circle}
              onChange={setAspectId}
              options={CROP_ASPECTS.map((aspect) => ({ value: aspect.id, label: aspect.label }))}
            />
            <label className="check-row">
              <input type="checkbox" checked={circle} disabled={busy} onChange={(event) => setCircle(event.target.checked)} /> Round (circle) crop, for profile pictures
            </label>
            <ImageOutputControls
              label="03 · Save as"
              format={format}
              onFormat={setFormat}
              quality={quality}
              onQuality={setQuality}
              background={background}
              onBackground={setBackground}
              showBackground={circle}
              disabled={busy}
            />
            <RunButton working={busy} idleLabel="Crop picture" workingLabel="Cropping…" onClick={run} />
            <p className="settings-footnote">The crop is cut from the full-size picture, not the preview, so no quality is lost.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a picture, drag the box to the part you want, and Cutmoor cuts it out on your device." />
    </div>
  );
}
