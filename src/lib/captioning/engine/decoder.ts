/**
 * Greedy Whisper decoding with a key/value cache, for the "merged decoder" ONNX export
 * (Optimum / transformers.js layout):
 *
 *   inputs : input_ids [1, n] int64, encoder_hidden_states, use_cache_branch [1] bool,
 *            past_key_values.{layer}.{decoder|encoder}.{key|value}
 *   outputs: logits [1, n, vocab], present.{layer}.{decoder|encoder}.{key|value}
 *
 * Step 1 feeds the whole prompt with `use_cache_branch = false` and EMPTY past tensors; every later
 * step feeds just the newest token with `use_cache_branch = true` and the cache from the step
 * before. The "encoder" half of the cache (what the audio looks like to each layer) never changes
 * after step 1, so it is kept from step 1 and the repeated copies the model returns are freed.
 *
 * Only the logits are read back to the CPU, once per step. The cache stays wherever the runtime
 * keeps it (on the GPU for WebGPU).
 *
 * The step logic is pure apart from `session.run` and tensor creation, so tests drive it with a
 * fake session.
 */

import { CaptionError } from "../contracts";
import type { SpecialTokens } from "./tokenizer";
import type { InferenceSessionLike, OrtRuntime, TensorLike } from "./session";

export interface DecoderTensorNames {
  inputIds: string;
  encoderHiddenStates: string;
  useCacheBranch: string;
  logits: string;
  pastPrefix: string;
  presentPrefix: string;
}

export const DEFAULT_DECODER_NAMES: DecoderTensorNames = {
  inputIds: "input_ids",
  encoderHiddenStates: "encoder_hidden_states",
  useCacheBranch: "use_cache_branch",
  logits: "logits",
  pastPrefix: "past_key_values",
  presentPrefix: "present",
};

/** Whisper base: 8 attention heads of 64 values. Used only to shape the empty cache of step 1. */
export interface DecoderShape {
  heads: number;
  headDim: number;
}

/** See DecodeParams.maxEndBlocks. */
export const DEFAULT_MAX_END_BLOCKS = 12;

export const WHISPER_BASE_SHAPE: DecoderShape = { heads: 8, headDim: 64 };

export interface RepetitionRule {
  /** Length of the repeated run of tokens. */
  n: number;
  /** How many times in a row it must repeat to count as a loop. */
  times: number;
}

/** Whisper's classic failure is looping on a phrase. Stop on a 4-token run three times, or one token ten times. */
export const DEFAULT_REPETITION_RULES: readonly RepetitionRule[] = [
  { n: 4, times: 3 },
  { n: 1, times: 10 },
];

export interface DecodeParams {
  session: InferenceSessionLike;
  runtime: Pick<OrtRuntime, "createTensor">;
  /** Output of the encoder for this window. Not disposed here: the caller owns it. */
  encoderHiddenStates: TensorLike;
  /** Token ids fed first, e.g. [sot, en, transcribe, notimestamps]. Must contain `special.sot`. */
  prompt: readonly number[];
  special: SpecialTokens;
  /** Token ids never allowed, on top of every special/timestamp id above end-of-text. */
  suppress: ReadonlySet<number>;
  /** Token ids not allowed as the very first generated token (a bare space, or an instant end). */
  suppressAtStart: ReadonlySet<number>;
  /** Most tokens to generate after the prompt. */
  maxNewTokens: number;
  /**
   * Extra decoder outputs to read every step (e.g. cross-attention tensors for word timing). Each is copied to a
   * plain array and passed to `onStep`, then freed at once. Without it only the logits and the cache are fetched.
   */
  extra?: { names: readonly string[]; onStep: (step: number, tensors: Record<string, { data: Float32Array; dims: number[] }>, inputIds: readonly number[]) => void };
  /**
   * End-of-text is not allowed until this many tokens exist. Whisper sometimes ends a window after one word
   * ("nan?") although speech continues; the caller passes a floor based on the speech the detector found.
   */
  minNewTokens?: number;
  /** Most steps in one decode where end-of-text may be blocked by `minNewTokens`; after that the model may end. Bounds invented text. Default 12. */
  maxEndBlocks?: number;
  /**
   * Whisper's timestamp decoding (openai/whisper `ApplyTimestampRules`). When set, timestamp ids are allowed instead
   * of being masked above end-of-text: the first token must be a timestamp no later than `maxInitialTimestampIndex`,
   * timestamps come in pairs, they never decrease, and a timestamp is forced when the timestamp mass beats the best
   * text token. The read stops at the first completed timestamp pair (or end-of-text) and timestamp ids are left out
   * of `tokenIds` / `tokenLogProbs`. Off by default, so every existing call decodes exactly as before.
   */
  timestampRules?: boolean;
  /** Highest initial timestamp index allowed, in 20 ms units. Default 50 (<|1.00|>). Only used with `timestampRules`. */
  maxInitialTimestampIndex?: number;
  shape?: DecoderShape;
  names?: DecoderTensorNames;
  repetitionRules?: readonly RepetitionRule[];
  signal?: AbortSignal;
}

