/**
 * The sample clip behind the homepage demo. It is a real video file that runs
 * through the real encoder; nothing about the demo is prerecorded.
 *
 * It is an animated scene drawn in code (a sunset over a mountain lake, with a
 * synthesized soundtrack, made by scripts/make-sample.mjs), not camera footage,
 * and the page says so. The byte size is checked against the file on
 * disk by a unit test, so these facts cannot drift from the file.
 */
export const SAMPLE_CLIP = {
  path: "samples/sample-clip.mp4",
  fileName: "sample-clip.mp4",
  bytes: 3_368_377,
  width: 1280,
  height: 720,
  durationSeconds: 6,
  framesPerSecond: 24,
  format: "MP4",
  codec: "H.264",
  hasAudio: true,
  description: "A 6-second animated sunset over a mountain lake with a synthesized soundtrack, drawn in code and encoded with FFmpeg. An illustration, not camera footage.",
} as const;

/** A still image for the image demo: one frame cut from the sample clip. */
export const SAMPLE_PHOTO = {
  path: "samples/sample-photo.jpg",
  fileName: "sample-photo.jpg",
  bytes: 97_924,
  width: 1280,
  height: 720,
  format: "JPG",
  description: "A single frame from the sample clip, saved as a JPG. Not a camera photo.",
} as const;

export function sampleClipUrl(base: string): string {
  return `${base}${SAMPLE_CLIP.path}`;
}

export function samplePhotoUrl(base: string): string {
  return `${base}${SAMPLE_PHOTO.path}`;
}
