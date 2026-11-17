import type { FormatEntry, ToolCompat } from "./formats";

/**
 * Format tables for the editing tools. A row says "supported" only when a real file in that format went through the
 * page's own button and the output was checked (scripts/verify/more-tools.mjs). The video tools were checked with
 * H.264 + AAC MP4 input; the other containers go through the same decoder as Compress video but were not run
 * through these pages, so they are "limited" and say so.
 */

const MP4_IN: FormatEntry = { label: "MP4 (H.264 + AAC)", status: "supported" };
const OTHER_VIDEO_IN: FormatEntry = {
  label: "MOV, MKV, AVI, WebM",
  status: "limited",
  note: "Read by the same decoder as Compress video, which is verified with these formats. Not run through this tool in this release.",
};
const MP4_OUT: FormatEntry = { label: "MP4 (H.264 + AAC)", status: "supported" };

const VIDEO_NOTES = [
  "Video is re-encoded, so the output is never bit-for-bit identical to the original.",
  "The encoder runs in your browser on one thread, so long or high-resolution videos take longer.",
  "Browser memory is the real size limit. Very large files can fail with an out-of-memory error; keep the original.",
];

const MAX_TESTED = "short generated test clips (2 s, 320×180) and the 1-second sample; checked on the output file";
const METADATA = "Tags such as the title may be copied to the output. We did not test every tag type.";

function videoTool(extra: Partial<ToolCompat> & Pick<ToolCompat, "codecs" | "outputs">): ToolCompat {
  return {
    inputs: [MP4_IN, OTHER_VIDEO_IN],
    maxTested: MAX_TESTED,
    resolutions: "The picture size is kept unless this tool changes it.",
    metadata: METADATA,
    limitations: VIDEO_NOTES,
    ...extra,
  };
}

