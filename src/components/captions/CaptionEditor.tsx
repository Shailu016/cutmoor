import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeftRight, Play, Plus, Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import type { CaptionEvent, SpeechInterval, Word } from "../../lib/captioning/types";
import type { CaptionEdits } from "./useCaptionEdits";
import { formatClock } from "./time";
import { deleteWord, freeSpansWithin, insertWordAfter, insertWordAt, mergeWithNext, nudgeWord, setWordText, splitWordAt, type EditResult } from "./word-edit";

/** Confidence below this is shown as "uncertain" so the visitor knows where to look first. */
export const UNCERTAIN_BELOW = 0.6;
const STEP_MS = 50;
const FINE_STEP_MS = 10;

interface Props {
  edits: CaptionEdits;
  /** Moves the preview to this time (ms) without playing. */
  onSeek: (timeMs: number) => void;
  /** Index of the word being spoken in the preview, or -1. */
  playingWord: number;
  playing: boolean;
  uncovered: SpeechInterval[];
}

/**
 * The caption editor. Words are shown grouped into the caption blocks that will appear on screen.
 *
 * Keyboard (all of it also works with the mouse or touch):
 *  - Tab goes to the word list (one stop), arrow keys move between words, Up and Down jump a caption.
 *  - Enter or F2 edits the chosen word's text; Enter saves, Escape cancels. Typing a space splits the word.
 *  - Delete removes the word; Alt+Left and Alt+Right move it 50 ms (add Shift for 10 ms).
 *  - Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes.
 *  - A "no words found" stretch is one button that adds an empty caption there and puts the cursor
 *    in the word box, plus a smaller button that only plays the stretch.
 */
