import { useCallback, useMemo, useState } from "react";
import { layoutCaptions } from "../../lib/captioning/layout";
import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from "./history";
import type { EditResult } from "./word-edit";

interface State {
  /** Identifies which transcript the history belongs to; a new transcript starts a fresh history. */
  source: Word[] | null;
  history: History<Word[]>;
  selected: number;
}

function fresh(source: Word[] | null): State {
  return { source, history: createHistory(source ?? []), selected: -1 };
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
}

/**
 * The transcript the visitor edits: the pipeline's words, plus an undo history. When a new
 * result arrives (a new file, a re-run) it starts over, so one file's edits never leak into the next.
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
  const events = useMemo(() => layoutCaptions(words), [words]);

  const select = useCallback((index: number) => {
    setState((s) => ({ ...s, selected: Math.max(-1, Math.min(index, s.history.present.length - 1)) }));
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
  };
}
