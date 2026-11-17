/**
 * The FFmpeg arguments behind the editing tools (mute, rotate, speed, reverse, loop, GIF, merge, watermark,
 * add sound, slideshow). Same rule as tool-args.ts: the tool pages and the tests call these, so what is tested is
 * exactly what runs. Every function returns plain arguments; none touches the encoder.
 */

const H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "160k"];
const FASTSTART = ["-movflags", "+faststart"];
/** H.264 with yuv420p needs even sides; rotating or resizing can leave an odd one. */
const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

const num = (value: number) => String(Math.round(value * 1000) / 1000);

// ---- mute -------------------------------------------------------------------------------------------------

export function buildMuteArgs({ input, output }: { input: string; output: string }): string[] {
  return ["-i", input, "-vf", EVEN, ...H264, "-an", ...FASTSTART, "-y", output];
}

// ---- rotate and flip --------------------------------------------------------------------------------------

export type Rotation = 0 | 90 | 180 | 270;

export interface RotateOptions {
  input: string;
  output: string;
  /** Clockwise, in degrees. */
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
}

/** The video filters for a rotation and flips, in the order they are applied: rotate first, then flip. */
export function rotateFilters({ rotate, flipH, flipV }: Pick<RotateOptions, "rotate" | "flipH" | "flipV">): string[] {
  const filters: string[] = [];
  if (rotate === 90) filters.push("transpose=1");
  else if (rotate === 180) filters.push("hflip", "vflip");
  else if (rotate === 270) filters.push("transpose=2");
  if (flipH) filters.push("hflip");
  if (flipV) filters.push("vflip");
  return filters;
}

export function buildRotateArgs(options: RotateOptions): string[] {
  const filters = [...rotateFilters(options), EVEN];
  return ["-i", options.input, "-vf", filters.join(","), ...H264, ...AAC, ...FASTSTART, "-y", options.output];
}

// ---- speed ------------------------------------------------------------------------------------------------

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** `atempo` only accepts 0.5 to 2 per step, so a bigger change is chained: 4x is two steps of 2x. */
export function atempoChain(factor: number): string[] {
  const steps: number[] = [];
  let rest = factor;
  while (rest < 0.5) {
    steps.push(0.5);
    rest /= 0.5;
  }
  while (rest > 2) {
    steps.push(2);
    rest /= 2;
  }
  steps.push(rest);
  return steps.map((step) => `atempo=${num(step)}`);
}

export function buildSpeedArgs({ input, output, factor, hasAudio }: { input: string; output: string; factor: number; hasAudio: boolean }): string[] {
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, factor));
  const args = ["-i", input, "-vf", `setpts=PTS/${num(speed)},${EVEN}`];
  if (hasAudio) args.push("-af", atempoChain(speed).join(","));
  args.push(...H264, ...(hasAudio ? AAC : ["-an"]), ...FASTSTART, "-y", output);
  return args;
}

// ---- reverse and loop -------------------------------------------------------------------------------------

/** Reversing holds every frame in memory. The estimate is what the decoded frames take, in bytes. */
export function reverseMemoryEstimate({ width, height, fps, duration }: { width: number; height: number; fps: number; duration: number }): number {
  return Math.ceil(width * height * 1.5 * Math.max(1, fps) * duration);
}

/** About 700 MB of decoded frames is where a browser tab starts to run out of memory. */
export const REVERSE_MEMORY_LIMIT = 700 * 1024 * 1024;

export function buildReverseArgs({ input, output, hasAudio }: { input: string; output: string; hasAudio: boolean }): string[] {
  const args = ["-i", input, "-vf", `reverse,${EVEN}`];
  if (hasAudio) args.push("-af", "areverse");
  args.push(...H264, ...(hasAudio ? AAC : ["-an"]), ...FASTSTART, "-y", output);
  return args;
}

/** `plays` is the total number of times the clip is shown, so 2 means the original and one repeat. */
export function buildLoopArgs({ input, output, plays, hasAudio }: { input: string; output: string; plays: number; hasAudio: boolean }): string[] {
  const repeats = Math.max(0, Math.round(plays) - 1);
  return ["-stream_loop", String(repeats), "-i", input, "-vf", EVEN, ...H264, ...(hasAudio ? AAC : ["-an"]), ...FASTSTART, "-y", output];
}

