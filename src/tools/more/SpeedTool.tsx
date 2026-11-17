import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { Chips, RangeField, RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName, formatDuration } from "../../lib/format";
import { buildSpeedArgs, MAX_SPEED, MIN_SPEED } from "../../lib/video-edit-args";

const PRESETS = [0.25, 0.5, 0.75, 1.5, 2, 3, 4].map((value) => ({ value, label: `${value}×` }));

export function SpeedTool() {
  const job = useMediaJob();
  const [factor, setFactor] = useState(2);
  const outputName = `${baseName(job.file?.name ?? "clip")}-${String(factor).replace(".", "_")}x.mp4`;
  const newLength = job.meta && job.meta.duration > 0 ? job.meta.duration / factor : 0;

  const run = () => {
    if (!job.file || factor === 1) return;
    job.runMulti(
      outputName,
      [job.file],
      ({ names, infos }) => buildSpeedArgs({ input: names[0], output: outputName, factor, hasAudio: infos[0].hasAudio }),
      { probe: true },
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
          hint="MP4, MOV, WebM, MKV, or AVI. Slow motion or fast forward."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · Speed" hint={`${factor}×${newLength > 0 ? ` · ${formatDuration(newLength)} long` : ""}`} />
            <Chips label="Speed presets" value={factor} options={PRESETS} onChange={setFactor} disabled={job.phase === "working"} />
            <RangeField label="Custom speed" value={factor} min={MIN_SPEED} max={MAX_SPEED} step={0.05} display={`${factor}×`} onChange={setFactor} disabled={job.phase === "working"} />
            <p className="settings-note">
              Below 1× is slow motion, above 1× is fast forward. The sound is sped up or slowed down with the picture, and its pitch is kept
              natural.
            </p>
            <RunButton
              working={job.phase === "working"}
              idleLabel={factor < 1 ? "Slow the video down" : "Speed the video up"}
              workingLabel="Changing speed…"
              disabled={factor === 1}
              onClick={run}
            />
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · {factor}× speed</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a video and a speed. Cutmoor re-times the picture and the sound together on your device." />
    </div>
  );
}
