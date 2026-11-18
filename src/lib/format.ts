export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Accepts "83", "1:23", "01:02:03", or "1:02:03.5". Returns seconds. */
export function parseTimecode(input: string): number {
  const clean = input.trim();
  if (!clean) return 0;
  if (!/^\d+(\.\d+)?(:[0-5]?\d(\.\d+)?){0,2}$/.test(clean)) return Number.NaN;
  const parts = clean.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function extensionOf(name: string): string {
  const match = name.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "mp4";
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "clip";
}

export function mimeForName(name: string): string {
  const ext = extensionOf(name);
  const map: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    srt: "text/plain",
    vtt: "text/vtt",
  };
  return map[ext] ?? "application/octet-stream";
}

const MIN_VIDEO_KBPS = 120;

/**
 * Video bitrate needed to land near a target file size. Audio is reserved first
 * because losing audio is more noticeable than a slightly softer image.
 */
export function targetVideoKbps(targetMb: number, durationSeconds: number, audioKbps = 128): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const totalKbps = (targetMb * 8 * 1024) / durationSeconds;
  return Math.max(MIN_VIDEO_KBPS, Math.round(totalKbps - audioKbps));
}

/** The smallest result a target can reach for this length, at the lowest video bitrate plus the audio. */
export function smallestTargetMb(durationSeconds: number, audioKbps = 128): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.ceil(((MIN_VIDEO_KBPS + audioKbps) * durationSeconds) / (8 * 1024));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTimecodeInput(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  return formatDuration(seconds);
}
