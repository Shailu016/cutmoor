import type { CaptionEvent, Word } from "./types";

/**
 * Caption export: CaptionEvent[] -> SRT, VTT and word-level JSON.
 *
 * Timestamps are built in exactly one function, from integer milliseconds with integer maths.
 * That is what keeps 1 h 59 min 59.999 s from drifting into 2 h after a round trip, and it means
 * SRT and VTT can never disagree about a cue boundary by a millisecond.
 *
 * Cue text is data from a speech model, so it is treated as hostile: a literal "-->" would end the
 * timing line early for some parsers, and a newline inside a "word" would forge an extra caption
 * line. In WebVTT "&", "<" and ">" are also markup, so they are escaped there. SRT cue text has no
 * markup in the format, so it stays plain text. All of this is neutralised here rather than trusted.
 */

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

/** A safe, non-negative integer millisecond value. NaN/Infinity/negatives collapse to 0. */
function toIntMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The single place a timestamp is formatted. `separator` is SRT's comma or VTT's period. */
function formatTimestamp(ms: number, separator: "," | "."): string {
  const total = toIntMs(ms);
  const hours = Math.floor(total / HOUR_MS);
  const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((total % MINUTE_MS) / SECOND_MS);
  const millis = total % SECOND_MS;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(millis, 3)}`;
}

interface CueRange {
  startMs: number;
  endMs: number;
}

/**
 * Shared guard for both timestamps. End is always at least one millisecond after start, so a
 * zero-length or backwards event still produces a cue a player will accept.
 */
function cueRange(startMs: number, endMs: number): CueRange {
  const start = toIntMs(startMs);
  const end = toIntMs(endMs);
  return { startMs: start, endMs: end > start ? end : start + 1 };
}

/** Looks like an arrow to a human, but no parser can mistake it for the timing separator. */
const ARROW = "--\u203A";

/** Plain cue text for SRT: collapse newlines, defuse "-->" and leave every other character alone. */
function cueText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, " ").replace(/-->/g, ARROW);
}

/**
 * WebVTT cue text: "&", "<" and ">" are parsed as character references and tags, so they must be
 * escaped. "&" is replaced first; doing it last would re-escape the ampersands introduced by the
 * other two replacements. This is one pass, so "AT&T" -> "AT&amp;T", never "AT&amp;amp;T".
 */
function vttCueText(text: string): string {
  return cueText(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type CueTextEscaper = (text: string) => string;

/** Visible, non-empty lines of an event. Empty words are dropped, blank lines disappear. */
function eventLines(event: CaptionEvent, escape: CueTextEscaper): string[] {
  const lines: string[] = [];
  for (const line of event.lines) {
    const text = line
      .map((word) => escape(word.text))
      .filter((part) => part.length > 0)
      .join(" ")
      .trim();
    if (text.length > 0) lines.push(text);
  }
  return lines;
}

export function toSrt(events: CaptionEvent[]): string {
  const blocks: string[] = [];
  for (const event of events) {
    const lines = eventLines(event, cueText);
    if (lines.length === 0) continue;
    const range = cueRange(event.startMs, event.endMs);
    const timing = `${formatTimestamp(range.startMs, ",")} --> ${formatTimestamp(range.endMs, ",")}`;
    blocks.push(`${blocks.length + 1}\n${timing}\n${lines.join("\n")}`);
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}

export function toVtt(events: CaptionEvent[]): string {
  const blocks: string[] = [];
  for (const event of events) {
    const lines = eventLines(event, vttCueText);
    if (lines.length === 0) continue;
    const range = cueRange(event.startMs, event.endMs);
    const timing = `${formatTimestamp(range.startMs, ".")} --> ${formatTimestamp(range.endMs, ".")}`;
    blocks.push(`${timing}\n${lines.join("\n")}`);
  }
  // An empty file still needs the header, or no player will accept it as WebVTT.
  return blocks.length > 0 ? `WEBVTT\n\n${blocks.join("\n\n")}\n` : "WEBVTT\n\n";
}

interface JsonWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  index: number;
  windowIndex: number;
  eventIndex: number;
}

function wordToJson(word: Word, eventIndex: number): JsonWord {
  const range = cueRange(word.startMs, word.endMs);
  const confidence = Number.isFinite(word.confidence) ? Math.min(1, Math.max(0, word.confidence)) : 1;
  const index = Number.isFinite(word.index) ? Math.trunc(word.index) : 0;
  const windowIndex = Number.isFinite(word.windowIndex) ? Math.trunc(word.windowIndex) : 0;
  return {
    text: word.text, // JSON is data, not cue text: keep the recogniser's characters exactly.
    startMs: range.startMs,
    endMs: range.endMs,
    confidence,
    index,
    windowIndex,
    eventIndex,
  };
}

/**
 * Word-level JSON for karaoke/preview tooling: a flat word stream in reading order, each word
 * carrying its timing, confidence and the index of the caption event that owns it. Unlike SRT/VTT,
 * empty-text words are kept: this is the machine-readable view, not the rendered one.
 */
export function toWordJson(events: CaptionEvent[]): string {
  const words: JsonWord[] = [];
  events.forEach((event, eventIndex) => {
    for (const line of event.lines) {
      for (const word of line) words.push(wordToJson(word, eventIndex));
    }
  });
  return `${JSON.stringify({ version: 1, words }, null, 2)}\n`;
}
