import { useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { useMediaJob } from "../hooks/useMediaJob";
import { baseName, formatDuration, parseTimecode } from "../lib/format";

export function TrimTool() {
  const job = useMediaJob();
  const [start, setStart] = useState("0:00");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (job.meta && job.meta.duration > 0) {
      setStart("0:00");
      setEnd(formatDuration(job.meta.duration));
    }
  }, [job.meta]);

  const startSeconds = parseTimecode(start);
  const endSeconds = end.trim() ? parseTimecode(end) : job.meta?.duration ?? 0;
  const valid =
    Number.isFinite(startSeconds) &&
    Number.isFinite(endSeconds) &&
    startSeconds >= 0 &&
    endSeconds > startSeconds;
  const length = valid ? endSeconds - startSeconds : 0;
  const outputName = `${baseName(job.file?.name ?? "clip")}-trimmed.mp4`;

  const run = () => {
    if (!job.file || !valid) return;
    job.run(outputName, (input) => {
      const args = ["-ss", String(startSeconds), "-i", input, "-t", String(length)];
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "160k");
      args.push("-movflags", "+faststart", "-y", outputName);
      return args;
    });
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
          hint="MP4, MOV, WebM, MKV, or AVI. The cut is re-encoded for accuracy."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <div className="settings-head">
              <span className="mono-label">01 · Range</span>
              {job.meta && job.meta.duration > 0 && (
                <span className="settings-hint">Source {formatDuration(job.meta.duration)}</span>
              )}
            </div>
            <div className="inline-fields">
              <label>
                Start
                <input
                  type="text"
                  inputMode="numeric"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  placeholder="0:00"
                  aria-label="Start time"
                  aria-invalid={!valid}
                  aria-describedby={!valid ? "trim-error" : undefined}
                />
              </label>
              <label>
                End
                <input
                  type="text"
                  inputMode="numeric"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  placeholder="0:30"
                  aria-label="End time"
                  aria-invalid={!valid}
                  aria-describedby={!valid ? "trim-error" : undefined}
                />
              </label>
            </div>
            <p className="settings-note">
              Use seconds or a timecode: <code>12</code>, <code>0:12</code>, or <code>1:02:03</code>. Leave the end
              empty to keep the rest of the file.
            </p>
            {!valid && (start.trim() || end.trim()) && (
              <p className="field-error" id="trim-error" role="alert">
                The end time must be after the start time.
              </p>
            )}
            {valid && (
              <div className="range-preview">
                <Scissors size={16} />
                <span>
                  Keeping <strong>{formatDuration(length)}</strong> of the clip.
                </span>
              </div>
            )}

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={!valid || job.phase === "working"}
            >
              {job.phase === "working" ? "Trimming…" : "Trim video"}
            </button>
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · frame-accurate cut</p>
          </div>
        )}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video. Cutmoor shows its duration, then cuts the exact range you enter."
      />
    </div>
  );
}
