import { buildCompressArgs } from "./compress";
import { SAMPLE_CLIP } from "./samples";
import { buildAudioArgs, buildConvertArgs, buildFrameArgs, buildResizeArgs, buildTrimArgs } from "./tool-args";

/**
 * The tabs of the homepage demo. Each tab runs one real tool on the sample,
 * using the same FFmpeg arguments (or image code) as the tool page.
 */

export type DemoId = "compress" | "crop" | "trim" | "convert" | "audio" | "frame" | "image";
export type OutputKind = "video" | "audio" | "image";

export interface DemoOption {
  id: string;
  label: string;
  /** What the result is, so the screen can show it with the right element. */
  output: OutputKind;
}

export interface DemoScenario {
  id: DemoId;
  /** Tab label. */
  label: string;
  /** The tool page this tab demonstrates. */
  tool: string;
  toolName: string;
  /** Whether the sample is the video clip or the sample photo. */
  source: "video" | "image";
  /** One line on what the tool does, shown under the screen. */
  blurb: string;
  optionsLabel: string;
  options: DemoOption[];
  defaultOption: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "compress",
    label: "Compress",
    tool: "compress",
    toolName: "Compress video",
    source: "video",
    blurb: "Hit a target file size. The encoder picks the bitrate for you.",
    optionsLabel: "Target size",
    options: [
      { id: "2", label: "2 MB", output: "video" },
      { id: "1", label: "1 MB", output: "video" },
    ],
    defaultOption: "2",
  },
  {
    id: "crop",
    label: "Crop",
    tool: "resize",
    toolName: "Crop & resize",
    source: "video",
    blurb: "Fill a vertical, square or portrait frame without stretching.",
    optionsLabel: "Shape",
    options: [
      { id: "9x16", label: "9:16", output: "video" },
      { id: "1x1", label: "1:1", output: "video" },
      { id: "4x5", label: "4:5", output: "video" },
    ],
    defaultOption: "9x16",
  },
  {
    id: "trim",
    label: "Trim",
    tool: "trim",
    toolName: "Trim video",
    source: "video",
    blurb: "Keep only the part you need. Cuts are frame-accurate.",
    optionsLabel: "Keep",
    options: [
      { id: "start", label: "First 2 s", output: "video" },
      { id: "middle", label: "Middle 2 s", output: "video" },
      { id: "end", label: "Last 2 s", output: "video" },
    ],
    defaultOption: "middle",
  },
  {
    id: "convert",
    label: "Convert",
    tool: "convert",
    toolName: "Convert video",
    source: "video",
    blurb: "Change the format: a looping GIF, a WebM, or just the audio.",
    optionsLabel: "Convert to",
    options: [
      { id: "gif", label: "GIF", output: "image" },
      { id: "webm", label: "WebM", output: "video" },
      { id: "mp3", label: "MP3", output: "audio" },
    ],
    defaultOption: "gif",
  },
  {
    id: "audio",
    label: "Audio",
    tool: "audio",
    toolName: "Extract audio",
    source: "video",
    blurb: "Pull the sound track out of a video as MP3, M4A or WAV.",
    optionsLabel: "Format",
    options: [
      { id: "mp3", label: "MP3", output: "audio" },
      { id: "m4a", label: "M4A", output: "audio" },
      { id: "wav", label: "WAV", output: "audio" },
    ],
    defaultOption: "mp3",
  },
  {
    id: "frame",
    label: "Frame",
    tool: "frame",
    toolName: "Save a frame",
    source: "video",
    blurb: "Save any moment of a video as a full-resolution still.",
    optionsLabel: "At",
    options: [
      { id: "1", label: "1 s", output: "image" },
      { id: "3", label: "3 s", output: "image" },
      { id: "5", label: "5 s", output: "image" },
    ],
    defaultOption: "3",
  },
  {
    id: "image",
    label: "Image",
    tool: "compress-image",
    toolName: "Compress image",
    source: "image",
    blurb: "Shrink a photo to a target size in your browser's own encoder.",
    optionsLabel: "Target size",
    options: [
      { id: "50", label: "50 KB", output: "image" },
      { id: "30", label: "30 KB", output: "image" },
    ],
    defaultOption: "50",
  },
];

export function scenarioById(id: DemoId): DemoScenario {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`Unknown demo: ${id}`);
  return scenario;
}

export function optionById(scenario: DemoScenario, optionId: string): DemoOption {
  return scenario.options.find((option) => option.id === optionId) ?? scenario.options[0];
}

const CROP_SIZES: Record<string, { width: number; height: number }> = {
  "9x16": { width: 720, height: 1280 },
  "1x1": { width: 720, height: 720 },
  "4x5": { width: 720, height: 900 },
};

const TRIM_WINDOWS: Record<string, { startSeconds: number; lengthSeconds: number }> = {
  start: { startSeconds: 0, lengthSeconds: 2 },
  middle: { startSeconds: 2, lengthSeconds: 2 },
  end: { startSeconds: 4, lengthSeconds: 2 },
};

/** The file name the result is saved under, matching the tool pages. */
export function demoOutputName(baseName: string, scenarioId: DemoId, optionId: string): string {
  switch (scenarioId) {
    case "compress":
      return `${baseName}-compressed.mp4`;
    case "crop": {
      const size = CROP_SIZES[optionId] ?? CROP_SIZES["9x16"];
      return `${baseName}-${size.width}x${size.height}.mp4`;
    }
    case "trim":
      return `${baseName}-trimmed.mp4`;
    case "convert":
    case "audio":
      return `${baseName}.${optionId}`;
    case "frame":
      return `${baseName}-frame.png`;
    case "image":
      return `${baseName}-compressed.jpg`;
  }
}

/** Target size in bytes for the image demo. */
export function demoImageTargetBytes(optionId: string): number {
  return (Number(optionId) || 50) * 1024;
}

/** The FFmpeg command for a video tab. The image tab does not use FFmpeg. */
export function demoVideoArgs(
  scenarioId: DemoId,
  optionId: string,
  { input, output, durationSeconds = SAMPLE_CLIP.durationSeconds }: { input: string; output: string; durationSeconds?: number },
): string[] {
  switch (scenarioId) {
    case "compress":
      return buildCompressArgs({ input, output, mode: "size", targetMb: Number(optionId) || 2, durationSeconds, resolution: "original" });
    case "crop": {
      const size = CROP_SIZES[optionId] ?? CROP_SIZES["9x16"];
      return buildResizeArgs({ input, output, ...size, fit: "crop" });
    }
    case "trim": {
      const window = TRIM_WINDOWS[optionId] ?? TRIM_WINDOWS.middle;
      // Never ask for more than the clip has.
      const lengthSeconds = Math.max(0.5, Math.min(window.lengthSeconds, durationSeconds - window.startSeconds));
      return buildTrimArgs({ input, output, startSeconds: window.startSeconds, lengthSeconds });
    }
    case "convert":
      return buildConvertArgs({ input, output, format: optionId as "gif" | "webm" | "mp3" });
    case "audio":
      return buildAudioArgs({ input, output, format: optionId as "mp3" | "m4a" | "wav", bitrate: 192 });
    case "frame":
      return buildFrameArgs({ input, output, seconds: Number(optionId) || 3, format: "png" });
    case "image":
      throw new Error("The image demo does not use FFmpeg.");
  }
}

export function walkthroughUrl(base: string, id: DemoId): string {
  return `${base}walkthroughs/${id}.mp4`;
}

export function walkthroughPosterUrl(base: string, id: DemoId): string {
  return `${base}walkthroughs/${id}.jpg`;
}
