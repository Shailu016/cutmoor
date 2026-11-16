import { CaptionError, WINDOW_MS } from "../contracts";
import type {
  CaptionPipeline,
  ForcedAlignResult,
  LyricsStats,
  PcmChunk,
  CaptionResult,
  PipelineDeps,
  PipelineOptions,
  PipelineProgress,
  PipelineStage,
  PipelineStats,
  TranscribeBounds,
  SpeechEngine,
  VoiceDetector,
  WindowAudio,
  WindowTranscript,
  WordAligner,
} from "../contracts";
import type { DownloadProgress } from "../model-loader";
import { dropCollapsedTail, evaluateTranscript } from "../hallucination-gate";
import type { GateOptions, GateReason } from "../hallucination-gate";
import { layoutCaptions } from "../layout";
import type { LayoutOptions } from "../layout";
import { normalizeWords } from "../normalize";
import { auditCoverage } from "../overlap-merge";
import { normalizeIntervals, toGlobalWord, windowSourceSpan } from "../packer";
import type { PackOptions } from "../packer";
import type { CaptionEvent, PackedWindow, SpeechInterval, Word } from "../types";
import { assembleWindowAudio } from "./assemble";
import { PcmStore } from "./pcm-store";
import { StreamingPacker } from "./streaming-packer";
import { createUniformAligner, uniformAlign } from "./uniform-aligner";
import { createVocalActivityDetector } from "./vocal-activity";
import { WordAccumulator } from "./word-accumulator";
import { pickBetterSongReading, scoreSongWords, songWordCore, trimSongReading } from "./song-junk";
import { createRepeatTracker, measureRepeatExtent, transferRepeatedWords } from "./song-repeat";
import { isHardSongWindow, planSongRetryWindows } from "./song-windows";
import {
  CONFIDENCE_COLLAPSE_WORDS,
  DEFAULT_SPEECH_WORDS_PER_SECOND,
  DEFAULT_SONG_WORDS_PER_SECOND,
  END_OF_AUDIO_GUARD_MS,
  END_OF_FILE_EPSILON_MS,
  DEFAULT_UNCERTAIN_CONFIDENCE,
  MAX_ALIGN_TEXT_CHARS,
  acceptAlignedWords,
  findAnchors,
  forcedWordConfidence,
  lyricEndGuardMs,
  parseLyrics,
  planLyricChunk,
  reconcileWithAnchors,
  sameWord,
  unmatchedLyricLines,
} from "./lyrics";
import type { AcceptedLyricWord, LyricChunk, ParsedLyrics } from "./lyrics";
import { planGlobalLyrics, lyricPlanLooksRight } from "./lyrics-global";

/**
 * The captioning pipeline: file in, caption events out, everything in this tab.
 *
 *   ingest (16 kHz chunks) -> voice detector -> streaming packer -> 30 s window audio
 *     -> speech engine -> hallucination gate -> word aligner -> global time -> overlap merge
 *     -> spelling normaliser -> caption layout
 *
 * It is a loop over audio chunks, not a batch job: when the detector has closed enough speech to
 * make a window, that window is transcribed straight away and `onPartial` fires, so the first
 * captions can be shown while the rest of the file is still being read. Only audio that a pending
 * window still needs is kept (see PcmStore), so a long file costs the same memory as a short one.
 */

export interface PipelineTuning {
  packOptions?: PackOptions;
  gate?: GateOptions;
  layout?: LayoutOptions;
  /**
   * Upper bound on audio kept in memory, in ms. Normally speech closes long before this. It only
   * matters when the voice detector never closes an interval (an hour of silence, or one unbroken
   * stretch): then the oldest audio is let go and any speech that began before it is transcribed as
   * silence and shows up in `uncoveredSpeech`, rather than the tab running out of memory. Default 10 minutes.
   */
  maxRetainedMs?: number;
  /** Used when the real aligner fails to load or to align a window. Default: the model-free uniform aligner. */
  fallbackAligner?: WordAligner;
  /** Called after every chunk with the audio currently held, in ms. For tests and diagnostics. */
  onRetained?: (retainedMs: number) => void;
  /**
   * How long cleanup (closing the file, releasing models) may take before the pipeline stops waiting for it, in ms.
   * A model that is still busy on the GPU cannot release until its current call returns, and a cancel must not
   * wait for that. Cleanup keeps going in the background; this only bounds how long anyone waits. Default 3000.
   */
  cleanupTimeoutMs?: number;
  /**
   * Diagnostics, song mode's read accounting: print one `console.debug` line per model read (window, token, kind,
   * raw/kept word counts, real Latin words, ms). A development build also switches it on with
   * `globalThis.__cutmoorDebugReads = true`; a production build has no such path and stays silent. Default off.
   */
  debugReads?: boolean;
  /**
   * Song mode: run the second, timestamped read (wp-TS) on a hard-ish window. Default true; set false to turn the
   * extra read off without touching the engine (the engine's `timestampRead: false` option is the other switch).
   */
  timestampRead?: boolean;
  /**
   * Song mode: the C2 time changes (the read budget, the rescue skip after two empty retries, and the High-first
   * rescue order). Default true. `false` restores the R3 read policy — no budget, no rescue skip, +10 s first — so an
   * A/B run can tell whether a lost line is the time optimisation's fault. Words beat seconds: this is the switch to
   * turn off if the budget ever starves a read that produced real lyrics.
   */
  c2Time?: boolean;
  /**
   * Song mode: let the reads of one window share an encoder run (base read, token vote, timestamp read, retries).
   * Default true. `false` gives every read its own encoder pass, which is the R3 behaviour before the C2 sharing.
   */
  reuseEncoder?: boolean;
}

const DEFAULT_MAX_RETAINED_MS = 10 * 60_000;
/**
 * Shortest stretch of detected speech with no word that is shown to the visitor as "no words found". The detector pads
 * and joins speech across pauses of up to about 1.6 s, and words now carry real times, so an ordinary pause must not be flagged.
 */
const UNCOVERED_MIN_MS = 2500;

/** How far before the last closed speech the next speech might start (the detector may pad the front of a segment). */
const OPEN_INTERVAL_LOOKBACK_MS = 1000;
/** The packer's default overlap between the pieces of a long region (packer.ts DEFAULTS.splitOverlapMs). */
const DEFAULT_SPLIT_OVERLAP_MS = 150;
/** On top of the overlap: the merger's seam slack (400 ms) and room for the aligner's timing jitter. */
const PREVIEW_GUARD_EXTRA_MS = 1000;
/** Reasons that mean text was invented. The other two (too-slow, long-gap) mean words may be MISSING, so the words we have are kept. */
const INVENTED_REASONS: readonly GateReason[] = ["repetitive", "looping", "no-speech", "outside-speech", "too-fast", "junk-text"];
/**
 * Song mode only. Whisper writes one of these for audio it cannot read; a window made only of them is not a caption.
 * Kept as the safety net now that audio the detector is confident is instrumental is skipped before the model: a stray
 * token can still arrive in a window that holds a real phrase (the detector is a heuristic), so the `junk-text` gate still drops a junk-only
 * window, and `dropJunkInInstrumentalSpans` below drops a stray one inside an instrumental span. Speech mode never
 * passes this list to the gate, so a real "na" in a conversation is untouched.
 */
const MUSIC_JUNK_WORDS: readonly string[] = ["nan", "n", "nn"];

/** A word core with its edge punctuation removed, lowercased, for comparing against the junk list. */
const wordCore = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

/** Merges overlapping or touching spans, so a "is this time inside a claim" scan stays short. */
function mergeSpans(spans: readonly SpeechInterval[]): SpeechInterval[] {
  if (spans.length <= 1) return spans.map((span) => ({ ...span }));
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: SpeechInterval[] = [{ ...sorted[0] }];
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
    else merged.push({ ...span });
  }
  return merged;
}

/** First index where `needle` appears as a contiguous run in `haystack`, or -1. */
function findContiguous(haystack: readonly string[], needle: readonly string[]): number {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let same = true;
    for (let i = 0; i < needle.length && same; i += 1) same = haystack[start + i] === needle[i];
    if (same) return start;
  }
  return -1;
}

/**
 * Song mode only: applies `trimSongReading` to a window reading, keeping the per-word arrays aligned.
 * Trimming only removes words from the two ends (junk runs) or repeated copies at the end (a loop), so
 * the kept words are a contiguous slice and `wordTimes` / `wordConfidence` can be sliced with them.
 * Returns the original transcript when nothing can be trimmed, so a bug here can never lose words.
 */
export function trimTranscriptReading(transcript: WindowTranscript): { transcript: WindowTranscript; dropped: number; cutLoop: boolean } {
  const trimmed = trimSongReading(transcript.words);
  if (trimmed.dropped === 0) return { transcript, dropped: 0, cutLoop: false };
  const end = trimmed.words.length === 0 ? 0 : findContiguous(transcript.words, trimmed.words) + trimmed.words.length;
  const start = trimmed.words.length === 0 ? 0 : end - trimmed.words.length;
  if (trimmed.words.length > 0 && start < 0) return { transcript, dropped: 0, cutLoop: false };
  const sameLength = transcript.wordConfidence?.length === transcript.words.length;
  const sameTimes = transcript.wordTimes?.length === transcript.words.length;
  return {
    transcript: {
      ...transcript,
      words: trimmed.words,
      wordConfidence: sameLength ? transcript.wordConfidence?.slice(start, end) : undefined,
      wordTimes: sameTimes ? transcript.wordTimes?.slice(start, end) : undefined,
    },
    dropped: trimmed.dropped,
    cutLoop: trimmed.cutLoop,
  };
}

/**
 * Song mode only: true when a reading repeats an n-gram (period 1-4) three times in a row ANYWHERE. `trimSongReading`
 * already removes a trailing loop; this catches one left in the middle (a decoder loop the aligner would stack). The
 * timestamp read is rejected when it loops, so a longer looping read cannot replace a shorter clean one.
 */
export function hasSongLoop(words: readonly string[]): boolean {
  const cores = words.map((word) => songWordCore(word));
  for (let period = 1; period <= 4; period += 1) {
    for (let start = 0; start + period * 3 <= cores.length; start += 1) {
      let same = true;
      for (let offset = period; offset < period * 3 && same; offset += 1) {
        if (cores[start + offset] !== cores[start + (offset % period)]) same = false;
      }
      if (same) return true;
    }
  }
  return false;
}

/**
 * Song mode only. A window that hears nothing ("nan"), one word, or a loop is read again from slices of the same
 * stretch moved later by these amounts, with the Hindi token. Whisper is very sensitive to where a window starts on
 * loud music: on Sajan Sajan x Batman the base 30 s window gave "nan" while the slices starting 10 s and 15 s later
 * read the real lyric line (High: 0 words once this was deleted, 33 real words with it, last at 0:59.4). Restored
 * because the plan's "nothing may regress" rule outranks "delete the rescue", and because the Demucs A/B showed
 * separation does not recover those lines either (3-4 words either way). 10 and 15 seconds were the two offsets that
 * worked; only the later half of a 30 s slice usually carries the singing.
 *
 * It is now gated by the vocal-activity detector: base windows are built only from vocal intervals, and a rescue slice
 * must hold at least MUSIC_RESCUE_MIN_MS of detector-confirmed vocal audio before it is worth a model call. A slice is
 * cut from the window's own span, so it can still contain instrumental audio beside those vocal seconds; that is
 * deliberate, because these moved slices are the only measured way to recover Sajan's 0:30-0:59 lines.
 */
/** Song mode only: the moved slices tried when a window still holds too few real words, in this order. The first slice
 * that beats the window's own reading by 3 real words wins; +15 s is the measured recovery of Sajan High (0:15-0:30),
 * while on the Draft tier it is the +10 s slice that reads the whole second line (20 words vs 14). */
