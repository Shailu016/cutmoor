/**
 * The encoder keeps going after this error, failing on every remaining frame, so a long video would look busy for
 * hours and produce nothing. It appears only while a stream is really being decoded: reading an AV1 file also logs AV1
 * errors, but those are harmless for jobs that never decode the picture, such as extracting the audio.
 */
export function isUnsupportedDecodeError(line: string): boolean {
  return /Error while decoding stream #\d+:\d+: Function not implemented/i.test(line);
}

export function unsupportedVideoMessage(logLines: string[]): string {
  const format = logLines.some((line) => /\[av1\b/i.test(line)) ? "AV1 video" : "this video format";
  return `Cutmoor cannot read ${format} yet, so the job was stopped. Try a copy of the video in H.264 MP4.`;
}

const OUT_OF_MEMORY = /out of memory|cannot allocate|memory access out of bounds|array buffer allocation|allocation failed|\boom\b|quota.*exceeded/i;
const COULD_NOT_LOAD = /failed to fetch|dynamically imported module|importing a module script failed|load failed/i;
const UNREADABLE_FILE =/file could not be read|notreadable|requested file could not be read/i;

/** What to show for a failed job. Low-level browser and encoder errors become a sentence a person can act on. */
export function describeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error.trim() : "";
  if (OUT_OF_MEMORY.test(message)) {
    return "This device ran out of memory or storage for this video. Close other tabs, free some space, or try a shorter video or a computer.";
  }
  if (COULD_NOT_LOAD.test(message)) {
    return "Cutmoor could not load part of the video tool. Check your connection, reload the page and try again.";
  }
  if (UNREADABLE_FILE.test(message)) {
    return "The browser could not read this file. Choose it again, and if it still fails, copy it to your device first.";
  }
  return message || "The encoder failed. Try a smaller file or a different format.";
}

/**
 * Turns the encoder's own log into a message a person can act on. FFmpeg
 * exits with a bare code, so the reason has to be read from its log lines.
 * Returns null when the log has no recognisable cause.
 */
export function explainFailure(logLines: string[]): string | null {
  const log = logLines.join("\n");
  // Extracting audio (-vn) from a video that has no sound leaves nothing to write.
  if (/Output file #?\d* ?does not contain any stream/i.test(log)) {
    return "This file has no audio track, so there is nothing to extract. Choose a video that has sound.";
  }
  if (/Invalid data found when processing input/i.test(log)) {
    return "The encoder could not read this file. It may be damaged, or not a video or audio file.";
  }
  if (/Unknown encoder|Encoder .* not found/i.test(log)) {
    return "This browser build of the encoder does not include the codec needed for that format.";
  }
  if (OUT_OF_MEMORY.test(log)) return describeJobError(log);
  return null;
}
