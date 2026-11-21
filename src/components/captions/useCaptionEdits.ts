import { useCallback, useMemo, useState } from "react";
import { layoutCaptions } from "../../lib/captioning/layout";
import { applyScript, hasDevanagari as textHasDevanagari, type CaptionScript } from "../../lib/captioning/translit";
import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from "./history";
import type { EditResult } from "./word-edit";

/** The choices the words-per-caption control offers. `undefined` is "automatic". */
const MIN_WORDS_PER_CAPTION = 1;
const MAX_WORDS_PER_CAPTION = 5;

interface State {
  /** Identifies which transcript the history belongs to; a new transcript starts a fresh history. */
  source: Word[] | null;
  history: History<Word[]>;
  selected: number;
  /**
   * Layout choices, not edits: changing them must not touch the undo history. A new transcript
   * starts at the defaults (automatic words, the words as recognised).
   */
  wordsPerCaption: number | undefined;
  script: CaptionScript;
}

function fresh(source: Word[] | null): State {
  return { source, history: createHistory(source ?? []), selected: -1, wordsPerCaption: undefined, script: "original" };
}

export interface CaptionEdits {
  words: Word[];
  /** The caption blocks laid out from the current words. Exports and the preview both use these. */
  events: CaptionEvent[];
  selected: number;
  select: (index: number) => void;
  /** Runs one edit. Returns what changed, or null when the edit was refused (nothing changed). */
  apply: (operation: (words: Word[]) => EditResult | null) => EditResult | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** True once any edit has been made and not undone. */
  edited: boolean;
  /** Hard cap on words in one caption, or undefined for the automatic layout. Not an edit. */
  wordsPerCaption: number | undefined;
  setWordsPerCaption: (value: number | undefined) => void;
  /** "original" keeps the recognised spelling; "roman" transliterates Devanagari captions. Not an edit. */
  script: CaptionScript;
  setScript: (script: CaptionScript) => void;
  /** True when any word has Devanagari, so the UI can offer the Hinglish option only then. */
  hasDevanagari: boolean;
}

/**
 * The transcript the visitor edits: the pipeline's words, plus an undo history. When a new
 * result arrives (a new file, a re-run) it starts over, so one file's edits never leak into the next.
 *
 * The layout choices (words per caption, script) live here next to the words because they are
 * recalculated client-side: changing either re-lays out the same timed words instantly, with no
 * model rerun. They are kept apart from the history, so they never create an undo step.
 */
export function useCaptionEdits(source: Word[] | null): CaptionEdits {
  const [state, setState] = useState<State>(() => fresh(source));

  // A new transcript replaces the old state during render (React's pattern for state that depends on a prop).
  let current = state;
  if (state.source !== source) {
    current = fresh(source);
    setState(current);
  }

  const words = current.history.present;
  const events = useMemo(() => {
    // `applyScript` returns new Word objects, so the layout below never mutates the editable list.
    const scripted = applyScript(words, current.script);
    const options = current.wordsPerCaption === undefined ? undefined : { maxWordsPerCaption: current.wordsPerCaption };
    return layoutCaptions(scripted, options);
  }, [words, current.script, current.wordsPerCaption]);
  const hasDevanagari = useMemo(() => words.some((word) => textHasDevanagari(word.text)), [words]);

  const select = useCallback((index: number) => {
    setState((s) => ({ ...s, selected: Math.max(-1, Math.min(index, s.history.present.length - 1)) }));
  }, []);

  const setWordsPerCaption = useCallback((value: number | undefined) => {
    const normalized =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(MAX_WORDS_PER_CAPTION, Math.max(MIN_WORDS_PER_CAPTION, Math.floor(value)))
        : undefined;
    setState((s) => ({ ...s, wordsPerCaption: normalized }));
  }, []);

  const setScript = useCallback((script: CaptionScript) => {
    setState((s) => ({ ...s, script }));
  }, []);

  const apply = useCallback(
    (operation: (words: Word[]) => EditResult | null): EditResult | null => {
      const result = operation(current.history.present);
      if (!result) return null;
      setState((s) => ({ ...s, history: commit(s.history, result.words), selected: result.selected }));
      return result;
    },
    [current.history.present],
  );

  const clampSelection = (history: History<Word[]>, selected: number) => Math.min(selected, history.present.length - 1);

  const doUndo = useCallback(() => setState((s) => ({ ...s, history: undo(s.history), selected: clampSelection(undo(s.history), s.selected) })), []);
  const doRedo = useCallback(() => setState((s) => ({ ...s, history: redo(s.history), selected: clampSelection(redo(s.history), s.selected) })), []);

  return {
    words,
    events,
    selected: Math.min(current.selected, words.length - 1),
    select,
    apply,
    undo: doUndo,
    redo: doRedo,
    canUndo: canUndo(current.history),
    canRedo: canRedo(current.history),
    edited: current.history.past.length > 0,
    wordsPerCaption: current.wordsPerCaption,
    setWordsPerCaption,
    script: current.script,
    setScript,
    hasDevanagari,
  };
}
