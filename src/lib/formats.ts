/**
 * The single source of truth for what each tool accepts and produces.
 *
 * Statuses mean exactly this:
 *  - supported:   verified working in the tested setup below.
 *  - limited:     works with documented restrictions, or could not be verified.
 *  - unsupported: not currently available.
 *
 * A format is only "supported" if a real file in that format went through the
 * tool's real code path and the output decoded. Everything we could not
 * produce a test file for is "limited" and says so. Statuses describe the
 * tested setup only; other browsers and phones have not been tested.
 */

import { MORE_IMAGE_COMPAT, MORE_IMAGE_SLUGS, MORE_VIDEO_COMPAT } from "./formats-more";

export type FormatStatus = "supported" | "limited" | "unsupported";

export interface FormatEntry {
  label: string;
  status: FormatStatus;
  note?: string;
}

export interface ToolCompat {
  inputs: FormatEntry[];
  outputs: FormatEntry[];
  /** The largest input actually run through this tool. */
  maxTested: string;
  resolutions: string;
  codecs: string;
  audio?: string;
  transparency?: string;
  metadata: string;
  limitations: string[];
}

/** What the statuses were verified on. Update both fields whenever the tests are re-run. */
export const TESTED_SETUP = {
  browser: "Chrome 157 on desktop (Windows)",
  date: "2026-11-13",
  scope:
    "Other browsers, Safari, and phones have not been tested for this release, so a status describes the setup above only.",
} as const;

export const STATUS_LABEL: Record<FormatStatus, string> = {
  supported: "Supported",
  limited: "Limited",
  unsupported: "Unsupported",
};


const VIDEO_BROWSER_NOTE = "A current desktop or mobile browser with WebAssembly and Web Workers. Verified in Chrome only.";
const IMAGE_BROWSER_NOTE =
  "A current browser with the Canvas API. Verified in Chrome only; WebP export and HEIC decoding differ by browser.";
const IMAGE_TOOL_SLUGS = new Set(["compress-image", "resize-image", "convert-image", "heic-to-jpg"]);

const VIDEO_INPUTS: FormatEntry[] = [
  { label: "MP4 (H.264 + AAC)", status: "supported" },
  { label: "MOV (H.264 + AAC)", status: "supported" },
  { label: "MOV (ProRes)", status: "supported" },
  { label: "MKV (H.264 + AAC)", status: "supported" },
  { label: "AVI (MPEG-4 + MP3)", status: "supported" },
  { label: "WebM (VP8 or VP9)", status: "supported" },
  {
    label: "HEVC / H.265 (many iPhone videos)",
    status: "limited",
    note: "Not verified in this release: our test encoder timed out before it could produce an HEVC file to test with. If a video fails, export it with the phone's \"Most compatible\" setting.",
  },
  { label: "AV1 and other codecs", status: "limited", note: "Not verified in this release." },
  { label: "DRM-protected video, streaming URLs", status: "unsupported", note: "Only files you already have on your device." },
];

/** Compress video reads the file with the browser's own decoder first, which opens AV1 as well; the other video tools still use FFmpeg. */
const COMPRESS_INPUTS: FormatEntry[] = VIDEO_INPUTS.map((entry) =>
  entry.label === "AV1 and other codecs"
    ? {
        label: "AV1 (YouTube downloads, newer phones)",
        status: "supported" as const,
        note: "Where the browser can decode AV1, such as recent Chrome and Edge. Otherwise Cutmoor says so before it starts.",
      }
    : entry,
);

const VIDEO_LIMITATIONS = [
  "Video is re-encoded, so the output is never bit-for-bit identical to the original.",
  "The video encoder is single-threaded, so long or high-resolution videos take longer.",
  "Browser memory is the real size limit. Very large files can fail with an out-of-memory error; keep the original.",
  "Video metadata such as the title tag is copied to the output. We did not test every tag type, so assume other tags, including location, may be copied too.",
];

