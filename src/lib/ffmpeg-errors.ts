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
  return null;
}
