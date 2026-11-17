import { useState } from "react";
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { Chips, FieldError, RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName } from "../../lib/format";
import { buildRotateArgs, type Rotation } from "../../lib/video-edit-args";

const ROTATIONS: { value: Rotation; label: string }[] = [
  { value: 0, label: "No turn" },
  { value: 90, label: "90° right" },
  { value: 180, label: "180°" },
  { value: 270, label: "90° left" },
];

export function RotateVideoTool() {
  const job = useMediaJob();
  const [rotate, setRotate] = useState<Rotation>(90);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const changes = rotate !== 0 || flipH || flipV;
  const outputName = `${baseName(job.file?.name ?? "clip")}-rotated.mp4`;
  const sideways = rotate === 90 || rotate === 270;
  const result = job.meta && job.meta.width > 0 ? (sideways ? `${job.meta.height}×${job.meta.width}` : `${job.meta.width}×${job.meta.height}`) : null;

  const run = () => {
    if (!job.file || !changes) return;
    job.run(outputName, (input) => buildRotateArgs({ input, output: outputName, rotate, flipH, flipV }));
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
          hint="MP4, MOV, WebM, MKV, or AVI. Fix a sideways phone video or mirror a clip."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · Turn" hint={result ? `Result ${result}` : undefined} />
            <Chips label="Rotation" value={rotate} options={ROTATIONS} onChange={setRotate} disabled={job.phase === "working"} />
            <SettingsHead label="02 · Mirror" />
            <div className="chips" role="group" aria-label="Mirror">
              <button type="button" className={flipH ? "chip active" : "chip"} aria-pressed={flipH} onClick={() => setFlipH(!flipH)}>
                <FlipHorizontal2 size={15} /> Left to right
              </button>
              <button type="button" className={flipV ? "chip active" : "chip"} aria-pressed={flipV} onClick={() => setFlipV(!flipV)}>
                <FlipVertical2 size={15} /> Top to bottom
              </button>
            </div>
            <p className="settings-note">
              The turn is applied first, then the mirror. Text in the video will read backwards after a mirror; that is what a mirror does.
            </p>
            {!changes && <FieldError>Pick a turn or a mirror first.</FieldError>}
            <RunButton
              working={job.phase === "working"}
              idleLabel={rotate === 270 ? "Rotate left" : "Rotate video"}
              workingLabel="Rotating…"
              disabled={!changes}
              onClick={run}
            />
            <p className="settings-footnote">
              {rotate === 270 ? <RotateCcw size={12} /> : <RotateCw size={12} />} Output: MP4 · H.264 + AAC · the sound is kept
            </p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a video, pick a turn or a mirror, and Cutmoor re-encodes it on your device." />
    </div>
  );
}
