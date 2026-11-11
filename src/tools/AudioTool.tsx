import { useState } from "react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { useMediaJob } from "../hooks/useMediaJob";
import { baseName } from "../lib/format";

type AudioFormat = "mp3" | "m4a" | "wav";

export function AudioTool() {
  const job = useMediaJob();
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [bitrate, setBitrate] = useState(192);
  const outputName = `${baseName(job.file?.name ?? "audio")}.${format}`;

  const run = () => {
    if (!job.file) return;
    job.run(outputName, (input) => {
      if (format === "wav") {
        return ["-i", input, "-vn", "-c:a", "pcm_s16le", "-y", outputName];
      }
      if (format === "m4a") {
        return ["-i", input, "-vn", "-c:a", "aac", "-b:a", `${bitrate}k`, "-y", outputName];
      }
      return ["-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", `${bitrate}k`, "-y", outputName];
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
          accept="video/*,audio/*"
          hint="MP4, MOV, WebM, MKV, MP3, WAV, or M4A."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <div className="settings-head">
              <span className="mono-label">01 · Audio format</span>
            </div>
            <div className="segmented">
              {(["mp3", "m4a", "wav"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={format === value ? "segment active" : "segment"}
                  onClick={() => setFormat(value)}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="settings-note">
              {format === "wav"
                ? "WAV is uncompressed. Use it when you will edit the audio; the file will be large."
                : "MP3 and M4A are compressed. 192 kbps is a good default for music and speech."}
            </p>

            {format !== "wav" && (
              <>
                <div className="settings-head">
                  <span className="mono-label">02 · Bitrate</span>
                </div>
                <div className="chips">
                  {[128, 192, 320].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={bitrate === value ? "chip active" : "chip"}
                      onClick={() => setBitrate(value)}
                    >
                      {value} kbps
                    </button>
                  ))}
                </div>
              </>
            )}

            <button
              className="button button-primary button-block button-lg"
              type="button"
              onClick={run}
              disabled={job.phase === "working"}
            >
              {job.phase === "working" ? "Extracting…" : `Extract ${format.toUpperCase()}`}
            </button>
            <p className="settings-footnote">
              Output: {format.toUpperCase()}
              {format !== "wav" ? ` · ${bitrate} kbps` : " · 16-bit PCM"} · audio only
            </p>
          </div>
        )}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video or audio file. Only the sound track is exported; the video is discarded."
      />
    </div>
  );
}