export const TOOL_COMPAT: Record<string, ToolCompat> = {
  compress: {
    inputs: COMPRESS_INPUTS,
    outputs: [{ label: "MP4 (H.264 + AAC)", status: "supported" }],
    maxTested:
      "a 2.9 GB MKV, which opened and compressed in Chrome on a Windows PC. A 1.3 GB, 4 h 40 min 4K AV1 video ran at about 4 times real time there (a full run takes about 70 minutes; that test was stopped after 4 minutes).",
    resolutions: "You choose how much smaller the file should be; Cutmoor picks the resolution and quality. Tested from 320×180 to 4K.",
    codecs: "Output is H.264 video with AAC sound. The browser's own encoder is used first and uses the device's video hardware when it has some.",
    audio: "Small stereo AAC sound is copied as it is. Other sound is converted to AAC at 128 kbps (96 kbps for videos an hour or longer). A video with no sound compresses normally.",
    metadata: VIDEO_LIMITATIONS[3],
    limitations: [
      "Video is re-encoded, so the output is never bit-for-bit identical to the original.",
      "Reading 4K and AV1 video is the slowest step, so long videos can take an hour or more. Keep the tab open: a phone may pause or close a background tab.",
      "Large results are written to the browser's private storage, so free disk space is the limit rather than memory. Very large files can still fail on a device with little free space; keep the original.",
    ],
  },
  resize: {
    inputs: VIDEO_INPUTS,
    outputs: [{ label: "MP4 (H.264 + AAC)", status: "supported" }],
    maxTested: "a 320×180 video cropped to 9:16",
    resolutions: "Output is the exact size you choose: 9:16, 1:1, 4:5, or a custom size.",
    codecs: "Output is always H.264 video with AAC audio at 160 kbps.",
    audio: "Kept and re-encoded to AAC.",
    metadata: VIDEO_LIMITATIONS[3],
    limitations: [VIDEO_LIMITATIONS[0], VIDEO_LIMITATIONS[1], VIDEO_LIMITATIONS[2]],
  },
  trim: {
    inputs: VIDEO_INPUTS,
    outputs: [{ label: "MP4 (H.264 + AAC)", status: "supported" }],
    maxTested: "a 1-second, 320×180 clip",
    resolutions: "Keeps the source resolution.",
    codecs: "The cut is re-encoded to H.264 video with AAC audio at 160 kbps, for frame-accurate cuts.",
    audio: "Kept and re-encoded to AAC.",
    metadata: VIDEO_LIMITATIONS[3],
    limitations: [VIDEO_LIMITATIONS[0], VIDEO_LIMITATIONS[1], VIDEO_LIMITATIONS[2]],
  },
  convert: {
    inputs: VIDEO_INPUTS,
    outputs: [
      { label: "MP4 (H.264 + AAC)", status: "supported" },
      { label: "WebM (VP8 + Vorbis)", status: "supported", note: "Usually larger than MP4 at similar quality." },
      { label: "WebM (VP9)", status: "unsupported", note: "The VP9 encoder crashes in this browser build, so Cutmoor uses VP8." },
      { label: "GIF", status: "supported", note: "640 px wide, 12 fps, no sound. Best under 6 seconds." },
      { label: "MP3", status: "supported", note: "Audio only, 192 kbps." },
      { label: "M4A (AAC)", status: "supported", note: "Audio only, 192 kbps." },
      { label: "WAV", status: "supported", note: "Audio only, uncompressed and large." },
    ],
    maxTested: "1-second, 320×180 clips (every output); WebM also with a 6-second, 1280×720 clip",
    resolutions: "MP4 and WebM keep the source resolution. GIF is scaled to 640 px wide.",
    codecs: "MP4 is H.264 + AAC. WebM is VP8 + Vorbis. Audio exports re-encode the sound track.",
    audio: "Kept in MP4 and WebM. GIF has no audio. Audio exports need a video that has sound.",
    metadata: VIDEO_LIMITATIONS[3],
    limitations: [VIDEO_LIMITATIONS[0], VIDEO_LIMITATIONS[1], VIDEO_LIMITATIONS[2], "GIF is a poor format for long or detailed video; the file can be very large."],
  },
  audio: {
    inputs: [
      { label: "Video with sound: MP4, MOV, MKV, AVI, WebM", status: "supported" },
      { label: "MP3", status: "supported" },
      { label: "WAV", status: "supported" },
      { label: "M4A (AAC)", status: "supported" },
      { label: "Video with no audio track", status: "limited", note: "Fails with a clear \"no audio track\" message." },
    ],
    outputs: [
      { label: "MP3", status: "supported", note: "At the bitrate you choose." },
      { label: "M4A (AAC)", status: "supported" },
      { label: "WAV", status: "supported", note: "Uncompressed and large." },
    ],
    maxTested: "1-second clips",
    resolutions: "Not applicable.",
    codecs: "MP3 uses LAME, M4A uses AAC, WAV is 16-bit PCM.",
    audio: "The audio is re-encoded. Re-encoding a lossy file such as MP3 loses a little more quality.",
    metadata: "Tags such as the title may be copied to the output.",
    limitations: [VIDEO_LIMITATIONS[1], VIDEO_LIMITATIONS[2]],
  },
  frame: {
    inputs: VIDEO_INPUTS,
    outputs: [
      { label: "PNG", status: "supported", note: "Lossless." },
      { label: "JPG", status: "supported", note: "High quality." },
    ],
    maxTested: "1-second, 320×180 clips",
    resolutions: "The still is exported at the video's own resolution.",
    codecs: "Not applicable.",
    metadata: "Not copied: the image is a new file.",
    limitations: [
      "If the timestamp is outside the video, or before the first decodable frame, the result can be empty.",
      VIDEO_LIMITATIONS[2],
    ],
  },
  captions: {
    inputs: [
      { label: "SRT", status: "supported" },
      { label: "WebVTT (.vtt)", status: "supported" },
    ],
    outputs: [
      { label: "WebVTT (.vtt)", status: "supported" },
      { label: "SRT", status: "supported" },
    ],
    maxTested: "covered by automated tests; no practical size limit for text",
    resolutions: "Not applicable.",
    codecs: "Plain text only.",
    metadata: "Cue numbers and timings are rewritten.",
    limitations: [
      "VTT to SRT drops cue settings and styling that SRT cannot represent, and ignores NOTE blocks.",
      "Only SRT and WebVTT are supported. Other subtitle formats, such as ASS, are not.",
    ],
  },
};

