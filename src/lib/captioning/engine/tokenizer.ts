/**
 * Whisper's tokenizer, decode side only: the engine feeds the model a fixed prompt of special
 * token ids and gets token ids back, so it never has to turn text into ids.
 *
 * Whisper writes text as "byte-level BPE": every UTF-8 byte of the text is shown as one printable
 * character (so a space becomes "Ġ" and each byte of a Devanagari letter becomes its own symbol),
 * and a token is a run of those symbols. To read text back we map each symbol to its byte and
 * decode the whole byte string as UTF-8. Decoding bytes of ALL tokens together matters: one
 * Devanagari letter or emoji can be split across several tokens.
 *
 * The vocabulary comes from bytes the caller already downloaded (hash-checked by model-loader),
 * so this file never touches the network.
 */

import { CaptionError } from "../contracts";

export interface SpecialTokens {
  /** End of text: the model's "I am done" token. Every id at or above it is special, never text. */
  eot: number;
  sot: number;
  transcribe: number;
  noTimestamps: number;
  /** The "no speech here" token whose first-step probability tells silence from speech. */
  noSpeech: number;
  /** "<|startofprev|>": what comes before it is earlier text given to the model as a hint. Absent in vocabularies that lack it. */
  startOfPrev?: number;
}

export interface WhisperTokenizer {
  readonly special: SpecialTokens;
  /** Highest token id plus one. */
  readonly vocabSize: number;
  /** The id of a token by its exact name, e.g. "<|en|>". */
  tokenId(name: string): number | undefined;
  /** True for ids that are not text: end of text, language/task markers, timestamps. */
  isSpecial(id: number): boolean;
  /** Text of the ids, special tokens skipped. */
  decode(ids: readonly number[]): string;
  /**
   * The ids for a piece of text (byte-level BPE, as Whisper reads it). Used to give the model a hint of names and words before it
   * listens. Special-token markers inside the text are NOT turned into special ids: they are encoded as plain text.
   */
  encode(text: string): number[];
}

/** GPT-2's pre-tokenizer: contractions, words, numbers, symbols and runs of spaces, each with its leading space. */
const PRETOKENIZER = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/** The standard multilingual Whisper layout, used only when the files give no names for the special tokens. */
const MULTILINGUAL_FALLBACK: SpecialTokens & { en: number } = { eot: 50257, sot: 50258, en: 50259, transcribe: 50359, noTimestamps: 50363, noSpeech: 50362 };
const MULTILINGUAL_BASE_VOCAB = 50257;

/** The printable character for each byte, the inverse of SYMBOL_TO_BYTE below. */
const BYTE_TO_SYMBOL: string[] = [];

/** GPT-2's byte to printable-character table, inverted so a symbol maps back to its byte. */
function buildSymbolToByte(): Map<string, number> {
  const printable: number[] = [];
  for (let b = 33; b <= 126; b += 1) printable.push(b);
  for (let b = 161; b <= 172; b += 1) printable.push(b);
  for (let b = 174; b <= 255; b += 1) printable.push(b);
  const known = new Set(printable);
  const map = new Map<string, number>();
  let extra = 0;
  for (let b = 0; b < 256; b += 1) {
    if (known.has(b)) map.set(String.fromCodePoint(b), b);
    else {
      map.set(String.fromCodePoint(256 + extra), b);
      extra += 1;
    }
  }
  return map;
}

const SYMBOL_TO_BYTE = buildSymbolToByte();
for (const [symbol, byte] of SYMBOL_TO_BYTE) BYTE_TO_SYMBOL[byte] = symbol;

function parseJson(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new CaptionError("model-load", `The ${what} file is not valid JSON.`, { cause });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIdMap(value: unknown, what: string): Map<string, number> {
  if (!isRecord(value)) throw new CaptionError("model-load", `The ${what} is not a token table.`);
  const map = new Map<string, number>();
  for (const [token, id] of Object.entries(value)) {
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0) throw new CaptionError("model-load", `The ${what} has a bad id for "${token}".`);
    map.set(token, id);
  }
  return map;
}

/**
 * `vocab` is either Whisper's `vocab.json` ({ token: id }) or a Hugging Face `tokenizer.json`
 * (its `model.vocab` plus `added_tokens`). `addedTokens` is the separate `added_tokens.json`
 * some exports ship for the special tokens.
 */
