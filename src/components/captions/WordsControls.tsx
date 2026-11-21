import type { CaptionScript } from "../../lib/captioning/translit";

export interface WordsControlsProps {
  /** Hard cap on words in one caption; undefined means the automatic layout. */
  wordsPerCaption: number | undefined;
  onWordsPerCaption: (value: number | undefined) => void;
  /** "original" keeps Devanagari; "roman" shows the local Hinglish transliteration. */
  script: CaptionScript;
  onScript: (script: CaptionScript) => void;
  /** True when the transcript has Devanagari, so the Hinglish option can do something. */
  hasDevanagari: boolean;
}

/** The fixed choices: undefined is automatic, then the five caps the product offers. */
const WORD_CHOICES: readonly (number | undefined)[] = [undefined, 1, 2, 3, 4, 5];

/**
 * Words-per-caption and script controls for the caption editor. Presentational only: the hook
 * owns the values (see useCaptionEdits) and re-lays out the same timed words when either changes,
 * so nothing here reruns the speech model or the network.
 *
 * The script toggle appears only when the text actually contains Devanagari. A transcript that is
 * already Roman has nothing to transliterate, and showing an Original / Hinglish choice there
 * would suggest a difference that does not exist.
 */
export function WordsControls({ wordsPerCaption, onWordsPerCaption, script, onScript, hasDevanagari }: WordsControlsProps) {
  return (
    <div className="cap-words">
      <p className="mono-label">Words per caption</p>
      <div className="chips" role="group" aria-label="Words per caption">
        {WORD_CHOICES.map((choice) => {
          const active = wordsPerCaption === choice;
          return (
            <button
              key={choice === undefined ? "auto" : String(choice)}
              type="button"
              className={active ? "chip active" : "chip"}
              aria-pressed={active}
              onClick={() => onWordsPerCaption(choice)}
            >
              {choice === undefined ? "Auto" : String(choice)}
            </button>
          );
        })}
      </div>

      {hasDevanagari && (
        <>
          <p className="mono-label">Caption script</p>
          <div className="chips" role="group" aria-label="Caption script">
            <button
              type="button"
              className={script === "original" ? "chip active" : "chip"}
              aria-pressed={script === "original"}
              onClick={() => onScript("original")}
            >
              Original
            </button>
            <button
              type="button"
              className={script === "roman" ? "chip active" : "chip"}
              aria-pressed={script === "roman"}
              onClick={() => onScript("roman")}
            >
              Hinglish
            </button>
          </div>
        </>
      )}
    </div>
  );
}