const IMAGE_INPUTS: FormatEntry[] = [
  { label: "JPG", status: "supported" },
  { label: "PNG", status: "supported", note: "Transparency is read." },
  { label: "WebP", status: "supported" },
  { label: "SVG", status: "supported", note: "Rasterised at its own size." },
  { label: "GIF", status: "supported", note: "First frame only; the animation is not kept." },
  { label: "BMP", status: "supported" },
  { label: "AVIF", status: "limited", note: "Depends on your browser's decoder. Not verified in this release." },
  {
    label: "HEIC / HEIF (iPhone)",
    status: "limited",
    note: "Safari uses the system decoder; other browsers download a local decoder. Not verified in this release. Live Photos and some 10-bit HDR files can fail.",
  },
];

const IMAGE_OUTPUTS: FormatEntry[] = [
  { label: "JPG", status: "supported" },
  { label: "PNG", status: "supported", note: "Lossless." },
  {
    label: "WebP",
    status: "limited",
    note: "Works in Chrome. Safari cannot encode WebP from a canvas, so the option is disabled there instead of returning a PNG.",
  },
];

const IMAGE_LIMITATIONS = [
  "Output is capped at 16,777,216 pixels and 16,384 px per edge; larger images are scaled down.",
  "Images are re-encoded through the browser's canvas, which drops EXIF data such as camera model and location.",
  "Everything runs in memory, so very large photos can fail on phones.",
];

const IMAGE_COMPAT_BASE = {
  inputs: IMAGE_INPUTS,
  outputs: IMAGE_OUTPUTS,
  maxTested: "240×160 test images in every format; the canvas limits below are enforced in code",
  resolutions: "Up to 16,777,216 pixels total and 16,384 px on the longest edge.",
  codecs: "Encoded by your browser's own JPEG, PNG, and WebP encoders.",
  transparency: "PNG and WebP keep transparency. JPG has none, so transparent areas are filled with the background colour you choose.",
  metadata: IMAGE_LIMITATIONS[1],
  limitations: IMAGE_LIMITATIONS,
};

