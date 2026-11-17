import { Rewind } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName, formatBytes, formatDuration } from "../../lib/format";
import { buildReverseArgs, reverseMemoryEstimate, REVERSE_MEMORY_LIMIT } from "../../lib/video-edit-args";

export function ReverseTool() {
  const job = useMediaJob();
  const outputName = `${baseName(job.file?.name ?? "clip")}-reversed.mp4`;

  const run = () => {
    if (!job.file) return;
    job.runMulti(
      outputName,
      [job.file],
      ({ names, infos }) => {
        const info = infos[0];
        const needed = reverseMemoryEstimate({
          width: info.width || job.meta?.width || 1280,
          height: info.height || job.meta?.height || 720,
          fps: info.fps || 30,
          duration: info.duration || job.meta?.duration || 0,
        });
        if (needed > REVERSE_MEMORY_LIMIT) {
          throw new Error(
            `Reversing keeps every frame in memory, and this clip would need about ${formatBytes(needed)}, more than a browser tab can hold. Trim it to a shorter piece first (the Trim tool), or lower its resolution.`,
          );
        }
        return buildReverseArgs({ input: names[0], output: outputName, hasAudio: info.hasAudio });
      },
      { probe: true },
    );
  };

  const long = job.meta && job.meta.duration > 60;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="video/*"
          hint="MP4, MOV, WebM, MKV, or AVI. Best for clips under a minute."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · What happens" hint={job.meta && job.meta.duration > 0 ? formatDuration(job.meta.duration) : undefined} />
            <div className="range-preview">
              <Rewind size={16} />
              <span>
                The clip plays <strong>from the last frame to the first</strong>, and the sound plays backwards with it.
              </span>
            </div>
            <p className="settings-note">
              Reversing needs the whole clip in memory at once, so it suits short clips. If a clip is too big, Cutmoor says so before it starts
              instead of crashing.
            </p>
            {long && <p className="settings-note">This clip is over a minute. A shorter piece (use Trim first) will reverse faster and is less likely to run out of memory.</p>}
            <RunButton working={job.phase === "working"} idleLabel="Reverse video" workingLabel="Reversing…" onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · reversed picture and sound</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a short video. Cutmoor plays it backwards on your device and gives you a new MP4." />
    </div>
  );
}
