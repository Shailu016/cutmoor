import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { Chips, RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName, formatDuration } from "../../lib/format";
import { buildLoopArgs } from "../../lib/video-edit-args";

const PLAYS = [2, 3, 4, 5, 10].map((value) => ({ value, label: `${value} times` }));
/** A looped result longer than this is refused: it would take too long and too much memory in a tab. */
const MAX_TOTAL_SECONDS = 600;

export function LoopTool() {
  const job = useMediaJob();
  const [plays, setPlays] = useState(3);
  const duration = job.meta?.duration ?? 0;
  const total = duration * plays;
  const tooLong = total > MAX_TOTAL_SECONDS;
  const outputName = `${baseName(job.file?.name ?? "clip")}-loop-${plays}x.mp4`;

  const run = () => {
    if (!job.file || tooLong) return;
    job.runMulti(outputName, [job.file], ({ names, infos }) => buildLoopArgs({ input: names[0], output: outputName, plays, hasAudio: infos[0].hasAudio }), {
      probe: true,
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
          hint="MP4, MOV, WebM, MKV, or AVI. Repeat a short clip."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · Repeat" hint={total > 0 ? `${formatDuration(total)} in total` : undefined} />
            <Chips label="Number of plays" value={plays} options={PLAYS} onChange={setPlays} disabled={job.phase === "working"} />
            <p className="settings-note">
              The clip is played {plays} times in a row, sound included, and saved as one MP4. This is a real file, not a player setting, so it
              loops on any site that takes video.
            </p>
            {tooLong && (
              <p className="field-error" role="alert">
                That would be over {MAX_TOTAL_SECONDS / 60} minutes. Choose fewer repeats or a shorter clip.
              </p>
            )}
            <RunButton working={job.phase === "working"} idleLabel={`Loop ${plays} times`} workingLabel="Looping…" disabled={tooLong} onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · {plays} plays</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a short clip and how many times to repeat it. The loop is made on your device." />
    </div>
  );
}
