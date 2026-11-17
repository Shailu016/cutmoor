import { useEffect } from "react";
import { useImageEncoderSupport } from "../hooks/useImageEncoderSupport";
import type { ImageFormat } from "../lib/image";
import { RangeField, Segmented, SettingsHead } from "./Controls";

/**
 * The output choices every picture tool ends with: file type, quality, and the fill for see-through areas when the type
 * is JPG. WebP is offered only where the browser can write it.
 */
export function ImageOutputControls({
  label = "Output",
  format,
  onFormat,
  quality,
  onQuality,
  background,
  onBackground,
  showBackground,
  allowJpeg = true,
  disabled = false,
}: {
  label?: string;
  format: ImageFormat;
  onFormat: (format: ImageFormat) => void;
  quality: number;
  onQuality: (quality: number) => void;
  background: string;
  onBackground: (color: string) => void;
  /** True when the picture has see-through areas (a circle crop, a tilted picture, a PNG with alpha). */
  showBackground: boolean;
  /** False when the result must stay see-through, so JPG is not offered. */
  allowJpeg?: boolean;
  disabled?: boolean;
}) {
  const support = useImageEncoderSupport();
  useEffect(() => {
    if (!support.webp && format === "webp") onFormat("jpeg");
  }, [format, onFormat, support.webp]);

  return (
    <>
      <SettingsHead label={label} hint={format === "png" ? "Lossless" : `Quality ${quality}%`} />
      <Segmented
        label="File type"
        value={format}
        disabled={disabled}
        onChange={onFormat}
        options={[
          ...(allowJpeg ? [{ value: "jpeg" as ImageFormat, label: "JPG" }] : []),
          { value: "png", label: "PNG" },
          ...(support.webp ? [{ value: "webp" as ImageFormat, label: "WebP" }] : []),
        ]}
      />
      {format !== "png" && <RangeField label="Image quality" value={quality} min={50} max={100} display={`${quality}`} onChange={onQuality} disabled={disabled} />}
      {format === "jpeg" && showBackground && (
        <div className="color-field">
          <label>
            Fill for see-through areas
            <input type="color" value={background} onChange={(event) => onBackground(event.target.value)} aria-label="Fill colour for see-through areas" disabled={disabled} />
          </label>
          <p className="settings-note">JPG cannot be see-through, so empty corners are filled with this colour. Choose PNG to keep them transparent.</p>
        </div>
      )}
    </>
  );
}