const MUSIC_RESCUE_OFFSETS_MS: readonly number[] = [10_000, 15_000];
/**
 * High accuracy only: the same two slices with +15 s first. Every measured High rescue win is +15 s (Sajan 0:15-0:30:
 * 14 real words from +15, nothing from +10, whose pair cost 18.5 s); Draft keeps the order above because its win is +10
 * (20 words vs 14). The tier is read from the engine's own character-aligner capability (see `longRescueFirst`), never
 * from a setting.
 */
const MUSIC_RESCUE_OFFSETS_HIGH_MS: readonly number[] = [15_000, 10_000];
/** A rescue slice with less detector-confirmed vocal audio than this is mostly instrumental/padding; skip the call. */
const MUSIC_RESCUE_MIN_MS = 5000;
/**
 * Song mode: most model reads one window may ask for (base, the timestamp read, the other-token vote, the two 20 s
 * retries, and a moved rescue slice). Five is every productive shape: base + timestamp + vote + two retries. The
 * budget was four before wp-TS added the timestamp read, which silently stole the second retry's slot on KING's
 * ~120-149.5 s window and lost its 19-word English rap line (the line is read by the SECOND 20 s retry). Keep this
 * at least one slot above base + timestamp + vote when another read is added. Since the base and the vote share an
 * encoder run, a window costs at most five encoder passes.
 */
const SONG_READ_BUDGET = 5;
/**
 * Song mode, wp-TS: read the window again with the timestamp policy when the normal read has fewer real Latin words
 * than this. wp-TS measured the gain on Sajan 0-30 (24 real words -> 35) and 47-59 (1 -> 18); a window that already
 * reads 24+ real words is left alone, which keeps the extra decode (and, for a short window, the extra encoder pass)
 * off the clean windows. That extra read is one of the five reads above, never a sixth.
 */
const TIMESTAMP_READ_MAX_REAL_WORDS = 24;
/**
 * The timestamp read only runs on a (nearly) full 30 s window. Every measured win (Sajan 0-30 and 30-60, KING's song
 * windows) is a full window, where both mel conventions give the same input and only the prompt differs. On a short
 * window the read also switches to the frame-padded mel, and on short noisy SPEECH that reading is longer but wrong:
 * the "mumma" clip (one 15 s window) went from 12 words (WER 0.696) to 30 invented ones (WER 0.957) because the longer
 * reading won on word count. Speech clips are usually one short window; songs are long. So short windows keep the
 * normal read only.
 */
const TIMESTAMP_READ_MIN_USED_MS = 28_000;

/**
 * Song-mode bounds also carry the engine's encoder-sharing hint (`reuseEncoder`, read by whisper-engine's `runOnce`).
 * It is not part of the `TranscribeBounds` contract: speech mode and any other caller pass no bounds at all, so their
 * path is byte-identical, and the engine only consults its cache when a caller asks.
 */
type SongBounds = TranscribeBounds & { reuseEncoder?: boolean; timestampRead?: boolean };

/**
 * Song mode only: the token cap for EVERY read. 6 new tokens per second of audio is 188 tokens for a 30 s window and
 * 128 for a 20 s one; the measured 30 s reads are 24-50 tokens, and the fastest measured bin (KING, 102 words in 30 s)
 * is about 140 tokens, so this caps a runaway decode without touching a real reading. There is deliberately NO extra
 * repetition stop: the tighter 3-repeat rule was measured (review finding + debug run) to truncate the decode right
 * after a leading `nan` loop (window 1 of Sajan stopped at 1 token where the product's default rules read 17 words),
 * and the decoder's own rules (a 4-token run three times, or one token ten times) already stop a true loop. Junk at
 * either end is removed by `trimSongReading` after the decode; a loop in the middle no longer costs words.
 * Speech mode passes no bounds, so its decode policy is untouched.
 */
const SONG_BASE_BOUNDS: SongBounds = { tokensPerSecond: 6, reuseEncoder: true };

/**
 * The same cap for the extra reads (second token, 20 s retries), plus one saving for the retries: no shifted second
 * take. A retry is already a second chance, and measured on Sajan the shifted copy of a retry returned the same 2-3
 * junk tokens; dropping it halves the encoder runs on the windows that need several reads.
 */
const SONG_RETRY_BOUNDS: SongBounds = { tokensPerSecond: 6, retryShiftMs: 0, reuseEncoder: true };
/** The extra read with the other language token keeps the engine's shifted take: it is a vote, not a retry. */
const SONG_EXTRA_READ_BOUNDS: SongBounds = { tokensPerSecond: 6, reuseEncoder: true };
/**
 * wp-TS song-mode timestamp read: same audio, no shifted second take, the same bounded token cap, and the
 * out-of-contract hint the engine turns into the timestamp prompt + decoder rules. The frame-padded mel is chosen by
 * the engine; for a full 30 s window the mel is identical, so the encoder output is reused (no extra encoder run).
 */
const SONG_TIMESTAMP_BOUNDS: SongBounds = { tokensPerSecond: 6, retryShiftMs: 0, reuseEncoder: true, timestampRead: true };
/**
 * Speech-mode base reads when the visitor pasted lyrics on a tier with an aligner. Same policy as speech mode (no
 * token cap, no shift, the same repetition rules) plus one out-of-contract hint: keep the encoder output of this
 * window, because the lyrics pass runs after the whole file and needs it for the forced-alignment decoder pass.
 * Without the hint every aligned window pays a second encoder run (measured on B5: `aligning` = windows x 9-11 s).
 * A run without lyrics passes no bounds at all, so it stays byte-identical to before.
 */
const LYRIC_KEEP_ENCODER_BOUNDS: SongBounds = { reuseEncoder: true };
/**
 * A song window with fewer real Latin words than this is treated as a missed line: its own reading is kept, but the
 * moved rescue slices are tried as well. Window 0 of Sajan is the measured case: `<|en|>` keeps 3 real words after the
 * junk trim, while the +15 s Hindi slice holds 16 (the product's old first caption at 0:15). Threshold 8 rather than 3
 * because a real sung 30 s line has far more than 8 words; 3 is enough for the token vote to be worth it, not enough
 * to call the window read.
 */
const SONG_RESCUE_MIN_REAL_WORDS = 8;
/** Longest file the repeat pass runs on, in ms. The lag scan is O(frames * lags * bands); above this it would dominate. */
const REPEAT_MAX_AUDIO_MS = 12 * 60_000;
/**
 * Longest file forced alignment runs on, in ms. It costs one extra decoder pass per window, so a very long
 * recording would nearly double the job for words the visitor can see anyway. Past this the lyrics are
 * reported as unplaced instead of silently costing minutes.
 */
const LYRIC_MAX_AUDIO_MS = 15 * 60_000;
/**
 * A heard word this close (ms) to a placed lyric word that sounds the same is the same word: the lyric
 * placement wins and the heard copy is not shown twice across a window overlap.
 */
const LYRIC_DUPLICATE_WINDOW_MS = 1500;

/**
 * Wrong-lyrics guard: when at least this many words were "placed" and this share of them were uncertain, the
 * aligner was guessing (the teacher-forced log-probability of arbitrary words over unrelated audio collapses).
 * Keeping the transcript is the honest answer: a pasted text that does not fit the audio must not invent timing.
 */
const LYRIC_WEAK_EVIDENCE_MIN_WORDS = 4;
const LYRIC_WEAK_EVIDENCE_RATIO = 0.8;
/** Below this many sound-alike anchors a mostly-uncertain paste has no audio support: it is a different text. */
const LYRIC_WEAK_ANCHOR_MIN = 4;

/**
 * Second alignment pass of one window (REVIEW-1 finding 2): the engine's 400-character limit means one `alignText` call
 * cannot be given 1.5x the words a 30 s window holds, so the pipeline calls the aligner again on the SAME audio for the
 * next chunk. That call is decoder-only (the engine reuses the encoder of the first pass), so it is cheap. Hard cap: two
 * passes per window.
 *
 * The second chunk starts this many words BEFORE the cursor so the DTW has the context of the words the first pass just
 * placed; the overlap is context only, never placed twice (the accepted words are filtered to `wordIndex >= cursor`).
 */
const LYRIC_SECOND_PASS_OVERLAP_WORDS = 5;
/**
 * A window only earns a second pass when its first pass left this much usable audio before the end guard. If the words
 * reached (nearly) the window's safe end the window is already read and a second chunk has no audio to land on, so the
 * decoder pass would be pure cost.
 */
const LYRIC_SECOND_PASS_MIN_ROOM_MS = 1500;
/** The smallest remainder a second pass plans for (the pass-2 floor, in ms; see the pass-2 planner). */
const MIN_SECOND_PASS_WINDOW_MS = 1500;
/**
 * The claim span of one window is the placed run plus this much slack on each side (see `alignLyrics`). Claiming the
 * whole window threw away correct heard words before and after the run (REVIEW-1 finding 7); 500 ms still covers the
 * window overlap and the aligner's boundary rounding.
 */
const LYRIC_CLAIM_PAD_MS = 500;
/**
 * Timing from the agreed transcript: a heard word whose midpoint is this close (ms) to a placed word that `sameWord()`
 * it is the same word, so the placed word takes the heard word's times. Pasted words therefore keep the transcript's
 * (measured) timing wherever the two agree, which is what "pasting lyrics must never make timing worse" needs.
 */
const LYRIC_BORROW_TIMING_MS = 800;

/** The engine's teacher-forced aligner. Feature-detected: not every tier (and not every test fake) has one. */
type AlignTextFn = NonNullable<PipelineDeps["engine"]["alignText"]>;

/** What one lyrics pass produced. */
interface LyricOutcome {
  /** The final word list: pasted words where they were placed, heard words only in spans alignment did not claim. */
  words: Word[];
  /** Distinct pasted words placed on the audio (a repeat copy is not counted again). */
  placed: number;
  /** Placed words whose evidence was weak. */
  uncertain: number;
  /** Pasted lines with no placed word, in the visitor's spelling, bounded for the panel. */
  unmatchedLines: string[];
  /** Words copied from a repeated section of the song because the same words were pasted once. */
  inferred: number;
  /** Preferred caption breaks: the output-word indices where a pasted line starts. */
  breakWords: number[];
  /** Counts for `LyricsStats` (see the contract): how the pass got to that number. */
  diagnostics: LyricDiagnostics;
}

/** The diagnostics half of `LyricsStats` that one lyrics pass fills in. */
interface LyricDiagnostics {
  /** Aligned words the aligner returned, over every call. */
  returned: number;
  /** Words that passed the guards (and the pass-2 overlap filter) and were placed. */
  accepted: number;
  /** Audio windows where the aligner returned nothing (null, empty, or a thrown error). */
  nullWindows: number;
  /** `alignText` calls made (at most two per audio window). */
  passes: number;
  /** Placed words whose timing was borrowed from a heard word of the agreed transcript. */
  timingBorrowed: number;
  /** Words the global plan predicted (all pasted words get a prediction). */
  planned: number;
  /** Words whose timing the teacher-forced pass verified inside its window. */
  verified: number;
  /** Placed words with neither an anchor nor a verified time: their timing is the structure estimate. */
  approximate: number;
}

