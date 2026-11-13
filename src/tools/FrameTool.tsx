import { useEffect, useState } from "react";
import { Image } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { useMediaJob } from "../hooks/useMediaJob";
import { baseName, formatDuration, parseTimecode } from "../lib/format";
import { buildFrameArgs } from "../lib/tool-args";

export function FrameTool() {
  const job = useMediaJob();
  const [timestamp, setTimestamp] = useState("0:01");
  const [format, setFormat] = useState<"png" | "jpg">("png");

  useEffect(() => {
    if (job.meta && job.meta.duration > 0) {
      const suggested = Math.min(job.meta.duration / 2, 3);
      setTimestamp(formatDuration(suggested));
    }
  }, [job.meta]);

  const seconds = parseTimecode(timestamp);
  const valid = Number.isFinite(seconds) && seconds >= 0;
  const outputName = `${baseName(job.file?.name ?? "clip")}-frame.${format}`;

  const run = () => {
    if (!job.file || !valid) return;
    job.run(outputName, (input) => buildFrameArgs({ input, output: outputName, seconds, format }));
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
          hint="MP4, MOV, WebM, MKV, or AVI. The still is exported at full resolution."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <div className="settings-head">
              <span className="mono-label">01 · Timestamp</span>
              {job.meta && job.meta.duration > 0 && (
                <span className="settings-hint">Duration {formatDuration(job.meta.duration)}</span>
              )}
            </div>
            <label className="single-field">
              Time in the video
              <input
                type="text"
                inputMode="decimal"
                value={timestamp}
                onChange={(event) => setTimestamp(event.target.value)}
                placeholder="0:03"
                aria-invalid={!valid}
              />
            </label>
            <p className="settings-note">
              Use seconds or a timecode. The frame closest to this moment is exported. If the result is black, move the
              timestamp one second later.
            </p>

            <div className="settings-head">
              <span className="mono-label">02 · Image format</span>
            </div>
            <div className="segmented" role="group" aria-label="Image format">
              <button
                type="button"
                className={format === "png" ? "segment active" : "segment"}
                aria-pressed={format === "png"}
                onClick={() => setFormat("png")}
              >
                PNG · sharp
              </button>
              <button
                type="button"
                className={format === "jpg" ? "segment active" : "segment"}
                aria-pressed={format === "jpg"}
                onClick={() => setFormat("jpg")}
              >
                JPG · small
              </button>
            </div>

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={!valid || job.phase === "working"}
            >
              <Image size={17} /> {job.phase === "working" ? "Extracting…" : "Save this frame"}
            </button>
            <p className="settings-footnote">
              Output: {format.toUpperCase()}
              {job.meta && job.meta.width > 0 ? ` · ${job.meta.width}×${job.meta.height}` : ""} · full resolution
            </p>
          </div>
        )}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video, then pick the moment you want as a still. The image is saved at the video's resolution."
      />
    </div>
  );
}
