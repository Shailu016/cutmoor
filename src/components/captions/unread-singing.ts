import type { CaptionResult } from "../../lib/captioning/contracts";

/**
 * Track 3 of R5: when a song window (singing detected) ends with no words, or with much less text than the
 * detector heard, offer the one honest way to complete it: the visitor's own lyrics. This is a nudge, not an
 * error, and it never asks the visitor to change a setting.
 */
export interface UnreadSingingNote {
  message: string;
  actionLabel: string;
}

/** Shorter than this is normal for a clip with an instrumental intro; do not judge it. */
const MIN_SPEECH_SECONDS = 8;
/** Voiced time with no words above this share means more than half the singing was not read. */
const MIN_UNCOVERED_SHARE = 0.4;

export const UNREAD_SINGING_MESSAGE =
  "Some singing could not be read. If you have the lyrics, paste them in the lyrics box and Cutmoor will fill them in.";
export const UNREAD_SINGING_ACTION = "Use the lyrics box";

/** Milliseconds of detected speech that ended up with no word (intervals are global, may overlap). */
function uncoveredMs(result: Pick<CaptionResult, "uncoveredSpeech">): number {
  return result.uncoveredSpeech.reduce((sum, gap) => {
    const length = gap.endMs - gap.startMs;
    return Number.isFinite(length) && length > 0 ? sum + length : sum;
  }, 0);
}

/**
 * Returns the nudge when the result shows singing that was not read, or null when there is nothing to say.
 * Callers hide it for the test double: sample captions say nothing about the visitor's audio.
 */
export function describeUnreadSinging(result: Pick<CaptionResult, "words" | "uncoveredSpeech" | "stats">): UnreadSingingNote | null {
  const speechSeconds = result.stats.speechSeconds;
  if (!Number.isFinite(speechSeconds) || speechSeconds < MIN_SPEECH_SECONDS) return null;
  // The visitor already pasted words. Whether any line was placed or not, the panel's "Your words: …" block is the
  // honest answer; asking them to paste again (or contradicting "not found") is worse than saying nothing.
  if (result.stats.lyrics) return null;

  const heardNothing = result.words.length === 0;
  const uncoveredShare = uncoveredMs(result) / 1000 / speechSeconds;
  if (!heardNothing && !(Number.isFinite(uncoveredShare) && uncoveredShare >= MIN_UNCOVERED_SHARE)) return null;

  return { message: UNREAD_SINGING_MESSAGE, actionLabel: UNREAD_SINGING_ACTION };
}