export const MORE_VIDEO_COMPAT: Record<string, ToolCompat> = {
  "mute-video": videoTool({
    outputs: [{ label: "MP4 (H.264, no audio)", status: "supported" }],
    codecs: "H.264 video, no audio track.",
    audio: "Removed completely.",
  }),
  "rotate-video": videoTool({
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps.",
    audio: "Kept and re-encoded to AAC. A video with no sound stays silent.",
    resolutions: "A 90 or 270 degree turn swaps width and height. Odd sides are rounded to even.",
  }),
  "video-speed": videoTool({
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps.",
    audio: "Time-stretched with the picture (0.25x to 4x), keeping its pitch.",
    limitations: [...VIDEO_NOTES, "Slow motion stretches the existing frames, so low frame rate footage can look steppy."],
  }),
  "reverse-video": videoTool({
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps.",
    audio: "Reversed with the picture.",
    limitations: [...VIDEO_NOTES, "Reversing holds every frame in memory, so the tool refuses clips that would need more than about 700 MB."],
  }),
  "loop-video": videoTool({
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps.",
    audio: "Repeated with the picture.",
    limitations: [...VIDEO_NOTES, "The result can be up to 10 minutes long."],
  }),
  "gif-to-mp4": {
    inputs: [{ label: "GIF (animated)", status: "supported" }],
    outputs: [{ label: "MP4 (H.264, no audio)", status: "supported" }],
    maxTested: "a 2-second, 201×101 animated GIF",
    resolutions: "Odd sides are rounded down to even, because MP4 requires it.",
    codecs: "H.264 video, no audio track.",
    transparency: "MP4 has no transparency; see-through areas become black.",
    metadata: "Not copied.",
    limitations: ["The MP4 plays once; use Loop video for a file that repeats.", ...VIDEO_NOTES.slice(1)],
  },
  "compress-gif": {
    inputs: [{ label: "GIF (animated)", status: "supported" }],
    outputs: [{ label: "GIF (animated, loops forever)", status: "supported" }],
    maxTested: "a 2-second, 201×101 animated GIF",
    resolutions: "Never wider than the source: 640, 480, 320, or 240 pixels at most, by level.",
    codecs: "GIF with a palette built for the animation (up to 192, 128, 96, or 64 colours by level).",
    transparency: "Transparent areas are not kept.",
    metadata: "Not copied.",
    limitations: ["A GIF is a heavy format. An MP4 of the same animation is usually many times smaller.", "Very large animations can run out of memory, especially on phones."],
  },
  "resize-gif": {
    inputs: [{ label: "GIF (animated)", status: "supported" }],
    outputs: [{ label: "GIF (animated, loops forever)", status: "supported" }],
    maxTested: "a 2-second, 201×101 animated GIF resized to 160 px",
    resolutions: "160, 240, 320, 480, 640, or 800 pixels wide; never wider than the source.",
    codecs: "GIF with up to 160 colours, at the original frame rate within 6 to 20 per second.",
    transparency: "Transparent areas are not kept.",
    metadata: "Not copied.",
    limitations: ["Very large animations can run out of memory, especially on phones."],
  },
  "merge-videos": videoTool({
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps, 30 frames per second.",
    audio: "Kept. A clip with no sound gets silence of its length.",
    resolutions: "One output size for all clips: the first clip's, 1080p, 720p, vertical 9:16, or square. Other shapes get black bars.",
    limitations: [...VIDEO_NOTES, "Up to 10 clips at once."],
  }),
  "watermark-video": videoTool({
    inputs: [MP4_IN, OTHER_VIDEO_IN, { label: "Logo: PNG, JPG, WebP, SVG, HEIC", status: "limited", note: "Read by the browser's image decoder (HEIC by a local decoder). A text mark was verified; a logo file was not run through this page." }],
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps.",
    audio: "Kept. A video with no sound stays silent.",
    transparency: "A PNG logo keeps its see-through areas over the video.",
    limitations: [...VIDEO_NOTES, "The mark is burned in and cannot be removed afterwards."],
  }),
  "add-audio-to-video": videoTool({
    inputs: [MP4_IN, OTHER_VIDEO_IN, { label: "Sound: MP3, WAV, M4A", status: "supported", note: "MP3 verified." }],
    outputs: [MP4_OUT],
    codecs: "H.264 video with AAC audio at 160 kbps.",
    audio: "Replaced or mixed with the original, at the volume you set (0 to 200 percent). The result is as long as the video.",
    limitations: [...VIDEO_NOTES, "Cutmoor does not check whether you have the right to use the music."],
  }),
  "slideshow-maker": {
    inputs: [
      { label: "JPG pictures", status: "supported" },
      { label: "PNG, WebP, GIF, BMP, SVG", status: "limited", note: "Read by the browser's image decoder, which handles them; not run through this page in this release." },
      { label: "AVIF and HEIC (iPhone)", status: "limited", note: "AVIF depends on the browser. HEIC uses a local decoder. Neither was run through this page." },
    ],
    outputs: [{ label: "MP4 (H.264, 30 fps)", status: "supported" }],
    maxTested: "three 400×300 JPG pictures at 1080p wide with fades",
    resolutions: "1920×1080, 1280×720, 1080×1920, or 1080×1080, by choice.",
    codecs: "H.264 video; AAC audio when music is added.",
    audio: "Optional music, cut to the slideshow length.",
    metadata: "Not copied.",
    limitations: ["Up to 30 pictures. Each is prepared in memory first, so many large photos take longer on a phone.", ...VIDEO_NOTES.slice(1)],
  },
};

// ---- picture tools ------------------------------------------------------------------------------------------

const PICTURE_NOTE_OTHER: FormatEntry = {
  label: "WebP, GIF, BMP, SVG",
  status: "limited",
  note: "Read by the same browser decoder as Convert image, which is verified with these formats. Not run through this tool in this release.",
};
const PICTURE_NOTE_MODERN: FormatEntry = {
  label: "AVIF and HEIC (iPhone)",
  status: "limited",
  note: "AVIF depends on the browser. HEIC uses a local decoder. Neither was run through this tool in this release.",
};
const PICTURE_INPUTS: FormatEntry[] = [
  { label: "JPG", status: "supported" },
  { label: "PNG", status: "supported", note: "Transparency is read." },
  PICTURE_NOTE_OTHER,
  PICTURE_NOTE_MODERN,
];
const PICTURE_OUTPUTS: FormatEntry[] = [
  { label: "JPG", status: "supported" },
  { label: "PNG", status: "supported", note: "Lossless. Keeps transparency." },
  { label: "WebP", status: "limited", note: "Works in Chrome. Safari cannot encode WebP from a canvas, so the option is hidden there." },
];
const PICTURE_LIMITS = [
  "Output is capped at 16,777,216 pixels and 16,384 px per edge; larger pictures are scaled down.",
  "Everything runs in memory, so very large photos can fail on phones.",
];
const PICTURE_MAX = "400×300 generated test pictures; the canvas limits are enforced in code";

