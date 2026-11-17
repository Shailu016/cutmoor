import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { DEFAULT_MARK, MARK_MARGIN_PERCENT, MarkPreview, MarkSettings, useMarkImage, type MarkState } from "../../components/MarkSettings";
import { RunButton } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName } from "../../lib/format";
import { markWidthFor } from "../../lib/watermark";
import { buildWatermarkArgs } from "../../lib/video-edit-args";

export function WatermarkVideoTool() {
  const job = useMediaJob();
  const [mark, setMark] = useState<MarkState>(DEFAULT_MARK);
  const image = useMarkImage(mark);
  const working = job.phase === "working";
  const outputName = `${baseName(job.file?.name ?? "clip")}-watermarked.mp4`;
  const ready = Boolean(image.blob) && !image.error;

  const run = () => {
    if (!job.file || !image.blob) return;
    const pictureWidth = job.meta?.width || 1280;
    job.runMulti(
      outputName,
      [job.file, new File([image.blob], "mark.png", { type: "image/png" })],
      ({ names, infos }) => {
        const width = infos[0].width || pictureWidth;
        return buildWatermarkArgs({
          input: names[0],
          mark: names[1],
          output: outputName,
          position: mark.position,
          markWidth: markWidthFor(width, mark.size),
          opacity: mark.opacity / 100,
          margin: Math.round((width * MARK_MARGIN_PERCENT) / 100),
          hasAudio: infos[0].hasAudio,
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
          hint="MP4, MOV, WebM, MKV, or AVI. Add your name or logo to every frame."
          disabled={working}
        />

        {job.file && (
          <div className="settings-card">
            {job.previewUrl && <MarkPreview base={job.previewUrl} kind="video" markUrl={image.url} state={mark} />}
            <MarkSettings state={mark} onChange={setMark} disabled={working} error={image.error} />
            <RunButton working={working} idleLabel="Add watermark" workingLabel="Adding watermark…" disabled={!ready} onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · the mark is burned in for good</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose a video, then type your text or pick a logo. The mark is added on your device." />
    </div>
  );
}