/** What one `alignText` pass on one audio window did (see `alignLyrics`). */
interface LyricPass {
  /** The plan that was handed to the aligner. Pass 2 starts before the cursor (overlap context). */
  chunk: LyricChunk;
  /** Words the aligner returned. */
  returned: number;
  /** Words that passed the guards and the pass-2 overlap filter, before the padding drop. */
  accepted: number;
  /** Words actually placed (global time, not in the padding). */
  mapped: number;
  /** Window-local end of the last accepted word: where the next pass may start. */
  acceptedEndMs: number | null;
  /** Highest lyric index that passed the filter, or null when nothing did: the next cursor. */
  lastWordIndex: number | null;
  /** Global first/last word this pass placed, for the window's claim span. */
  firstPlaced: Word | null;
  lastPlaced: Word | null;
}

/** Which read of a song window this is: the base read, the other-token vote, the timestamp read, a 20 s retry, or a moved rescue slice. */
type ReadKind = "base" | "vote" | "timestamp" | "retry" | "rescue";

/** What one read of one window produced (see `readTake`). */
interface ReadTake {
  window: PackedWindow;
  audio: WindowAudio;
  words: Word[];
  junk: boolean;
  sparse: boolean;
  flagged: boolean;
  transcript: WindowTranscript;
  dropped: number;
  /** How many words the model wrote before trimming/gating (1 = the model's single "I cannot read this" token). */
  rawWords: number;
  /** True when the reading contained a decode loop (trimmed or in the middle): the timestamp read must not replace a window with one. */
  looped: boolean;
}

/**
 * Song mode only: drops a word that is ALL of
 *  1. a junk token ("nan", "n", "nn" - what the model writes for audio it cannot read),
 *  2. inside a stretch the vocal-activity detector reported as instrumental, and
 *  3. with a real word next to it in the UNFILTERED list, so it is a stray token and not the whole window. Neighbours
 *     are read before anything is dropped, so in a run of three junk tokens the outer two go here and the middle one is
 *     left to `dropIsolatedLowConfidenceJunk`, which runs next.
 *
 * WHY it is kept although confident instrumentals are now skipped before the model: the detector is a heuristic on the mix
 * (see vocal-activity.ts), so a little instrumental audio can still reach a window near a phrase boundary. Junk-only
 * windows are handled earlier by the `junk-text` gate; `dropIsolatedLowConfidenceJunk` (which runs after this one)
 * removes a whole run of unsure junk tokens between real words, so a run of two or three is covered by the pair.
 * It cannot change a speech clip in practice: a transcript of talking contains no junk-family token, and
 * `detection: "speech"` never builds a song detector at all.
 */
export function dropJunkInInstrumentalSpans(words: readonly Word[], spans: readonly SpeechInterval[]): Word[] {
  if (spans.length === 0 || words.length === 0) return [...words];
  const isJunk = (word: Word) => MUSIC_JUNK_WORDS.includes(wordCore(word.text));
  const insideInstrumental = (word: Word) => {
    const middle = (word.startMs + word.endMs) / 2;
    return spans.some((span) => middle >= span.startMs && middle <= span.endMs);
  };
  return words.filter((word, index) => {
    if (!isJunk(word) || !insideInstrumental(word)) return true;
    const neighbours = [words[index - 1], words[index + 1]].filter((item): item is Word => item !== undefined);
    return !neighbours.some((neighbour) => !isJunk(neighbour));
  });
}

/**
 * Song mode only: removes a junk-family word that sits alone between real words and that the model was very unsure
 * about (confidence below `maxConfidence`). This is the measured KING failure: three "nan" tokens at 0:29.9, 0:59.7 and
 * 2:29.3, each between real lyric words, with confidence 0.09-0.23. It is not a lyric and it is not a whole junk window
 * (the `junk-text` gate owns those), so it is removed instead of shown. It cannot change a speech clip in practice: a
 * transcript of talking contains no junk-family token to match, and `detection: "speech"` never calls it at all.
 */
export function dropIsolatedLowConfidenceJunk(words: readonly Word[], maxConfidence = 0.5): Word[] {
  if (words.length === 0) return [...words];
  const isJunk = (word: Word) => MUSIC_JUNK_WORDS.includes(wordCore(word.text));
  const kept: Word[] = [];
  for (let index = 0; index < words.length; ) {
    if (!isJunk(words[index])) {
      kept.push(words[index]);
      index += 1;
      continue;
    }
    // A run of junk tokens (two or three in a row must go together, or the first would be kept as a "neighbour").
    let end = index;
    while (end < words.length && isJunk(words[end])) end += 1;
    const besideRealWord = (index > 0 && !isJunk(words[index - 1])) || (end < words.length && !isJunk(words[end]));
    const allUnsure = words.slice(index, end).every((word) => word.confidence < maxConfidence);
    if (!(besideRealWord && allUnsure)) kept.push(...words.slice(index, end));
    index = end;
  }
  return kept;
}

const cancelled = () => new CaptionError("aborted", "Captioning was cancelled.");

/**
 * Timing from the agreed transcript (guidance [02:28] item 4: "pasting lyrics must never make timing worse").
 *
 * A placed lyric word whose MIDPOINT is within `LYRIC_BORROW_TIMING_MS` of a heard word that `sameWord()` it is the
 * same word said at the same moment: the transcript's times are the audio's own timing, so the placed word takes them.
 * The visitor's text, the word id and the placed word's confidence/uncertain flag are kept — only the boundaries move.
 * Words the transcript does not agree with keep the aligner's times.
 *
 * `placed` is modified in place (the caller owns the array). A heard word is borrowed once: two copies of a chorus word
 * cannot both take the same heard word. Returns how many words borrowed, for `LyricsStats.timingBorrowed`.
 *
 * The heard words are indexed by midpoint once and probed by binary search, so the cost is O(placed log heard) plus the
 * (few) candidates inside 800 ms: a pasted script of thousands of words cannot make this quadratic.
 */
/**
 * "The paste is the transcript": when the visitor's words are the same words the model heard (same count
 * within a quarter, and at least three quarters of them sound the same in order), give every placed word
 * the heard word's measured interval. That is what makes pasting the words never worse than free
 * transcription on timing: on tts-words and studypoint the timings become identical to the transcript's.
 * Returns the number of words that borrowed (0 when the paste is not the transcript; the caller then falls
 * back to the local borrow).
 */
export function borrowWholeTranscriptTiming(placed: Word[], heard: readonly Word[]): number {
  if (placed.length === 0 || heard.length === 0) return 0;
  const ratio = placed.length / heard.length;
  if (ratio < 0.75 || ratio > 1.33) return 0;
  const snapshot = placed.map((word) => ({ startMs: word.startMs, endMs: word.endMs }));
  let cursor = 0;
  let previousEnd = Number.NEGATIVE_INFINITY;
  let borrowed = 0;
  for (const word of placed) {
    const middle = (word.startMs + word.endMs) / 2;
    for (let j = cursor; j < heard.length; j += 1) {
      const candidate = heard[j];
      const heardMiddle = (candidate.startMs + candidate.endMs) / 2;
      if (heardMiddle < middle - 2500) continue;
      if (heardMiddle > middle + 2500) break;
      if (!sameWord(word.text, candidate.text)) continue;
      if (candidate.startMs < previousEnd - 100) continue;
      word.startMs = candidate.startMs;
      word.endMs = candidate.endMs;
      previousEnd = candidate.endMs;
      cursor = j + 1;
      borrowed += 1;
      break;
    }
  }
  if (borrowed < placed.length * 0.75) {
    // Not the same words after all: restore the plan's own times, the caller borrows locally instead.
    for (let i = 0; i < placed.length; i += 1) {
      placed[i].startMs = snapshot[i].startMs;
      placed[i].endMs = snapshot[i].endMs;
    }
    return 0;
  }
  return borrowed;
}

export function borrowHeardTiming(placed: Word[], heard: readonly Word[]): number {
  if (placed.length === 0 || heard.length === 0) return 0;
  const middles = heard.map((word) => (word.startMs + word.endMs) / 2);
  const order = heard.map((_word, index) => index).sort((a, b) => middles[a] - middles[b]);
  const used = new Set<number>();
  let borrowed = 0;
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < placed.length; i += 1) {
    const word = placed[i];
    const middle = (word.startMs + word.endMs) / 2;
    // First heard word whose midpoint is inside the borrow window.
    let low = 0;
    let high = order.length;
    const floor = middle - LYRIC_BORROW_TIMING_MS;
    while (low < high) {
      const at = (low + high) >> 1;
      if (middles[order[at]] < floor) low = at + 1;
      else high = at;
    }
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let at = low; at < order.length; at += 1) {
      const index = order[at];
      if (middles[index] > middle + LYRIC_BORROW_TIMING_MS) break;
      if (used.has(index)) continue;
      const distance = Math.abs(middles[index] - middle);
      if (distance >= bestDistance) continue;
      if (!sameWord(word.text, heard[index].text)) continue;
      bestIndex = index;
      bestDistance = distance;
    }
    if (bestIndex < 0) continue;
    // Never borrow an interval that starts before the previous placed word ends: the merge is monotonic, and a
    // borrowed word that ran backwards would either be shifted (lyric order inverted) or dropped. Leaving the
    // aligner's own (monotonic) times is the safe, honest choice for that word.
    if (heard[bestIndex].startMs < previousEnd) continue;
    used.add(bestIndex);
    placed[i] = { ...word, startMs: heard[bestIndex].startMs, endMs: heard[bestIndex].endMs };
    previousEnd = Math.max(previousEnd, heard[bestIndex].endMs);
    borrowed += 1;
  }
  return borrowed;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  // Only the visitor's own stop is an abort. An AbortError the browser raised on its own (a GPU reset, a
  // killed worker) is a failure the visitor must see, with a retry, not "Stopped. Nothing was saved".
  if (signal.aborted) return true;
  if (error instanceof CaptionError) return error.code === "aborted";
  return false;
}

/** Rejects as soon as `signal` fires, even when the underlying work ignores it. The work is left to finish quietly. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(cancelled());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Keeps CaptionErrors as they are, turns a cancel into "aborted", and wraps anything else with `code`. */
function asCaptionError(error: unknown, signal: AbortSignal, code: CaptionError["code"], message: string): CaptionError {
  if (error instanceof CaptionError) return error;
  if (isAbort(error, signal)) return cancelled();
  return new CaptionError(code, message, { cause: error });
}

const silently = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch {
    /* cleanup must never hide the real error */
  }
};

/**
 * Waits for `work` (which must never reject) for at most `ms`. The work is NOT cancelled when the
 * wait ends, it just stops being waited for. Used for cleanup that may be stuck behind a busy model.
 */