function pictureTool(extra: Partial<ToolCompat>): ToolCompat {
  return {
    inputs: PICTURE_INPUTS,
    outputs: PICTURE_OUTPUTS,
    maxTested: PICTURE_MAX,
    resolutions: "Up to 16,777,216 pixels total and 16,384 px on the longest edge.",
    codecs: "Encoded by your browser's own JPEG, PNG, and WebP encoders.",
    transparency: "PNG and WebP keep transparency. JPG has none, so transparent areas are filled with the colour you choose.",
    metadata: "Re-drawing a picture through the canvas drops hidden data such as GPS and camera model.",
    limitations: PICTURE_LIMITS,
    ...extra,
  };
}

export const MORE_IMAGE_COMPAT: Record<string, ToolCompat> = {
  "crop-image": pictureTool({
    resolutions: "The crop is cut from the full-size picture. The output is exactly the size of the box.",
    transparency: "A circle crop is saved with transparent corners in PNG or WebP. JPG fills them with the colour you choose.",
  }),
  "rotate-image": pictureTool({
    resolutions: "A quarter turn swaps width and height. A tilt makes the picture larger so the corners fit, up to the canvas limits.",
    limitations: [...PICTURE_LIMITS, "A tilt re-samples the pixels once; a quarter turn does not change them."],
  }),
  "remove-photo-metadata": {
    inputs: [
      { label: "JPG", status: "supported", note: "Cleaned without re-encoding." },
      { label: "PNG", status: "supported", note: "Cleaned without re-encoding." },
      { label: "WebP", status: "supported", note: "Cleaned without re-encoding." },
      { label: "GIF, BMP, SVG, AVIF, HEIC", status: "limited", note: "Cannot be cleaned in place; the picture is redrawn as a JPG or PNG, which drops the hidden data. Not run through this tool in this release." },
    ],
    outputs: [
      { label: "Same format (JPG, PNG, WebP)", status: "supported", note: "The picture's pixels are unchanged." },
      { label: "JPG or PNG (redrawn)", status: "limited", note: "Used for formats that cannot be cleaned in place." },
    ],
    maxTested: "generated JPG, PNG, and WebP files carrying EXIF, GPS, XMP, and comment data",
    resolutions: "Not changed for JPG, PNG, and WebP.",
    codecs: "No re-encoding for JPG, PNG, and WebP: only metadata blocks are removed.",
    metadata: "Camera and phone, date, serial numbers, GPS location, author, XMP, IPTC, comments, PNG text and time chunks. A colour profile is kept; for JPG the orientation number is kept so the photo stays upright.",
    limitations: ["Hidden data that is not in a standard block, or that is embedded in the picture itself (such as a visible date stamp), is not found.", ...PICTURE_LIMITS.slice(1)],
  },
  "blur-image": pictureTool({
    limitations: [
      ...PICTURE_LIMITS,
      "Blur and pixelation hide detail but are not as final as a black box. Use Black box for anything that must never be read.",
      "Areas are marked by hand; nothing is detected automatically.",
    ],
  }),
  "watermark-image": pictureTool({
    inputs: [...PICTURE_INPUTS, { label: "Logo: PNG, JPG, WebP, SVG, HEIC", status: "limited", note: "A text mark was verified; a logo file was not run through this page." }],
    limitations: [...PICTURE_LIMITS, "The mark is drawn into the picture and cannot be removed afterwards."],
  }),
  "webp-to-jpg": pictureTool({
    inputs: [{ label: "WebP", status: "supported" }],
    outputs: [{ label: "JPG", status: "supported" }, { label: "PNG", status: "supported", note: "Lossless. Keeps transparency." }],
  }),
  "png-to-jpg": pictureTool({
    inputs: [{ label: "PNG", status: "supported", note: "Transparency is read." }],
    outputs: [{ label: "JPG", status: "supported" }, { label: "WebP", status: "limited", note: "Works in Chrome. Safari cannot encode WebP from a canvas." }],
  }),
  "jpg-to-png": pictureTool({
    inputs: [{ label: "JPG", status: "supported" }],
    outputs: [{ label: "PNG", status: "supported", note: "Lossless. Does not restore detail the JPG already lost." }, { label: "WebP", status: "limited", note: "Works in Chrome. Safari cannot encode WebP from a canvas." }],
  }),
  "svg-to-png": pictureTool({
    inputs: [{ label: "SVG", status: "supported", note: "Drawn at the size the file declares." }],
    outputs: [{ label: "PNG", status: "supported", note: "Keeps transparency." }, { label: "JPG", status: "supported" }],
    limitations: ["External fonts and linked images inside an SVG are not fetched, so they may not appear.", ...PICTURE_LIMITS],
  }),
  "avif-to-jpg": pictureTool({
    inputs: [{ label: "AVIF", status: "supported", note: "Needs a browser with an AVIF decoder. Verified in Chrome on desktop with a real AVIF file." }],
    outputs: [{ label: "JPG", status: "supported" }, { label: "PNG", status: "supported", note: "Lossless. Keeps transparency." }],
    limitations: ["Needs a browser that can show AVIF, such as current Chrome, Edge, or Firefox.", ...PICTURE_LIMITS],
  }),
};

