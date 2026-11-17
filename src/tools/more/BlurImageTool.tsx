import { useState } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { ImageOutputControls } from "../../components/ImageOutput";
import { PictureStage } from "../../components/PictureStage";
import { RangeField, RunButton, Segmented, SettingsHead } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { baseName } from "../../lib/format";
import { canvasToBlob, clampDimensions, drawToCanvas, formatExtension, type ImageFormat } from "../../lib/image";
import { redactCanvas, type RedactMode } from "../../lib/picture-edit";
import type { Box } from "../../lib/crop";

export function BlurImageTool() {
  const job = useImageJob();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [mode, setMode] = useState<RedactMode>("pixelate");
  const [strength, setStrength] = useState(7);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState("#ffffff");
  const busy = job.phase === "working";
  const meta = job.meta;
  const outputName = `${baseName(job.file?.name ?? "image")}-hidden.${formatExtension(format)}`;
  const usable = boxes.filter((box) => box.w >= 2 && box.h >= 2);

  const run = () => {
    if (!meta || usable.length === 0) return;
    job.run(async ({ loaded, onProgress, signal }) => {
      onProgress(0.15);
      const size = clampDimensions(meta.width, meta.height);
      const canvas = drawToCanvas(loaded, { width: size.width, height: size.height, fit: "stretch", format, background: format === "jpeg" ? background : null });
      // Boxes are in the picture's own pixels; a very large picture is drawn smaller, so the boxes scale with it.
      const scaleX = canvas.width / meta.width;
      const scaleY = canvas.height / meta.height;
      redactCanvas(
        canvas,
        usable.map((box) => ({ x: box.x * scaleX, y: box.y * scaleY, w: box.w * scaleX, h: box.h * scaleY })),
        mode,
        strength,
      );
      onProgress(0.7);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const blob = await canvasToBlob(canvas, format, quality / 100);
      onProgress(1);
      return {
        blob,
        name: outputName,
        width: canvas.width,
        height: canvas.height,
        format,
        note:
          mode === "blackout"
            ? "The covered areas are solid black. The original pixels are gone from this file."
            : "Blur and pixelation hide detail but are not as final as a black box. For something that must never be read, use Black box.",
      };
    });
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={(file) => {
            setBoxes([]);
            void job.selectFile(file);
          }}
          onClear={() => {
            setBoxes([]);
            job.clear();
          }}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif"
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. Hide faces, number plates, or private text."
          kind="image"
          disabled={busy}
        />

        {job.file && meta && job.sourcePreview && (
          <div className="settings-card">
            <SettingsHead label="01 · Draw over what to hide" hint={`${usable.length} area${usable.length === 1 ? "" : "s"}`} />
            <PictureStage mode="draw" src={job.sourcePreview} picture={{ width: meta.width, height: meta.height }} alt="Your picture. Drag on it to mark an area to hide." boxes={boxes} onBoxesChange={setBoxes} disabled={busy} />
            <div className="chips">
              <button type="button" className="chip" disabled={busy || boxes.length === 0} onClick={() => setBoxes((current) => current.slice(0, -1))}>
                <Undo2 size={14} /> Undo last
              </button>
              <button type="button" className="chip" disabled={busy || boxes.length === 0} onClick={() => setBoxes([])}>
                <Trash2 size={14} /> Clear all
              </button>
            </div>
            <SettingsHead label="02 · How to hide it" />
            <Segmented
              label="Hiding method"
              value={mode}
              wrap
              disabled={busy}
              onChange={setMode}
              options={[
                { value: "pixelate", label: "Pixelate" },
                { value: "blur", label: "Blur" },
                { value: "blackout", label: "Black box" },
              ]}
            />
            {mode !== "blackout" && <RangeField label="Strength" value={strength} min={1} max={10} display={`${strength}`} onChange={setStrength} disabled={busy} />}
            <p className="settings-note">
              {mode === "blackout"
                ? "A solid black box removes the picture underneath for good. It is the safest choice for anything that must not be read."
                : "A strong setting hides faces and text from a glance. A mild blur of small text can sometimes be reversed, so use a strong setting or a black box for sensitive details."}
            </p>
            <ImageOutputControls label="03 · Save as" format={format} onFormat={setFormat} quality={quality} onQuality={setQuality} background={background} onBackground={setBackground} showBackground={meta.hasAlpha} disabled={busy} />
            <RunButton working={busy} idleLabel="Hide the marked areas" workingLabel="Hiding…" disabled={usable.length === 0} onClick={run} />
            <p className="settings-footnote">The picture is edited at full size on your device and never uploaded.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a picture, drag over faces or text, and Cutmoor blurs, pixelates, or blacks them out on your device." />
    </div>
  );
}