export type DecodeStop = "eot" | "max-tokens" | "repetition" | "timestamp";

export interface DecodeResult {
  /** Generated tokens only: the prompt and the end-of-text token are not included. */
  tokenIds: number[];
  /** Chance the model gave to "no speech" before it wrote anything. 0..1. */
  noSpeechProbability: number;
  /** Mean log-probability of the chosen tokens, end-of-text included. <= 0. */
  averageLogProbability: number;
  /** Log-probability of each generated token, same order and length as `tokenIds` (end-of-text not included). <= 0. */
  tokenLogProbs: number[];
  /** How many times the model wanted to end but `minNewTokens` did not let it. Above 0 means the text was pushed past an early stop. */
  endBlocked: number;
  stop: DecodeStop;
}

/**
 * If the tail of `tokens` is a run of `n` tokens repeated `times` times in a row, returns the length
 * to cut back to so ONE copy of the run stays; otherwise -1.
 */
export function findRepetitionCut(tokens: readonly number[], rules: readonly RepetitionRule[]): number {
  for (const { n, times } of rules) {
    const span = n * times;
    if (n < 1 || times < 2 || tokens.length < span) continue;
    const start = tokens.length - span;
    let same = true;
    for (let i = n; i < span && same; i += 1) {
      if (tokens[start + i] !== tokens[start + (i % n)]) same = false;
    }
    if (same) return tokens.length - n * (times - 1);
  }
  return -1;
}

/** log(sum(exp(x))) over the finite entries, computed without overflow. */
function logSumExp(values: Float32Array, from: number, to: number): number {
  let max = -Infinity;
  for (let i = from; i < to; i += 1) if (values[i] > max) max = values[i];
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += Math.exp(values[i] - max);
  return max + Math.log(sum);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.");
}

const PAST_NAME = /^(.*)\.(\d+)\.(decoder|encoder)\.(key|value)$/;

/** Which cache inputs the decoder has, and the matching output name for each. Fails early if the model is not the layout we expect. */
function cacheLayout(session: InferenceSessionLike, names: DecoderTensorNames) {
  const entries: { input: string; output: string; encoderSide: boolean }[] = [];
  for (const input of session.inputNames) {
    const match = PAST_NAME.exec(input);
    if (!match || match[1] !== names.pastPrefix) continue;
    const output = `${names.presentPrefix}.${match[2]}.${match[3]}.${match[4]}`;
    if (!session.outputNames.includes(output)) throw new CaptionError("model-load", `The decoder has input "${input}" but no matching output "${output}".`);
    entries.push({ input, output, encoderSide: match[3] === "encoder" });
  }
  for (const required of [names.inputIds, names.encoderHiddenStates, names.useCacheBranch]) {
    if (!session.inputNames.includes(required)) throw new CaptionError("model-load", `The decoder has no input named "${required}". This is not the model layout the engine expects.`);
  }
  if (!session.outputNames.includes(names.logits)) throw new CaptionError("model-load", `The decoder has no output named "${names.logits}".`);
  if (entries.length === 0) throw new CaptionError("model-load", "The decoder has no key/value cache inputs. A merged decoder with a cache is required.");
  return entries;
}

