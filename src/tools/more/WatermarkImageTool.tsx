import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { ImageOutputControls } from "../../components/ImageOutput";
import { DEFAULT_MARK, MARK_MARGIN_PERCENT, MarkPreview, MarkSettings, useMarkImage, type MarkState } from "../../components/MarkSettings";
import { RunButton } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { baseName } from "../../lib/format";
import { canvasToBlob, clampDimensions, drawToCanvas, formatExtension, type ImageFormat } from "../../lib/image";
import { markPlacement } from "../../lib/picture-edit";
import { markWidthFor } from "../../lib/watermark";

export function WatermarkImageTool() {
  const job = useImageJob();
  const [mark, setMark] = useState<MarkState>(DEFAULT_MARK);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState("#ffffff");
  const image = useMarkImage(mark);
  const busy = job.phase === "working";
  const meta = job.meta;
  const outputName = `${baseName(job.file?.name ?? "image")}-watermarked.${formatExtension(format)}`;
  const ready = Boolean(image.blob) && !image.error;

  const run = () => {
    if (!meta || !image.blob) return;
    const markBlob = image.blob;
    job.run(async ({ loaded, onProgress, signal }) => {
      onProgress(0.15);
      const size = clampDimensions(meta.width, meta.height);
      const canvas = drawToCanvas(loaded, { width: size.width, height: size.height, fit: "stretch", format, background: format === "jpeg" ? background : null });
      const bitmap = await createImageBitmap(markBlob);
      try {
        const width = markWidthFor(canvas.width, mark.size);
        const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
        const margin = Math.round((canvas.width * MARK_MARGIN_PERCENT) / 100);
        const at = markPlacement({ width: canvas.width, height: canvas.height }, { width, height }, mark.position, margin);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The browser could not draw on the picture. Try a smaller one.");
        context.globalAlpha = Math.min(1, Math.max(0.05, mark.opacity / 100));
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, at.x, at.y, width, height);
      } finally {
        bitmap.close();
      }
      onProgress(0.7);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const blob = await canvasToBlob(canvas, format, quality / 100);
      onProgress(1);
      return { blob, name: outputName, width: canvas.width, height: canvas.height, format, note: "The mark is part of the picture now and cannot be removed. Keep your original." };
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
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. Add your name or logo."
          kind="image"
          disabled={busy}
        />

        {job.file && meta && job.sourcePreview && (
          <div className="settings-card">
            <MarkPreview base={job.sourcePreview} kind="image" markUrl={image.url} state={mark} />
            <MarkSettings state={mark} onChange={setMark} disabled={busy} error={image.error} />
            <ImageOutputControls label="05 · Save as" format={format} onFormat={setFormat} quality={quality} onQuality={setQuality} background={background} onBackground={setBackground} showBackground={meta.hasAlpha} disabled={busy} />
            <RunButton working={busy} idleLabel="Add watermark" workingLabel="Adding watermark…" disabled={!ready} onClick={run} />
            <p className="settings-footnote">Made at the picture&apos;s full size on your device.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a picture, then type your text or pick a logo. The mark is added on your device." />
    </div>
  );
}