TOOL_COMPAT["compress-image"] = { ...IMAGE_COMPAT_BASE, resolutions: `${IMAGE_COMPAT_BASE.resolutions} Large photos can be scaled down to reach a target size.` };
TOOL_COMPAT["resize-image"] = { ...IMAGE_COMPAT_BASE };
TOOL_COMPAT["convert-image"] = { ...IMAGE_COMPAT_BASE };
// Auto captions: the speech model has been run with real files (scripts/verify/captions-real.mjs),
// but only in desktop Chrome on Windows, so every row still says what it depends on instead of promising it works.
TOOL_COMPAT["auto-captions"] = {
  inputs: [
    { label: "MP4, MOV, WebM, MKV video", status: "limited", note: "Depends on the browser's audio decoder. Verified with MP4 in desktop Chrome on Windows so far." },
    { label: "MP3 and WAV audio", status: "limited", note: "Depends on the browser's audio decoder. Verified with WAV and MP3 in desktop Chrome on Windows so far." },
  ],
  outputs: [
    { label: "SRT and WebVTT captions", status: "limited", note: "Available when a model runs. Verified in desktop Chrome on Windows only so far." },
    { label: "Word-level JSON", status: "limited", note: "Available when a model runs. Verified in desktop Chrome on Windows only so far." },
    { label: "MP4 with captions burned in", status: "limited", note: "Needs WebCodecs video encoding, which not every browser has. Verified in desktop Chrome on Windows only so far." },
  ],
  maxTested: "short test clips in desktop Chrome on Windows only; no broad accuracy benchmark",
  resolutions: "Burned-in captions scale with the picture height.",
  codecs: "Audio is decoded by the browser (WebCodecs).",
  audio: "The video needs a sound track with speech.",
  metadata: "The file name and content are never sent anywhere. Only the model files are downloaded.",
  limitations: [
    "Machine captions can be wrong; review them before publishing.",
    "Songs, rap, and speech over loud music are the hardest case: where there is singing, expect more wrong words and some missing lines.",
    "Draft is a quick first pass for clear speech and can miss words on fast, noisy or accented speech; High accuracy is the accurate one.",
    "Hinglish spelling varies. Common spellings are made consistent, but names are guesses; add them in the Names and special words box.",
    "Word timing can be off by a fraction of a second.",
    "Verified only in desktop Chrome on Windows so far. Other browsers are not tested, and phones may run out of memory with High accuracy.",
    "The model downloads once and needs a connection the first time.",
  ],
};
TOOL_COMPAT["heic-to-jpg"] = {
  ...IMAGE_COMPAT_BASE,
  inputs: IMAGE_INPUTS.filter((entry) => entry.label.startsWith("HEIC") || entry.label === "JPG" || entry.label === "PNG"),
  outputs: [IMAGE_OUTPUTS[0], IMAGE_OUTPUTS[1]],
  maxTested: "not tested with real HEIC files in this release",
};

Object.assign(TOOL_COMPAT, MORE_VIDEO_COMPAT, MORE_IMAGE_COMPAT);

/** The browser features a tool depends on. */
export function browserRequirement(slug: string): string {
  if (slug === "captions") return "Any modern browser. Captions are converted as plain text.";
  return IMAGE_TOOL_SLUGS.has(slug) || MORE_IMAGE_SLUGS.has(slug) ? IMAGE_BROWSER_NOTE : VIDEO_BROWSER_NOTE;
}

export function compatForTool(slug: string): ToolCompat | undefined {
  return TOOL_COMPAT[slug];
}

/** Every format a group of tools accepts or produces, deduplicated, for the homepage summary. */
export function summarizeFormats(slugs: string[], side: "inputs" | "outputs"): FormatEntry[] {
  const seen = new Map<string, FormatEntry>();
  for (const slug of slugs) {
    for (const entry of TOOL_COMPAT[slug]?.[side] ?? []) {
      if (!seen.has(entry.label)) seen.set(entry.label, entry);
    }
  }
  return [...seen.values()];
}