export function CaptionEditor({ edits, onSeek, playingWord, playing, uncovered }: Props) {
  const { words, events, selected } = edits;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const [showUncertain, setShowUncertain] = useState(true);
  const [notice, setNotice] = useState("");

  const word: Word | undefined = words[selected];

  // The text box shows the chosen word. It resets whenever the word (or its text) changes underneath it.
  useEffect(() => {
    setDraft(word?.text ?? "");
  }, [word?.text, selected]);

  // Index of the first word of each caption block, so a word's position in the list is known without searching.
  const offsets = useMemo(() => {
    const result: number[] = [];
    let total = 0;
    for (const event of events) {
      result.push(total);
      for (const line of event.lines) total += line.length;
    }
    return result;
  }, [events]);

  // Each uncovered stretch is listed just before the first caption that starts after it (or at the end).
  // Only the still-empty parts are listed: time that already holds a word (typed in by hand, for
  // example) is no longer "no words found".
  const openGaps = useMemo(() => uncovered.flatMap((gap) => freeSpansWithin(words, gap)), [uncovered, words]);
  const gapsBefore = useMemo(() => {
    const placed: SpeechInterval[][] = events.map(() => []);
    const trailing: SpeechInterval[] = [];
    for (const gap of openGaps) {
      const at = events.findIndex((event) => event.startMs > gap.startMs);
      if (at < 0) trailing.push(gap);
      else placed[at].push(gap);
    }
    return { placed, trailing };
  }, [events, openGaps]);

  const focusWord = (index: number) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-word="${index}"]`)?.focus({ preventScroll: false }));
  };

  const choose = (index: number, seek = true) => {
    if (index < 0 || index >= words.length) return;
    edits.select(index);
    if (seek) onSeek(words[index].startMs);
  };

  /** Runs an edit, says what happened for screen readers, and (optionally) keeps focus on the edited word. */
  const run = (operation: (list: Word[]) => EditResult | null, done: string, refocus: "word" | "none" = "word") => {
    const result = edits.apply(operation);
    setNotice(result ? done : "That change is not possible here.");
    if (result && refocus === "word") {
      focusWord(result.selected);
      const moved = result.words[result.selected];
      if (moved) onSeek(moved.startMs);
    }
    return result;
  };

  const commitDraft = () => {
    if (!word || draft === word.text) return;
    run((list) => setWordText(list, selected, draft), draft.trim() ? "Word updated." : "Word deleted.", "none");
  };

  /**
   * One click on a "no words found" stretch: create a pre-timed, still-empty caption and put the
   * cursor in the word box, so the visitor types what they hear without any other step. When the
   * stretch is too short to hold a caption, the old behaviour stays: just play it.
   */
  const addCaptionAt = (gap: SpeechInterval) => {
    const result = run((list) => insertWordAt(list, gap.startMs, gap.endMs, ""), "Caption added. Type the words you hear.", "none");
    if (!result) {
      setNotice("That spot is too short for a new caption. Playing it instead.");
      onSeek(gap.startMs);
      return;
    }
    edits.select(result.selected);
    onSeek(gap.startMs);
    // The word box is focused and its (empty) text selected, so typing replaces nothing and saves on blur or Enter.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (key === "z" || key === "Z")) {
      event.preventDefault();
      if (event.shiftKey) edits.redo();
      else edits.undo();
      return;
    }
    if (mod && (key === "y" || key === "Y")) {
      event.preventDefault();
      edits.redo();
      return;
    }
    // Below here only the word buttons use the keys. A "no words found" button or its Listen
    // button keeps normal Enter/Space activation, and Delete or the arrows do nothing while it has focus.
    const origin = event.target as HTMLElement;
    if (!origin.dataset.word && origin !== event.currentTarget) return;
    if (selected < 0) return;
    if (event.altKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      event.preventDefault();
      const delta = (key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? FINE_STEP_MS : STEP_MS);
      run((list) => nudgeWord(list, selected, "both", delta), "Word moved.", "none");
      return;
    }
    if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault();
      const next = selected + (key === "ArrowRight" ? 1 : -1);
      choose(next);
      focusWord(Math.max(0, Math.min(next, words.length - 1)));
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const block = blockOf(offsets, selected);
      const target = offsets[Math.max(0, Math.min(block + (key === "ArrowDown" ? 1 : -1), offsets.length - 1))] ?? selected;
      choose(target);
      focusWord(target);
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      const target = key === "Home" ? 0 : words.length - 1;
      choose(target);
      focusWord(target);
    } else if (key === "Enter" || key === "F2") {
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      run((list) => deleteWord(list, selected), "Word deleted.");
    }
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      focusWord(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(word?.text ?? "");
      focusWord(selected);
    }
  };

  // While the video plays, keep the spoken word in view (but never steal focus).
  useEffect(() => {
    if (!playing || playingWord < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-word="${playingWord}"]`)?.scrollIntoView({ block: "nearest" });
  }, [playing, playingWord]);

  const range = word ? `${formatClock(word.startMs, true)} to ${formatClock(word.endMs, true)}` : "";
  const step = (event: { shiftKey: boolean }) => (event.shiftKey ? FINE_STEP_MS : STEP_MS);
  const none = !word;
  // An empty caption (made by one click on a "no words found" stretch) is not a word until text is typed into it.
  const emptyCount = words.reduce((total, item) => total + (item.text.trim() ? 0 : 1), 0);
  const typedWords = words.length - emptyCount;
  const wordName = word ? word.text || "empty caption" : "";

  return (
    <div className="cap-editor">
      <div className="cap-editor-bar">
        <div>
          <strong>Edit captions</strong>
          <span className="cap-count">
            {typedWords} {typedWords === 1 ? "word" : "words"} · {events.length} {events.length === 1 ? "caption" : "captions"}
            {emptyCount > 0 && ` · ${emptyCount} to fill in`}
          </span>
        </div>
        <div className="cap-editor-actions">
          <button type="button" className="icon-button" onClick={edits.undo} disabled={!edits.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={edits.redo} disabled={!edits.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <label className="cap-check">
            <input type="checkbox" checked={showUncertain} onChange={(event) => setShowUncertain(event.target.checked)} />
            Mark uncertain words
          </label>
        </div>
      </div>

      <p className="cap-hint" id={hintId}>
        Click a word to edit it. Arrow keys move between words, Enter edits, Delete removes.
        {openGaps.length > 0 && " Spots where speech was heard but no words were found are marked: choose one to add a caption and type what you hear."}
      </p>

      <div className="cap-list" ref={listRef} onKeyDown={onListKey} role="group" aria-label="Caption words" aria-describedby={hintId}>
        {words.length === 0 && <p className="cap-empty">No words left. Undo to bring them back.</p>}
        {events.map((event: CaptionEvent, eventIndex) => {
          let flat = offsets[eventIndex];
          const gaps = gapsBefore.placed[eventIndex];
          return (
            <div key={event.index} className="cap-row">
              {gaps.map((gap) => (
                <GapNotice key={gap.startMs} gap={gap} onAdd={() => addCaptionAt(gap)} onListen={() => onSeek(gap.startMs)} />
              ))}
              <button type="button" className="cap-time" onClick={() => onSeek(event.startMs)} tabIndex={-1} aria-label={`Play from ${formatClock(event.startMs)}`}>
                {formatClock(event.startMs)}
              </button>
              <div className="cap-words">
                {event.lines.map((line, lineIndex) => (
                  <div className="cap-wline" key={lineIndex}>
                    {line.map((item) => {
                      const index = flat++;
                      const isSelected = index === selected;
                      const uncertain = showUncertain && item.confidence < UNCERTAIN_BELOW;
                      const empty = item.text.trim().length === 0;
                      return (
                        <button
                          key={item.index}
                          type="button"
                          data-word={index}
                          className={["cap-w", isSelected && "is-selected", index === playingWord && "is-playing", uncertain && "is-uncertain", empty && "is-empty"].filter(Boolean).join(" ")}
                          tabIndex={isSelected || (selected < 0 && index === 0) ? 0 : -1}
                          aria-current={isSelected ? "true" : undefined}
                          aria-label={
                            empty
                              ? `Empty caption at ${formatClock(item.startMs)} to ${formatClock(item.endMs)}. Type a word.`
                              : `${item.text}${uncertain ? ", uncertain" : ""}`
                          }
                          onClick={() => {
                            choose(index);
                            // An empty caption exists to be typed into: open its word box straight away.
                            if (empty) requestAnimationFrame(() => inputRef.current?.focus());
                          }}
                          onFocus={() => {
                            if (!isSelected) edits.select(index);
                          }}
                        >
                          {empty ? "Type a word" : item.text}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {gapsBefore.trailing.map((gap) => (
          <GapNotice key={gap.startMs} gap={gap} onAdd={() => addCaptionAt(gap)} onListen={() => onSeek(gap.startMs)} />
        ))}
      </div>

      <div className="cap-tools" role="group" aria-label={word ? `Edit the ${word.text ? `word ${wordName}` : "empty caption"}` : "Edit a word"}>
        <div className="cap-tools-row">
          <label className="cap-field">
            <span className="mono-label">Word</span>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              disabled={none}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKey}
              onBlur={commitDraft}
              spellCheck={false}
              autoComplete="off"
              placeholder={none ? "Choose a word above" : word?.text ? "" : "Type what you hear"}
              aria-describedby={`${hintId}-input`}
            />
          </label>
          <span id={`${hintId}-input`} className="cap-sr">
            Press Enter to save. A space splits the word into two. Emptying a word that has text deletes it. An empty caption stays until you type in it.
          </span>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={none}
            onClick={() => {
              const caret = inputRef.current?.selectionStart ?? 0;
              const target = inputRef.current && document.activeElement === inputRef.current ? caret : Math.floor((word?.text.length ?? 0) / 2);
              run((list) => splitWordAt(list, selected, target), "Word split in two.");
            }}
            title="Split the word at the text cursor"
          >
            <Scissors size={14} aria-hidden="true" /> Split
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={none || selected >= words.length - 1}
            onClick={() => run((list) => mergeWithNext(list, selected), "Words joined.")}
            title="Join with the next word"
          >
            <ArrowLeftRight size={14} aria-hidden="true" /> Join next
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={words.length === 0}
            onClick={() => {
              // A placeholder is added and its text box opens selected, so typing replaces it.
              const result = run((list) => insertWordAfter(list, selected, "word"), "Word added. Type the new word.", "none");
              if (result) {
                focusWord(result.selected);
                requestAnimationFrame(() => {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                });
              }
            }}
            title="Add a missing word after this one"
          >
            <Plus size={14} aria-hidden="true" /> Add
          </button>
          <button
            type="button"
            className="button button-ghost button-small cap-danger"
            disabled={none}
            onClick={() => run((list) => deleteWord(list, selected), "Word deleted.")}
          >
            <Trash2 size={14} aria-hidden="true" /> Delete
          </button>
        </div>

        <div className="cap-tools-row cap-timing">
          <span className="cap-range" aria-live="off">
            {word ? range : "No word chosen"}
          </span>
          <Nudge label="Start" disabled={none} onNudge={(sign, e) => run((list) => nudgeWord(list, selected, "start", sign * step(e)), "Start time changed.", "none")} />
          <Nudge label="End" disabled={none} onNudge={(sign, e) => run((list) => nudgeWord(list, selected, "end", sign * step(e)), "End time changed.", "none")} />
          <Nudge label="Move" disabled={none} onNudge={(sign, e) => run((list) => nudgeWord(list, selected, "both", sign * step(e)), "Word moved.", "none")} />
        </div>
      </div>

      <p className="cap-sr" role="status" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}

/**
 * A stretch where speech was heard but no words were found. The readable note stays, and it gains
 * two actions: add a caption here (one click, then type) and just listen to the stretch.
 */
function GapNotice({ gap, onAdd, onListen }: { gap: SpeechInterval; onAdd: () => void; onListen: () => void }) {
  const range = `${formatClock(gap.startMs)} to ${formatClock(gap.endMs)}`;
  return (
    <div className="cap-tools-row" style={{ gridColumn: "1 / -1", margin: "2px 0 4px" }}>
      <button type="button" className="cap-gap" onClick={onAdd}>
        No words found at {range}. <span aria-hidden="true">Add a caption</span>
        <span className="cap-sr">
          {" "}
          Add a caption at {range}: one click makes an empty caption and puts the cursor in the word box, so you can type what you hear.
        </span>
      </button>
      <button
        type="button"
        className="button button-ghost button-small"
        onClick={onListen}
        aria-label={`Listen from ${formatClock(gap.startMs)} to ${formatClock(gap.endMs)}, without adding a caption`}
      >
        <Play size={14} aria-hidden="true" /> Listen
      </button>
    </div>
  );
}

function blockOf(offsets: number[], wordIndex: number): number {
  let block = 0;
  for (let i = 0; i < offsets.length; i += 1) if (offsets[i] <= wordIndex) block = i;
  return block;
}

function Nudge({ label, disabled, onNudge }: { label: string; disabled: boolean; onNudge: (sign: -1 | 1, event: { shiftKey: boolean }) => void }) {
  return (
    <span className="cap-nudge" role="group" aria-label={`${label} time`}>
      <span className="mono-label">{label}</span>
      <button type="button" className="chip" disabled={disabled} onClick={(event) => onNudge(-1, event)} aria-label={`${label} 50 milliseconds earlier`} title="50 ms earlier (Shift: 10 ms)">
        &minus;
      </button>
      <button type="button" className="chip" disabled={disabled} onClick={(event) => onNudge(1, event)} aria-label={`${label} 50 milliseconds later`} title="50 ms later (Shift: 10 ms)">
        +
      </button>
    </span>
  );
}
