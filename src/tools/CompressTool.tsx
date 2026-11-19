import { useEffect, useState } from "react";
import { FileDrop } from "../components/FileDrop";
import { JobPanel } from "../components/JobPanel";
import { CustomSizeChip } from "../components/NumberFields";
import { useMediaJob, type CustomJobContext, type CustomJobOutput, type MediaJob } from "../hooks/useMediaJob";
import { buildCompressArgs } from "../lib/compress";
import { chooseCompressEngine, NO_AUDIO_ROUTE_MESSAGE, type CompressRoute } from "../lib/compress-engine";
import {
  bestQualityKbps,
  capKbps,
  FFMPEG_LIMITS,
  nativeLimits,
  outputSize,
  planCompression,
  planSizeChoices,
  recommendResolution,
  videoKbpsForTarget,
  type CompressResolution,
} from "../lib/compress-options";
import { onFFmpegProgress, runFFmpeg } from "../lib/ffmpeg";
import { baseName, formatBytes, targetVideoKbps } from "../lib/format";
import type { VideoMeta } from "../lib/media";
import { parseNumberInput } from "../lib/number-input";
import { inspectVideo, type VideoInspection } from "../lib/video-inspect";

const MIN_CUSTOM_MB = 1;
const MB = 1024 * 1024;
const LONG_JOB_SECONDS = 30 * 60;
const LARGE_FILE_BYTES = 1024 * MB;
/** After this much progress, restarting on the slower engine would throw away too much work without asking. */
const FALLBACK_BEFORE_PROGRESS = 0.05;

