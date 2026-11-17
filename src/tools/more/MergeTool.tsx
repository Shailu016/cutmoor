import { useEffect, useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { MultiFileList, moveItem, type ListedFile } from "../../components/MultiFileList";
import { Segmented, FieldError, RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { formatDuration } from "../../lib/format";
import { isVideoFile, readVideoMeta } from "../../lib/media";
import { buildMergeArgs } from "../../lib/video-edit-args";

const MAX_CLIPS = 10;

type SizeChoice = "first" | "1080p" | "720p" | "vertical" | "square";

const SIZES: Record<Exclude<SizeChoice, "first">, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export function MergeTool() {
  const job = useMediaJob();
  const [items, setItems] = useState<ListedFile[]>([]);
  const [size, setSize] = useState<SizeChoice>("first");
  const [note, setNote] = useState<string | null>(null);
  const working = job.phase === "working";

  // The page previews the first clip; the first clip changes when the order does.
  const first = items[0]?.file ?? null;
  const { selectFile, clear } = job;
  useEffect(() => {
    if (first) void selectFile(first);
    else clear();
  }, [first, selectFile, clear]);

  const add = async (files: File[]) => {
    const videos = files.filter(isVideoFile);
    setNote(videos.length < files.length ? "Some files were skipped because they are not videos." : null);
    const room = Math.max(0, MAX_CLIPS - items.length);
    const accepted = videos.slice(0, room);
    if (videos.length > room) setNote(`Only ${MAX_CLIPS} clips fit in one merge, so the rest were left out.`);
    const added: ListedFile[] = await Promise.all(
      accepted.map(async (file) => {
        const meta = await readVideoMeta(file);
        const detail = [meta.width > 0 ? `${meta.width}×${meta.height}` : null, meta.duration > 0 ? formatDuration(meta.duration) : null].filter(Boolean).join(" · ");
        return { file, detail };
      }),
    );
    setItems((current) => [...current, ...added].slice(0, MAX_CLIPS));
  };

  const firstMeta = job.meta;
  const target =
    size === "first"
      ? { width: firstMeta?.width || 1280, height: firstMeta?.height || 720 }
      : SIZES[size];

  const run = () => {
    if (items.length < 2) return;
    job.runMulti(
      "merged.mp4",
      items.map((item) => item.file),
      ({ names, infos }) =>
        buildMergeArgs({
          output: "merged.mp4",
          // "Match first clip" takes the size the encoder found in that clip, which is known even before the page has read it.
          width: size === "first" ? infos[0].width || target.width : target.width,
          height: size === "first" ? infos[0].height || target.height : target.height,
          fps: 30,
          clips: names.map((name, index) => ({ name, hasAudio: infos[index].hasAudio, duration: infos[index].duration })),
        }),
      { probe: true },
    );
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        {items.length === 0 ? (
          <FileDrop
            file={null}
            onFile={(file) => void add([file])}
            onFiles={(files) => void add(files)}
            onClear={() => undefined}
            accept="video/*"
            hint={`Choose two or more videos (up to ${MAX_CLIPS}). You can put them in order next.`}
          />
        ) : (
          <MultiFileList
            items={items}
            accept="video/*"
            max={MAX_CLIPS}
            disabled={working}
            addLabel="Add more videos"
            onAdd={(files) => void add(files)}
            onRemove={(index) => setItems((current) => current.filter((_, i) => i !== index))}
            onMove={(index, direction) => setItems((current) => moveItem(current, index, direction))}
          />
        )}
        {note && (
          <p className="settings-note" role="status">
            {note}
          </p>
        )}

        {items.length > 0 && (
          <div className="settings-card">
            <SettingsHead label="01 · Picture size" />
            <Segmented
              label="Output picture size"
              value={size}
              wrap
              disabled={working}
              onChange={setSize}
              options={[
                { value: "first", label: "Match first clip" },
                { value: "1080p", label: "1080p wide" },
                { value: "720p", label: "720p wide" },
                { value: "vertical", label: "Vertical 9:16" },
                { value: "square", label: "Square" },
              ]}
            />
            <p className="settings-note">
              Clips of a different shape are fitted inside the frame with black bars, never stretched. Output is {target.width}×{target.height} at
              30 frames a second. A clip with no sound gets silence, so the sound stays in step with the picture.
            </p>
            {items.length < 2 && <FieldError>Add at least one more video to merge.</FieldError>}
            <RunButton working={working} idleLabel={`Merge ${items.length} videos`} workingLabel="Merging…" disabled={items.length < 2} onClick={run} />
            <p className="settings-footnote">Output: MP4 · H.264 + AAC · joined in the order shown</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose two or more videos, put them in order, and Cutmoor joins them into one MP4 on your device." />
    </div>
  );
}
