import { useEffect, useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { MultiFileList, moveItem, type ListedFile } from "../../components/MultiFileList";
import { Chips, FieldError, RunButton, Segmented, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { formatDuration } from "../../lib/format";
import { loadImage, renderImage } from "../../lib/image";
import { buildSlideshowArgs, slideshowLength } from "../../lib/video-edit-args";

const MAX_PICTURES = 30;
const SIZES = {
  "1080p": { width: 1920, height: 1080, label: "1080p wide" },
  "720p": { width: 1280, height: 720, label: "720p wide" },
  vertical: { width: 1080, height: 1920, label: "Vertical 9:16" },
  square: { width: 1080, height: 1080, label: "Square" },
} as const;
type SizeKey = keyof typeof SIZES;

const isPicture = (file: File) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name);

export function SlideshowTool() {
  const job = useMediaJob();
  const [items, setItems] = useState<ListedFile[]>([]);
  const [seconds, setSeconds] = useState(3);
  const [fade, setFade] = useState(0.5);
  const [size, setSize] = useState<SizeKey>("1080p");
  const [fit, setFit] = useState<"pad" | "crop">("pad");
  const [music, setMusic] = useState<File | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const working = job.phase === "working" || preparing;

  const first = items[0]?.file ?? null;
  const { selectFile, clear } = job;
  useEffect(() => {
    if (first) void selectFile(first);
    else clear();
  }, [first, selectFile, clear]);

  const add = (files: File[]) => {
    const pictures = files.filter(isPicture);
    setNote(pictures.length < files.length ? "Some files were skipped because they are not pictures." : null);
    const room = Math.max(0, MAX_PICTURES - items.length);
    if (pictures.length > room) setNote(`A slideshow takes up to ${MAX_PICTURES} pictures, so the rest were left out.`);
    setItems((current) => [...current, ...pictures.slice(0, room).map((file) => ({ file }))]);
  };

  const length = slideshowLength({ count: items.length, seconds, fade: Math.min(fade, seconds / 2) });

  const run = async () => {
    if (items.length === 0) return;
    setFailure(null);
    setPreparing(true);
    try {
      const frames: File[] = [];
      const { width, height } = SIZES[size];
      for (let index = 0; index < items.length; index += 1) {
        const loaded = await loadImage(items[index].file);
        try {
          const blob = await renderImage(loaded, { width, height, fit, format: "jpeg", quality: 0.92, background: "#000000" });
          frames.push(new File([blob], `frame${index}.jpg`, { type: "image/jpeg" }));
        } finally {
          loaded.release();
        }
      }
      setPreparing(false);
      const inputs = music ? [...frames, music] : frames;
      await job.runMulti(
        "slideshow.mp4",
        inputs,
        ({ names, infos }) => {
          if (music && !infos[frames.length]?.hasAudio) throw new Error("The music file has no audio in it. Choose an MP3, WAV, M4A, or a video that has sound.");
          return buildSlideshowArgs({
            frames: names.slice(0, frames.length),
            output: "slideshow.mp4",
            seconds,
            fade: Math.min(fade, seconds / 2),
            fps: 30,
            audio: music ? names[frames.length] : null,
          });
        },
        { probe: Boolean(music) },
      );
    } catch (cause) {
      setPreparing(false);
      setFailure(cause instanceof Error ? cause.message : "A picture could not be read.");
    }
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        {items.length === 0 ? (
          <FileDrop
            file={null}
            kind="image"
            onFile={(file) => add([file])}
            onFiles={add}
            onClear={() => undefined}
            accept="image/*,.heic,.heif"
            hint={`Choose your pictures (up to ${MAX_PICTURES}): JPG, PNG, WebP, HEIC. You can put them in order next.`}
          />
        ) : (
          <MultiFileList
            items={items}
            accept="image/*,.heic,.heif"
            max={MAX_PICTURES}
            disabled={working}
            addLabel="Add more pictures"
            onAdd={add}
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
            <SettingsHead label="01 · Time per picture" hint={`${formatDuration(length)} video`} />
            <Chips label="Seconds per picture" value={seconds} options={[1, 2, 3, 5, 8].map((value) => ({ value, label: `${value} s` }))} onChange={setSeconds} disabled={working} />
            <SettingsHead label="02 · Change between pictures" />
            <Chips
              label="Transition"
              value={fade}
              options={[
                { value: 0, label: "Cut" },
                { value: 0.5, label: "Fade 0.5 s" },
                { value: 1, label: "Fade 1 s" },
              ]}
              onChange={setFade}
              disabled={working}
            />
            <SettingsHead label="03 · Video shape" />
            <Segmented
              label="Video size"
              value={size}
              wrap
              disabled={working}
              onChange={setSize}
              options={(Object.keys(SIZES) as SizeKey[]).map((key) => ({ value: key, label: SIZES[key].label }))}
            />
            <Segmented
              label="How a picture fills the frame"
              value={fit}
              disabled={working}
              onChange={setFit}
              options={[
                { value: "pad", label: "Show it all (black bars)" },
                { value: "crop", label: "Fill the frame (crop)" },
              ]}
            />
            <SettingsHead label="04 · Music (optional)" />
            <div className="field-row">
              <label htmlFor="slideshow-music">Audio file</label>
              <input
                id="slideshow-music"
                type="file"
                accept="audio/*,video/*"
                disabled={working}
                onChange={(event) => {
                  setMusic(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              {music && <small className="settings-hint">{music.name}</small>}
            </div>
            {failure && <FieldError>{failure}</FieldError>}
            <RunButton working={working} idleLabel={`Make a ${items.length}-picture video`} workingLabel={preparing ? "Preparing pictures…" : "Making the video…"} onClick={() => void run()} />
            <p className="settings-footnote">Output: MP4 · H.264 · 30 fps · made on your device</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint="Choose your pictures, put them in order, and Cutmoor turns them into a video on your device." />
    </div>
  );
}
