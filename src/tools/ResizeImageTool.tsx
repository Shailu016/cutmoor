import { useEffect, useState } from "react";
import { Crop, RectangleHorizontal } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { ImageJobPanel } from "../components/ImageJobPanel";
import { DimensionInput } from "../components/NumberFields";
import { LiveCropPreview } from "../components/Previews";
import { useImageEncoderSupport } from "../hooks/useImageEncoderSupport";
import { useImageJob } from "../hooks/useImageJob";
import { baseName } from "../lib/format";
import {
  clampDimensions,
  formatExtension,
  renderImage,
  sourceKindNote,
  sourceLabel,
  type ImageFit,
  type ImageFormat,
} from "../lib/image";

type PresetId =
  | "ig-post"
  | "ig-square"
  | "ig-story"
  | "yt-thumb"
  | "og"
  | "x-post"
  | "li-post"
  | "app-icon"
  | "custom";

interface Preset {
  width: number;
  height: number;
  label: string;
  note: string;
}

const PRESETS: Record<Exclude<PresetId, "custom">, Preset> = {
  "ig-post": { width: 1080, height: 1350, label: "Instagram post", note: "4:5 portrait" },
  "ig-square": { width: 1080, height: 1080, label: "Instagram square", note: "1:1 feed" },
  "ig-story": { width: 1080, height: 1920, label: "Story / Reel", note: "9:16 vertical" },
  "yt-thumb": { width: 1280, height: 720, label: "YouTube thumbnail", note: "16:9 · JPG under 2 MB" },
  og: { width: 1200, height: 630, label: "Link preview", note: "Open Graph / Facebook" },
  "x-post": { width: 1600, height: 900, label: "X post", note: "16:9 timeline" },
  "li-post": { width: 1200, height: 1200, label: "LinkedIn post", note: "1:1 feed" },
  "app-icon": { width: 512, height: 512, label: "App icon", note: "512 × 512 PNG" },
};

const FORMATS: { value: ImageFormat; label: string; note: string }[] = [
  { value: "jpeg", label: "JPG", note: "Safest for feeds and upload forms." },
  { value: "png", label: "PNG", note: "Lossless. Keeps transparency." },
  { value: "webp", label: "WebP", note: "Smaller on the web. Safari can't export it from a canvas." },
];