export function checkDecoderSession(session: InferenceSessionLike, names: DecoderTensorNames = DEFAULT_DECODER_NAMES): void {
  cacheLayout(session, names);
}

export async function decodeGreedy(params: DecodeParams): Promise<DecodeResult> {
  const { session, runtime, special, prompt, signal } = params;
  const names = params.names ?? DEFAULT_DECODER_NAMES;
  const shape = params.shape ?? WHISPER_BASE_SHAPE;
  const rules = params.repetitionRules ?? DEFAULT_REPETITION_RULES;
  const timestampRules = params.timestampRules === true;
  /** First timestamp id: `<|0.00|>` sits immediately after `<|notimestamps|>` in Whisper's vocabulary. */
  const timestampBegin = special.noTimestamps + 1;
  const layout = cacheLayout(session, names);
  const sotIndex = prompt.indexOf(special.sot);
  if (sotIndex < 0) throw new CaptionError("internal", "The decoder prompt has no start-of-transcript token.");
  if (params.maxNewTokens < 1) throw new CaptionError("internal", "maxNewTokens must be at least 1.");

  /** Every tensor we made or were handed and still hold. Freed in `finally` so an error or abort leaks nothing. */
  const live = new Set<TensorLike>();
  const track = <T extends TensorLike>(tensor: T): T => {
    live.add(tensor);
    return tensor;
  };
  const free = (tensor: TensorLike | undefined) => {
    if (tensor && live.delete(tensor)) tensor.dispose();
  };

  const fetchNames = [names.logits, ...layout.map((entry) => entry.output), ...(params.extra?.names ?? [])];

  const generated: number[] = [];
  const logProbs: number[] = [];
  /** Every generated id including timestamps, for the pair / monotonic rules. Only used in timestamp mode. */
  const sequence: number[] = [];
  let noSpeechProbability = 0;
  let stop: DecodeStop = "max-tokens";
  let endBlocked = 0;
  let cache = new Map<string, TensorLike>(); // input name -> tensor for the NEXT step
  let work: Float32Array | null = null;

  try {
    let input: number[] = [...prompt];
    for (let step = 0; step < params.maxNewTokens; step += 1) {
      throwIfAborted(signal);
      const first = step === 0;

      const ids = track(runtime.createTensor("int64", BigInt64Array.from(input, (id) => BigInt(id)), [1, input.length]));
      const useCache = track(runtime.createTensor("bool", Uint8Array.of(first ? 0 : 1), [1]));
      const feeds: Record<string, TensorLike> = {
        [names.inputIds]: ids,
        [names.encoderHiddenStates]: params.encoderHiddenStates,
        [names.useCacheBranch]: useCache,
      };
      const emptyPast: TensorLike[] = [];
      for (const entry of layout) {
        if (first) {
          const empty = track(runtime.createTensor("float32", new Float32Array(0), [1, shape.heads, 0, shape.headDim]));
          emptyPast.push(empty);
          feeds[entry.input] = empty;
        } else {
          const kept = cache.get(entry.input);
          if (!kept) throw new CaptionError("internal", `The cache for "${entry.input}" went missing.`);
          feeds[entry.input] = kept;
        }
      }

      let outputs: Record<string, TensorLike>;
      try {
        // Ask only for what the loop uses: the logits and the cache. Attention maps and the like are not computed or returned.
        outputs = await session.run(feeds, fetchNames);
      } catch (cause) {
        if (signal?.aborted) throw new CaptionError("aborted", "Captioning was cancelled.", { cause });
        throw new CaptionError("inference", "The speech model failed while decoding.", { cause });
      }
      for (const tensor of Object.values(outputs)) track(tensor);
      if (params.extra) {
        const copies: Record<string, { data: Float32Array; dims: number[] }> = {};
        for (const name of params.extra.names) {
          const tensor = outputs[name];
          if (!tensor) continue;
          const data = await tensor.getData();
          if (data instanceof Float32Array) copies[name] = { data: data.slice(), dims: [...tensor.dims] };
          free(tensor);
        }
        params.extra.onStep(step, copies, [...input]);
      }
      free(ids);
      free(useCache);
      for (const empty of emptyPast) free(empty);

      // Roll the cache forward: new decoder-side values replace the old ones; encoder-side ones are kept from step 1.
      const next = new Map<string, TensorLike>();
      for (const entry of layout) {
        const produced = outputs[entry.output];
        if (!produced) throw new CaptionError("inference", `The decoder did not return "${entry.output}".`);
        if (entry.encoderSide && !first) {
          free(produced);
          const kept = cache.get(entry.input);
          if (kept) next.set(entry.input, kept);
        } else {
          next.set(entry.input, produced);
          if (!first) free(cache.get(entry.input));
        }
      }
      cache = next;

      const logitsTensor = outputs[names.logits];
      if (!logitsTensor) throw new CaptionError("inference", `The decoder did not return "${names.logits}".`);
      const dims = logitsTensor.dims;
      const vocab = dims[dims.length - 1];
      const rows = dims.length === 3 ? dims[1] : 1;
      const raw = await logitsTensor.getData();
      free(logitsTensor);
      if (!(raw instanceof Float32Array) || raw.length < rows * vocab || vocab <= special.eot) {
        throw new CaptionError("inference", "The decoder returned logits in an unexpected shape.");
      }

      if (first) {
        // The "no speech" chance is read where Whisper reads it: at the start-of-transcript position, before any text.
        const rowStart = sotIndex * vocab;
        const lse = logSumExp(raw, rowStart, rowStart + vocab);
        noSpeechProbability = special.noSpeech < vocab ? Math.exp(raw[rowStart + special.noSpeech] - lse) : 0;
      }

      // Take the last row, then forbid everything that cannot be spoken text.
      if (!work || work.length !== vocab) work = new Float32Array(vocab);
      work.set(raw.subarray((rows - 1) * vocab, rows * vocab));
      if (timestampRules) {
        // Text ids are below end-of-text; timestamps start at `timestampBegin`. Everything between (language/task
        // markers, no-speech, `<|notimestamps|>`) can never be generated in this mode.
        for (let id = special.eot + 1; id < timestampBegin && id < vocab; id += 1) work[id] = -Infinity;
        if (first) {
          // Whisper's `max_initial_timestamp`: step 0 is a timestamp no later than <|1.00|> by default.
          for (let id = 0; id < timestampBegin; id += 1) work[id] = -Infinity;
          const lastAllowed = timestampBegin + (params.maxInitialTimestampIndex ?? 50);
          for (let id = lastAllowed + 1; id < vocab; id += 1) work[id] = -Infinity;
        } else {
          const lastWasTimestamp = sequence.length >= 1 && sequence[sequence.length - 1] >= timestampBegin;
          const penultimateWasTimestamp = sequence.length < 2 || sequence[sequence.length - 2] >= timestampBegin;
          if (lastWasTimestamp) {
            if (penultimateWasTimestamp) {
              // Two timestamps in a row open a new segment: the next token must be text (or EOT).
              for (let id = timestampBegin; id < vocab; id += 1) work[id] = -Infinity;
            } else {
              // A timestamp after text closes the segment: the next token must be a timestamp (or EOT).
              for (let id = 0; id < special.eot; id += 1) work[id] = -Infinity;
            }
          }
          // Timestamps never decrease, and a new segment must be longer than zero: strict increase as in Whisper.
          let lastTimestamp = -1;
          for (let index = sequence.length - 1; index >= 0; index -= 1) {
            if (sequence[index] >= timestampBegin) {
              lastTimestamp = sequence[index];
              break;
            }
          }
          if (lastTimestamp >= 0) {
            const firstAllowed = lastWasTimestamp && !penultimateWasTimestamp ? lastTimestamp : lastTimestamp + 1;
            for (let id = timestampBegin; id < firstAllowed && id < vocab; id += 1) work[id] = -Infinity;
          }
        }
      } else {
        for (let id = special.eot + 1; id < vocab; id += 1) work[id] = -Infinity;
      }
      for (const id of params.suppress) if (id >= 0 && id < vocab) work[id] = -Infinity;
      if (first) for (const id of params.suppressAtStart) if (id >= 0 && id < vocab) work[id] = -Infinity;
      // `minNewTokens` (the early-end block) is deliberately off for the timestamp read: measured on KING it turns the
      // model's single "nan" into a hundreds-of-words English loop.
      if (!timestampRules && generated.length < (params.minNewTokens ?? 0) && endBlocked < (params.maxEndBlocks ?? DEFAULT_MAX_END_BLOCKS)) {
        let wantsEnd = true;
        const endValue = work[special.eot];
        for (let id = 0; id < special.eot; id += 1) {
          if (work[id] > endValue) {
            wantsEnd = false;
            break;
          }
        }
        if (wantsEnd) endBlocked += 1;
        work[special.eot] = -Infinity;
      }
      if (timestampRules) {
        // If the total probability mass of all timestamp ids beats the best single text id, force a timestamp.
        const timestampMass = logSumExp(work, timestampBegin, vocab);
        let bestText = -Infinity;
        for (let id = 0; id < timestampBegin; id += 1) if (work[id] > bestText) bestText = work[id];
        if (timestampMass > bestText) {
          for (let id = 0; id < timestampBegin; id += 1) work[id] = -Infinity;
        }
      }

      let best = -1;
      let bestValue = -Infinity;
      for (let id = 0; id < vocab; id += 1) {
        if (work[id] > bestValue) {
          bestValue = work[id];
          best = id;
        }
      }
      if (best < 0) throw new CaptionError("inference", "Every token was ruled out while decoding.");
      const tokenLogProbability = bestValue - logSumExp(work, 0, vocab);

      if (best === special.eot) {
        logProbs.push(tokenLogProbability);
        stop = "eot";
        break;
      }
      if (timestampRules) {
        sequence.push(best);
        if (best >= timestampBegin) {
          // Stop only on EOT or on two timestamps in a row (the literal "second consecutive timestamp"). The pair rule
          // normally forbids that, so a well-formed read continues to EOT and nothing after a timestamp boundary is cut.
          const previousWasTimestamp = sequence.length >= 2 && sequence[sequence.length - 2] >= timestampBegin;
          if (previousWasTimestamp) {
            stop = "timestamp";
            break;
          }
          input = [best];
          continue;
        }
        logProbs.push(tokenLogProbability);
        generated.push(best);
        input = [best];

        const cut = findRepetitionCut(generated, rules);
        if (cut >= 0) {
          const dropped = generated.length - cut;
          generated.length = cut;
          logProbs.length = Math.max(0, logProbs.length - dropped);
          stop = "repetition";
          break;
        }
        continue;
      }
      logProbs.push(tokenLogProbability);
      generated.push(best);
      input = [best];

      const cut = findRepetitionCut(generated, rules);
      if (cut >= 0) {
        // Keep one copy of the loop and forget the rest, including their scores.
        const dropped = generated.length - cut;
        generated.length = cut;
        logProbs.length = Math.max(0, logProbs.length - dropped);
        stop = "repetition";
        break;
      }
    }
  } finally {
    for (const tensor of [...live]) {
      live.delete(tensor);
      try {
        tensor.dispose();
      } catch {
        /* already gone: freeing must never hide the real error */
      }
    }
  }

  const average = logProbs.length === 0 ? 0 : logProbs.reduce((sum, value) => sum + value, 0) / logProbs.length;
  return { tokenIds: generated, noSpeechProbability, averageLogProbability: Math.min(0, average), tokenLogProbs: logProbs.slice(0, generated.length).map((value) => Math.min(0, value)), endBlocked, stop };
}