// ---- GIF --------------------------------------------------------------------------------------------------

export function buildGifToMp4Args({ input, output }: { input: string; output: string }): string[] {
  // Many GIFs have odd sizes and a transparent background; H.264 needs even sides and no alpha.
  return ["-i", input, "-vf", `${EVEN},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", ...FASTSTART, "-y", output];
}

export interface GifOptions {
  input: string;
  output: string;
  /** Output width in pixels. A GIF is never made wider than its source. */
  width: number;
  fps: number;
  colors: number;
}

export function buildGifArgs({ input, output, width, fps, colors }: GifOptions): string[] {
  const palette = `split[s0][s1];[s0]palettegen=max_colors=${Math.round(colors)}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  return ["-i", input, "-vf", `fps=${num(fps)},scale='min(${Math.round(width)},iw)':-2:flags=lanczos,${palette}`, "-loop", "0", "-y", output];
}

export const GIF_PRESETS = {
  light: { label: "Light", note: "Up to 640 px, 15 fps. Closest to the original.", width: 640, fps: 15, colors: 192 },
  balanced: { label: "Balanced", note: "Up to 480 px, 12 fps. A good default.", width: 480, fps: 12, colors: 128 },
  small: { label: "Small", note: "Up to 320 px, 10 fps. For chat apps.", width: 320, fps: 10, colors: 96 },
  tiny: { label: "Tiny", note: "Up to 240 px, 8 fps. Smallest file.", width: 240, fps: 8, colors: 64 },
} as const;

// ---- merge ------------------------------------------------------------------------------------------------

export interface MergeClip {
  name: string;
  hasAudio: boolean;
  /** Seconds. Needed to make silence for a clip with no sound. */
  duration: number;
}

export interface MergeOptions {
  clips: MergeClip[];
  output: string;
  width: number;
  height: number;
  fps: number;
}

export function buildMergeArgs({ clips, output, width, height, fps }: MergeOptions): string[] {
  const w = Math.max(2, Math.round(width / 2) * 2);
  const h = Math.max(2, Math.round(height / 2) * 2);
  const args: string[] = [];
  for (const clip of clips) args.push("-i", clip.name);
  const parts: string[] = [];
  const joined: string[] = [];
  clips.forEach((clip, index) => {
    parts.push(
      `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${num(fps)},format=yuv420p[v${index}]`,
    );
    // A clip with no sound still needs an audio stream of its own length, or the joined sound drifts out of step.
    parts.push(
      clip.hasAudio
        ? `[${index}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`
        : `anullsrc=r=44100:cl=stereo,atrim=duration=${num(Math.max(0.04, clip.duration))}[a${index}]`,
    );
    joined.push(`[v${index}][a${index}]`);
  });
  parts.push(`${joined.join("")}concat=n=${clips.length}:v=1:a=1[v][a]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[v]", "-map", "[a]", ...H264, ...AAC, ...FASTSTART, "-y", output);
  return args;
}

// ---- watermark --------------------------------------------------------------------------------------------

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

/** FFmpeg overlay coordinates for a position, with a margin that scales with the picture. */
export function overlayPosition(position: WatermarkPosition, margin: number): { x: string; y: string } {
  const m = Math.max(0, Math.round(margin));
  switch (position) {
    case "top-left":
      return { x: String(m), y: String(m) };
    case "top-right":
      return { x: `W-w-${m}`, y: String(m) };
    case "bottom-left":
      return { x: String(m), y: `H-h-${m}` };
    case "center":
      return { x: "(W-w)/2", y: "(H-h)/2" };
    default:
      return { x: `W-w-${m}`, y: `H-h-${m}` };
  }
}

export interface WatermarkOptions {
  input: string;
  mark: string;
  output: string;
  position: WatermarkPosition;
  /** Mark width in pixels, already worked out from the video's own width. */
  markWidth: number;
  /** 0 to 1. */
  opacity: number;
  margin: number;
  hasAudio: boolean;
}

export function buildWatermarkArgs({ input, mark, output, position, markWidth, opacity, margin, hasAudio }: WatermarkOptions): string[] {
  const { x, y } = overlayPosition(position, margin);
  const alpha = Math.min(1, Math.max(0.05, opacity));
  const graph = `[1:v]scale=${Math.max(2, Math.round(markWidth))}:-1,format=rgba,colorchannelmixer=aa=${num(alpha)}[wm];[0:v][wm]overlay=${x}:${y}:format=auto,${EVEN}[v]`;
  return ["-i", input, "-i", mark, "-filter_complex", graph, "-map", "[v]", ...(hasAudio ? ["-map", "0:a"] : []), ...H264, ...(hasAudio ? AAC : ["-an"]), ...FASTSTART, "-y", output];
}

// ---- add sound --------------------------------------------------------------------------------------------

export interface AddAudioOptions {
  video: string;
  audio: string;
  output: string;
  /** "replace" drops the original sound; "mix" plays both. */
  mode: "replace" | "mix";
  /** Volume of the new sound, 0 to 2 (1 is unchanged). */
  volume: number;
  /** Repeat a shorter sound until the video ends. */
  loop: boolean;
  videoHasAudio: boolean;
  /** Length of the video, seconds. The result is cut to this. */
  duration: number;
}

export function buildAddAudioArgs({ video, audio, output, mode, volume, loop, videoHasAudio, duration }: AddAudioOptions): string[] {
  const level = Math.min(2, Math.max(0, volume));
  const mix = mode === "mix" && videoHasAudio;
  const graph = mix
    ? `[1:a]volume=${num(level)}[n];[0:a][n]amix=inputs=2:duration=first:dropout_transition=0[a]`
    : `[1:a]volume=${num(level)}[a]`;
  const args = ["-i", video];
  if (loop) args.push("-stream_loop", "-1");
  args.push("-i", audio, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", ...AAC);
  args.push("-t", num(Math.max(0.1, duration)), ...FASTSTART, "-y", output);
  return args;
}

// ---- slideshow --------------------------------------------------------------------------------------------

export interface SlideshowOptions {
  /** Names of the prepared pictures, all the same size (the page draws them onto one frame first). */
  frames: string[];
  output: string;
  /** Seconds each picture is shown. */
  seconds: number;
  /** Seconds of cross-fade between pictures; 0 for a plain cut. */
  fade: number;
  fps: number;
  /** A sound track to play under the slideshow, or null. */
  audio: string | null;
}

export function slideshowLength({ count, seconds, fade }: { count: number; seconds: number; fade: number }): number {
  return count * seconds - Math.max(0, count - 1) * fade;
}

export function buildSlideshowArgs({ frames, output, seconds, fade, fps, audio }: SlideshowOptions): string[] {
  const args: string[] = [];
  const t = Math.min(fade, seconds / 2);
  // Each picture is shown for `seconds`; a fade overlaps the end of one with the start of the next.
  for (const frame of frames) args.push("-loop", "1", "-framerate", num(fps), "-t", num(seconds), "-i", frame);
  if (audio) args.push("-i", audio);
  const total = slideshowLength({ count: frames.length, seconds, fade: t });
  let graph: string;
  let last: string;
  if (frames.length === 1) {
    graph = "[0:v]format=yuv420p[v]";
    last = "[v]";
  } else if (t > 0) {
    const steps: string[] = [];
    let previous = "[0:v]";
    for (let index = 1; index < frames.length; index += 1) {
      const out = index === frames.length - 1 ? "[x]" : `[x${index}]`;
      steps.push(`${previous}[${index}:v]xfade=transition=fade:duration=${num(t)}:offset=${num(index * (seconds - t))}${out}`);
      previous = out;
    }
    steps.push("[x]format=yuv420p[v]");
    graph = steps.join(";");
    last = "[v]";
  } else {
    graph = `${frames.map((_, index) => `[${index}:v]`).join("")}concat=n=${frames.length}:v=1:a=0,format=yuv420p[v]`;
    last = "[v]";
  }
  args.push("-filter_complex", graph, "-map", last);
  if (audio) args.push("-map", `${frames.length}:a`, ...AAC, "-shortest");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-t", num(total), ...FASTSTART, "-y", output);
  return args;
}
