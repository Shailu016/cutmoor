/**
 * What the encoder reports about a file, read from its own log. FFmpeg prints the streams when it opens an
 * input, even when no output is given, so a probe costs one header read and needs no extra library.
 */
export interface MediaInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  /** Seconds, or 0 when the log has no duration (some streams). */
  duration: number;
  /** Frames per second of the first video stream, or 0. */
  fps: number;
  width: number;
  height: number;
}

export const EMPTY_INFO: MediaInfo = { hasVideo: false, hasAudio: false, duration: 0, fps: 0, width: 0, height: 0 };

function durationSeconds(text: string): number {
  const match = text.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Parses the log lines FFmpeg prints for `-i file` (stream list, duration). Pure, so it is unit tested. */
export function parseMediaInfo(lines: readonly string[]): MediaInfo {
  const info: MediaInfo = { ...EMPTY_INFO };
  for (const line of lines) {
    if (!info.duration) info.duration = durationSeconds(line);
    if (/Stream #\d+:\d+.*: Audio:/.test(line)) info.hasAudio = true;
    if (/Stream #\d+:\d+.*: Video:/.test(line) && !/attached pic/.test(line) && !info.hasVideo) {
      info.hasVideo = true;
      // "1920x1080" comes after the pixel format; skip hex like 0x31637661 and sample-aspect ratios.
      const size = line.match(/[\s,](\d{2,5})x(\d{2,5})(?=[\s,\[])/);
      if (size) {
        info.width = Number(size[1]);
        info.height = Number(size[2]);
      }
      const rate = line.match(/([\d.]+)\s*fps/);
      if (rate) info.fps = Number(rate[1]);
    }
  }
  return info;
}
