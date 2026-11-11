import { useState } from "react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { useMediaJob } from "../hooks/useMediaJob";
import { baseName } from "../lib/format";

type Format = "mp4" | "webm" | "gif" | "mp3" | "wav" | "m4a";

const FORMATS: { value: Format; label: string; note: string }[] = [
  { value: "mp4", label: "MP4", note: "Plays everywhere. H.264 + AAC." },
  { value: "webm", label: "WebM", note: "Smaller for the web. VP9 + Opus." },
  { value: "gif", label: "GIF", note: "Short silent loop. Keep it under 6s." },
  { value: "mp3", label: "MP3", note: "Audio only. Small and universal." },
  { value: "m4a", label: "M4A", note: "Audio only. AAC, Apple-friendly." },
  { value: "wav", label: "WAV", note: "Audio only. Uncompressed, large." },
];

export function ConvertTool() {
  const job = useMediaJob();
  const [format, setFormat] = useState<Format>("mp4");
  const outputName = `${baseName(job.file?.name ?? "clip")}.${format}`;

  const run = () => {
    if (!job.file) return;
    job.run(outputName, (input) => {
      if (format === "mp4") {
        return ["-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", outputName];
      }
      if (format === "webm") {
        return ["-i", input, "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k", "-y", outputName];
      }
      if (format === "gif") {
        return [
          "-i", input,
          "-vf", "fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
          "-loop", "0",
          "-y", outputName,
        ];
      }
      if (format === "mp3") {
        return ["-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-y", outputName];
      }
      if (format === "m4a") {
        return ["-i", input, "-vn", "-c:a", "aac", "-b:a", "192k", "-y", outputName];
      }
      return ["-i", input, "-vn", "-c:a", "pcm_s16le", "-y", outputName];
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
          hint="MP4, MOV, WebM, MKV, or AVI."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <div className="settings-head">
              <span className="mono-label">01 · Output format</span>
            </div>
            <div className="format-grid" role="group" aria-label="Output format">
              {FORMATS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={format === item.value ? "format active" : "format"}
                  aria-pressed={format === item.value}
                  onClick={() => setFormat(item.value)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.note}</span>
                </button>
              ))}
            </div>
            <p className="settings-note">
              Converting always re-encodes. If the source is already the format you need, use the compress or trim tool
              instead to avoid a second quality loss.
            </p>

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={job.phase === "working"}
            >
              {job.phase === "working" ? "Converting…" : `Convert to ${format.toUpperCase()}`}
            </button>
            <p className="settings-footnote">Output: {format.toUpperCase()} · encoded locally in your browser</p>
          </div>
        )}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video or audio file, then pick the format you need. The conversion runs on your device."
      />
    </div>
  );
}
