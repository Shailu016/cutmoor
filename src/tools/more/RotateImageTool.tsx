import { useState } from "react";
import { FlipHorizontal2, FlipVertical2 } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { ImageOutputControls } from "../../components/ImageOutput";
import { Chips, RangeField, RunButton, SettingsHead } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { baseName } from "../../lib/format";
import { canvasToBlob, formatExtension, MAX_CANVAS_EDGE, MAX_CANVAS_PIXELS, type ImageFormat } from "../../lib/image";
import { drawTurned, rotatedSize } from "../../lib/picture-edit";

const TURNS = [
  { value: 0, label: "No turn" },
  { value: 90, label: "90° right" },
  { value: 180, label: "180°" },
  { value: 270, label: "90° left" },
];

export function RotateImageTool() {
  const job = useImageJob();
  const [turn, setTurn] = useState(90);
  const [tilt, setTilt] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState("#ffffff");
  const busy = job.phase === "working";
  const meta = job.meta;
  const degrees = turn + tilt;
  const size = meta ? rotatedSize(meta.width, meta.height, degrees) : null;
  const tooBig = size ? size.width > MAX_CANVAS_EDGE || size.height > MAX_CANVAS_EDGE || size.width * size.height > MAX_CANVAS_PIXELS : false;
  const changes = degrees % 360 !== 0 || flipH || flipV;
  const hasGaps = tilt !== 0;
  const outputName = `${baseName(job.file?.name ?? "image")}-rotated.${formatExtension(format)}`;

  const run = () => {
    if (!meta || !changes || tooBig) return;
    job.run(async ({ loaded, onProgress, signal }) => {
      onProgress(0.2);
      const canvas = drawTurned(loaded.source, loaded.width, loaded.height, {
        degrees,
        flipH,
        flipV,
        background: format === "jpeg" ? background : null,
      });
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
        note: hasGaps ? "A tilted picture is larger than the original, because the corners need room. Crop it afterwards if you want to trim the edges." : undefined,
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
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. Turn it, mirror it, or straighten a crooked photo."
          kind="image"
          disabled={busy}
        />

        {job.file && meta && (
          <div className="settings-card">
            <SettingsHead label="01 · Turn" hint={size ? `Result ${size.width}×${size.height}` : undefined} />
            <Chips label="Turn" value={turn} options={TURNS} onChange={setTurn} disabled={busy} />
            <SettingsHead label="02 · Straighten" hint={`${tilt > 0 ? "+" : ""}${tilt}°`} />
            <RangeField label="Fine tilt in degrees" value={tilt} min={-45} max={45} step={0.5} display={`${tilt}°`} onChange={setTilt} disabled={busy} />
            <SettingsHead label="03 · Mirror" />
            <div className="chips" role="group" aria-label="Mirror">
              <button type="button" className={flipH ? "chip active" : "chip"} aria-pressed={flipH} disabled={busy} onClick={() => setFlipH(!flipH)}>
                <FlipHorizontal2 size={15} /> Left to right
              </button>
              <button type="button" className={flipV ? "chip active" : "chip"} aria-pressed={flipV} disabled={busy} onClick={() => setFlipV(!flipV)}>
                <FlipVertical2 size={15} /> Top to bottom
              </button>
            </div>
            {job.sourcePreview && (
              <div className="turn-preview" role="img" aria-label="Preview of the turned picture">
                <img
                  src={job.sourcePreview}
                  alt=""
                  style={{ transform: `rotate(${degrees}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`, maxWidth: "70%", maxHeight: "70%" }}
                />
              </div>
            )}
            {tooBig && (
              <p className="field-error" role="alert">
                That turn makes a picture larger than the browser can draw. Use a smaller tilt or a smaller picture.
              </p>
            )}
            <ImageOutputControls
              label="04 · Save as"
              format={format}
              onFormat={setFormat}
              quality={quality}
              onQuality={setQuality}
              background={background}
              onBackground={setBackground}
              showBackground={hasGaps}
              disabled={busy}
            />
            <RunButton working={busy} idleLabel="Rotate picture" workingLabel="Rotating…" disabled={!changes || tooBig} onClick={run} />
            <p className="settings-footnote">A quarter turn loses nothing. Fine tilts re-sample the pixels once.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a picture, then turn, tilt, or mirror it. Everything happens on your device." />
    </div>
  );
}
