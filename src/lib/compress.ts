import { targetVideoKbps } from "./format";

export type CompressMode = "size" | "quality";
export type CompressResolution = "original" | "1080" | "720" | "480";

export interface CompressOptions {
  input: string;
  output: string;
  mode: CompressMode;
  /** Target file size in MB, used when mode is "size". */
  targetMb: number;
  /** Source duration in seconds. Target-size mode needs it; without it the encoder falls back to quality mode. */
  durationSeconds: number;
  resolution: CompressResolution;
}

/**
 * The FFmpeg arguments for the Compress video tool. Shared by the tool page
 * and the homepage demo, so the demo always runs exactly what the tool runs.
 */
export function buildCompressArgs({ input, output, mode, targetMb, durationSeconds, resolution }: CompressOptions): string[] {
  const args = ["-i", input];
  if (mode === "size" && durationSeconds > 0) {
    const videoKbps = targetVideoKbps(targetMb, durationSeconds, 128);
    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-b:v", `${videoKbps}k`,
      "-maxrate", `${Math.round(videoKbps * 1.5)}k`,
      "-bufsize", `${videoKbps * 2}k`,
    );
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "28");
  }
  if (resolution !== "original") {
    args.push("-vf", `scale=-2:${resolution}`);
  }
  args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", output);
  return args;
}
