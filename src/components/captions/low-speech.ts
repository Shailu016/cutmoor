import type { PipelineStats } from "../../lib/captioning/contracts";

/**
 * When a long file produced almost no text, say so and say why. Songs, rap and speech under loud music are the usual
 * cause: the speech model cannot hear words through them, and the voice detector finds little speech. A short note beats
 * a near-empty editor with no explanation.
 */
export interface LowSpeechNote {
  title: string;
  detail: string;
}

/** Shortest file (seconds) worth judging; a 5-second clip with 3 words is normal. */
const MIN_AUDIO_SECONDS = 20;
/** Fewer words per minute of audio than this is very little text for a recording that is meant to contain speech. */
const FEW_WORDS_PER_MINUTE = 8;
/** Less than this share of the file found as speech means mostly music, noise or silence. */
const LOW_SPEECH_SHARE = 0.2;

export function describeLowSpeech(wordCount: number, stats: Pick<PipelineStats, "audioSeconds" | "speechSeconds">, onFastModel: boolean): LowSpeechNote | null {
  const { audioSeconds, speechSeconds } = stats;
  if (!Number.isFinite(audioSeconds) || audioSeconds < MIN_AUDIO_SECONDS) return null;
  const wordsPerMinute = (wordCount / audioSeconds) * 60;
  const speechShare = Number.isFinite(speechSeconds) ? speechSeconds / audioSeconds : 1;
  if (wordsPerMinute >= FEW_WORDS_PER_MINUTE && speechShare >= LOW_SPEECH_SHARE) return null;
  return {
    title: wordCount === 0 ? "No speech was recognised" : "Very little speech was recognised",
    detail: `Only ${wordCount} ${wordCount === 1 ? "word" : "words"} were found in ${Math.round(audioSeconds)} seconds of audio. Songs, rap and speech over loud music are hard for this tool, because it is built for talking. There was little singing or speech it could make out. ${onFastModel ? "High accuracy hears more, but music will still limit it. " : ""}A recording with clear speech works best, or you can add the missing words yourself in the editor.`,
  };
}
