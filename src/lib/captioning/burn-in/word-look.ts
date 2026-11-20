import type { CaptionStyle } from "../contracts";

/**
 * How one caption word looks at a moment: shared by the live preview (HTML) and the MP4 burn-in
 * (canvas), so both draw the same thing. Pure, so it is tested without a browser.
 */

export type WordState = "spoken" | "active" | "upcoming";

/** Quotes, brackets and sentence punctuation around a token, which do not change what it is. */
const EDGE_PUNCTUATION = /^[\s"'“”‘’«»([{¿¡]+|[\s"'“”‘’«»)\]}.,!?;:…]+$/gu;

/**
 * A number the viewer should notice: an amount, a price, a percentage, a year, a count. "5,000",
 * "$5,000", "₹15,00,000", "40%", "1991", "10k", "3.5", "1st", "1990s", "२०२४". Not words that merely
 * hold a digit, like "mp4", "covid19" or "4K"-style product names with letters before the digits.
 */
export function isNumberToken(text: string): boolean {
  const core = text.replace(EDGE_PUNCTUATION, "");
  if (core.length === 0) return false;
  return /^[+\-−]?[\p{Sc}]?[+\-−]?\p{Nd}[\p{Nd},.]*(?:%|[kKmMbB]|st|nd|rd|th|s|x|cr|L)?[\p{Sc}]?$/u.test(core);
}

/** The text drawn for a word: trimmed, and in capitals when the style asks for it. */
export function displayText(text: string, style: Pick<CaptionStyle, "uppercase">): string {
  const trimmed = text.trim();
  return style.uppercase ? trimmed.toLocaleUpperCase() : trimmed;
}

/** Whether a word (by position in its caption) has been said, is being said, or is still to come. */
export function wordState(index: number, active: number): WordState {
  if (index === active) return "active";
  return index < active ? "spoken" : "upcoming";
}

/** Whether the word is drawn at all. A "spoken" reveal hides the words still to come. */
export function isWordVisible(state: WordState, style: Pick<CaptionStyle, "reveal">): boolean {
  return !(style.reveal === "spoken" && state === "upcoming");
}

/**
 * Fill colour of a word. The spoken word wins, then a highlighted number, then the spoken or
 * upcoming colour. With a box behind the spoken word, `activeColor` is the text on that box.
 */
export function wordColor(
  text: string,
  state: WordState,
  style: Pick<CaptionStyle, "textColor" | "activeColor" | "upcomingColor" | "numberColor" | "highlightNumbers">,
): string {
  if (state === "active") return style.activeColor;
  if (style.highlightNumbers && isNumberToken(text)) return style.numberColor ?? style.activeColor;
  if (state === "upcoming") return style.upcomingColor ?? style.textColor;
  return style.textColor;
}