/** The choices for one video. It is remounted for each file, so nothing chosen for the last video carries over. */
function CompressSettings({
  job,
  file,
  meta,
  inspection,
  route,
}: {
  job: MediaJob;
  file: File;
  meta: VideoMeta;
  inspection: VideoInspection | null;
  route: Exclude<CompressRoute, { engine: "blocked" }>;
}) {
  const native = route.engine === "native";
  const duration = meta.duration || inspection?.durationSeconds || 0;
  const width = inspection?.width || meta.width;
  const height = inspection?.height || meta.height;
  const source = { sizeBytes: file.size, durationSeconds: duration, width, height };
  const copiesSound = native && route.audio === "copy";
  const baseLimits = native ? nativeLimits(duration) : FFMPEG_LIMITS;
  // Copied sound keeps its own size, so the picture's share of a target is worked out from that.
  const limits = copiesSound && inspection?.audioKbps ? { ...baseLimits, audioKbps: Math.max(32, Math.ceil(inspection.audioKbps)) } : baseLimits;
  const { choices, defaultPercent } = planSizeChoices(source, limits);
  const basePlan = planCompression(source, limits);
  const encodable = inspection?.encodableHeights ?? [];
  const plan = native ? { ...basePlan, resolutions: basePlan.resolutions.filter((value) => encodable.includes(Number(value))) } : basePlan;
  const canKeepOriginal = !native || encodable.includes(height);

  const [percent, setPercent] = useState(defaultPercent ?? 0);
  const [custom, setCustom] = useState("");

  const customMb = parseNumberInput(custom, MIN_CUSTOM_MB);
  const customInvalid = custom !== "" && customMb === null;
  const chosen = choices.find((choice) => choice.percent === percent);
  const target = customMb ?? chosen?.targetMb ?? 0;
  // With no size to aim for (length unknown, or already near its smallest), Cutmoor simply makes the best version it can.
  const mode = duration > 0 && target > 0 ? "size" : "quality";
  const estimatedKbps =
    mode === "size" ? (native ? videoKbpsForTarget(target, duration, limits) : targetVideoKbps(target, duration)) : 0;
  const suggested = recommendResolution(estimatedKbps, width, height, plan);
  const resolution: CompressResolution = suggested === "original" && !canKeepOriginal ? (plan.resolutions[0] ?? "original") : suggested;
  const output = `${baseName(file.name)}-compressed.mp4`;

  const ffmpegArgs = (input: string) =>
    buildCompressArgs({ input, output, mode, targetMb: target, durationSeconds: duration, resolution });

  const compressInBrowser = async (context: CustomJobContext, audio: "native" | "copy" | "ffmpeg" | "none"): Promise<CustomJobOutput> => {
    const size = outputSize(resolution, width, height);
    const videoKbps = mode === "size" ? capKbps(estimatedKbps, size.width, size.height) : bestQualityKbps(size.width, size.height, source, limits.audioKbps);
    const audioKbps = audio === "none" ? 0 : limits.audioKbps;
    let progress = 0;
    try {
      context.setStatus("Getting ready…");
      const { compressNative } = await import("../lib/native-compress");
      const result = await compressNative({
        file,
        videoKbps,
        audioKbps: limits.audioKbps,
        height: resolution === "original" ? null : Number(resolution),
        audio,
        audioChannels: inspection?.audioChannels ?? 2,
        durationSeconds: duration,
        expectedBytes: ((videoKbps + audioKbps) * 1000 * duration) / 8,
        signal: context.signal,
        onProgress: (value) => {
          progress = value;
          context.setProgress(value);
        },
        onStatus: context.setStatus,
        onOutputBytes: context.setOutputBytes,
        onLog: context.log,
      });
      const notes: string[] = [];
      if (audio === "none" && inspection?.hasAudio) notes.push("This video was made without sound, as you chose.");
      if (result.blob.size >= file.size) notes.push("The result is not smaller than the original, so keep whichever you prefer.");
      else if (mode === "size" && result.blob.size > target * MB * 1.1) notes.push(`The result is above the ${formatBytes(target * MB)} target.`);
      return { blob: result.blob, release: result.release, note: notes.join(" ") || undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (context.signal.aborted || message === NO_AUDIO_ROUTE_MESSAGE) throw error;
      if (progress >= FALLBACK_BEFORE_PROGRESS || inspection?.videoCodec === "av1") throw error;
      context.log(`Browser encoder could not start (${message}). Using the slower engine.`);
      context.setStatus("Using the slower engine…");
      context.setProgress(0);
      const stopProgress = onFFmpegProgress(context.setProgress);
      try {
        return { blob: await runFFmpeg({ file, outputName: output, args: ffmpegArgs }), note: "This browser's video encoder could not start, so the slower engine was used." };
      } finally {
        stopProgress();
      }
    }
  };

  const run = (audio = route.engine === "native" ? route.audio : "none") => {
    if (native) void job.runCustom(output, (context) => compressInBrowser(context, audio));
    else void job.run(output, ffmpegArgs);
  };

  const longJob = duration >= LONG_JOB_SECONDS || file.size >= LARGE_FILE_BYTES;
  const resolutionText = resolution === "original" ? "the original resolution" : `${resolution}p`;

  return (
    <div className="settings-card">
      <div className="settings-head">
        <span className="mono-label">How much smaller?</span>
        <span className="settings-hint">Quality is automatic</span>
      </div>
      <div className="chips" role="group" aria-label="How much smaller">
        {choices.map((choice) => (
          <button
            key={choice.percent}
            type="button"
            className={custom === "" && percent === choice.percent ? "chip active" : "chip"}
            aria-pressed={custom === "" && percent === choice.percent}
            onClick={() => {
              setPercent(choice.percent);
              setCustom("");
            }}
          >
            {choice.percent}% smaller
          </button>
        ))}
        <CustomSizeChip value={custom} unit="MB" label="Exact size in megabytes" onChange={setCustom} />
      </div>

      {customInvalid ? (
        <p className="settings-note">Enter a size of at least {MIN_CUSTOM_MB} MB.</p>
      ) : mode === "size" ? (
        <p className="settings-note">
          About <strong>{formatBytes(target * MB)}</strong>. Cutmoor will use {resolutionText} and the best quality that fits.
          {customMb !== null && target < plan.smallestMb && ` This video needs about ${plan.smallestMb} MB, so the result will be larger than your size.`}
          {customMb !== null && target * MB >= file.size && ` That is not smaller than the original (${formatBytes(file.size)}), so the file may not shrink.`}
        </p>
      ) : (
        <p className="settings-note">
          Cutmoor will make the best version it can. {duration > 0 ? "This video is already close to its smallest useful size" : "This browser could not read the video's length"}, so the
          result may not be much smaller.
        </p>
      )}

      {longJob && (
        <p className="settings-note">
          This is a long job. Keep this tab open, the screen on and your device charging.
          {!native && " This browser will use the slower engine, so it may take many hours or run out of memory."}
        </p>
      )}

      <button className="button button-primary button-block button-lg" type="button" onClick={() => run()} disabled={job.phase === "working" || customInvalid}>
        {job.phase === "working" ? "Compressing…" : "Compress video"}
      </button>
      {job.phase === "error" && job.error === NO_AUDIO_ROUTE_MESSAGE && (
        <button className="button button-ghost button-block" type="button" onClick={() => run("none")}>
          Continue without sound
        </button>
      )}
      <p className="settings-footnote">Output: MP4 (H.264 + AAC) · from {formatBytes(file.size)}</p>
    </div>
  );
}

export function CompressTool() {
  const job = useMediaJob();
  const { file, meta } = job;
  const [inspected, setInspected] = useState<{ file: File; video: VideoInspection | null } | null>(null);

  useEffect(() => {
    if (!file) return;
    let current = true;
    void inspectVideo(file).then((video) => {
      if (current) setInspected({ file, video });
    });
    return () => {
      current = false;
    };
  }, [file]);

  const ready = inspected?.file === file;
  const route = ready ? chooseCompressEngine(inspected.video) : null;

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={file}
          meta={meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="video/*,.mkv"
          hint="MP4, MOV, WebM, MKV, or AVI. Your file stays on this device."
          disabled={job.phase === "working"}
        />

        {file &&
          (!meta || !route ? (
            // Holds about the height of the options, so the page barely moves when they arrive.
            <div className="settings-card" style={{ minHeight: 280 }}>
              <p className="settings-note" role="status">
                Checking which options work for this video…
              </p>
            </div>
          ) : route.engine === "blocked" ? (
            <div className="settings-card">
              <p className="settings-note" role="alert">
                <strong>{route.reason}</strong> Nothing was changed.
              </p>
            </div>
          ) : (
            <CompressSettings key={`${file.name}-${file.size}-${file.lastModified}`} job={job} file={file} meta={meta} inspection={inspected?.video ?? null} route={route} />
          ))}
      </section>

      <JobPanel
        job={job}
        idleHint="Choose a video. Cutmoor checks it on your device, then shows how much smaller it can get."
      />
    </div>
  );
}
