import { useState } from "react";
import { Gauge, Sparkles } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { useMediaJob } from "../hooks/useMediaJob";
import { buildCompressArgs } from "../lib/compress";
import { baseName, formatBytes, targetVideoKbps } from "../lib/format";

const SIZES = [8, 10, 16, 25, 50, 100];

export function CompressTool() {
  const job = useMediaJob();
  const [mode, setMode] = useState<"size" | "quality">("size");
  const [target, setTarget] = useState(25);
  const [resolution, setResolution] = useState<"original" | "1080" | "720" | "480">("original");

  const duration = job.meta?.duration ?? 0;
  const estimatedKbps = mode === "size" && duration > 0 ? targetVideoKbps(target, duration) : 0;

  const run = () => {
    if (!job.file) return;
    const output = `${baseName(job.file.name)}-compressed.mp4`;
    job.run(output, (input) =>
      buildCompressArgs({ input, output, mode, targetMb: target, durationSeconds: duration, resolution }),
    );
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
          hint="MP4, MOV, WebM, MKV, or AVI. Tested up to 104 MB; larger files depend on your device's memory."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <div className="settings-head">
              <span className="mono-label">01 · Method</span>
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
                <Sparkles size={16} /> Best quality
              </button>
            </div>

            {mode === "size" ? (
              <>
                <div className="settings-head">
                  <span className="mono-label">02 · Target file size</span>
                  {duration > 0 && <span className="settings-hint">{Math.round(duration)}s source</span>}
                </div>
                <div className="chips" role="group" aria-label="Target file size">
                  {SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={target === size ? "chip active" : "chip"}
                      aria-pressed={target === size}
                      onClick={() => setTarget(size)}
                    >
                      {size} MB
                    </button>
                  ))}
                  <label className="chip chip-input">
                    <input
                      type="number"
                      min={2}
                      max={500}
                      value={target}
                      onChange={(event) => setTarget(Math.max(2, Math.min(500, Number(event.target.value) || 2)))}
                      aria-label="Custom target size in megabytes"
                    />
                    <span>MB</span>
                  </label>
                </div>
                {estimatedKbps > 0 && (
                  <p className="settings-note">
                    About <strong>{estimatedKbps} kbps</strong> for video and 128 kbps for audio. Short clips get a
                    generous bitrate; long clips get a lean one.
                  </p>
                )}
              </>
            ) : (
              <p className="settings-note">
                A quality-first H.264 encode (CRF 28). The file size is whatever the picture needs. This is usually the
                best choice when the video is already close to the limit.
              </p>
            )}

            <div className="settings-head">
              <span className="mono-label">03 · Resolution</span>
            </div>
            <div className="chips" role="group" aria-label="Output resolution">
              {(["original", "1080", "720", "480"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={resolution === value ? "chip active" : "chip"}
                  aria-pressed={resolution === value}
                  onClick={() => setResolution(value)}
                >
                  {value === "original" ? "Original" : `${value}p`}
                </button>
              ))}
            </div>

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={job.phase === "working"}
            >
              {job.phase === "working" ? "Compressing…" : "Compress video"}
            </button>
            <p className="settings-footnote">
              Output: MP4 (H.264 + AAC) · {mode === "size" ? `target ${target} MB` : "quality-first"} ·{" "}
              {resolution === "original" ? "original resolution" : `${resolution}p`}
              {job.file ? ` · from ${formatBytes(job.file.size)}` : ""}
            </p>
          </div>
        )}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video. Cutmoor reads its duration locally, then calculates a bitrate that fits your target size."
      />
    </div>
  );
}
