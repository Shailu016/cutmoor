import { useEffect, useState } from "react";
import { MapPin, ShieldCheck } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { RunButton, SettingsHead } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { baseName } from "../../lib/format";
import { inspectMetadata, stripMetadata, type Inspection } from "../../lib/exif";
import { formatExtension, renderImage, type ImageFormat } from "../../lib/image";

const MIME_FORMAT: Record<string, ImageFormat> = { jpeg: "jpeg", png: "png", webp: "webp" };

export function RemoveMetadataTool() {
  const job = useImageJob();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const busy = job.phase === "working";
  const file = job.file;

  // Look inside the file as soon as it is chosen, so the visitor sees what is hidden in it before it is removed.
  useEffect(() => {
    let cancelled = false;
    setInspection(null);
    setReadFailed(false);
    if (!file) return;
    void file
      .arrayBuffer()
      .then((buffer) => {
        if (!cancelled) setInspection(inspectMetadata(new Uint8Array(buffer)));
      })
      .catch(() => {
        if (!cancelled) setReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const run = () => {
    if (!file || !job.meta) return;
    const meta = job.meta;
    job.run(async ({ loaded, onProgress, signal }) => {
      onProgress(0.2);
      const original = new Uint8Array(await file.arrayBuffer());
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const cleaned = stripMetadata(original);
      onProgress(0.7);
      if (cleaned) {
        const kind = inspectMetadata(original).kind;
        const format = MIME_FORMAT[kind] ?? "jpeg";
        const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
        onProgress(1);
        return {
          blob: new Blob([cleaned.buffer.slice(cleaned.byteOffset, cleaned.byteOffset + cleaned.byteLength) as ArrayBuffer], { type: mime }),
          name: `${baseName(file.name)}-clean.${formatExtension(format)}`,
          width: meta.width,
          height: meta.height,
          format,
          note: "The picture itself was not touched: its pixels are exactly the same, and only the hidden data was cut out of the file.",
        };
      }
      // GIF, HEIC, AVIF, BMP, SVG: draw the picture again, which carries none of the original file's hidden data.
      const format: ImageFormat = meta.hasAlpha ? "png" : "jpeg";
      const blob = await renderImage(loaded, { width: meta.width, height: meta.height, fit: "stretch", format, quality: 0.95, background: format === "jpeg" ? "#ffffff" : null });
      onProgress(1);
      return {
        blob,
        name: `${baseName(file.name)}-clean.${formatExtension(format)}`,
        width: meta.width,
        height: meta.height,
        format,
        note: `This file type cannot be cleaned in place, so the picture was redrawn as a ${format === "png" ? "PNG" : "JPG"}. That drops all hidden data, and re-encodes the picture once.`,
      };
    });
  };

  const hasGps = inspection?.findings.some((finding) => finding.label.startsWith("GPS")) ?? false;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/svg+xml,image/heic,image/heif"
          hint="A photo from a phone or camera. See what is hidden in it, then remove it."
          kind="image"
          disabled={busy}
        />

        {job.file && job.meta && (
          <div className="settings-card">
            <SettingsHead label="01 · What is hidden in this file" />
            {readFailed && <p className="settings-note">The file could not be read for a check. You can still clean it below.</p>}
            {!inspection && !readFailed && <p className="settings-note">Looking inside the file…</p>}
            {inspection && inspection.findings.length === 0 && (
              <p className="settings-note">
                <ShieldCheck size={14} /> {inspection.kind === "other" ? "This file type is not checked in detail. Cleaning it redraws the picture, which drops any hidden data." : "No camera, location, or author data was found in this file."}
              </p>
            )}
            {inspection && inspection.findings.length > 0 && (
              <>
                {hasGps && (
                  <p className="field-error" role="status">
                    <MapPin size={14} /> This photo records where it was taken. Anyone who gets the file can read the location.
                  </p>
                )}
                <ul className="found-list" aria-label="Hidden data found in the file">
                  {inspection.findings.map((finding, index) => (
                    <li key={`${finding.label}-${index}`} data-risk={finding.risk}>
                      <span>{finding.label}</span>
                      <span>{finding.value}</span>
                    </li>
                  ))}
                </ul>
                <p className="settings-note">These values are shown only here, on your device.</p>
              </>
            )}
            <SettingsHead label="02 · Clean" />
            <p className="settings-note">
              JPG, PNG, and WebP files are cleaned <strong>without re-encoding</strong>: the picture stays exactly as it is and only the hidden
              data is removed. A colour profile is kept so colours stay right, and a phone photo keeps its upright orientation.
            </p>
            <RunButton working={busy} idleLabel="Remove hidden data" workingLabel="Cleaning…" onClick={run} />
            <p className="settings-footnote">The clean copy is a new file; your original is not changed.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a photo. Cutmoor shows what is hidden in it, such as the place and the phone, then removes it on your device." />
    </div>
  );
}
