/**
 * Subtitle conversion. These functions are deliberately small and pure so the
 * subtitle tool can run without ffmpeg, and so the same code can be tested.
 */

const TIMECODE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/g;

function shiftTimecode(match: string, offsetSeconds: number): string {
  const parts = match.split(/[:,.]/).map(Number);
  const total = parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000 + offsetSeconds;
  const safe = Math.max(0, total);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function srtToVtt(input: string): string {
  const body = input
    .replace(/\r\n/g, "\n")
    .replace(/^\uFEFF/, "")
    .replace(/^\d+\s*$/gm, "")
    .replace(TIMECODE, (match) => match.replace(",", "."))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export function vttToSrt(input: string): string {
  const withoutHeader = input
    .replace(/\r\n/g, "\n")
    .replace(/^\uFEFF/, "")
    .replace(/^WEBVTT.*$/m, "")
    .replace(/^NOTE[\s\S]*?(?=\n\n|$)/gm, "")
    .trim();

  const blocks = withoutHeader.split(/\n{2,}/).filter(Boolean);
  const cues: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex === -1) continue;
    const timing = lines[timeIndex]
      .replace(/\./g, ",")
      .replace(/\s+(align|position|line|size|region|vertical):\S+/g, "")
      .trim();
    const text = lines.slice(timeIndex + 1).join("\n");
    if (!text) continue;
    cues.push(`${cues.length + 1}\n${timing}\n${text}`);
  }

  return `${cues.join("\n\n")}\n`;
}

export function shiftSubtitles(input: string, offsetSeconds: number): string {
  const normalized = input.replace(/\r\n/g, "\n");
  return normalized.replace(TIMECODE, (match) => shiftTimecode(match, offsetSeconds));
}

export function looksLikeVtt(input: string): boolean {
  return /^\uFEFF?WEBVTT/.test(input.trimStart());
}

export function detectSubtitleFormat(input: string): "vtt" | "srt" {
  return looksLikeVtt(input) ? "vtt" : "srt";
}
