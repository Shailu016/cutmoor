import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { ImageJobPanel } from "../../components/ImageJobPanel";
import { ImageOutputControls } from "../../components/ImageOutput";
import { ModelNotice, useModel } from "../../components/ModelGate";
import { Chips, FieldError, RunButton, SettingsHead } from "../../components/Controls";
import { useImageJob } from "../../hooks/useImageJob";
import { baseName, formatBytes } from "../../lib/format";
import { canvasToBlob, drawToCanvas, formatExtension, type ImageFormat } from "../../lib/image";
import { UPSCALE_MODEL } from "../../lib/modeltools/manifests";
import { extractPatch, fitsCanvas, MARGIN, outputSize, planTiles, SCALE, TILE, writeCore } from "../../lib/modeltools/tiling";

const MODEL_FILE = "realesrgan-x4v3";
const factors = [
  { value: 2, label: "2× (twice the size)" },
  { value: 4, label: "4× (four times)" },
];

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function UpscaleTool() {
  const job = useImageJob();
  const model = useModel(UPSCALE_MODEL, MODEL_FILE);
  const [factor, setFactor] = useState<2 | 4>(2);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState("#ffffff");
  const busy = job.phase === "working";
  const meta = job.meta;
  const fits = meta ? fitsCanvas(meta.width, meta.height, factor) : true;
  const target = meta ? outputSize(meta.width, meta.height, factor) : null;
  const tiles = meta ? planTiles(meta.width, meta.height).length : 0;
  const outputName = `${baseName(job.file?.name ?? "image")}-${factor}x.${formatExtension(format)}`;

  const run = () => {
    if (!meta || !fits) return;
    job.run(async ({ loaded, onProgress, signal }) => {
      const session = await model.open((fraction) => onProgress(fraction * 0.15), signal);
      onProgress(0.15);

      // The picture's pixels, at its own size.
      const source = drawToCanvas(loaded, { width: meta.width, height: meta.height, fit: "stretch", format: "png", background: null });
      const sourcePixels = source.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, meta.width, meta.height);
      if (!sourcePixels) throw new Error("The browser could not read the picture back. Try a smaller picture.");

      // The network always enlarges four times, in pieces; the middle of each piece is kept. A 2x result is the 4x picture
      // scaled back down, which is sharper than enlarging twice with ordinary smoothing.
      const big = { width: meta.width * SCALE, height: meta.height * SCALE };
      const out = new Uint8ClampedArray(big.width * big.height * 4);
      const list = planTiles(meta.width, meta.height);
      for (let index = 0; index < list.length; index += 1) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const tile = list[index];
        const patch = extractPatch(sourcePixels.data, meta.width, meta.height, tile.sx, tile.sy, TILE);
        const result = await session.run({ image: { data: patch, dims: [1, 3, TILE, TILE] } });
        const enlarged = Object.values(result)[0];
        if (!enlarged) throw new Error("The model returned nothing.");
        writeCore(out, big.width, enlarged.data, tile, TILE, MARGIN, SCALE);
        onProgress(0.15 + ((index + 1) / list.length) * 0.75);
        if (index % 4 === 3) await pause();
      }

      // See-through pictures: the network only handles colour, so the transparency is enlarged the ordinary way.
      if (meta.hasAlpha) {
        const alphaCanvas = document.createElement("canvas");
        alphaCanvas.width = big.width;
        alphaCanvas.height = big.height;
        const alphaContext = alphaCanvas.getContext("2d", { willReadFrequently: true });
        if (alphaContext) {
          alphaContext.imageSmoothingQuality = "high";
          alphaContext.drawImage(source, 0, 0, big.width, big.height);
          const scaled = alphaContext.getImageData(0, 0, big.width, big.height).data;
          for (let i = 3; i < out.length; i += 4) out[i] = scaled[i];
        }
      }

      const bigCanvas = document.createElement("canvas");
      bigCanvas.width = big.width;
      bigCanvas.height = big.height;
      const bigContext = bigCanvas.getContext("2d");
      if (!bigContext) throw new Error("The browser could not create a canvas for the result.");
      bigContext.putImageData(new ImageData(out, big.width, big.height), 0, 0);

      let result = bigCanvas;
      if (factor === 2) {
        const half = document.createElement("canvas");
        half.width = meta.width * 2;
        half.height = meta.height * 2;
        const halfContext = half.getContext("2d");
        if (!halfContext) throw new Error("The browser could not create a canvas for the result.");
        halfContext.imageSmoothingQuality = "high";
        halfContext.drawImage(bigCanvas, 0, 0, half.width, half.height);
        result = half;
      }
      if (format === "jpeg") {
        const flat = document.createElement("canvas");
        flat.width = result.width;
        flat.height = result.height;
        const flatContext = flat.getContext("2d");
        if (flatContext) {
          flatContext.fillStyle = background;
          flatContext.fillRect(0, 0, flat.width, flat.height);
          flatContext.drawImage(result, 0, 0);
          result = flat;
        }
      }
      const blob = await canvasToBlob(result, format, quality / 100);
      onProgress(1);
      return {
        blob,
        name: outputName,
        width: result.width,
        height: result.height,
        format,
        note: `Enlarged on your device (${session.backend === "webgpu" ? "graphics card" : "processor"}) in ${list.length} pieces. It sharpens and adds believable detail but cannot recover what was never in the picture; faces and small text can look slightly changed.`,
      };
    });
  };

  const cached = model.plan?.cached ?? false;
  const label = cached || !model.plan ? `Enlarge ${factor}×` : `Download ${formatBytes(model.plan.totalBytes)} and enlarge ${factor}×`;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp,image/heic,image/heif"
          hint="JPG, PNG, WebP, AVIF, GIF, BMP, or HEIC. Best for small or soft pictures."
          kind="image"
          disabled={busy}
        />

        {job.file && meta && target && (
          <div className="settings-card">
            <SettingsHead label="01 · How much bigger" hint={`${target.width}×${target.height} px`} />
            <Chips label="Enlargement" value={factor} options={factors} onChange={(value) => setFactor(value as 2 | 4)} disabled={busy} />
            {!fits && <FieldError>The result would be larger than a browser can draw. Choose 2× or use a smaller picture.</FieldError>}
            <p className="settings-note">
              The picture is enlarged in {tiles} piece{tiles === 1 ? "" : "s"}. Larger pictures take longer; a graphics card makes it several times faster than a processor alone.
            </p>
            <ImageOutputControls label="02 · Save as" format={format} onFormat={setFormat} quality={quality} onQuality={setQuality} background={background} onBackground={setBackground} showBackground={meta.hasAlpha} disabled={busy} />
            <ModelNotice plan={model.plan} what="the enlargement model" />
            <RunButton working={busy} idleLabel={label} workingLabel="Enlarging…" disabled={!fits} onClick={run} />
            <p className="settings-footnote">Everything runs on your device. PNG is best for a result you will edit again.</p>
          </div>
        )}
      </section>

      <ImageJobPanel job={job} idleHint="Choose a small or soft picture. Cutmoor enlarges it with a neural network that runs on your device." />
    </div>
  );
}
