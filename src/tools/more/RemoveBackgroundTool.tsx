import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { ImageOutputControls } from "../../components/ImageOutput";
import { ModelNotice, useModel } from "../../components/ModelGate";
import { Chips, RunButton, Segmented, SettingsHead } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { formatBytes, baseName } from "../../lib/format";
import { canvasToBlob, clampDimensions, drawToCanvas, formatExtension, type ImageFormat } from "../../lib/image";
import { applyMask, coverage, EDGE_STYLES, MATTING_SIZE, normalizeMask, opaqueBounds, resizeMask, shapeMask, toNetworkInput, type EdgeStyle } from "../../lib/modeltools/matting";
import { BACKGROUND_MODEL } from "../../lib/modeltools/manifests";

const BACKGROUNDS = [
  { value: "none", label: "Transparent" },
  { value: "#ffffff", label: "White" },
  { value: "#000000", label: "Black" },
  { value: "custom", label: "Your colour" },
];

const MODEL_FILE = "isnet-general-fp16";

export function RemoveBackgroundTool() {
  const job = useImageJob();
  const model = useModel(BACKGROUND_MODEL, MODEL_FILE);
  const [edge, setEdge] = useState<EdgeStyle>("normal");
  const [background, setBackground] = useState("none");
  const [custom, setCustom] = useState("#2d4bf0");
  const [trim, setTrim] = useState(false);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(92);
  const [jpgFill, setJpgFill] = useState("#ffffff");
  const busy = job.phase === "working";
  const meta = job.meta;
  const fill = background === "none" ? null : background === "custom" ? custom : background;
  // A solid background means the result needs no transparency, so JPG is allowed; a transparent one needs PNG or WebP.
  const effectiveFormat: ImageFormat = fill === null && format === "jpeg" ? "png" : format;
  const outputName = `${baseName(job.file?.name ?? "image")}-no-background.${formatExtension(effectiveFormat)}`;

  const run = () => {
    if (!meta) return;
    job.run(async ({ loaded, onProgress, signal }) => {
      const session = await model.open((fraction) => onProgress(fraction * 0.55), signal);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(0.6);

      // 1. What the network sees: the whole picture squeezed to a square.
      const square = drawToCanvas(loaded, { width: MATTING_SIZE, height: MATTING_SIZE, fit: "stretch", format: "png", background: "#ffffff" });
      const squareContext = square.getContext("2d", { willReadFrequently: true });
      if (!squareContext) throw new Error("The browser could not read the picture back. Try a smaller picture.");
      const input = toNetworkInput(squareContext.getImageData(0, 0, MATTING_SIZE, MATTING_SIZE).data);
      onProgress(0.65);

      // 2. The network's answer: how much each pixel belongs to the subject.
      const outputs = await session.run({ input_image: { data: input, dims: [1, 3, MATTING_SIZE, MATTING_SIZE] } });
      const raw = Object.values(outputs)[0];
      if (!raw) throw new Error("The model returned nothing.");
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      onProgress(0.8);

      // 3. Back to the picture's own size, shaped, and written into the transparency.
      const size = clampDimensions(meta.width, meta.height);
      const canvas = drawToCanvas(loaded, { width: size.width, height: size.height, fit: "stretch", format: "png", background: null });
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("The browser could not read the picture back. Try a smaller picture.");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      let mask = normalizeMask(raw.data);
      mask = resizeMask(mask, MATTING_SIZE, MATTING_SIZE, canvas.width, canvas.height);
      shapeMask(mask, edge);
      const share = coverage(mask);
      applyMask(pixels.data, mask);
      context.putImageData(pixels, 0, 0);
      onProgress(0.9);

      // 4. Optional: a solid background, and trimming the empty space around the subject.
      let result = canvas;
      if (trim) {
        const bounds = opaqueBounds(pixels.data, canvas.width, canvas.height);
        if (bounds) {
          const cropped = document.createElement("canvas");
          cropped.width = bounds.w;
          cropped.height = bounds.h;
          cropped.getContext("2d")?.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
          result = cropped;
        }
      }
      if (fill || effectiveFormat === "jpeg") {
        const flat = document.createElement("canvas");
        flat.width = result.width;
        flat.height = result.height;
        const flatContext = flat.getContext("2d");
        if (!flatContext) throw new Error("The browser could not create a canvas.");
        flatContext.fillStyle = fill ?? jpgFill;
        flatContext.fillRect(0, 0, flat.width, flat.height);
        flatContext.drawImage(result, 0, 0);
        result = flat;
      }
      const blob = await canvasToBlob(result, effectiveFormat, quality / 100);
      onProgress(1);

      const notes: string[] = [];
      if (share < 0.003) notes.push("The model found almost no clear subject, so very little is left. Try a picture where the subject stands out from its background.");
      else if (share > 0.97) notes.push("Almost the whole picture was kept: the model did not find a background to remove.");
      notes.push(`Cut out on your device (${session.backend === "webgpu" ? "graphics card" : "processor"}). Fine hair, glass, and smoke are the hardest cases; check the edges.`);
      return { blob, name: outputName, width: result.width, height: result.height, format: effectiveFormat, note: notes.join(" ") };
    });
  };

  const cached = model.plan?.cached ?? false;
  const label = cached || !model.plan ? "Remove background" : `Download ${formatBytes(model.plan.totalBytes)} and remove background`;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif"
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, or HEIC. Works best with a clear subject: a person, product, or pet."
          kind="image"
          disabled={busy}
        />

        {job.file && meta && (
          <div className="settings-card">
            <SettingsHead label="01 · Edge" />
            <Segmented
              label="Edge style"
              value={edge}
              disabled={busy}
              onChange={setEdge}
              options={(Object.keys(EDGE_STYLES) as EdgeStyle[]).map((key) => ({ value: key, label: key === "soft" ? "Soft" : key === "normal" ? "Normal" : "Sharp" }))}
            />
            <p className="settings-note">Soft keeps fine hair and fur; Sharp gives a clean line for products and logos.</p>
            <SettingsHead label="02 · Background" />
            <Chips label="Background" value={background} options={BACKGROUNDS} onChange={setBackground} disabled={busy} />
            {background === "custom" && (
              <div className="color-field">
                <label>
                  Background colour
                  <input type="color" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Background colour" disabled={busy} />
                </label>
              </div>
            )}
            <label className="check-row">
              <input type="checkbox" checked={trim} disabled={busy} onChange={(event) => setTrim(event.target.checked)} /> Trim the empty space around the subject
            </label>
            <ImageOutputControls
              label="03 · Save as"
              format={effectiveFormat}
              onFormat={setFormat}
              quality={quality}
              onQuality={setQuality}
              background={jpgFill}
              onBackground={setJpgFill}
              showBackground={false}
              allowJpeg={fill !== null}
              disabled={busy}
            />
            <ModelNotice plan={model.plan} what="the background-removal model" />
            <RunButton working={busy} idleLabel={label} workingLabel="Removing background…" onClick={run} />
            <p className="settings-footnote">Transparent results are saved as PNG or WebP. The picture is processed on your device.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a picture. Cutmoor finds the subject and removes the background on your device." />
    </div>
  );
}
