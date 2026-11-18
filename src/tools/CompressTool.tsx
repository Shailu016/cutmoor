import { useEffect, useState } from "react";
import { Gauge, Sparkles } from "lucide-react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { CustomSizeChip } from "../components/NumberFields";
import { useMediaJob, type MediaJob } from "../hooks/useMediaJob";
import { buildCompressArgs } from "../lib/compress";
import { planCompression, recommendResolution, type CompressResolution } from "../lib/compress-options";
import { baseName, formatBytes, targetVideoKbps } from "../lib/format";
import type { VideoMeta } from "../lib/media";
import { parseNumberInput } from "../lib/number-input";
import { readVideoCodec } from "../lib/video-codec";

const MIN_CUSTOM_MB = 1;

const resolutionLabel = (value: CompressResolution) => (value === "original" ? "Original" : `${value}p`);

/** The choices for one video. It is remounted for each file, so nothing chosen for the last video carries over. */
function CompressSettings({ job, file, meta }: { job: MediaJob; file: File; meta: VideoMeta }) {
  const { duration, width, height } = meta;
  const plan = planCompression({ sizeBytes: file.size, durationSeconds: duration, width, height });
  const canTarget = plan.defaultSize !== null;
  const [chosenMode, setMode] = useState<"size" | "quality">("size");
  const [preset, setPreset] = useState(plan.defaultSize ?? 0);
  const [custom, setCustom] = useState("");
  const [chosenResolution, setResolution] = useState<CompressResolution | null>(null);

  const mode = canTarget ? chosenMode : "quality";
  const customMb = parseNumberInput(custom, MIN_CUSTOM_MB);
  const customInvalid = mode === "size" && custom !== "" && customMb === null;
  const target = customMb ?? preset;
  const estimatedKbps = mode === "size" && duration > 0 ? targetVideoKbps(target, duration) : 0;
  const recommended = recommendResolution(estimatedKbps, width, height, plan);
  const resolution = chosenResolution ?? recommended;

  const run = () => {
    const output = `${baseName(file.name)}-compressed.mp4`;
    job.run(output, (input) =>
      buildCompressArgs({ input, output, mode, targetMb: target, durationSeconds: duration, resolution }),
    );
  };

  return (
    <div className="settings-card">
      <div className="settings-head">
        <span className="mono-label">01 · Method</span>
      </div>
      {canTarget ? (
        <div className="segmented" role="group" aria-label="Compression method">
          <button
            type="button"
            className={mode === "size" ? "segment active" : "segment"}
            aria-pressed={mode === "size"}
            onClick={() => setMode("size")}
          >
            <Gauge size={16} /> Target size
          </button>
          <button
            type="button"
            className={mode === "quality" ? "segment active" : "segment"}
            aria-pressed={mode === "quality"}
            onClick={() => setMode("quality")}
          >
            <Sparkles size={16} /> Best quality
          </button>
        </div>
      ) : (
        <p className="settings-note">
          <strong>Best quality</strong> is the option for this video.{" "}
          {duration > 0
            ? `A target size cannot help, because this video needs about ${plan.smallestMb} MB at the lowest bitrate and the original is ${formatBytes(file.size)}.`
            : "A target size needs the video's length, and this browser could not read it."}
        </p>
      )}

      {mode === "size" ? (
        <>
          <div className="settings-head">
            <span className="mono-label">02 · Target file size</span>
            <span className="settings-hint">Possible for this video</span>
          </div>
          <div className="chips" role="group" aria-label="Target file size">
            {plan.sizes.map((size) => (
              <button
                key={size}
                type="button"
                className={custom === "" && preset === size ? "chip active" : "chip"}
                aria-pressed={custom === "" && preset === size}
                onClick={() => {
                  setPreset(size);
                  setCustom("");
                }}
              >
                {size} MB
              </button>
            ))}
            <CustomSizeChip value={custom} unit="MB" label="Custom target size in megabytes" onChange={setCustom} />
          </div>
          {customInvalid ? (
            <p className="settings-note">Enter a size of at least {MIN_CUSTOM_MB} MB.</p>
          ) : (
            <p className="settings-note">
              About <strong>{estimatedKbps} kbps</strong> for video and 128 kbps for audio.
              {target < plan.smallestMb &&
                ` This video needs about ${plan.smallestMb} MB at the lowest bitrate, so the result will be larger than your target.`}
              {target * 1024 * 1024 >= file.size &&
                ` Your target is not smaller than the original (${formatBytes(file.size)}), so the file may not shrink.`}
            </p>
          )}
        </>
      ) : (
        <p className="settings-note">
          A quality-first H.264 encode (CRF 28). The file size is whatever the picture needs, so the result may not be
          smaller than the original.
        </p>
      )}

      <div className="settings-head">
        <span className="mono-label">03 · Resolution</span>
      </div>
      <div className="chips" role="group" aria-label="Output resolution">
        {(["original", ...plan.resolutions] as CompressResolution[]).map((value) => (
          <button
            key={value}
            type="button"
            className={resolution === value ? "chip active" : "chip"}
            aria-pressed={resolution === value}
            onClick={() => setResolution(value)}
          >
            {resolutionLabel(value)}
          </button>
        ))}
      </div>
      {recommended !== "original" && !customInvalid && (
        <p className="settings-note">
          {resolution === recommended
            ? `${resolutionLabel(recommended)} suits this size best. A higher resolution would look blocky at ${estimatedKbps} kbps.`
            : `${resolutionLabel(recommended)} will look cleaner at this size.`}
        </p>
      )}

      <button
        className="button button-primary button-block button-lg"
        type="button"
        onClick={run}
        disabled={job.phase === "working" || customInvalid}
      >
        {job.phase === "working" ? "Compressing…" : "Compress video"}
      </button>
      <p className="settings-footnote">
        Output: MP4 (H.264 + AAC) · {mode === "size" ? `target ${target} MB` : "quality-first"} ·{" "}
        {resolution === "original" ? "original resolution" : `${resolution}p`} · from {formatBytes(file.size)}
      </p>
    </div>
  );
}

export function CompressTool() {
  const job = useMediaJob();
  const { file, meta } = job;
  const [inspected, setInspected] = useState<{ file: File; codec: string | null } | null>(null);

  useEffect(() => {
    if (!file) return;
    let current = true;
    void readVideoCodec(file).then((codec) => {
      if (current) setInspected({ file, codec });
    });
    return () => {
      current = false;
    };
  }, [file]);

  const codec = inspected?.file === file ? inspected?.codec : undefined;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={file}
          meta={meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="video/*"
          hint="MP4, MOV, WebM, MKV, or AVI. Tested up to 104 MB; larger files depend on your device's memory."
          disabled={job.phase === "working"}
        />

        {file &&
          (!meta || codec === undefined ? (
            // Holds about the height of the options, so the page barely moves when they arrive.
            <div className="settings-card" style={{ minHeight: 460 }}>
              <p className="settings-note" role="status">
                Checking which options work for this video…
              </p>
            </div>
          ) : codec === "av1" ? (
            <div className="settings-card">
              <p className="settings-note" role="alert">
                <strong>This video is in AV1 format, which Cutmoor cannot compress yet.</strong> Nothing was changed. Try
                a copy of the video in H.264 MP4.
              </p>
            </div>
          ) : (
            <CompressSettings key={`${file.name}-${file.size}-${file.lastModified}`} job={job} file={file} meta={meta} />
          ))}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video. Cutmoor checks it on your device, then shows the sizes and resolutions that can work."
      />
    </div>
  );
}
