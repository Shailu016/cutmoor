import { VolumeX } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName } from "../../lib/format";
import { buildMuteArgs } from "../../lib/video-edit-args";

export function MuteTool() {
  const job = useMediaJob();
  const outputName = `${baseName(job.file?.name ?? "clip")}-muted.mp4`;

  const run = () => {
    if (!job.file) return;
    job.run(outputName, (input) => buildMuteArgs({ input, output: outputName }));
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
          hint="MP4, MOV, WebM, MKV, or AVI. The sound track is removed."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · What happens" />
            <div className="range-preview">
              <VolumeX size={16} />
              <span>
                The picture is kept and the <strong>whole sound track is removed</strong>. The result has no audio at all, so there is nothing to
                un-mute later.
              </span>
            </div>
            <p className="settings-note">Already silent? The tool still works; it just returns the same picture without a sound track.</p>
            <RunButton working={job.phase === "working"} idleLabel="Remove the sound" workingLabel="Removing sound…" onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264, no audio · made on your device</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a video. Cutmoor removes its sound track on your device and gives you a silent MP4." />
    </div>
  );
}
