/**
 * The sample clip behind the homepage demo. It is a real video file that runs
 * through the real encoder; nothing about the demo is prerecorded.
 *
 * It is a generated test clip (a Mandelbrot zoom made with FFmpeg), not camera
 * footage, and the page says so. The byte size is checked against the file on
 * disk by a unit test, so these facts cannot drift from the file.
 */
export const SAMPLE_CLIP = {
  path: "samples/sample-clip.mp4",
  fileName: "sample-clip.mp4",
  bytes: 3_779_467,
  width: 1280,
  height: 720,
  durationSeconds: 6,
  framesPerSecond: 24,
  format: "MP4",
  codec: "H.264",
  hasAudio: false,
  description: "A 6-second Mandelbrot zoom generated with FFmpeg. A test clip, not camera footage.",
} as const;

export const SAMPLE_TARGETS_MB = [1, 2] as const;

export function sampleClipUrl(base: string): string {
  return `${base}${SAMPLE_CLIP.path}`;
}
