/**
 * The shared contract for the auto-captions pipeline. Every module in this folder
 * speaks these types, so they are frozen: change one only by agreement.
 *
 * TIME RULES (the place where seam words get duplicated if two modules disagree):
 *  - All times are INTEGER MILLISECONDS. Never floats, never seconds.
 *  - "Window-local" time starts at 0 at the start of a packed 30 s window, and includes the
 *    synthetic silence the packer inserted. The aligner and the decoder work in this time.
 *  - "Global" time is the position in the source video. Only `packer.toGlobalMs` converts
 *    local to global; nothing else may shift times.
 *  - Everything after the overlap merger (normalize, layout, export) sees global time only.
 */

/** One recognised word. `index` is global and strictly increasing once words are merged. */
export interface Word {
  text: string;
  startMs: number;
  endMs: number;
  /** 0 to 1. Use 1 when a stage cannot tell. */
  confidence: number;
  /** Position in the final transcript. Window-local stages may leave it as the in-window position. */
  index: number;
  /** Which packed window produced this word. */
  windowIndex: number;
  /**
   * True when the word was not heard by the model but copied from a repeated section of the song (the
   * repeat-aware pass). Such words always carry a low confidence, so the editor marks them uncertain.
   */
  inferred?: boolean;
}

/** A stretch of speech found by the voice-activity detector, in global time. */
export interface SpeechInterval {
  startMs: number;
  endMs: number;
}

/** One speech region placed inside a packed window. */
export interface PackedRegion {
  /** Where the region starts in the source video. */
  sourceStartMs: number;
  /** Where it ends in the source video. */
  sourceEndMs: number;
  /** Where it starts inside the packed window (window-local). */
  packOffsetMs: number;
}

/** A fixed-length window handed to the speech model. */
export interface PackedWindow {
  index: number;
  /** Always the model's fixed length (30 000 for stock Whisper). */
  lengthMs: number;
  /** How much of the window is real speech or inserted silence; the rest is padding. Words past this are bogus. */
  usedMs: number;
  regions: PackedRegion[];
}

/** One caption block: a few lines of words that appear together. */
export interface CaptionEvent {
  index: number;
  startMs: number;
  endMs: number;
  /** Words, not strings, so the renderer can highlight the active word. */
  lines: Word[][];
}
