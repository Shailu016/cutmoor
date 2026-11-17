import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName } from "../../lib/format";
import { buildGifToMp4Args } from "../../lib/video-edit-args";

export function GifToMp4Tool() {
  const job = useMediaJob();
  const outputName = `${baseName(job.file?.name ?? "animation")}.mp4`;

  const run = () => {
    if (!job.file) return;
    job.run(outputName, (input) => buildGifToMp4Args({ input, output: outputName }));
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/gif,.gif"
          kind="image"
          hint="A .gif file. The animation is turned into a small MP4."
          disabled={job.phase === "working"}
        />

        {job.file && (
          <div className="settings-card">
            <SettingsHead label="01 · What happens" />
            <p className="settings-note">
              The GIF becomes an <strong>H.264 MP4</strong>: the same animation, usually <strong>5 to 20 times smaller</strong>, and accepted by
              Instagram, TikTok, WhatsApp, and every video player. An odd pixel size is rounded to an even one, because MP4 needs that.
            </p>
            <p className="settings-note">GIFs have no sound, so the MP4 is silent. It plays once unless the site loops it for you.</p>
            <RunButton working={job.phase === "working"} idleLabel="Convert to MP4" workingLabel="Converting…" onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264 · no audio · made on your device</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a GIF. Cutmoor turns it into a small MP4 on your device." />
    </div>
  );
}