export const MORE_IMAGE_SLUGS = new Set(Object.keys(MORE_IMAGE_COMPAT));

// ---- neural-network picture tools ---------------------------------------------------------------------------

export const MODEL_TOOLS_COMPAT: Record<string, ToolCompat> = {
  "remove-background": pictureTool({
    inputs: [
      { label: "JPG", status: "supported" },
      { label: "PNG", status: "supported", note: "Existing transparency is multiplied with the new cut-out." },
      { label: "WebP, GIF, BMP, AVIF, HEIC", status: "limited", note: "Read by the browser's decoders. Not run through this tool in this release." },
    ],
    outputs: [
      { label: "PNG (transparent)", status: "supported" },
      { label: "WebP (transparent)", status: "limited", note: "Works in Chrome. Safari cannot encode WebP from a canvas." },
      { label: "JPG (solid background)", status: "supported" },
    ],
    maxTested: "a generated 400×300 picture with a clear subject, in desktop Chrome with WebGPU",
    resolutions: "The cut-out is made at the picture's own size, up to the canvas limits. The model itself looks at a 1024 by 1024 version.",
    codecs: "ISNet general-use, half-precision ONNX, run with ONNX Runtime Web (WebGPU, or the CPU build).",
    limitations: [
      ...PICTURE_LIMITS,
      "Downloads an 88 MB model and a 29 MB engine once, after you agree.",
      "Fine hair, glass, smoke, and subjects that blend into the background can need a touch-up.",
      "Tested in desktop Chrome only.",
    ],
  }),
  "upscale-image": pictureTool({
    inputs: [
      { label: "JPG", status: "supported" },
      { label: "PNG", status: "supported", note: "Transparency is enlarged with ordinary smoothing." },
      { label: "WebP, GIF, BMP, AVIF, HEIC", status: "limited", note: "Read by the browser's decoders. Not run through this tool in this release." },
    ],
    outputs: PICTURE_OUTPUTS,
    maxTested: "a generated 400×300 picture enlarged 2x, in desktop Chrome with WebGPU",
    resolutions: "2x or 4x. The result must fit a browser canvas (16,777,216 pixels, 16,384 px per side), so 4x takes pictures up to about 1 megapixel and 2x up to about 4.",
    codecs: "Real-ESRGAN general x4 v3, ONNX, run in 128-pixel pieces with ONNX Runtime Web (WebGPU, or the CPU build).",
    limitations: [
      ...PICTURE_LIMITS,
      "Downloads a 5 MB model and a 29 MB engine once, after you agree.",
      "The result adds believable detail; it cannot recover detail that was never in the picture, and small text or faces can look slightly changed.",
      "Tested in desktop Chrome only.",
    ],
  }),
};
