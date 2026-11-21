import type { CaptionEvent } from "../types";

/** Enough to cover every script a caption can use, and still small enough to hand to the font loader in one call. */
const MAX_SAMPLE_CHARS = 600;

/**
 * The characters of the captions about to be drawn, for the font loader.
 *
 * Fonts from the bundled packages are split by script: one file for plain Latin, another for accented
 * Latin, another for Devanagari, and a browser fetches a file only when asked to draw a character it
 * covers. Asking for "Aa" alone loads the Latin file and nothing else, so an export of a caption with an
 * accent or a Hindi word would measure and draw it in a fallback font. Asking with the real text loads
 * every file the export needs, before the first frame.
 */
export function captionSampleText(events: readonly CaptionEvent[]): string {
  const seen = new Set<string>(["A", "a"]);
  outer: for (const event of events) {
    // A malformed event must never stop an export, so a missing `lines` just contributes nothing.
    for (const line of event.lines ?? []) {
      for (const word of line) {
        for (const character of word.text) {
          if (/\s/.test(character)) continue;
          seen.add(character);
          if (seen.size >= MAX_SAMPLE_CHARS) break outer;
        }
      }
    }
  }
  return [...seen].join("");
}
