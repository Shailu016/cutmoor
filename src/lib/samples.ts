/**
 * The sample clip behind the homepage demo. It is a real video file that runs
 * through the real encoder; nothing about the demo is prerecorded.
 *
 * It is a generated test clip (a Mandelbrot zoom with a synthesized chord, made
 * with FFmpeg), not camera footage, and the page says so. The byte size is checked against the file on
 * disk by a unit test, so these facts cannot drift from the file.
 */
export const SAMPLE_CLIP = {
  path: "samples/sample-clip.mp4",
  fileName: "sample-clip.mp4",
  bytes: 3_880_217,
  width: 1280,
  height: 720,
  durationSeconds: 6,
  framesPerSecond: 24,
  format: "MP4",
  codec: "H.264",
  hasAudio: true,
  description: "A 6-second Mandelbrot zoom with a synthesized chord, generated with FFmpeg. A test clip, not camera footage.",
} as const;

/** A still image for the image demo: one frame cut from the sample clip. */
export const SAMPLE_PHOTO = {
  path: "samples/sample-photo.jpg",
  fileName: "sample-photo.jpg",
  bytes: 124_190,
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
