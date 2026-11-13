import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Film, Loader2, Play, RotateCcw } from "lucide-react";
import { JobPanel } from "./JobPanel";
import { useMediaJob } from "../hooks/useMediaJob";
import { buildCompressArgs } from "../lib/compress";
import { baseName, formatBytes, formatDuration } from "../lib/format";
import { SAMPLE_CLIP, SAMPLE_TARGETS_MB, sampleClipUrl } from "../lib/samples";

/**
 * A live demo on the homepage. It loads a real sample video and runs it
 * through the same encoder and the same compress settings as the Compress
 * video tool. Nothing here is prerecorded or simulated: the sizes, the
 * progress and the timing all come from the actual job.
 */
export function SampleDemo() {
  const job = useMediaJob();
  const [targetMb, setTargetMb] = useState<(typeof SAMPLE_TARGETS_MB)[number]>(2);
  const [loadingSample, setLoadingSample] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSample = async () => {
    setLoadingSample(true);
    setLoadError(null);
    try {
      const response = await fetch(sampleClipUrl(import.meta.env.BASE_URL));
      if (!response.ok) throw new Error(`The sample clip could not be loaded (${response.status}).`);
      const blob = await response.blob();
      await job.selectFile(new File([blob], SAMPLE_CLIP.fileName, { type: "video/mp4" }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The sample clip could not be loaded.");
    } finally {
      setLoadingSample(false);
    }
  };

  const compress = () => {
    if (!job.file || !job.meta) return;
    const output = `${baseName(job.file.name)}-compressed.mp4`;
    job.run(output, (input) =>
      buildCompressArgs({
        input,
        output,
        mode: "size",
        targetMb,
        durationSeconds: job.meta?.duration ?? SAMPLE_CLIP.durationSeconds,
        resolution: "original",
      }),
    );
  };

  const showActions = job.phase === "ready" || job.phase === "done";

  return (
    <div className="sample-demo">
      <div className="sample-demo-head">
        <span className="mono-label">Live demo</span>
        <span className="sample-demo-note">Real encoder. Runs in this tab.</span>
      </div>

      {job.phase === "idle" ? (
        <div className="sample-demo-intro">
          <div className="sample-demo-file">
            <Film size={20} aria-hidden="true" />
            <div>
              <strong>{SAMPLE_CLIP.fileName}</strong>
              <span>
                {formatBytes(SAMPLE_CLIP.bytes)} · {SAMPLE_CLIP.format} ({SAMPLE_CLIP.codec}) · {SAMPLE_CLIP.width}×
                {SAMPLE_CLIP.height} · {formatDuration(SAMPLE_CLIP.durationSeconds)}
              </span>
            </div>
          </div>
          <p>
            Compress a real video and see the result. The sample runs through the same encoder and settings as the
            Compress video tool, and nothing is uploaded.
          </p>
          <p className="sample-demo-caveat">{SAMPLE_CLIP.description}</p>
          <button className="button button-primary button-block" type="button" onClick={loadSample} disabled={loadingSample}>
            {loadingSample ? (
              <>
                <Loader2 size={17} className="spin" aria-hidden="true" /> Loading the sample…
              </>
            ) : (
              <>
                <Play size={17} aria-hidden="true" /> Load the sample clip
              </>
            )}
          </button>
          {loadError && (
            <p className="job-error" role="alert">
              {loadError}
            </p>
          )}
          <Link className="sample-demo-link" to="/tools/compress">
            Or use your own video <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <JobPanel job={job} idleHint="" />
          {showActions && (
            <div className="sample-demo-actions">
              <div className="chips" role="group" aria-label="Target size for the sample">
                {SAMPLE_TARGETS_MB.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={targetMb === size ? "chip active" : "chip"}
                    aria-pressed={targetMb === size}
                    onClick={() => setTargetMb(size)}
                  >
                    {size} MB
                  </button>
                ))}
              </div>
              <button className="button button-primary" type="button" onClick={compress}>
                {job.phase === "done" ? "Compress again" : `Compress to ~${targetMb} MB`}
              </button>
              <button className="button button-ghost button-small" type="button" onClick={job.clear}>
                <RotateCcw size={14} aria-hidden="true" /> Reset
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
