/**
 * The FFmpeg arguments behind each video tool, in one place. The tool pages
 * and the homepage demo both call these, so the demo always runs exactly what
 * the tool runs. Compress lives in compress.ts.
 */

export interface ResizeOptions {
  input: string;
  output: string;
  width: number;
  height: number;
  /** "crop" fills the frame and trims the edges; "pad" keeps everything and adds black bars. */
  fit: "crop" | "pad";
}

export function buildResizeArgs({ input, output, width, height, fit }: ResizeOptions): string[] {
  const filter =
    fit === "crop"
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  return [
    "-i", input,
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-y", output,
  ];
}

export interface TrimOptions {
  input: string;
  output: string;
  startSeconds: number;
  lengthSeconds: number;
}

export function buildTrimArgs({ input, output, startSeconds, lengthSeconds }: TrimOptions): string[] {
  return [
    "-ss", String(startSeconds),
    "-i", input,
    "-t", String(lengthSeconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    "-y", output,
  ];
}

export type ConvertFormat = "mp4" | "webm" | "gif" | "mp3" | "wav" | "m4a";

export function buildConvertArgs({ input, output, format }: { input: string; output: string; format: ConvertFormat }): string[] {
  if (format === "mp4") {
    return ["-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", output];
  }
  if (format === "webm") {
    // VP8, not VP9: the VP9 encoder in the single-thread WebAssembly build crashes with
    // "memory access out of bounds" in every configuration we tried (tested 2026-11-13).
    return ["-i", input, "-c:v", "libvpx", "-crf", "12", "-b:v", "6M", "-cpu-used", "5", "-c:a", "libopus", "-b:a", "128k", "-y", output];
  }
  if (format === "gif") {
    return [
      "-i", input,
      "-vf", "fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
      "-loop", "0",
      "-y", output,
    ];
  }
  if (format === "mp3") {
    return ["-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-y", output];
  }
  if (format === "m4a") {
    return ["-i", input, "-vn", "-c:a", "aac", "-b:a", "192k", "-y", output];
  }
  return ["-i", input, "-vn", "-c:a", "pcm_s16le", "-y", output];
}

export type AudioFormat = "mp3" | "m4a" | "wav";

export function buildAudioArgs({ input, output, format, bitrate }: { input: string; output: string; format: AudioFormat; bitrate: number }): string[] {
  if (format === "wav") return ["-i", input, "-vn", "-c:a", "pcm_s16le", "-y", output];
  if (format === "m4a") return ["-i", input, "-vn", "-c:a", "aac", "-b:a", `${bitrate}k`, "-y", output];
  return ["-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", `${bitrate}k`, "-y", output];
}

export function buildFrameArgs({ input, output, seconds, format }: { input: string; output: string; seconds: number; format: "png" | "jpg" }): string[] {
  const args = ["-ss", String(seconds), "-i", input, "-frames:v", "1"];
  if (format === "jpg") args.push("-q:v", "2");
  args.push("-y", output);
  return args;
}
