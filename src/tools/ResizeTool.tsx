import { useState } from "react";
import { Crop, RectangleHorizontal } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { VideoCropPreview } from "../components/Previews";
import { useMediaJob } from "../hooks/useMediaJob";
import { baseName } from "../lib/format";
import { buildResizeArgs } from "../lib/tool-args";

type Preset = "9:16" | "1:1" | "4:5" | "16:9" | "custom";

const PRESETS: Record<Exclude<Preset, "custom">, { width: number; height: number; label: string }> = {
  "9:16": { width: 1080, height: 1920, label: "Reels · Shorts · TikTok" },
  "1:1": { width: 1080, height: 1080, label: "Square feed post" },
  "4:5": { width: 1080, height: 1350, label: "Portrait feed post" },
  "16:9": { width: 1920, height: 1080, label: "Landscape / YouTube" },
};

export function ResizeTool() {
  const job = useMediaJob();
  const [preset, setPreset] = useState<Preset>("9:16");
  const [fit, setFit] = useState<"crop" | "pad">("crop");
  const [customWidth, setCustomWidth] = useState(1080);
  const [customHeight, setCustomHeight] = useState(1920);

  const width = preset === "custom" ? customWidth : PRESETS[preset].width;
  const height = preset === "custom" ? customHeight : PRESETS[preset].height;
  const outputName = `${baseName(job.file?.name ?? "clip")}-${width}x${height}.mp4`;

  const run = () => {
    if (!job.file) return;
    job.run(outputName, (input) => buildResizeArgs({ input, output: outputName, width, height, fit }));
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="video/*"
          hint="MP4, MOV, WebM, MKV, or AVI. A 1080p source gives the cleanest result."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <VideoCropPreview
              src={job.previewUrl}
              width={width}
              height={height}
              fit={fit}
              label={`Live preview · ${width}×${height}`}
            />
            <div className="settings-head">
              <span className="mono-label">01 · Frame</span>
              {job.meta && job.meta.width > 0 && (
                <span className="settings-hint">
                  Source {job.meta.width}×{job.meta.height}
                </span>
              )}
            </div>
            <div className="preset-grid" role="group" aria-label="Output frame">
              {(Object.keys(PRESETS) as Exclude<Preset, "custom">[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={preset === key ? "preset active" : "preset"}
                  aria-pressed={preset === key}
                  onClick={() => setPreset(key)}
                >
                  <span className="preset-shape" data-shape={key} />
                  <strong>{key}</strong>
                  <span>{PRESETS[key].label}</span>
                </button>
              ))}
              <button
                type="button"
                className={preset === "custom" ? "preset active" : "preset"}
                aria-pressed={preset === "custom"}
                onClick={() => setPreset("custom")}
              >
                <span className="preset-shape" data-shape="custom" />
                <strong>Custom</strong>
                <span>Any even size</span>
              </button>
            </div>

            {preset === "custom" && (
              <div className="inline-fields">
                <label>
                  Width
                  <input
                    type="number"
                    min={16}
                    max={3840}
                    step={2}
                    value={customWidth}
                    onChange={(event) => setCustomWidth(Math.max(16, Math.min(3840, Number(event.target.value) || 16)))}
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    min={16}
                    max={3840}
                    step={2}
                    value={customHeight}
                    onChange={(event) => setCustomHeight(Math.max(16, Math.min(3840, Number(event.target.value) || 16)))}
                  />
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
                <RectangleHorizontal size={16} /> Pad with bars
              </button>
            </div>
            <p className="settings-note">
              Crop keeps the center and trims the edges. Pad keeps the whole frame and adds black bars. For a talking-head
              Reel, crop is usually right. For a screen recording, pad is safer.
            </p>

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={job.phase === "working"}
            >
              {job.phase === "working" ? "Resizing…" : `Resize to ${width}×${height}`}
            </button>
            <p className="settings-footnote">
              Output: MP4 · {width}×{height} · {fit === "crop" ? "cropped" : "padded"} · H.264 + AAC
            </p>
          </div>
        )}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video. The source dimensions are read locally so you can see what the crop will do."
      />
    </div>
  );
}
