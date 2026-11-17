import { useEffect, useState } from "react";
import { ArrowRight, Info, ShieldCheck } from "lucide-react";
import { Link } from "../components/Link";
import { FileDrop } from "../components/FileDrop";
import { ImageJobPanel } from "../components/ImageJobPanel";
import { useImageEncoderSupport } from "../hooks/useImageEncoderSupport";
import { useImageJob } from "../hooks/useImageJob";
import { baseName } from "../lib/format";
import {
  clampDimensions,
  formatExtension,
  renderImage,
  sourceKindNote,
  sourceLabel,
  type ImageFormat,
} from "../lib/image";

const FORMATS: { value: ImageFormat; label: string; note: string }[] = [
  { value: "jpeg", label: "JPG", note: "Universal. No transparency." },
  { value: "png", label: "PNG", note: "Lossless. Keeps transparency." },
  { value: "webp", label: "WebP", note: "Smaller on the web. Safari can't export it from a canvas." },
];

interface ConvertImageToolProps {
  defaultFormat?: ImageFormat;
  heicMode?: boolean;
  /** The kinds of file the picker takes. Pages such as "WebP to JPG" narrow it to the one they are about. */
  accept?: string;
  /** The line under the drop box. */
  hint?: string;
  /** The output formats offered. Defaults to all three. */
  formats?: ImageFormat[];
}

const ANY_IMAGE = "image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif";

export function ConvertImageTool({ defaultFormat = "jpeg", heicMode = false, accept = ANY_IMAGE, hint, formats }: ConvertImageToolProps) {
  const job = useImageJob();
  const support = useImageEncoderSupport();
  const [format, setFormat] = useState<ImageFormat>(defaultFormat);
  const [quality, setQuality] = useState(90);
  const [background, setBackground] = useState("#ffffff");

  useEffect(() => {
    if (!support.webp && format === "webp") setFormat("jpeg");
  }, [format, support.webp]);

  const effectiveFormat = format === "webp" && !support.webp ? "jpeg" : format;
  const outputSize = job.meta ? clampDimensions(job.meta.width, job.meta.height) : null;
  const outputName = `${baseName(job.file?.name ?? "image")}${heicMode ? "" : "-converted"}.${formatExtension(effectiveFormat)}`;

  const run = () => {
    if (!job.file || !job.meta || !outputSize) return;
    const meta = job.meta;
    job.run(async ({ loaded, onProgress, signal }) => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(0.25);
      const blob = await renderImage(loaded, {
        width: outputSize.width,
        height: outputSize.height,
        fit: "stretch",
        format: effectiveFormat,
        quality: quality / 100,
        background: effectiveFormat === "jpeg" ? background : null,
      });
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(1);

      const notes: string[] = [];
      if (outputSize.scaled) {
        notes.push(`The output was capped at ${outputSize.width}×${outputSize.height} because the source is larger than the browser canvas limit.`);
      }
      if (effectiveFormat === "jpeg" && meta.hasAlpha) {
        notes.push("Any transparency was filled with the chosen background color because JPG cannot store an alpha channel.");
      }
      if (effectiveFormat === "png") notes.push("PNG is lossless, so the quality slider does not change the file.");
      const sourceNote = sourceKindNote(meta.kind);
      if (sourceNote) notes.push(sourceNote);
      if (effectiveFormat === meta.kind && !heicMode) {
        notes.push("The image was re-encoded in the same format. If you only need a smaller file, the compress tool avoids a second quality loss.");
      }
      if (heicMode && meta.kind === "heic") {
        notes.push("The HEIC file was decoded locally. The JPG carries no GPS or camera metadata; orientation was applied before export.");
      }
      return {
        blob,
        name: outputName,
        width: outputSize.width,
        height: outputSize.height,
        format: effectiveFormat,
        note: notes.join(" ") || undefined,
      };
    });
  };

  const busy = job.phase === "working";
  const webpBlocked = format === "webp" && !support.webp;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept={accept}
          hint={
            hint ??
            (heicMode
              ? "HEIC or HEIF from an iPhone. Decoded locally; the photo is never uploaded."
              : "JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. Transparency is handled in the browser.")
          }
          disabled={busy}
          kind="image"
        />

        {job.file && job.meta && outputSize && (
          <div className="settings-card">
            {heicMode && (
              <div className="info-callout">
                <Info size={17} />
                <p>
                  Safari uses the system HEIC decoder. Chrome, Edge, and Firefox load a 3 MB local decoder once, only
                  for HEIC files. The photo still never leaves your device. The decoder is the open-source heic-to /
                  libheif project, licensed LGPL-3.0 — <Link className="text-link" to="/licences">licence details</Link>.
                </p>
              </div>
            )}

            <div className="settings-head">
              <span className="mono-label">01 · Output format</span>
              <span className="settings-hint">
                Source {sourceLabel(job.meta.kind)} · {job.meta.width}×{job.meta.height}
              </span>
            </div>
            <div className="segmented" role="group" aria-label="Output format">
              {FORMATS.filter((item) => !formats || formats.includes(item.value)).map((item) => {
                const disabled = item.value === "webp" && !support.webp;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={format === item.value ? "segment active" : "segment"}
                    aria-pressed={format === item.value}
                    onClick={() => !disabled && setFormat(item.value)}
                    disabled={disabled}
                    title={disabled ? "This browser cannot encode WebP from a canvas." : undefined}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <p className="settings-note">
              {FORMATS.find((item) => item.value === format)?.note}
              {!support.webp && " WebP export is not available in this browser, so JPG and PNG stay available."}
            </p>

            {effectiveFormat !== "png" && (
              <>
                <div className="settings-head">
                  <span className="mono-label">02 · Quality</span>
                  <span className="settings-hint">{quality}%</span>
                </div>
                <div className="range-row">
                  <input
                    type="range"
                    min={50}
                    max={95}
                    step={1}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    aria-label="Image quality"
                  />
                  <span className="range-value">{quality}</span>
                </div>
                <p className="settings-note">
                  90 keeps a photo clean. 75 is a good web default. Going below 60 starts to show blocking in gradients
                  and skin tones.
                </p>
              </>
            )}

            {effectiveFormat === "jpeg" && job.meta.hasAlpha && (
              <div className="color-field">
                <label>
                  Transparency background
                  <input
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                    aria-label="Background color for transparent areas"
                  />
                </label>
                <p className="settings-note">JPG has no alpha channel, so transparent pixels are filled with this color.</p>
              </div>
            )}

            <div className="convert-note">
              <ShieldCheck size={16} />
              <span>Metadata such as GPS coordinates is not copied. The output is a clean, flat image.</span>
            </div>

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={busy || webpBlocked}
            >
              {busy ? "Converting…" : `Convert to ${sourceLabel(effectiveFormat)}`}
            </button>
            <p className="settings-footnote">
              Output: {sourceLabel(effectiveFormat)} · {outputSize.width}×{outputSize.height} ·{" "}
              {effectiveFormat === "png" ? "lossless" : `${quality}% quality`}
              {job.file ? ` · from ${sourceLabel(job.meta.kind)}` : ""}
            </p>
            <Link className="text-link" to="/tools/compress-image">
              Need a specific file size instead? Compress the image <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </section>

      <ImageJobPanel
        job={job}
        idleHint={
          heicMode
            ? "Choose an iPhone HEIC photo. Cutmoor decodes it locally and exports a standard JPG for Windows, Android, or an upload form."
            : "Choose an image and pick the format you need. The conversion runs on your device, with no upload step."
        }
      />
    </div>
  );
}
