/** "1:05" for a time in milliseconds; "1:05.250" when `precise`. Hours are folded in ("1:02:05") for long files. */
export function formatClock(ms: number, precise = false): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const head = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : String(minutes);
  const base = `${head}:${String(seconds).padStart(2, "0")}`;
  return precise ? `${base}.${String(safe % 1000).padStart(3, "0")}` : base;
}

/** A download name for the captions of `fileName`: "holiday.mp4" becomes "holiday-captions.srt". */
export function captionFileName(fileName: string, extension: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[\/:*?"<>|]+/g, "-").trim() || "video";
  return `${stem}-captions.${extension}`;
}