export function createWhisperTokenizer(input: { vocab: Uint8Array; addedTokens?: Uint8Array }): WhisperTokenizer {
  const root = parseJson(input.vocab, "vocabulary");
  const table = new Map<string, number>();

  if (isRecord(root) && isRecord(root.model) && "vocab" in root.model) {
    for (const [token, id] of toIdMap(root.model.vocab, "tokenizer vocabulary")) table.set(token, id);
    if (Array.isArray(root.added_tokens)) {
      for (const entry of root.added_tokens) {
        if (isRecord(entry) && typeof entry.content === "string" && typeof entry.id === "number") table.set(entry.content, entry.id);
      }
    }
  } else {
    for (const [token, id] of toIdMap(root, "vocabulary")) table.set(token, id);
  }
  if (input.addedTokens) {
    for (const [token, id] of toIdMap(parseJson(input.addedTokens, "added tokens"), "added tokens")) table.set(token, id);
  }

  let maxId = -1;
  for (const id of table.values()) if (id > maxId) maxId = id;
  if (maxId < 255) throw new CaptionError("model-load", "The vocabulary is too small to be a Whisper vocabulary.");

  const byId: (string | undefined)[] = new Array<string | undefined>(maxId + 1).fill(undefined);
  for (const [token, id] of table) byId[id] = token;

  const named = (name: string) => table.get(name);
  const baseVocab = (() => {
    let top = -1;
    for (const [token, id] of table) if (!token.startsWith("<|") && id > top) top = id;
    return top + 1;
  })();

  let special: SpecialTokens;
  const eot = named("<|endoftext|>");
  const sot = named("<|startoftranscript|>");
  const transcribe = named("<|transcribe|>");
  const noTimestamps = named("<|notimestamps|>");
  const noSpeech = named("<|nocaptions|>") ?? named("<|nospeech|>");
  if (eot !== undefined && sot !== undefined && transcribe !== undefined && noTimestamps !== undefined && noSpeech !== undefined) {
    special = { eot, sot, transcribe, noTimestamps, noSpeech, startOfPrev: named("<|startofprev|>") };
  } else if (baseVocab === MULTILINGUAL_BASE_VOCAB) {
    special = { eot: MULTILINGUAL_FALLBACK.eot, sot: MULTILINGUAL_FALLBACK.sot, transcribe: MULTILINGUAL_FALLBACK.transcribe, noTimestamps: MULTILINGUAL_FALLBACK.noTimestamps, noSpeech: MULTILINGUAL_FALLBACK.noSpeech, startOfPrev: named("<|startofprev|>") ?? 50361 };
    for (const [name, id] of [["<|endoftext|>", special.eot], ["<|startoftranscript|>", special.sot], ["<|en|>", MULTILINGUAL_FALLBACK.en], ["<|transcribe|>", special.transcribe], ["<|notimestamps|>", special.noTimestamps], ["<|nocaptions|>", special.noSpeech]] as const) {
      if (!table.has(name)) table.set(name, id);
    }
  } else {
    throw new CaptionError("model-load", "The vocabulary does not name Whisper's special tokens and is not the standard multilingual layout.");
  }

  // Counted only now: the fallback above may have added special tokens above the highest id in the files.
  let vocabSize = maxId + 1;
  for (const id of table.values()) if (id + 1 > vocabSize) vocabSize = id + 1;

  const decoder = new TextDecoder("utf-8", { fatal: false });

  // ---- encoding: byte-level BPE with the merge list from tokenizer.json ----
  const mergeRanks = new Map<string, number>();
  if (isRecord(root) && isRecord(root.model) && Array.isArray(root.model.merges)) {
    root.model.merges.forEach((entry: unknown, rank: number) => {
      const pair = typeof entry === "string" ? entry : Array.isArray(entry) ? entry.join(" ") : null;
      if (pair !== null && !mergeRanks.has(pair)) mergeRanks.set(pair, rank);
    });
  }
  const bpe = (symbols: string[]): string[] => {
    const parts = [...symbols];
    while (parts.length > 1) {
      let bestRank = Number.POSITIVE_INFINITY;
      let bestAt = -1;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const rank = mergeRanks.get(`${parts[i]} ${parts[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          bestAt = i;
        }
      }
      if (bestAt < 0) break;
      parts.splice(bestAt, 2, parts[bestAt] + parts[bestAt + 1]);
    }
    return parts;
  };
  const encoder = new TextEncoder();
  const encodeText = (text: string): number[] => {
    const ids: number[] = [];
    for (const match of text.matchAll(PRETOKENIZER)) {
      const symbols = [...encoder.encode(match[0])].map((byte) => BYTE_TO_SYMBOL[byte]);
      for (const piece of bpe(symbols)) {
        const id = table.get(piece);
        if (id !== undefined && id < special.eot) ids.push(id);
        else for (const symbol of piece) {
          const single = table.get(symbol);
          if (single !== undefined && single < special.eot) ids.push(single);
        }
      }
    }
    return ids;
  };

  return {
    special,
    vocabSize,
    tokenId: (name) => table.get(name),
    encode: encodeText,
    isSpecial: (id) => id >= special.eot,
    decode(ids) {
      const bytes: number[] = [];
      for (const id of ids) {
        if (id >= special.eot) continue;
        const token = byId[id];
        if (token === undefined) continue;
        for (const symbol of token) {
          const byte = SYMBOL_TO_BYTE.get(symbol);
          if (byte !== undefined) bytes.push(byte);
        }
      }
      return decoder.decode(Uint8Array.from(bytes));
    },
  };
}

/**
 * Splits decoded text into words by whitespace. Punctuation stays on its word ("hai," is one
 * word) because the layout and export code expect it that way.
 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word.length > 0);
}
