import { useState } from "react";
import { Music } from "lucide-react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { RangeField, RunButton, Segmented, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName, formatBytes } from "../../lib/format";
import { buildAddAudioArgs } from "../../lib/video-edit-args";

export function AddAudioTool() {
  const job = useMediaJob();
  const [audio, setAudio] = useState<File | null>(null);
  const [mode, setMode] = useState<"replace" | "mix">("replace");
  const [volume, setVolume] = useState(100);
  const [loop, setLoop] = useState(true);
  const working = job.phase === "working";
  const outputName = `${baseName(job.file?.name ?? "clip")}-with-sound.mp4`;

  const run = () => {
    if (!job.file || !audio) return;
    job.runMulti(
      outputName,
      [job.file, audio],
      ({ names, infos }) => {
        if (!infos[1].hasAudio) throw new Error("The sound file has no audio in it. Choose an MP3, WAV, M4A, or a video that has sound.");
        return buildAddAudioArgs({
          video: names[0],
          audio: names[1],
          output: outputName,
          mode,
          volume: volume / 100,
          loop,
          videoHasAudio: infos[0].hasAudio,
          duration: infos[0].duration || job.meta?.duration || 0,
        });
      },
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
          hint="MP4, MOV, WebM, MKV, or AVI. Add music or a voice-over."
          disabled={working}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · Sound to add" />
            <div className="field-row">
              <label htmlFor="add-audio-file">Audio file (MP3, WAV, M4A, or a video with sound)</label>
              <input
                id="add-audio-file"
                type="file"
                accept="audio/*,video/*"
                disabled={working}
                onChange={(event) => {
                  setAudio(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              {audio && (
                <small className="settings-hint">
                  <Music size={12} /> {audio.name} · {formatBytes(audio.size)}
                </small>
              )}
            </div>
            <SettingsHead label="02 · What happens to the original sound" />
            <Segmented
              label="Original sound"
              value={mode}
              disabled={working}
              onChange={setMode}
              options={[
                { value: "replace", label: "Replace it" },
                { value: "mix", label: "Mix both" },
              ]}
            />
            <SettingsHead label="03 · Volume of the new sound" hint={`${volume}%`} />
            <RangeField label="New sound volume" value={volume} min={0} max={200} step={5} display={`${volume}%`} onChange={setVolume} disabled={working} />
            <label className="check-row">
              <input type="checkbox" checked={loop} disabled={working} onChange={(event) => setLoop(event.target.checked)} /> Repeat the sound if it is shorter than the video
            </label>
            <p className="settings-note">
              The video keeps its length. A longer sound is cut at the end of the video. With Mix both, a video that has no sound of its own simply
              gets the new sound.
            </p>
            <RunButton working={working} idleLabel="Add the sound" workingLabel="Adding sound…" disabled={!audio} onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · made on your device</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a video, then the music or voice-over to put on it. Both stay on your device." />
    </div>
  );
}
