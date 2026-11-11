import { useEffect, useState } from "react";
import { Gauge, Sparkles } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { ImageJobPanel } from "../components/ImageJobPanel";
import { useImageEncoderSupport } from "../hooks/useImageEncoderSupport";
import { useImageJob } from "../hooks/useImageJob";
import { baseName } from "../lib/format";
import {
  clampDimensions,
  compressToTarget,
  fitDimensions,
  formatExtension,
  formatTargetSize,
  renderImage,
  sourceKindNote,
  sourceLabel,
  type ImageFormat,
} from "../lib/image";

type Mode = "size" | "quality";
type FormatChoice = "auto" | ImageFormat;
type MaxEdge = "original" | "2560" | "1920" | "1280" | "800";

const TARGETS = [100, 200, 500, 1024, 2048, 5120];
const FORMATS: { value: FormatChoice; label: string; note: string }[] = [
  { value: "auto", label: "Auto", note: "WebP when the browser can encode it, otherwise JPG." },
  { value: "jpeg", label: "JPG", note: "The safest photo format. No transparency." },
  { value: "webp", label: "WebP", note: "Smaller than JPG on the web. Safari can't create it from a canvas." },
  { value: "png", label: "PNG", note: "Lossless. Best for screenshots and graphics." },
];

export function CompressImageTool() {
  const job = useImageJob();
  const support = useImageEncoderSupport();
  const [mode, setMode] = useState<Mode>("size");
  const [targetKb, setTargetKb] = useState(200);
  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState<FormatChoice>("auto");
  const [maxEdge, setMaxEdge] = useState<MaxEdge>("original");

  const alpha = job.meta?.hasAlpha ?? false;
  const effectiveFormat: ImageFormat =
    format === "auto" ? (support.webp ? "webp" : alpha ? "png" : "jpeg") : format;

  useEffect(() => {
    if (format === "webp" && !support.webp) setFormat("auto");
  }, [format, support.webp]);

  const targetBytes = Math.max(10, targetKb) * 1024;

  const run = () => {
    if (!job.file || !job.meta) return;
    if (effectiveFormat === "webp" && !support.webp) return;

    const file = job.file;
    const meta = job.meta;
    const extension = formatExtension(effectiveFormat);
    const outputName = `${baseName(file.name)}-compressed.${extension}`;
    const max = maxEdge === "original" ? null : Number(maxEdge);

    job.run(async ({ loaded, onProgress, signal }) => {
      if (mode === "size") {
        // Nothing to gain from a re-encode when the file already fits, the
        // format already matches the output, and no size cap was requested.
        const sameFormat = meta.kind === effectiveFormat;
        if (sameFormat && file.size <= targetBytes && format === "auto" && maxEdge === "original") {
          return {
            blob: file,
            name: file.name,
            width: meta.width,
            height: meta.height,
            format: effectiveFormat,
            note: `The original is already ${formatTargetSize(file.size)}, under your ${formatTargetSize(targetKb * 1024)} target. It was left untouched.`,
          };
        }

        const result = await compressToTarget(loaded, {
          targetBytes,
          format: effectiveFormat,
          maxWidth: max ?? loaded.width,
          maxHeight: max ?? loaded.height,
          allowDownscale: true,
          onProgress,
          signal,
        });
        const notes: string[] = [];
        if (effectiveFormat === "jpeg" && alpha) notes.push("Any transparency was filled with white for JPG.");
        const sourceNote = sourceKindNote(meta.kind);
        if (sourceNote) notes.push(sourceNote);
        if (result.note) notes.push(result.note);
        return {
          blob: result.blob,
          name: outputName,
          width: result.width,
          height: result.height,
          format: effectiveFormat,
          note: notes.join(" ") || undefined,
        };
      }

      onProgress(0.2);
      const fitted = fitDimensions(
        loaded.width,
        loaded.height,
        max ?? loaded.width,
        max ?? loaded.height,
      );
      const clamped = clampDimensions(fitted.width, fitted.height);
      const blob = await renderImage(loaded, {
        width: clamped.width,
        height: clamped.height,
        fit: "stretch",
        format: effectiveFormat,
        quality: quality / 100,
      });
      onProgress(1);

      const notes: string[] = [];
      if (clamped.scaled) notes.push(`The output was capped at ${clamped.width}×${clamped.height} for browser canvas safety.`);
      if (effectiveFormat === "png") notes.push("PNG ignores the quality slider because it is lossless.");
      if (effectiveFormat === "jpeg" && alpha) notes.push("Any transparency was filled with white for JPG.");
      const sourceNote = sourceKindNote(meta.kind);
      if (sourceNote) notes.push(sourceNote);
      return {
        blob,
        name: outputName,
        width: clamped.width,
        height: clamped.height,
        format: effectiveFormat,
        note: notes.join(" ") || undefined,
      };
    });
  };

  const busy = job.phase === "working";
  const unsupported = effectiveFormat === "webp" && !support.webp;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif"
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. Up to ~50 MP on a desktop."
          disabled={busy}
          kind="image"
        />

        {job.file && job.meta && (
          <div className="settings-card">
            <div className="settings-head">
              <span className="mono-label">01 · Method</span>
              <span className="settings-hint">
                {job.meta.width}×{job.meta.height} · {sourceLabel(job.meta.kind)}
              </span>
            </div>
            <div className="segmented" role="group" aria-label="Compression method">
              <button
                type="button"
                className={mode === "size" ? "segment active" : "segment"}
                aria-pressed={mode === "size"}
                onClick={() => setMode("size")}
              >
                <Gauge size={16} /> Target size
              </button>
              <button
                type="button"
                className={mode === "quality" ? "segment active" : "segment"}
                aria-pressed={mode === "quality"}
                onClick={() => setMode("quality")}
              >
                <Sparkles size={16} /> Quality
              </button>
            </div>

            {mode === "size" ? (
              <>
                <div className="settings-head">
                  <span className="mono-label">02 · Target file size</span>
                  <span className="settings-hint">binary search</span>
                </div>
                <div className="chips" role="group" aria-label="Target file size">
                  {TARGETS.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={targetKb === size ? "chip active" : "chip"}
                      aria-pressed={targetKb === size}
                      onClick={() => setTargetKb(size)}
                    >
                      {formatTargetSize(size * 1024)}
                    </button>
                  ))}
                  <label className="chip chip-input">
                    <input
                      type="number"
                      min={10}
                      max={51200}
                      value={targetKb}
                      onChange={(event) =>
                        setTargetKb(Math.max(10, Math.min(51_200, Number(event.target.value) || 10)))
                      }
                      aria-label="Custom target size in kilobytes"
                    />
                    <span>KB</span>
                  </label>
                </div>
                <p className="settings-note">
                  ClipKit encodes the image at several quality levels and keeps the highest quality that fits under{" "}
                  <strong>{formatTargetSize(targetKb * 1024)}</strong>. If even the lowest quality is too large, it reduces the
                  dimensions in steps and tells you exactly what it did.
                </p>
              </>
            ) : (
              <>
                <div className="settings-head">
                  <span className="mono-label">02 · Quality</span>
                  <span className="settings-hint">{quality}%</span>
                </div>
                <div className="range-row">
                  <input
                    type="range"
                    min={40}
                    max={95}
                    step={1}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    aria-label="Image quality"
                  />
                  <span className="range-value">{quality}</span>
                </div>
                <p className="settings-note">
                  80 is a good default for photos. Drop toward 65 only when the file must be tiny. PNG ignores this
                  slider because it is lossless.
                </p>
              </>
            )}

            <div className="settings-head">
              <span className="mono-label">03 · Format</span>
            </div>
            <div className="segmented segmented-wrap" role="group" aria-label="Output format">
              {FORMATS.map((item) => {
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
              {format === "auto"
                ? `Auto uses ${effectiveFormat === "webp" ? "WebP" : effectiveFormat === "png" ? "PNG" : "JPG"} in this browser.`
                : FORMATS.find((item) => item.value === format)?.note}
              {!support.webp && " WebP export is not available in this browser, so JPG and PNG stay available."}
            </p>

            <div className="settings-head">
              <span className="mono-label">04 · Maximum dimension</span>
            </div>
            <div className="chips" role="group" aria-label="Maximum dimension">
              {(["original", "2560", "1920", "1280", "800"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={maxEdge === value ? "chip active" : "chip"}
                  aria-pressed={maxEdge === value}
                  onClick={() => setMaxEdge(value)}
                >
                  {value === "original" ? "Original" : `${value}px`}
                </button>
              ))}
            </div>
            <p className="settings-note">
              A 12 MP phone photo is often 4000 px wide. If the image will display at 1200 px, capping the long edge
              saves more bytes than any quality slider.
            </p>

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={busy || unsupported}
            >
              {busy ? "Compressing…" : "Compress image"}
            </button>
            <p className="settings-footnote">
              Output: {sourceLabel(effectiveFormat)} ·{" "}
              {mode === "size" ? `target ${formatTargetSize(targetKb * 1024)}` : `quality ${quality}%`} ·{" "}
              {maxEdge === "original" ? "original dimensions" : `long edge ≤ ${maxEdge}px`}
            </p>
          </div>
        )}
      </section>

      <ImageJobPanel
        job={job}
        idleHint="Choose a photo or screenshot. ClipKit reads the dimensions locally, then finds the highest quality that fits your target size."
      />
    </div>
  );
}