function waitAtMost(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function createCaptionPipeline(deps: PipelineDeps, tuning: PipelineTuning = {}): CaptionPipeline {
  const now = deps.now ?? (() => performance.now());
  /**
   * One line per read, off unless asked: `tuning.debugReads` (tests and benchmarks) or, in a development build only,
   * `globalThis.__cutmoorDebugReads = true` from the console. `import.meta.env.DEV` is false in a production bundle, so
   * the global path is removed there and a production run can never log.
   */
  const debugReads =
    tuning.debugReads ?? (import.meta.env.DEV && Boolean((globalThis as { __cutmoorDebugReads?: unknown }).__cutmoorDebugReads));
  /**
   * One line per lyrics window, for diagnosing placement (B5 defect 5). Development build only: `import.meta.env.DEV`
   * is false in a production bundle, so the switch and every log line are compiled out there (the same rule as
   * `debugReads`).
   */
  const debugLyrics =
    import.meta.env.DEV && Boolean((globalThis as { __cutmoorDebugLyrics?: unknown }).__cutmoorDebugLyrics);
  /**
   * wp-TS song-mode timestamp read. Feature-detected on the engine (Whisper exposes `timestampRead: true`), so every
   * test fake and any other engine keeps today's behaviour, and `tuning.timestampRead: false` turns it off globally.
   */
  const timestampReadEnabled = tuning.timestampRead !== false && (deps.engine as SpeechEngine & { timestampRead?: boolean }).timestampRead === true;
  /**
   * C2 time switches (see PipelineTuning.c2Time). `false` is R3 behaviour: a window may ask for as many reads as its
   * plan has, a rescue is never skipped, and the +10 s slice is tried first. The budget in particular must never starve
   * a read that produced real words: on KING the 19-word English rap line is the SECOND 20 s retry of its window, so the
   * old four-read cap (which stopped after the first junk retry) lost it.
   */
  const c2Time = tuning.c2Time !== false;
  const songReadBudget = c2Time ? SONG_READ_BUDGET : Number.POSITIVE_INFINITY;
  /** C2 encoder sharing (see PipelineTuning.reuseEncoder): off gives every song read its own encoder pass. */
  const shareSongEncoder = tuning.reuseEncoder !== false;
  const fallback = tuning.fallbackAligner ?? createUniformAligner();
  const cleanupTimeoutMs = tuning.cleanupTimeoutMs ?? 3000;
  /** Previews hold back words this close to the end of the newest window (see WordAccumulator.settledWords). */
  const previewGuardMs = (tuning.packOptions?.splitOverlapMs ?? DEFAULT_SPLIT_OVERLAP_MS) + PREVIEW_GUARD_EXTRA_MS;
  let active: { controller: AbortController; finished: Promise<unknown> } | null = null;
  /** Release of models after a failed or cancelled job. Runs in the background; the next job waits for it (bounded). */
  let pendingCleanup: Promise<void> = Promise.resolve();
  let disposed = false;

  /** Releases the models. Never rejects. */
  const releaseModels = (): Promise<void> =>
    Promise.all([
      silently(() => deps.engine.release()),
      silently(() => deps.aligner.release()),
      silently(() => fallback.release()),
    ]).then(() => undefined);

  async function runJob(file: File, options: PipelineOptions, signal: AbortSignal): Promise<CaptionResult> {
    const stageMs: Partial<Record<PipelineStage, number>> = {};
    const timed = async <T>(stage: PipelineStage, work: () => Promise<T>): Promise<T> => {
      const began = now();
      try {
        return await work();
      } finally {
        stageMs[stage] = (stageMs[stage] ?? 0) + (now() - began);
      }
    };

    // ---- progress: one number for the whole job that never goes backwards ----
    let lastFraction = 0;
    let lastStage: PipelineStage | null = null;
    let readMs = 0;
    let processedMs = 0;
    let durationMs: number | null = null;
    const emit = (stage: PipelineStage, message: string, download?: DownloadProgress, force = false) => {
      const total = Math.max(durationMs ?? 0, readMs, 1);
      const reading = Math.min(1, readMs / total);
      const processing = Math.min(1, processedMs / total);
      const raw = stage === "finishing" ? 0.97 : 0.03 + 0.92 * (0.15 * reading + 0.85 * processing);
      const fraction = Math.min(1, Math.max(lastFraction, raw));
      // Chunks arrive many times a second; only tell the UI when something it can show has changed.
      if (!force && stage === lastStage && fraction - lastFraction < 0.005 && !download) return;
      lastFraction = fraction;
      lastStage = stage;
      const progress: PipelineProgress = download ? { stage, fraction, message, download } : { stage, fraction, message };
      try {
        options.onProgress?.(progress);
      } catch {
        /* a bug in the screen's callback must not throw away a long transcription */
      }
    };

    if (signal.aborted) throw cancelled();
    emit("reading-audio", "Reading the audio", undefined, true);
    const source = await timed("reading-audio", async () => {
      const opening = (async () => deps.ingest.open(file, signal))();
      try {
        return await raceAbort(opening, signal);
      } catch (error) {
        // We stopped waiting, but the file may still finish opening: close it then, or its decoder and handle leak.
        void opening.then((late) => silently(() => late.close()), () => undefined);
        throw asCaptionError(error, signal, "unsupported-file", "This file could not be opened.");
      }
    });
    durationMs = source.durationMs;

    const store = new PcmStore();
    const packer = new StreamingPacker(tuning.packOptions);
    const accumulator = new WordAccumulator();
    const allSpeech: SpeechInterval[] = [];
    const maxRetainedMs = tuning.maxRetainedMs ?? DEFAULT_MAX_RETAINED_MS;
    let lastClosedEndMs = Number.NEGATIVE_INFINITY;
    let windowsDone = 0;
    let flaggedWindows = 0;
    let droppedWords = 0;
    /** The last final publish. The last window already publishes the final list, so the job end reuses it. */
    let lastFinal: { words: Word[]; events: CaptionEvent[] } | null = null;
    /** Words the final junk filters removed. Kept apart from `droppedWords` because the final publish can run twice. */
    let droppedFromJunk = 0;
    let modelsReady = false;
    /** Until the whole file is read the number of windows is unknown, so the message must not pretend to know it. */
    let readingDone = false;
    let alignerInUse: WordAligner = deps.aligner;
    /** Window indexes for the extra song reads; they must differ from the packer's so the merger keeps both. */
    let nextRescueIndex = 1_000_000;
    /**
     * Song mode only: words copied from a repeated section of the song because the other occurrence could not
     * be read. Counted for the honest note in the output panel; the words themselves are `inferred`.
     */
    let inferredWords = 0;

    const isMusic = options.detection === "everything";
    /**
     * High accuracy only: try the +15 s rescue slice before +10 s. The pipeline has no tier object, so it asks the
     * engine for the capability that only High ships — the teacher-forced character aligner (runtime.ts TierSpec) —
     * and falls back to the known High engine id. Anything else (Draft, the test fakes) keeps the Draft order. This is
     * a capability check, not a setting.
     */
    const longRescueFirst = (() => {
      const engine = deps.engine as { id: string; characterAlignment?: unknown };
      return typeof engine.characterAlignment === "boolean" ? engine.characterAlignment : /apex/i.test(engine.id);
    })();
    /**
     * Song bounds with the `reuseEncoder` hint applied (PipelineTuning.reuseEncoder). `false` is passed explicitly:
     * the engine shares an encoder output only when the hint is true, so `reuseEncoder: false` really pays one encoder
     * pass per read (the R3 behaviour) and the A/B is meaningful.
     */
    const songBounds = (base: SongBounds): SongBounds => (shareSongEncoder ? base : { ...base, reuseEncoder: false });
    /**
     * C2 off restores the R3 rescue order: +10 s first, then +15 s (High's +15-first order is one of the C2 time
     * changes). With C2 on, High keeps its measured +15-first order.
     */
    const rescueOffsets = c2Time && longRescueFirst ? MUSIC_RESCUE_OFFSETS_HIGH_MS : MUSIC_RESCUE_OFFSETS_MS;
    /**
     * Songs only: the detector that says which stretches have a voice, so audio it is confident is instrumental is not
     * sent to the model. It is deliberately conservative (on KING it excluded 0 s), so tonal music usually still reaches
     * it. It also reports the instrumental spans, which the final junk check uses.
     */
    const songDetector = isMusic ? createVocalActivityDetector() : null;
    /**
     * Songs only: cheap features collected while the audio streams past, for the repeat-aware pass (O3). The product
     * keeps only a rolling audio buffer, so the features are the only way to see the whole song at the end.
     */
    const repeatTracker = isMusic ? createRepeatTracker() : null;
    /**
     * The visitor's lyrics or script, parsed once. Null when there is none, and then NOTHING below this point
     * touches the result: a run without lyrics stays byte-identical to the transcript-only pipeline.
     */
    const lyricPlan: ParsedLyrics | null = (() => {
      if (!options.lyrics) return null;
      try {
        const parsed = parseLyrics(options.lyrics);
        return parsed.words.length > 0 ? parsed : null;
      } catch {
        return null; // a paste that cannot be parsed must never cost the visitor the transcript
      }
    })();
    /**
     * The teacher-forced aligner of this tier, if it has one. Draft and the test fakes may not. `characterAlignment`
     * is the engine's own capability flag: the real Draft engine still exposes an `alignText` method that always
     * declines, so a method alone would make Draft look supported and print "these lines were not found" for words
     * nobody looked at. The boolean is the honest test (REVIEW-1 finding 4).
     */
    const alignText: AlignTextFn | null =
      typeof deps.engine.alignText === "function" && (deps.engine as { characterAlignment?: unknown }).characterAlignment !== false
        ? deps.engine.alignText.bind(deps.engine)
        : null;
    /**
     * The assembled audio of each base window, in order, for the alignment pass. Only filled when the visitor
     * pasted words. Bounded by LYRIC_MAX_AUDIO_MS (~30 windows, ~1.9 MB each): once the file is known to be
     * longer, the list is dropped and alignment is skipped rather than spending the tab's memory.
     */
    const lyricQueue: WindowAudio[] = [];
    let lyricsTooLong = false;
    const gateOptions: GateOptions = isMusic ? { ...tuning.gate, junkWords: MUSIC_JUNK_WORDS } : tuning.gate ?? {};
    /** A window that is only Whisper's "I cannot read this" token. */
    const isJunkText = (words: readonly string[]) => words.length > 0 && words.every((word) => MUSIC_JUNK_WORDS.includes(wordCore(word)));
    /** Windows that saved words only if a rescue misses; a single token out of 30 s of music is not worth showing. */
    const isSparse = (transcript: WindowTranscript) => transcript.words.length <= 1;
    /**
     * Lyrics must be real, Latin-script words: the rescue is only allowed to replace a window when it produced that.
     * The Hindi token sometimes writes Devanagari or "nan" on a mixed window; that is not what this tool promises.
     */
    const isUsableLyrics = (words: readonly string[]) => {
      const real = words.map((word) => word.replace(/[^\p{L}\p{N}\p{M}]+/gu, "")).filter(Boolean);
      return real.length >= 2 && real.every((word) => !MUSIC_JUNK_WORDS.includes(word.toLowerCase()) && /^[\p{Script=Latin}\p{N}\p{M}]+$/u.test(word));
    };

    /** `preview` hides the words a later overlapping window could still re-time; the final result shows everything. */
    const publish = (preview: boolean) => {
      let words = normalizeWords(preview ? accumulator.settledWords(previewGuardMs) : accumulator.words());
      if (!preview && songDetector !== null) {
        // Only the final list is filtered: an instrumental span is not final until the detector has closed it, and
        // re-deciding a word after the viewer has seen it would break the "previews only ever grow" rule.
        const kept = dropJunkInInstrumentalSpans(words, songDetector.instrumentalSpans());
        const cleaned = dropIsolatedLowConfidenceJunk(kept);
        droppedFromJunk = words.length - cleaned.length;
        words = cleaned.map((word, index) => ({ ...word, index }));
        // O3: a song that repeats a block can be read once and copied to its twin. Only the final list, only song
        // mode, only when the audio itself proves the repeat (see song-repeat.ts), and only for a file short enough
        // that the lag scan stays cheap (the scan is O(frames x 800 lags x 10 bands): ~0.2 s for 2 min, ~3 s for
        // 10 min, minutes for a 2 h podcast, so long files skip the pass rather than freeze the finishing step).
        if (repeatTracker !== null && words.length > 0 && readMs <= REPEAT_MAX_AUDIO_MS) {
          const match = repeatTracker.find();
          if (match !== null) {
            const transferred = transferRepeatedWords(words, match, {
              durationMs: readMs,
              // Two probes, and the weaker one decides: the word's own audio (350-800 ms, where the vocal is) and about
              // 2 s of context (too few frames alone, and context can be the shared backing while the lyric differs).
              // A different lyric over the same backing therefore fails on the word probe; the measured repeat passes
              // both (word 0.66-0.77, context 0.70).
              similarityAt: (startMs, endMs, lagMs) =>
                Math.min(
                  repeatTracker.similarityAt(startMs, endMs, lagMs),
                  repeatTracker.similarityAt(Math.max(0, startMs - 750), endMs + 750, lagMs),
                ),
            });
            // Assigned, not added: this final publish also runs for the last window, so it can run twice on the same
            // accumulated words, and the transfer is idempotent (an occupied twin is never overwritten).
            inferredWords = transferred.inferred;
            words = transferred.words;
          }
        }
      }
      const events: CaptionEvent[] = layoutCaptions(words, tuning.layout);
      const result = { words, events };
      if (!preview) lastFinal = result;
      return result;
    };

    /**
     * The lyrics pass: once the normal transcription has finished, walk the base windows in order and ask the
     * teacher-forced aligner to place the next chunk of the visitor's words in each one.
     *
     * It runs AFTER the transcript, on the audio the pipeline already assembled, so the transcript path is
     * untouched. Every failure mode here degrades to the transcript:
     *  - `alignText` returns null / throws / is missing: that window contributes no claim, its heard words stay.
     *  - The aligner places nothing anywhere (wrong lyrics): `placed` is 0 and the caller keeps the heard result.
     *  - A window that did place words CLAIMS its source span: heard words there are guesses the pasted words
     *    replace. Heard words outside every claim stay, so an aligner that gives up mid-file leaves the rest of
     *    the transcript as it was.
     *  - A pasted word is never placed twice (`placedIndices`) and a heard word that sounds like a placed word
     *    within LYRIC_DUPLICATE_WINDOW_MS is not shown beside it (window overlaps).
     *
     * The cursor slides: accepted words advance it, a word the aligner put too late in the window is left for
     * the next window, and a run of more than CONFIDENCE_COLLAPSE_WORDS uncertain words triggers the anchor
     * reconciliation (re-find the place, skip an instrumental gap) before the next window.
     */
    const alignLyrics = async (parsed: ParsedLyrics, heard: readonly Word[], align: AlignTextFn | null): Promise<LyricOutcome> => {
      const total = parsed.words.length;
      const diagnostics: LyricDiagnostics = { returned: 0, accepted: 0, nullWindows: 0, passes: 0, timingBorrowed: 0, planned: 0, verified: 0, approximate: 0 };
      const placedWords: Word[] = [];
      const placedIndices = new Set<number>();
      const claimed: SpeechInterval[] = [];
      const unmatchedAll = () => unmatchedLyricLines(parsed, new Set());

      emit("aligning", "Matching your words to the audio", undefined, true);

      /**
       * The global plan (PLAN-R5 Track 1): anchors from the transcript we already read, the vocal-activity
       * intervals as the only places a word may live, and a syllable-proportional distribution in between.
       * This is what removes the sliding cursor: every pasted word gets a predicted time up front, so one
       * unreadable window can no longer lose the rest of the song. The measured loop lag maps a repeated
       * lyric block (Sajan's chorus is typed twice, the audio repeats it after 33.66 s).
       */
      let repeatLagMs: number | null = null;
      let repeatExtent: { startMs: number; endMs: number; lagMs: number } | null = null;
      if (isMusic && repeatTracker !== null && readMs <= REPEAT_MAX_AUDIO_MS) {
        try {
          const match = repeatTracker.find();
          repeatLagMs = match?.lagMs ?? null;
          if (match !== null) {
            const extent = measureRepeatExtent(repeatTracker, match, { durationMs: readMs });
            repeatExtent = extent.endMs - extent.startMs >= 1000 ? extent : null;
          }
        } catch {
          repeatLagMs = null; // the plan is complete without the repeat mapping
        }
      }
      const plan = planGlobalLyrics(
        parsed,
        heard.map((word) => ({ text: word.text, startMs: word.startMs, endMs: word.endMs })),
        normalizeIntervals(allSpeech, 0),
        { repeatLagMs, durationMs: readMs, repeatExtent },
      );
      diagnostics.planned = plan.words.length;

      /**
       * Verification ("predict with structure, verify with the model"): one teacher-forced pass per base
       * window over the whole lines predicted to fall inside it. No cursor, at most one call per window, and
       * the encoder of the window's transcription is reused, so this is a decoder-only pass. A word is
       * re-timed only when the model's interval is near the prediction (4 s guard, so a wrong paste cannot
       * throw words across the song) and its confidence wins over any earlier read of the same word.
       */
      const verified = new Map<number, { startMs: number; endMs: number; confidence: number; uncertain: boolean }>();
      if (align !== null && lyricQueue.length > 0) {
        for (let windowAt = 0; windowAt < lyricQueue.length; windowAt += 1) {
          const audio = lyricQueue[windowAt];
          if (signal.aborted) throw cancelled();
          const span = windowSourceSpan(audio.window);
          const low = span.startMs - 900;
          const high = span.endMs + 900;
          const inside: number[] = [];
          for (const word of plan.words) {
            const middle = (word.startMs + word.endMs) / 2;
            if (word.endMs > word.startMs && middle >= low && middle <= high) inside.push(word.wordIndex);
          }
          if (inside.length === 0) continue;
          // Whole lines where they fit: the aligner reads natural text, not a mid-line fragment.
          const firstLine = parsed.lines[parsed.lineOfWord[inside[0]] ?? 0];
          const lastLineIndex = parsed.lineOfWord[inside[inside.length - 1]] ?? 0;
          const lastLine = parsed.lines[lastLineIndex];
          let from = firstLine?.firstWord ?? inside[0];
          const to = lastLine !== undefined ? lastLine.firstWord + lastLine.words.length : inside[inside.length - 1] + 1;
          // The engine's 400-character contract: take the longest prefix that fits.
          let text = "";
          let end = from;
          for (let w = from; w < to; w += 1) {
            const piece = parsed.alignerWords[w] ?? "";
            const next = text.length === 0 ? piece : `${text} ${piece}`;
            if (next.length > MAX_ALIGN_TEXT_CHARS) break;
            text = next;
            end = w + 1;
          }
          if (end <= from) continue;
          diagnostics.passes += 1;
          let result: ForcedAlignResult | null = null;
          try {
            result = await raceAbort(align(audio, text, { language: "hinglish", signal }), signal);
          } catch (error) {
            if (isAbort(error, signal)) throw cancelled();
            result = null; // a broken aligner keeps the plan's prediction
          }
          if (result === null || result.words.length === 0) {
            diagnostics.nullWindows += 1;
            continue;
          }
          diagnostics.returned += result.words.length;
          const count = Math.min(result.words.length, end - from);
          for (let i = 0; i < count; i += 1) {
            const wordIndex = from + i;
            const word = result.words[i];
            if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.endMs <= word.startMs) continue;
            const local: Word = { text: parsed.words[wordIndex] ?? "", startMs: Math.round(word.startMs), endMs: Math.round(word.endMs), confidence: 0, index: 0, windowIndex: audio.window.index };
            const global = toGlobalWord(local, audio.window);
            if (global === null) continue;
            const predicted = plan.words[wordIndex];
            if (predicted === undefined) continue;
            // An anchored word's time was MEASURED by the transcript's own read of that word. The
            // teacher-forced pass is a second opinion with a coarser timing (B5: F1@100 0.115 vs free
            // 0.231), so it never overrides a measured anchor.
            if (predicted.support === "anchor") continue;
            const predictedMiddle = (predicted.startMs + predicted.endMs) / 2;
            const middle = (global.startMs + global.endMs) / 2;
            const confidence = forcedWordConfidence(word.logProbability, word.sharpness);
            // A structure word is only re-timed when the model is confident AND close to the plan. On Sajan
            // the wide guard let a 59-word window drag the chorus's first "Sajan" to 59.8 s (3.8 s before
            // the sung line); a confident 1.5 s correction is the honest use of this pass.
            if (confidence < 0.4) continue;
            if (!Number.isFinite(predictedMiddle) || Math.abs(middle - predictedMiddle) > 1500) continue;
            const previous = verified.get(wordIndex);
            if (previous !== undefined && previous.confidence >= confidence) continue;
            verified.set(wordIndex, { startMs: global.startMs, endMs: global.endMs, confidence, uncertain: confidence < DEFAULT_UNCERTAIN_CONFIDENCE });
          }
        }
      }
      diagnostics.verified = verified.size;

      /**
       * Wrong lyrics, after both kinds of evidence: a paste is this song when its anchors are structured
       * (plan looks right) OR when the teacher-forced pass confidently timed most of it on the audio. The
       * anchor test is what rejects a foreign paste even when the aligner "places" its words somewhere;
       * measured on Sajan the true lyrics anchor 15 of 25 lines with a 13-word run and the KING script
       * anchors 0 of 29 with a 2-word run. A rejected paste returns the transcript untouched.
       */
      const strongVerified = [...verified.values()].filter((word) => word.confidence >= 0.5).length;
      if (!lyricPlanLooksRight(plan, parsed.lines.length) && strongVerified < Math.max(2, Math.ceil(total * 0.6))) {
        return { words: [...heard], placed: 0, uncertain: 0, unmatchedLines: unmatchedAll(), inferred: 0, breakWords: [], diagnostics };
      }

      // ---- plan + verification -> the placed words (every pasted word has a prediction; only a word with
      // no voiced audio at all is left out, and it is reported as unmatched).
      let uncertainCount = 0;
      for (const word of plan.words) {
        const check = verified.get(word.wordIndex);
        const startMs = check?.startMs ?? word.startMs;
        const endMs = check?.endMs ?? word.endMs;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        const measured = word.support === "anchor" || check !== undefined;
        const confidence = check?.confidence ?? (word.support === "anchor" ? 0.9 : 0.25);
        const uncertain = check?.uncertain ?? !measured;
        placedWords.push({
          text: parsed.words[word.wordIndex] ?? "",
          startMs: Math.round(startMs),
          endMs: Math.round(endMs),
          confidence,
          index: 0,
          windowIndex: -1,
          ...(uncertain ? { uncertain: true } : {}),
        });
        placedIndices.add(word.wordIndex);
        if (!measured) diagnostics.approximate += 1;
        if (uncertain) uncertainCount += 1;
      }
      diagnostics.accepted = placedWords.length;
      if (placedWords.length === 0) {
        return { words: [...heard], placed: 0, uncertain: 0, unmatchedLines: unmatchedAll(), inferred: 0, breakWords: [], diagnostics };
      }

      /**
       * "Pasting lyrics must never make timing worse" (guidance [02:28] item 4). Two paths, cheapest first:
       *  - The paste IS the transcript (allowing spelling and a few words): every word takes the heard word's
       *    measured interval. On tts-words and studypoint this makes the pasted timing exactly the free
       *    transcription's timing (same starts/ends), which is the acceptance criterion.
       *  - Otherwise a placed word the transcript agrees with (same word, midpoint within 800 ms) borrows the
       *    heard interval (unchanged from R4). A rejected paste reports 0 borrowed.
       */
      const borrowed = borrowWholeTranscriptTiming(placedWords, heard);
      diagnostics.timingBorrowed = borrowed > 0 ? borrowed : borrowHeardTiming(placedWords, heard);

      // Claims: the placed run +- 350 ms. Heard words there are the transcript's guess at words the visitor
      // has now placed; outside every claim the transcript stays, so a partial paste cannot lose real words.
      for (const word of placedWords) {
        claimed.push({ startMs: Math.max(0, word.startMs - LYRIC_CLAIM_PAD_MS), endMs: word.endMs + LYRIC_CLAIM_PAD_MS });
      }
      const claims = mergeSpans(claimed);
      const orderedPlaced = [...placedWords].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
      const placedStarts = orderedPlaced.map((word) => word.startMs);
      /** True when a placed lyric word within the duplicate window says the same thing. */
      const duplicatesPlaced = (word: Word): boolean => {
        const middle = (word.startMs + word.endMs) / 2;
        let low = 0;
        let high = placedStarts.length;
        const probe = middle - LYRIC_DUPLICATE_WINDOW_MS - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (placedStarts[mid] < probe) low = mid + 1;
          else high = mid;
        }
        for (let i = low; i < orderedPlaced.length && orderedPlaced[i].startMs <= middle + LYRIC_DUPLICATE_WINDOW_MS; i += 1) {
          const other = orderedPlaced[i];
          if (Math.abs((other.startMs + other.endMs) / 2 - middle) <= LYRIC_DUPLICATE_WINDOW_MS && sameWord(other.text, word.text)) return true;
        }
        return false;
      };
      const voiceSpans = normalizeIntervals(allSpeech, 0);
      const keptHeard = heard.filter((word) => {
        const middle = (word.startMs + word.endMs) / 2;
        if (claims.some((span) => middle >= span.startMs && middle <= span.endMs)) return false;
        // Song mode: a heard word the vocal-activity detector says sits in an instrumental stretch is a
        // model guess (Sajan's "Meri" at 30.3 s, 0.9 s into the 30-47 s gap). The pasted plan is the answer
        // there, so the guess is not kept beside it.
        if (isMusic && voiceSpans.length > 0 && !voiceSpans.some((span) => middle >= span.startMs && middle <= span.endMs)) return false;
        return !duplicatesPlaced(word);
      });

      let words: Word[] = [];
      const orderedInput = [...orderedPlaced, ...keptHeard].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
      for (const word of orderedInput) {
        const startMs = words.length === 0 ? word.startMs : Math.max(word.startMs, words[words.length - 1].endMs);
        if (word.endMs <= startMs) continue;
        words.push({ ...word, startMs, endMs: word.endMs, index: words.length });
      }
      if (words.length === 0) return { words: [...heard], placed: 0, uncertain: 0, unmatchedLines: unmatchedAll(), inferred: 0, breakWords: [], diagnostics };

      /**
       * Repeats: if the pasted words hold a chorus once and the song's audio repeats it, place the same words
       * again and mark them `inferred`. This reuses the R3 trackers exactly as the transcript path does (same
       * audio probe, same confidence, same collision rule), and is guarded: repeat help is optional, the placed
       * words are already correct without it.
       */
      let inferred = 0;
      if (isMusic && repeatTracker !== null && readMs <= REPEAT_MAX_AUDIO_MS) {
        try {
          const match = repeatTracker.find();
          if (match !== null) {
            const transferred = transferRepeatedWords(words, match, {
              durationMs: readMs,
              similarityAt: (startMs, endMs, lagMs) =>
                Math.min(
                  repeatTracker.similarityAt(startMs, endMs, lagMs),
                  repeatTracker.similarityAt(Math.max(0, startMs - 750), endMs + 750, lagMs),
                ),
            });
            words = transferred.words;
            // Total inferred in the final list: the heard copies that survived in unclaimed spans plus the new ones.
            inferred = words.filter((word) => word.inferred === true).length;
          }
        } catch {
          /* the pasted words are already placed; a repeat copy is a bonus, never a condition */
        }
      }

      const unmatchedLines = unmatchedLyricLines(parsed, placedIndices);
      /**
       * Preferred caption breaks: the output-word index where each pasted line starts, for layoutCaptions.
       * A line's own break is a preference, never a rule: reading speed and the character limit win.
       */
      const breakWords: number[] = [];
      for (let lineIndex = 1; lineIndex < parsed.lines.length; lineIndex += 1) {
        const predicted = plan.lines[lineIndex];
        const firstWord = predicted !== undefined ? parsed.words[predicted.firstWord] : undefined;
        if (predicted === undefined || firstWord === undefined) continue;
        const at = words.findIndex((word) => word.startMs >= predicted.startMs - 600 && sameWord(word.text, firstWord));
        if (at > 0 && !breakWords.includes(at)) breakWords.push(at);
      }
      breakWords.sort((a, b) => a - b);
      return { words, placed: placedIndices.size, uncertain: uncertainCount, unmatchedLines, inferred, breakWords, diagnostics };
    };

    const ensureModels = async () => {
      if (modelsReady) return;
      const onDownload = (download: DownloadProgress) => emit("loading-model", "Getting the speech model ready", download, true);
      emit("loading-model", "Getting the speech model ready", undefined, true);
      await timed("loading-model", async () => {
        await raceAbort(deps.engine.load({ signal, onDownload }), signal).catch((error: unknown) => {
          throw asCaptionError(error, signal, "model-load", "The speech model could not start.");
        });
        try {
          await raceAbort(deps.aligner.load({ signal, onDownload }), signal);
        } catch (error) {
          if (isAbort(error, signal)) throw cancelled();
          // Timing is a nicety, words are the product: carry on with the model-free aligner.
          alignerInUse = fallback;
          await raceAbort(fallback.load({ signal }), signal);
        }
      });
      modelsReady = true;
    };

    const transcribe = async (audio: ReturnType<typeof assembleWindowAudio>, withHindi = false, bounds?: TranscribeBounds): Promise<WindowTranscript> => {
      let lastError: unknown;
      // One retry: a GPU hiccup or a one-off memory spike often passes the second time.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await raceAbort(
            deps.engine.transcribe(audio, { language: options.language, signal, glossary: options.glossary, music: isMusic && withHindi, bounds }),
            signal,
          );
        } catch (error) {
          if (isAbort(error, signal)) throw cancelled();
          lastError = error;
        }
      }
      throw asCaptionError(lastError, signal, "inference", "The speech model failed on part of the audio.");
    };

    const align = async (audio: ReturnType<typeof assembleWindowAudio>, transcript: WindowTranscript): Promise<Word[]> => {
      try {
        const aligned = await raceAbort(alignerInUse.align(audio, transcript, signal), signal);
        const valid =
          aligned.length === transcript.words.length &&
          aligned.every((word) => Number.isFinite(word.startMs) && Number.isFinite(word.endMs));
        if (!valid) throw new CaptionError("inference", "The aligner returned the wrong number of words or bad times.");
        return aligned;
      } catch (error) {
        if (isAbort(error, signal)) throw cancelled();
        if (alignerInUse === fallback) throw asCaptionError(error, signal, "inference", "Word timing failed.");
        return uniformAlign(audio, transcript);
      }
    };

    /** Counts the window as done and tells the screen, whether or not it produced words. `more` is false only for the very last window. */
    const finishWindow = (window: PackedWindow, more: boolean) => {
      windowsDone += 1;
      processedMs = Math.max(processedMs, windowSourceSpan(window).endMs);
      const { words, events } = publish(more);
      try {
        options.onPartial?.(events, words);
      } catch {
        /* same rule as onProgress */
      }
    };

    /**
     * One reading of one window (packed, a song retry, or a rescue slice), gated and timed. Adds nothing to the
     * transcript. `sharedAudio` lets the caller hand in audio it already assembled: the base read and the token vote
     * of the same window then hear the SAME samples array, which is what lets the engine encode that audio once.
     */
    const readTake = async (
      candidate: PackedWindow,
      withHindi = false,
      bounds?: TranscribeBounds,
      kind: ReadKind = "base",
      sharedAudio?: WindowAudio,
    ): Promise<ReadTake> => {
      const began = now();
      const audio = sharedAudio ?? assembleWindowAudio(candidate, store);
      const raw = await timed("transcribing", () => transcribe(audio, withHindi, bounds));
      if (signal.aborted) throw cancelled();
      /**
       * The read accounting line (see PipelineTuning.debugReads): the switch used to measure the encoder sharing, the
       * rescue-skip rule and the read budget in a real browser. `raw` is what the model wrote, `kept` what survived the
       * gates, `realLatin` how many usable lyric words the take ended up with.
       */
      const finish = (take: ReadTake): ReadTake => {
        if (debugReads) {
          const kept = take.words.map((word) => word.text);
          console.debug(
            `[captions] read win=${candidate.index} token=${withHindi ? "hi" : "en"} kind=${kind} raw=${raw.words.length} kept=${kept.length} realLatin=${scoreSongWords(kept).realLatin} lp=${Number.isFinite(raw.averageLogProbability) ? raw.averageLogProbability.toFixed(3) : "nan"} ms=${Math.round(now() - began)} text=${kept.join(" ").slice(0, 160)}`,
          );
        }
        return take;
      };
      // O1a: song mode trims junk-token runs and trailing decoder loops from a reading instead of letting one junk
      // tail delete a window that also holds real words. Speech mode keeps the reading exactly as the model wrote it.
      const { transcript, dropped: trimmedWords, cutLoop } = isMusic ? trimTranscriptReading(raw) : { transcript: raw, dropped: 0, cutLoop: false };
      const localSpeech = candidate.regions.map((region) => ({
        startMs: region.packOffsetMs,
        endMs: region.packOffsetMs + (region.sourceEndMs - region.sourceStartMs),
      }));
      const empty = { window: candidate, audio, words: [] as Word[], junk: true, sparse: true, flagged: false, transcript, dropped: trimmedWords, looped: cutLoop, rawWords: raw.words.length };
      if (transcript.words.length === 0) {
        // A reading that was nothing but junk is still counted as flagged: it was an unusable reading, not silence.
        return finish({ ...empty, flagged: trimmedWords > 0 });
      }
      // The model can answer in Devanagari (the Hindi token usually does, and the English token sometimes does on a
      // sung window); the product promises Latin letters, so such a reading is dropped, like junk. Its text is cleared
      // too, so the per-window token vote cannot mistake a rejected reading for a real one. Speech mode is untouched.
      if ((withHindi || isMusic) && transcript.words.some((word) => /[ऀ-ॿ]/u.test(word))) {
        return finish({ ...empty, transcript: { ...transcript, words: [], wordTimes: undefined, wordConfidence: undefined } });
      }

      // Gate 1, before the (possibly expensive) aligner: judge the text alone. The words are given
      // rough even times, so only the checks that need no real timing (repeats, loops, speed, the
      // model's own no-speech score, a junk token) can fire, which is what we want here.
      const textGate = evaluateTranscript(
        { words: uniformAlign(audio, transcript), speech: localSpeech, noSpeechProbability: transcript.noSpeechProbability },
        gateOptions,
      );
      if (textGate.reasons.some((reason) => INVENTED_REASONS.includes(reason))) {
        return finish({ ...empty, flagged: textGate.flagged, dropped: trimmedWords + transcript.words.length });
      }

      const aligned = (await timed("aligning", () => align(audio, transcript))).map((word) => ({
        ...word,
        startMs: Math.round(word.startMs),
        endMs: Math.round(word.endMs),
      }));
      if (signal.aborted) throw cancelled();
      // Music only: a decoder loop repeated the line and the aligner crushed the copy into the window's last
      // milliseconds. Kept as a safety net after song mode became vocal-only: a loop can still happen inside a sung
      // phrase, and dropping nine words is better than showing them stacked on one timestamp.
      const kept = isMusic ? dropCollapsedTail(aligned, candidate.usedMs) : aligned;
      const collapsed = aligned.length - kept.length;

      // Gate 2, on the real timings: words the aligner put in the padding or in inserted silence are
      // inventions. If most of them are, the whole window was noise.
      // Song mode: a 20 s retry hears 20 s of audio and 10 s of zeros; the aligner can put words in that padding, and
      // counting them as "outside speech" deleted the whole retry (all four Sajan retries measured 0 words this way)
      // even though `toGlobalWord` drops padding words anyway. Judge only the words that can become captions.
      const inWindow = isMusic ? kept.filter((word) => word.startMs < candidate.usedMs) : kept;
      const padding = kept.length - inWindow.length;
      const timingGate = evaluateTranscript({ words: inWindow, speech: localSpeech }, gateOptions);
      if (timingGate.reasons.includes("outside-speech")) {
        return finish({ ...empty, flagged: true, dropped: trimmedWords + aligned.length });
      }

      const globalWords: Word[] = [];
      let lost = 0;
      for (const word of inWindow) {
        const mapped = toGlobalWord(word, candidate);
        if (mapped) globalWords.push(mapped);
        else lost += 1;
      }
      return finish({
        window: candidate,
        audio,
        words: globalWords,
        junk: globalWords.length === 0 || isJunkText(transcript.words),
        sparse: isSparse(transcript),
        flagged: textGate.flagged,
        transcript,
        dropped: trimmedWords + lost + collapsed + padding,
        looped: cutLoop || hasSongLoop(transcript.words),
        rawWords: raw.words.length,
      });
    };

    /**
     * How much of a rescue slice is audio the vocal detector actually called vocal. The slice is always cut from the
     * window's own source span, and a window is only built from detected vocal intervals, so this can only shrink when
     * the window packed two phrases with an excluded gap between them.
     */
    const vocalMsIn = (window: PackedWindow, startMs: number, endMs: number) =>
      window.regions.reduce((sum, region) => sum + Math.max(0, Math.min(endMs, region.sourceEndMs) - Math.max(startMs, region.sourceStartMs)), 0);

    const processWindow = async (window: PackedWindow, more: boolean) => {
      if (signal.aborted) throw cancelled();
      await ensureModels();
      const known = Math.max(packer.windowsEmitted + packer.pendingWindowCount, windowsDone + 1);
      const label = readingDone ? `Transcribing ${windowsDone + 1} of ${known}` : `Transcribing part ${windowsDone + 1}`;
      emit("transcribing", label, undefined, true);

      /**
       * Song mode only, O1b: replace the old global `musicIsHard` latch with a per-window token vote. The base read
       * uses the normal token; a window that reads as nothing, one word, or under 3 real Latin words is read ONCE more
       * with the Hindi token and the better reading wins (real Latin words first, then junk, then sureness). Sajan is
       * the measured case: `<|en|>` reads 0-14.5 s and 59-80.85 s where `<|hi|>` is empty, while window 1 needs `hi`.
       * English files never do the second read: both tokens are `<|en|>` there. Every song read is bounded
       * (SONG_BASE_BOUNDS / SONG_EXTRA_READ_BOUNDS) so a looping decode cannot spend minutes of the job's time.
       *
       * The audio is assembled ONCE and handed to both reads: same samples object, so the engine encodes that window
       * once and the vote costs only its decode (measured: one hard window paid 4 encoder passes, now 2). Speech mode
       * assembles exactly as before and passes no bounds.
       */
      const baseAudio = assembleWindowAudio(window, store);
      /**
       * Lyrics only: keep this window's encoder output for the alignment pass that runs after the whole file. The
       * engine caches it under the window's own samples array (the same object the aligner will be handed), bounded,
       * and frees it on release. Songs already ask for it (SONG_BASE_BOUNDS), which is why the token vote is cheap.
       */
      const baseBounds: SongBounds | undefined = isMusic
        ? songBounds(SONG_BASE_BOUNDS)
        : lyricPlan !== null && alignText !== null
          ? LYRIC_KEEP_ENCODER_BOUNDS
          : undefined;
      const base = await readTake(window, false, baseBounds, "base", baseAudio);
      /** Song mode: model reads this window has asked for (see SONG_READ_BUDGET). */
      let reads = 1;
      // Lyrics only: the assembled audio of this base window is kept for the alignment pass that runs once the
      // whole file has been read. No file is re-read; this is the same array the model just heard.
      if (lyricPlan !== null && !lyricsTooLong) {
        if (readMs > LYRIC_MAX_AUDIO_MS) {
          lyricsTooLong = true;
          lyricQueue.length = 0;
        } else {
          lyricQueue.push(base.audio);
        }
      }
      /**
       * Real words of the reading: not a junk token, at least one Latin letter. English is written in Latin, so English
       * rap lines count exactly like Hinglish ones. A Devanagari reading never reaches this comparison (`readTake`
       * rejects it before the selection: the tool promises Latin letters), so "any language" cannot lose words here.
       */
      const realWordsIn = (take: ReadTake) => scoreSongWords(take.transcript.words).realLatin;
      let chosen = base;
      /**
       * wp-TS: the second, timestamped read of the SAME window. It is only a candidate: it replaces the normal read
       * only when it has MORE real words of any script (English counts), no junk-family word and no loop. One of the
       * five reads above, never a sixth; on a short window it also needs its own encoder pass (the frame-padded mel), on
       * a full 30 s window the encoder output is reused because both mel conventions are identical there.
       */
      let timestampWonBy = 0;
      if (
        isMusic &&
        timestampReadEnabled &&
        reads < songReadBudget &&
        window.usedMs >= TIMESTAMP_READ_MIN_USED_MS &&
        realWordsIn(base) < TIMESTAMP_READ_MAX_REAL_WORDS
      ) {
        reads += 1;
        const timestamp = await readTake(window, false, songBounds(SONG_TIMESTAMP_BOUNDS), "timestamp", baseAudio);
        const score = scoreSongWords(timestamp.transcript.words);
        if (!timestamp.looped && !timestamp.junk && score.junk === 0 && score.devanagari === 0 && score.realLatin > realWordsIn(base)) {
          timestampWonBy = score.realLatin - realWordsIn(base);
          chosen = timestamp;
        }
      }
      // The token vote is skipped when the timestamp read already won by 3+ real words: it is then the extra read the
      // budget paid for, and a second token vote would only spend the same slot again.
      if (isMusic && reads < songReadBudget && options.language !== "english" && isHardSongWindow(realWordsIn(chosen)) && timestampWonBy < 3) {
        reads += 1;
        const hindi = await readTake(window, true, songBounds(SONG_EXTRA_READ_BOUNDS), "vote", baseAudio);
        chosen = pickBetterSongReading(chosen, hindi, (take) => take.transcript.words, (take) => take.transcript.averageLogProbability);
      }

      /**
       * Song mode only, O2: a 30 s window that still has fewer than 3 real words is retried as independent 20 s
       * windows on a 10 s hop (measured: this reads 59-114 s where the 30 s plan reads nothing). No previous-text
       * conditioning (measured worse) and no shorter caps (measured to collapse). The retry uses the token that won
       * this window, and tries the other token once only when it reads nothing real.
       */
      const extras: ReadTake[] = [];
      if (isMusic && isHardSongWindow(realWordsIn(chosen))) {
        const baseSpan = windowSourceSpan(window);
        for (const span of planSongRetryWindows(baseSpan)) {
          if (reads >= songReadBudget) break;
          // A window that is already 20 s or shorter would be re-read as itself: no new audio, no new reading.
          if (span.startMs === baseSpan.startMs && span.endMs === baseSpan.endMs) continue;
          // The slice must already be read; otherwise its tail would reach the store as silence.
          if (span.endMs > store.endMs + 1000) continue;
          nextRescueIndex += 1;
          const retryWindow: PackedWindow = {
            index: nextRescueIndex,
            lengthMs: WINDOW_MS,
            usedMs: span.endMs - span.startMs,
            regions: [{ sourceStartMs: span.startMs, sourceEndMs: span.endMs, packOffsetMs: 0 }],
          };
          const preferred = chosen === base ? false : true;
          // One read per retry window. The plan allows one extra decode per hard window, and the second token inside a
          // retry doubled the calls for no measured gain (the retries returned 1-3 junk tokens with either token).
          reads += 1;
          const take = await readTake(retryWindow, preferred, songBounds(SONG_RETRY_BOUNDS), "retry");
          extras.push(take);
          // No early break after a junk retry. C2 once stopped the retry loop when the first 20 s slice returned a
          // single junk token, assuming the next slice would read the same. The assumption is wrong: KING's
          // ~120-149.5 s window returns "nan" for its first retry and then 18 real English words for its second, and
          // breaking early lost the whole 19-word rap line. Words beat seconds: both retry slices are always read, the
          // budget above pays for them, and `rescueAllowed` still skips the moved slices when the full retry plan
          // already returned nothing (the ~100 s saving C2 originally won).
        }
      }

      /**
       * Songs: a window that still holds nothing (or one word) is re-read from a slice that starts 10 s or 15 s
       * later, with the Hindi token, and the first real lyric replaces it. The detector gate: the slice is cut from
       * this window's span and must contain at least MUSIC_RESCUE_MIN_MS of detector-confirmed vocal audio, so a
       * window whose span never held that much vocal audio gets no rescue. A slice can still include instrumental
       * audio next to its vocal seconds; that is deliberate, because these moved slices are the measured way to
       * recover Sajan's 0:30-0:59 lines on the large model.
       *
       * The rescue is the last resort, not a third attempt after two failures: when the 20 s retries ran and both came
       * back with only junk, this span has already been re-read twice as independent windows, so the moved slices are
       * skipped (`rescueAllowed`). The measured rescue win (Sajan 0:15-0:30, 14 words) is a window that never gets
       * retries, because it already reads 3 real words. The two unreadable windows of each clip (KING window 3, Sajan
       * windows 2-3) spent 100 s on rescue slices that returned nothing. High tries +15 s first (every measured High
       * win); Draft keeps +10 s first (its second line). A recovery by the retries keeps its own rule: nothing more is
       * read then (`!extrasRecovered`).
       */
      const extrasRecovered = extras.some((take) => realWordsIn(take) > 0);
      /**
       * The rescue is the last resort, but only after the FULL retry plan failed. Both 20 s retries must have run and
       * read nothing: that means the span's own audio has no words (KING window 3), and a moved slice that overlaps the
       * same audio is more cost for nothing. This is where C2's saving comes from (~100 s on the clips measured). A
       * rescue is never skipped before both retries ran, because the second retry is exactly where KING's 19-word
       * English rap line was read (the old early break lost it). With `c2Time: false` a rescue is never skipped at all
       * (R3 behaviour).
       */
      const retriesExhausted = extras.length >= 2;
      // C2 rescue skip: with C2 on, two moved retries that read nothing mean this span has no readable audio, so the
      // rescue slices are skipped (the measured ~100 s saving). With C2 off, R3 behaviour: a rescue is never skipped.
      const rescueAllowed = !c2Time || !(retriesExhausted && !extrasRecovered);
      if (isMusic && rescueAllowed && !extrasRecovered && (chosen.junk || chosen.sparse || realWordsIn(chosen) < SONG_RESCUE_MIN_REAL_WORDS)) {
        const span = windowSourceSpan(window);
        for (const offset of rescueOffsets) {
          if (reads >= songReadBudget) break;
          const startMs = span.startMs + offset;
          const endMs = Math.min(span.endMs, startMs + WINDOW_MS);
          if (endMs - startMs < MUSIC_RESCUE_MIN_MS) continue;
          if (vocalMsIn(window, startMs, endMs) < MUSIC_RESCUE_MIN_MS) continue;
          // The slice must already be read; otherwise its tail would reach the store as silence.
          if (endMs > store.endMs + 1000) continue;
          nextRescueIndex += 1;
          const slice: PackedWindow = {
            index: nextRescueIndex,
            lengthMs: WINDOW_MS,
            usedMs: endMs - startMs,
            regions: [{ sourceStartMs: startMs, sourceEndMs: endMs, packOffsetMs: 0 }],
          };
          // The rescue keeps the engine's shifted second take: it is the measured recovery path for 0:15-0:30 and the
          // second take is what read 18 real words where the first gave 2 on the product's own run.
          reads += 1;
          const take = await readTake(slice, true, songBounds(SONG_BASE_BOUNDS), "rescue");
          // The rescue must add a real line, not repeat the words the window already read from a different slice: the
          // +10 s slice of Sajan's window 0 returned the same "Kya der hai," at shifted times, which would show the
          // line twice. Only a reading with at least 3 more real words than the window's own is kept, then the loop
          // goes on to the +15 s slice (the measured 16-word recovery of 0:15-0:30).
          if (!take.junk && !take.sparse && isUsableLyrics(take.transcript.words) && realWordsIn(take) >= realWordsIn(chosen) + 3) {
            extras.push(take);
            break;
          }
        }
      }

      if (base.flagged) flaggedWindows += 1;
      droppedWords += base.dropped;
      if (chosen !== base) droppedWords += chosen.dropped;
      for (const take of extras) droppedWords += take.dropped;
      // One window may now contribute several reads (the 30 s window, its 20 s retries, a rescue slice). The
      // accumulator needs them in time order, and it merges them with the same sewn-seam rules as any windows.
      const contributions = [{ window: chosen.window, words: chosen.words }, ...extras.map((take) => ({ window: take.window, words: take.words }))]
        .filter((item) => item.words.length > 0)
        // Time order; on an equal start the LONGER window (more context) goes first, so a 20 s retry cannot outrank the
        // 30 s reading it overlaps at the window's first 10 s (mergeWindowWords gives margin ties to the earlier entry).
        .sort((a, b) => windowSourceSpan(a.window).startMs - windowSourceSpan(b.window).startMs || windowSourceSpan(b.window).endMs - windowSourceSpan(a.window).endMs);
      for (const item of contributions) accumulator.add({ coverage: windowSourceSpan(item.window), words: item.words });
      finishWindow(window, more);
    };

    const drain = async (final: boolean) => {
      const windows = packer.take(final);
      // Only the last window of the final drain is known to be the last: after any other a window may still overlap it.
      for (let i = 0; i < windows.length; i += 1) await processWindow(windows[i], !final || i < windows.length - 1);
    };

    const afterVad = async (closed: SpeechInterval[], final: boolean) => {
      for (const interval of closed) {
        allSpeech.push(interval);
        lastClosedEndMs = Math.max(lastClosedEndMs, interval.endMs);
      }
      packer.add(closed);
      await drain(final);
      // Keep audio only from the first speech still waiting. Speech the detector has not closed yet
      // starts after the last closed interval (give or take padding), so keep a little before that.
      const floor =
        packer.firstPendingStartMs ?? (Number.isFinite(lastClosedEndMs) ? Math.max(0, lastClosedEndMs - OPEN_INTERVAL_LOOKBACK_MS) : 0);
      store.discardBefore(floor);
      if (store.retainedMs > maxRetainedMs) store.discardBefore(store.endMs - maxRetainedMs);
      tuning.onRetained?.(store.retainedMs);
    };

    let iterator: AsyncIterator<PcmChunk> | null = null;
    /** True while a `next()` call has not settled. A stuck decoder never settles it, and `return()` would queue behind it. */
    let nextPending = false;
    try {
      // Inside the try so a decoder that fails at once is reported as undecodable and the source is still closed.
      try {
        iterator = source.chunks(signal)[Symbol.asyncIterator]();
      } catch (error) {
        throw asCaptionError(error, signal, "unsupported-file", "The audio could not be decoded.");
      }
      const chunkIterator = iterator;
      const detector: VoiceDetector = songDetector ?? deps.vad;
      detector.reset();
      emit("finding-speech", "Listening for speech", undefined, true);
      for (;;) {
        const step = await timed("reading-audio", () => {
          nextPending = true;
          const pending = (async () => chunkIterator.next())();
          const settled = () => {
            nextPending = false;
          };
          void pending.then(settled, settled);
          return raceAbort(pending, signal).catch((error: unknown) => {
            throw asCaptionError(error, signal, "unsupported-file", "The audio could not be decoded.");
          });
        });
        if (step.done) break;
        const chunk = step.value;
        if (signal.aborted) throw cancelled();
        store.push(chunk);
        repeatTracker?.push(chunk);
        readMs = Math.max(readMs, chunk.startMs + (chunk.samples.length / 16_000) * 1000);
        const closed = await timed("finding-speech", () =>
          raceAbort(detector.push(chunk, signal), signal).catch((error: unknown) => {
            throw asCaptionError(error, signal, "internal", "Finding speech failed.");
          }),
        );
        await afterVad(closed, false);
        emit("finding-speech", "Listening for speech");
      }

      const tail = await timed("finding-speech", () =>
        raceAbort(detector.flush(), signal).catch((error: unknown) => {
          throw asCaptionError(error, signal, "internal", "Finding speech failed.");
        }),
      );
      readingDone = true;
      await afterVad(tail, true);
      if (allSpeech.length === 0) throw new CaptionError("no-speech", "No speech was found in this file.");

      emit("finishing", "Putting the captions together", undefined, true);
      // The last window already published the final list (its `more` flag is false), so reuse it instead of paying for
      // the same merge, junk filter and repeat pass a second time. The fallback keeps a job with no final window safe.
      const heard = await timed("finishing", async () => lastFinal ?? publish(false));
      const speech = normalizeIntervals(allSpeech, 0);
      let words = heard.words;
      let events = heard.events;
      /** Set only when the visitor pasted words: how much of the paste the audio supported. */
      let lyricsStats: LyricsStats | undefined;
      /** Song mode: inferred words of the final lyric-based list (replaces the transcript's own count). */
      let lyricInferred: number | null = null;

      if (lyricPlan !== null) {
        const lyricTotal = lyricPlan.words.length;
        const reportUnplaced = (unmatchedLines: string[], unsupported = false): LyricsStats => ({
          lines: lyricPlan.lines.length,
          placed: 0,
          uncertain: 0,
          unmatched: lyricTotal,
          unmatchedLines,
          ...(unsupported ? { unsupported: true } : {}),
        });
        if (!lyricsTooLong && lyricQueue.length > 0) {
          try {
            // The aligner is optional (PLAN-R5 Track 1 item 5): without one, the global plan still places the
            // visitor's words from the transcript's anchors, the vocal-activity spans and the syllable share,
            // and every word is reported as approximate. The box must not be useless on Draft.
            const outcome = await timed("aligning", () => alignLyrics(lyricPlan, heard.words, alignText));
            if (outcome.placed > 0 && outcome.words.length > 0) {
              words = outcome.words;
              events = layoutCaptions(words, { ...tuning.layout, preferredBreakBefore: outcome.breakWords });
              lyricInferred = outcome.inferred;
            }
            lyricsStats = {
              lines: lyricPlan.lines.length,
              placed: outcome.placed,
              uncertain: outcome.uncertain,
              unmatched: lyricTotal - outcome.placed,
              unmatchedLines: outcome.unmatchedLines,
              returned: outcome.diagnostics.returned,
              accepted: outcome.diagnostics.accepted,
              nullWindows: outcome.diagnostics.nullWindows,
              passes: outcome.diagnostics.passes,
              timingBorrowed: outcome.diagnostics.timingBorrowed,
              approximate: outcome.diagnostics.approximate,
            };
          } catch (error) {
            // The visitor's own stop is a stop; anything else keeps the transcript they already have.
            if (isAbort(error, signal)) throw cancelled();
            lyricsStats = reportUnplaced([]);
          }
        } else {
          // Past the alignment budget: say so in the stats instead of forcing words on audio nobody looked at.
          lyricsStats = reportUnplaced([], alignText === null && lyricQueue.length === 0);
        }
      }

      const stats: PipelineStats = {
        audioSeconds: readMs / 1000,
        speechSeconds: speech.reduce((sum, item) => sum + (item.endMs - item.startMs), 0) / 1000,
        windows: windowsDone,
        flaggedWindows,
        droppedWords: droppedWords + droppedFromJunk,
        ...(isMusic ? { inferredWords: lyricInferred ?? inferredWords } : {}),
        ...(lyricsStats ? { lyrics: lyricsStats } : {}),
        stageMs,
        engineId: deps.engine.id,
        alignerId: alignerInUse.id,
      };
      const result: CaptionResult = { words, events, stats, uncoveredSpeech: auditCoverage(words, speech, UNCOVERED_MIN_MS).gaps };
      lastFraction = 1;
      try {
        options.onProgress?.({ stage: "finishing", fraction: 1, message: "Done" });
      } catch {
        /* see above */
      }
      return result;
    } finally {
      const returning = silently(async () => {
        await iterator?.return?.();
      });
      // A stuck next() would hold return() (and so the close) up for ever: let go of the iterator and close the file anyway.
      if (!nextPending) await waitAtMost(returning, cleanupTimeoutMs);
      await waitAtMost(silently(() => source.close()), cleanupTimeoutMs);
      store.clear();
    }
  }

  return {
    async run(file, options) {
      if (disposed) throw new CaptionError("internal", "This pipeline has been disposed.");
      if (active) throw new CaptionError("internal", "A captioning job is already running on this pipeline.");
      const controller = new AbortController();
      // Claim the pipeline BEFORE any job code runs: the job calls back into the screen (onProgress) on its
      // first step, and that callback may call run() or dispose() again.
      let finish: () => void = () => undefined;
      const slot = {
        controller,
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      };
      active = slot;
      const outer = options.signal;
      const onOuterAbort = () => controller.abort();
      if (outer?.aborted) controller.abort();
      else outer?.addEventListener("abort", onOuterAbort, { once: true });

      try {
        // A previous failed job may still be releasing its models; wait for that, but not for ever.
        await waitAtMost(pendingCleanup, cleanupTimeoutMs);
        const job = runJob(file, options, controller.signal);
        job.then(finish, finish);
        return await job;
      } catch (error) {
        finish();
        // A failed or cancelled job must not leave models in memory or the detector mid-file. Releasing can be
        // stuck behind a model call that cannot be cancelled, so the caller gets its answer now and the release
        // finishes in the background (the next run, and dispose, wait for it, bounded).
        deps.vad.reset();
        pendingCleanup = releaseModels();
        throw asCaptionError(error, controller.signal, "internal", "Captioning failed unexpectedly.");
      } finally {
        outer?.removeEventListener("abort", onOuterAbort);
        if (active === slot) active = null;
      }
    },

    async prewarm(prewarmSignal) {
      if (disposed || active) return;
      await waitAtMost(pendingCleanup, cleanupTimeoutMs);
      if (disposed || active) return;
      await silently(() => deps.engine.load({ signal: prewarmSignal }));
    },

    async unloadModels() {
      if (disposed || active) return;
      // The unload claims the pipeline: it becomes the "cleanup in progress" that every later run and prewarm waits for, so a run
      // started while the models are being released starts them again afterwards instead of finding them half gone.
      const release = Promise.all([silently(() => deps.vad.release()), releaseModels()]).then(() => undefined);
      const previous = pendingCleanup;
      pendingCleanup = Promise.all([previous, release]).then(() => undefined);
      await waitAtMost(pendingCleanup, cleanupTimeoutMs);
    },

    async dispose() {
      disposed = true;
      if (active) {
        active.controller.abort();
        await waitAtMost(active.finished, cleanupTimeoutMs);
      }
      // In parallel and bounded: one release stuck behind a busy model must not keep the others from running.
      await waitAtMost(Promise.all([pendingCleanup, silently(() => deps.vad.release()), releaseModels()]), cleanupTimeoutMs);
    },
  };
}