function shapeSize(width: number, height: number) {
  const max = 28;
  const scale = max / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function ResizeImageTool() {
  const job = useImageJob();
  const support = useImageEncoderSupport();
  const [preset, setPreset] = useState<PresetId>("ig-post");
  const [fit, setFit] = useState<ImageFit>("crop");
  const [customWidth, setCustomWidth] = useState(1080);
  const [customHeight, setCustomHeight] = useState(1350);
  const [format, setFormat] = useState<ImageFormat>("jpeg");
  const [quality, setQuality] = useState(88);
  const [background, setBackground] = useState("#ffffff");
  const [transparent, setTransparent] = useState(false);

  useEffect(() => {
    if (format === "webp" && !support.webp) setFormat("jpeg");
  }, [format, support.webp]);

  const choosePreset = (key: PresetId) => {
    setPreset(key);
    // These presets only work in one format: an app icon needs PNG for
    // transparency, and a YouTube thumbnail should stay a small JPG.
    if (key === "app-icon") setFormat("png");
    else if (key === "yt-thumb") setFormat("jpeg");
  };

  const width = preset === "custom" ? customWidth : PRESETS[preset].width;
  const height = preset === "custom" ? customHeight : PRESETS[preset].height;
  const outputSize = clampDimensions(width, height);
  const effectiveFormat = format === "webp" && !support.webp ? "jpeg" : format;
  const padBackground = fit !== "pad" ? null : transparent && effectiveFormat !== "jpeg" ? null : background;
  const outputName = `${baseName(job.file?.name ?? "image")}-${outputSize.width}x${outputSize.height}.${formatExtension(effectiveFormat)}`;

  const run = () => {
    if (!job.file) return;
    const kind = job.meta?.kind;
    job.run(async ({ loaded, onProgress, signal }) => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(0.25);
      const blob = await renderImage(loaded, {
        width: outputSize.width,
        height: outputSize.height,
        fit,
        background: padBackground,
        format: effectiveFormat,
        quality: quality / 100,
      });
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(1);

      const notes: string[] = [];
      if (outputSize.scaled) {
        notes.push(`The requested size exceeded the browser canvas limit, so the output was capped at ${outputSize.width}×${outputSize.height}.`);
      }
      if (fit === "pad" && transparent && effectiveFormat === "jpeg") {
        notes.push("JPG cannot store transparency, so the padding was filled with the chosen background color.");
      }
      if (effectiveFormat === "png") notes.push("PNG is lossless, so the quality slider does not change the file.");
      if (effectiveFormat === "jpeg" && job.meta?.hasAlpha) notes.push("Any transparency in the source was filled with white.");
      if (kind) {
        const sourceNote = sourceKindNote(kind);
        if (sourceNote) notes.push(sourceNote);
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
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif"
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, SVG, or HEIC. The source dimensions are read locally."
          disabled={busy}
          kind="image"
        />

        {job.file && job.meta && (
          <div className="settings-card">
            <LiveCropPreview
              source={job.source}
              width={outputSize.width}
              height={outputSize.height}
              fit={fit}
              background={padBackground}
              label={`Live preview · ${outputSize.width}×${outputSize.height}`}
            />
            <div className="settings-head">
              <span className="mono-label">01 · Frame</span>
              <span className="settings-hint">
                Source {job.meta.width}×{job.meta.height} · {sourceLabel(job.meta.kind)}
              </span>
            </div>
            <div className="preset-grid" role="group" aria-label="Output preset">
              {(Object.keys(PRESETS) as Exclude<PresetId, "custom">[]).map((key) => {
                const item = PRESETS[key];
                const shape = shapeSize(item.width, item.height);
                return (
                  <button
                    key={key}
                    type="button"
                    className={preset === key ? "preset active" : "preset"}
                    aria-pressed={preset === key}
                    onClick={() => choosePreset(key)}
                  >
                    <span className="image-preset-shape" style={shape} />
                    <strong>{item.label}</strong>
                    <span>
                      {item.width}×{item.height} · {item.note}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                className={preset === "custom" ? "preset active" : "preset"}
                aria-pressed={preset === "custom"}
                onClick={() => choosePreset("custom")}
              >
                <span className="image-preset-shape image-preset-custom" />
                <strong>Custom</strong>
                <span>Any size up to the canvas limit</span>
              </button>
            </div>

            {preset === "custom" && (
              <div className="inline-fields">
                <label>
                  Width
                  <DimensionInput value={customWidth} min={16} max={8192} step={1} onChange={setCustomWidth} />
                </label>
                <label>
                  Height
                  <DimensionInput value={customHeight} min={16} max={8192} step={1} onChange={setCustomHeight} />
                </label>
              </div>
            )}

            <div className="settings-head">
              <span className="mono-label">02 · Fit</span>
            </div>
            <div className="segmented" role="group" aria-label="Fit mode">
              <button
                type="button"
                className={fit === "crop" ? "segment active" : "segment"}
                aria-pressed={fit === "crop"}
                onClick={() => setFit("crop")}
              >
                <Crop size={16} /> Crop to fill
              </button>
              <button
                type="button"
                className={fit === "pad" ? "segment active" : "segment"}
                aria-pressed={fit === "pad"}
                onClick={() => setFit("pad")}
              >
                <RectangleHorizontal size={16} /> Pad to fit
              </button>
            </div>
            <p className="settings-note">
              Crop keeps the center and trims the edges. Pad keeps the whole image and adds a background. For a product
              shot or a portrait, crop is usually right. For a screenshot, pad is safer.
            </p>

            {fit === "pad" && (
              <div className="color-field">
                <label>
                  Background
                  <input
                    type="color"
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                    aria-label="Padding background color"
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={transparent}
                    onChange={(event) => setTransparent(event.target.checked)}
                  />
                  Transparent padding (PNG or WebP)
                </label>
              </div>
            )}

            <div className="settings-head">
              <span className="mono-label">03 · Format</span>
            </div>
            <div className="segmented" role="group" aria-label="Output format">
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
              {FORMATS.find((item) => item.value === format)?.note}
              {!support.webp && " WebP export is not available in this browser, so JPG and PNG stay available."}
            </p>

            {effectiveFormat !== "png" && (
              <>
                <div className="settings-head">
                  <span className="mono-label">04 · Quality</span>
                  <span className="settings-hint">{quality}%</span>
                </div>
                <div className="range-row">
                  <input
                    type="range"
                    min={55}
                    max={95}
                    step={1}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    aria-label="Image quality"
                  />
                  <span className="range-value">{quality}</span>
                </div>
              </>
            )}

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={busy || webpBlocked}
            >
              {busy ? "Resizing…" : `Resize to ${outputSize.width}×${outputSize.height}`}
            </button>
            <p className="settings-footnote">
              Output: {sourceLabel(effectiveFormat)} · {outputSize.width}×{outputSize.height} ·{" "}
              {fit === "crop" ? "cropped to fill" : "padded to fit"}
              {job.file ? ` · from ${sourceLabel(job.meta.kind)}` : ""}
            </p>
          </div>
        )}
      </section>

      <ImageJobPanel
        job={job}
        idleHint="Choose an image. Pick a platform preset or enter exact pixels, then crop or pad it to the frame you need."
      />
    </div>
  );
}
