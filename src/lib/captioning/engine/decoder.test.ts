import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import { checkDecoderSession, decodeGreedy, findRepetitionCut, type DecodeParams, type RepetitionRule } from "./decoder";
import { bytesAsTokens, FAKE, FakeDecoder, FakeRuntime, FakeWorld, type FakeModelConfig } from "./fake-model";

const SPECIAL = { eot: FAKE.eot, sot: FAKE.sot, transcribe: FAKE.transcribe, noTimestamps: FAKE.noTimestamps, noSpeech: FAKE.noSpeech };
const PROMPT = [FAKE.sot, FAKE.en, FAKE.transcribe, FAKE.noTimestamps];

function setup(config: FakeModelConfig, key = 1) {
  const world = new FakeWorld();
  const runtime = new FakeRuntime(world, config);
  const session = new FakeDecoder(world, config, PROMPT.length);
  const hidden = world.tensor("float32", [1, FAKE.encoderFrames, 512], Float32Array.of(key));
  const base: DecodeParams = {
    session,
    runtime,
    encoderHiddenStates: hidden,
    prompt: PROMPT,
    special: SPECIAL,
    suppress: new Set(),
    suppressAtStart: new Set(),
    maxNewTokens: 60,
  };
  return { world, session, hidden, base };
}

/** Everything the caller does not own must be freed: only the hidden-state tensor may stay alive. */
const leaked = (world: FakeWorld, hidden: object) => [...world.live].filter((tensor) => tensor !== hidden);

describe("decodeGreedy: the cache protocol", () => {
  it("decodes a transcript, feeds the prompt once and then one token at a time", async () => {
    const text = bytesAsTokens(" hello");
    const { session, base, world, hidden } = setup({ transcripts: { 1: [...text, FAKE.hai] } });
    const result = await decodeGreedy(base);
    expect(result.tokenIds).toEqual([...text, FAKE.hai]);
    expect(result.stop).toBe("eot");
    // The fake throws if any step is fed wrongly; these are the steps it saw.
    expect(session.calls[0]).toEqual({ step: 0, inputIds: PROMPT, useCache: false });
    expect(session.calls[1]).toEqual({ step: 1, inputIds: [text[0]], useCache: true });
    expect(session.calls).toHaveLength(text.length + 1 + 1); // every token, plus the step that produced end-of-text
    expect(session.calls.at(-1)?.inputIds).toEqual([FAKE.hai]);
    expect(leaked(world, hidden)).toEqual([]);
  });

  it("keeps the encoder half of the cache from step one although later steps return empty ones", async () => {
    // The fake demands encoder cache length 1500 on every cached step and returns length 0 itself.
    const { base } = setup({ transcripts: { 1: bytesAsTokens(" abcdef") } });
    await expect(decodeGreedy(base)).resolves.toMatchObject({ stop: "eot" });
  });

  it("returns an empty transcript when the model ends at once", async () => {
    const { base, world, hidden } = setup({ transcripts: { 1: [] } });
    const result = await decodeGreedy({ ...base, suppressAtStart: new Set() });
    expect(result.tokenIds).toEqual([]);
    expect(result.stop).toBe("eot");
    expect(leaked(world, hidden)).toEqual([]);
  });

  it("does not let the model end before minNewTokens (an early stop while speech continues)", async () => {
    const tokens = bytesAsTokens(" ab");
    const { base } = setup({ transcripts: { 1: tokens } });
    // A floor the model already meets changes nothing.
    await expect(decodeGreedy({ ...base, minNewTokens: tokens.length })).resolves.toMatchObject({ tokenIds: tokens, stop: "eot" });
    // One more than it said: end-of-text is ruled out, so the decoder asks for another token. The scripted fake model
    // cannot give one and refuses, which is how this test sees that the early end was blocked.
    const { base: again } = setup({ transcripts: { 1: tokens } });
    await expect(decodeGreedy({ ...again, minNewTokens: tokens.length + 1 })).rejects.toMatchObject({ code: "inference" });
  });

  it("stops at maxNewTokens and says so", async () => {
    const { base } = setup({ transcripts: { 1: bytesAsTokens(" a very long transcript indeed") } });
    const result = await decodeGreedy({ ...base, maxNewTokens: 5 });
    expect(result.tokenIds).toEqual(bytesAsTokens(" a ve"));
    expect(result.stop).toBe("max-tokens");
  });
});

describe("decodeGreedy: only the outputs it needs", () => {
  it("asks the model for the logits and the cache, nothing else", async () => {
    const { session, base } = setup({ transcripts: { 1: bytesAsTokens(" ab") } });
    await decodeGreedy(base);
    expect(session.lastFetches).toBeDefined();
    expect(session.lastFetches).toContain("logits");
    expect(session.lastFetches?.every((name) => name === "logits" || name.startsWith("present."))).toBe(true);
  });
});

describe("decodeGreedy: extra outputs and the end block limit", () => {
  const attention = { layers: [0], heads: 8, frames: 1500, peak: (step: number) => step };

  it("hands each step's extra outputs to the caller as plain arrays, fetches them by name, and frees them", async () => {
    const { session, base, world, hidden } = setup({ transcripts: { 1: bytesAsTokens(" ab") }, attention });
    const seen: { step: number; dims: number[]; inputs: number[]; hasPeak: boolean }[] = [];
    await decodeGreedy({
      ...base,
      extra: {
        names: ["cross_attentions.0"],
        onStep: (step, tensors, inputIds) => {
          const t = tensors["cross_attentions.0"];
          seen.push({ step, dims: t.dims, inputs: [...inputIds], hasPeak: t.data.some((v) => v === 1) });
        },
      },
    });
    expect(session.lastFetches).toContain("cross_attentions.0");
    expect(seen.map((entry) => entry.step)).toEqual([0, 1, 2, 3]);
    expect(seen[0].dims).toEqual([1, 8, 4, 1500]);
    expect(seen[1].dims).toEqual([1, 8, 1, 1500]);
    expect(seen[0].inputs).toEqual(PROMPT);
    expect(seen[1].inputs).toEqual([bytesAsTokens(" ab")[0]]);
    expect(seen.every((entry) => entry.hasPeak)).toBe(true);
    expect(leaked(world, hidden)).toEqual([]);
  });

  it("does not fetch attention when nothing asked for it", async () => {
    const { session, base } = setup({ transcripts: { 1: bytesAsTokens(" ab") }, attention });
    await decodeGreedy(base);
    expect((session.lastFetches ?? []).some((name) => name.startsWith("cross_attentions"))).toBe(false);
  });

  it("stops blocking the end after maxEndBlocks, so invented text is bounded", async () => {
    const { base } = setup({ transcripts: { 1: bytesAsTokens(" ab") }, lenient: true });
    const result = await decodeGreedy({ ...base, minNewTokens: 40, maxEndBlocks: 3, repetitionRules: [] });
    expect(result.endBlocked).toBe(3);
    expect(result.stop).toBe("eot");
    expect(result.tokenIds.length).toBe(bytesAsTokens(" ab").length + 3);
  });
});

describe("decodeGreedy: probabilities", () => {
  it("reads the no-speech chance from the start-of-transcript row", async () => {
    // Every other logit is 0 on that row, so p = e^a / (e^a + (V - 1)). Choosing a = ln(V - 1) makes it exactly 1/2.
    const noSpeechLogit = Math.log(FAKE.vocab - 1);
    const { base } = setup({ transcripts: { 1: bytesAsTokens(" x") }, noSpeechLogit });
    const result = await decodeGreedy(base);
    expect(result.noSpeechProbability).toBeCloseTo(0.5, 5);
  });

  it("gives a tiny no-speech chance when the model is sure there is speech", async () => {
    const { base } = setup({ transcripts: { 1: bytesAsTokens(" x") }, noSpeechLogit: -20 });
    expect((await decodeGreedy(base)).noSpeechProbability).toBeLessThan(1e-6);
  });

  it("averages the log-probability of the chosen tokens, end-of-text included", async () => {
    const chosenLogit = 6;
    const { base } = setup({ transcripts: { 1: bytesAsTokens(" ab") }, chosenLogit });
    const result = await decodeGreedy(base);
    // Allowed ids are 0..eot (301 of them), the chosen one has logit 6, the rest 0. Same on every step incl. the final end-of-text.
    const allowed = FAKE.eot + 1;
    const expected = chosenLogit - Math.log(Math.exp(chosenLogit) + (allowed - 1));
    expect(result.averageLogProbability).toBeCloseTo(expected, 4);
    expect(result.averageLogProbability).toBeLessThanOrEqual(0);
  });

  it("is lower when the model is unsure", async () => {
    const sure = await decodeGreedy(setup({ transcripts: { 1: bytesAsTokens(" ab") }, chosenLogit: 12 }).base);
    const unsure = await decodeGreedy(setup({ transcripts: { 1: bytesAsTokens(" ab") }, chosenLogit: 3 }).base);
    expect(unsure.averageLogProbability).toBeLessThan(sure.averageLogProbability);
  });
});

describe("decodeGreedy: forbidden tokens", () => {
  it("never picks a timestamp or other special token above end-of-text, even if the model wants one", async () => {
    const tempting = FAKE.firstTimestamp + 2;
    const { base } = setup({
      transcripts: { 1: bytesAsTokens(" ab") },
      chosenLogit: 5,
      lenient: true,
      extraLogits: (_key, step) => (step === 1 ? [[tempting, 50]] : []),
    });
    const result = await decodeGreedy(base);
    expect(result.tokenIds).not.toContain(tempting);
    expect(result.tokenIds.every((id) => id < FAKE.eot)).toBe(true);
    // The tempting token had a logit 45 above the scripted one; with it ruled out the scripted text comes through whole.
    expect(result.tokenIds).toEqual(bytesAsTokens(" ab"));
  });

  it("honours the always-suppressed list", async () => {
    const wanted = bytesAsTokens(" ab");
    const { base } = setup({ transcripts: { 1: wanted }, chosenLogit: 5, lenient: true });
    const result = await decodeGreedy({ ...base, suppress: new Set([wanted[2]]) });
    expect(result.tokenIds[2]).not.toBe(wanted[2]);
  });

  it("suppresses the start-only list on the first generated token only", async () => {
    const space = FAKE.space;
    const { base } = setup({ transcripts: { 1: [space, space, ...bytesAsTokens("ab")] }, chosenLogit: 5, lenient: true });
    const result = await decodeGreedy({ ...base, suppressAtStart: new Set([space]) });
    expect(result.tokenIds[0]).not.toBe(space); // forbidden at the start
    // Later steps may use it again: the scripted spaces at step 1+ are not blocked.
    const again = await decodeGreedy({ ...setup({ transcripts: { 1: [65, space, 66] }, chosenLogit: 5 }).base, suppressAtStart: new Set([space]) });
    expect(again.tokenIds).toEqual([65, space, 66]);
  });

  it("will not stop at the very first step when end-of-text is in the start list", async () => {
    const { base } = setup({ transcripts: { 1: [] }, chosenLogit: 5, lenient: true });
    const result = await decodeGreedy({ ...base, suppressAtStart: new Set([FAKE.eot]) });
    expect(result.tokenIds.length).toBeGreaterThanOrEqual(1);
  });
});

describe("decodeGreedy: loops", () => {
  it("cuts a repeating 4-token phrase down to one copy and reports it", async () => {
    const lead = bytesAsTokens(" ok");
    const loop = bytesAsTokens(" abc").slice(0, 4);
    const script = [...lead, ...loop, ...loop, ...loop, ...loop, ...loop];
    const { base, session } = setup({ transcripts: { 1: script } });
    const result = await decodeGreedy(base);
    expect(result.stop).toBe("repetition");
    expect(result.tokenIds).toEqual([...lead, ...loop]);
    // It stopped as soon as the third copy was complete instead of running to the end.
    expect(session.calls.length).toBe(lead.length + loop.length * 3);
  });

  it("scores only the tokens that were kept", async () => {
    const loop = [70, 71, 72, 73];
    const { base } = setup({ transcripts: { 1: [...loop, ...loop, ...loop, ...loop] }, chosenLogit: 8 });
    const result = await decodeGreedy(base);
    expect(result.tokenIds).toEqual(loop);
    const perToken = 8 - Math.log(Math.exp(8) + FAKE.eot);
    expect(result.averageLogProbability).toBeCloseTo(perToken, 4);
  });

  it("stops a single token repeated ten times", async () => {
    const { base } = setup({ transcripts: { 1: new Array<number>(30).fill(80) } });
    const result = await decodeGreedy(base);
    expect(result.stop).toBe("repetition");
    expect(result.tokenIds).toEqual([80]);
  });

  it("does not cut ordinary speech that repeats twice", async () => {
    const phrase = bytesAsTokens(" haan").slice(0, 4);
    const { base } = setup({ transcripts: { 1: [...phrase, ...phrase, 90] } });
    const result = await decodeGreedy(base);
    expect(result.stop).toBe("eot");
    expect(result.tokenIds).toEqual([...phrase, ...phrase, 90]);
  });

  it("applies the caller's own repetition rule (a 2-token run three times) in place of the defaults", async () => {
    const lead = bytesAsTokens(" ok");
    const unit = [70, 71];
    const script = [...lead, ...unit, ...unit, ...unit, 90];
    // The default rules look for a 4-token run three times or one token ten times, so this loop passes them.
    const { base } = setup({ transcripts: { 1: script } });
    const untrimmed = await decodeGreedy(base);
    expect(untrimmed.stop).toBe("eot");
    expect(untrimmed.tokenIds).toEqual(script);
    // A caller asking for 2 tokens three times gets one copy kept and the decode stopped there.
    const { base: custom, session } = setup({ transcripts: { 1: script } });
    const result = await decodeGreedy({ ...custom, repetitionRules: [{ n: 2, times: 3 }] });
    expect(result.stop).toBe("repetition");
    expect(result.tokenIds).toEqual([...lead, ...unit]);
    // It stopped as soon as the third copy was complete: the tail after it was never decoded.
    expect(session.calls.length).toBe(lead.length + unit.length * 3);
  });
});

describe("findRepetitionCut", () => {
  const rules: RepetitionRule[] = [{ n: 4, times: 3 }];
  it("returns -1 for short, empty and non-repeating input", () => {
    expect(findRepetitionCut([], rules)).toBe(-1);
    expect(findRepetitionCut([1, 2, 3, 4, 1, 2, 3, 4], rules)).toBe(-1);
    expect(findRepetitionCut([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 5], rules)).toBe(-1);
  });
  it("finds a tail repeat and keeps one copy", () => {
    expect(findRepetitionCut([9, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4], rules)).toBe(5);
  });
  it("only looks at the tail", () => {
    expect(findRepetitionCut([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 9], rules)).toBe(-1);
  });
  it("ignores nonsense rules", () => {
    expect(findRepetitionCut([1, 1, 1, 1], [{ n: 0, times: 3 }, { n: 2, times: 1 }])).toBe(-1);
  });

  it("fuzz: finds a planted loop exactly, and never fires on text with no repeats", () => {
    let seed = 12345;
    const rand = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    for (let round = 0; round < 300; round += 1) {
      const n = 1 + rand(5);
      const times = 2 + rand(4);
      const rule = { n, times };
      const prefix = Array.from({ length: rand(20) }, () => rand(50));
      const unit = Array.from({ length: n }, () => rand(50));
      const tokens = [...prefix, ...Array.from({ length: times }, () => unit).flat()];
      const cut = findRepetitionCut(tokens, [rule]);
      expect(cut).toBe(prefix.length + n);
      // Cutting there leaves exactly one copy of the loop.
      expect(tokens.slice(cut - n, cut)).toEqual(unit);
    }
    for (let round = 0; round < 200; round += 1) {
      // Strictly increasing ids can never repeat, so no rule may fire.
      const tokens = Array.from({ length: 5 + rand(40) }, (_, i) => i * 3 + rand(3));
      expect(findRepetitionCut(tokens, [{ n: 4, times: 3 }, { n: 1, times: 10 }, { n: 2, times: 2 }])).toBe(-1);
    }
  });
});

describe("decodeGreedy: errors, cancellation and memory", () => {
  it("aborts between steps with an 'aborted' error and frees every tensor", async () => {
    const controller = new AbortController();
    const { base, session, world, hidden } = setup({ transcripts: { 1: bytesAsTokens(" a long sentence here") } });
    session.onRun = () => {
      if (session.calls.length === 3) controller.abort();
    };
    await expect(decodeGreedy({ ...base, signal: controller.signal })).rejects.toMatchObject({ name: "CaptionError", code: "aborted" });
    expect(leaked(world, hidden)).toEqual([]);
    expect(session.calls.length).toBeLessThanOrEqual(5);
  });

  it("does not start when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { base, session } = setup({ transcripts: { 1: [65] } });
    await expect(decodeGreedy({ ...base, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(session.calls).toHaveLength(0);
  });

  it("turns a model failure into an 'inference' error and frees every tensor", async () => {
    const { base, session, world, hidden } = setup({ transcripts: { 1: bytesAsTokens(" abc") } });
    session.onRun = () => {
      if (session.calls.length === 2) session.failWith = new Error("kernel exploded");
    };
    const error = await decodeGreedy(base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaptionError);
    expect((error as CaptionError).code).toBe("inference");
    expect(((error as CaptionError).cause as Error).message).toBe("kernel exploded");
    expect(leaked(world, hidden)).toEqual([]);
  });

  it("frees the tensors of a normal run too", async () => {
    const { base, world, hidden } = setup({ transcripts: { 1: bytesAsTokens(" a normal run") } });
    await decodeGreedy(base);
    expect(leaked(world, hidden)).toEqual([]);
    expect(hidden.disposed).toBe(false); // the caller owns it
  });

  it("rejects a prompt without a start token and a zero token budget", async () => {
    const { base } = setup({ transcripts: { 1: [] } });
    await expect(decodeGreedy({ ...base, prompt: [FAKE.en] })).rejects.toMatchObject({ code: "internal" });
    await expect(decodeGreedy({ ...base, maxNewTokens: 0 })).rejects.toMatchObject({ code: "internal" });
  });
});

describe("checkDecoderSession", () => {
  const world = new FakeWorld();
  const config: FakeModelConfig = { transcripts: {} };
  it("accepts the expected layout", () => {
    expect(() => checkDecoderSession(new FakeDecoder(world, config, 4))).not.toThrow();
  });
  it("rejects a decoder without cache inputs", () => {
    const session = new FakeDecoder(world, config, 4, { inputs: ["input_ids", "encoder_hidden_states", "use_cache_branch"], outputs: ["logits"] });
    expect(() => checkDecoderSession(session)).toThrow(/cache/);
  });
  it("rejects a missing use_cache_branch input", () => {
    const base = new FakeDecoder(world, config, 4);
    const session = new FakeDecoder(world, config, 4, { inputs: base.inputNames.filter((n) => n !== "use_cache_branch") });
    expect(() => checkDecoderSession(session)).toThrow(/use_cache_branch/);
  });
  it("rejects a cache input with no matching output", () => {
    const base = new FakeDecoder(world, config, 4);
    const session = new FakeDecoder(world, config, 4, { outputs: base.outputNames.filter((n) => n !== "present.1.encoder.value") });
    expect(() => checkDecoderSession(session)).toThrow(/present\.1\.encoder\.value/);
  });
});

describe("decodeGreedy: Whisper timestamp rules (wp-TS)", () => {
  const TS_PROMPT = [FAKE.sot, FAKE.en, FAKE.transcribe];
  const tsBegin = FAKE.noTimestamps + 1;

  function tsSetup(config: FakeModelConfig, key = 1) {
    const world = new FakeWorld();
    const runtime = new FakeRuntime(world, config);
    const session = new FakeDecoder(world, config, TS_PROMPT.length);
    const hidden = world.tensor("float32", [1, FAKE.encoderFrames, 512], Float32Array.of(key));
    const base: DecodeParams = {
      session,
      runtime,
      encoderHiddenStates: hidden,
      prompt: TS_PROMPT,
      special: SPECIAL,
      suppress: new Set(),
      suppressAtStart: new Set(),
      maxNewTokens: 60,
      timestampRules: true,
    };
    return { world, session, hidden, base };
  }

  it("makes step 0 a timestamp, honours the initial limit, and strips timestamps from the text", async () => {
    const text = bytesAsTokens(" hi");
    const { base, session } = tsSetup({
      transcripts: { 1: [tsBegin, ...text] },
      // A timestamp after <|1.00|> must not win even with a huge logit.
      extraLogits: (_key, step) => (step === 0 ? [[tsBegin + 2, 50]] : []),
    });
    const result = await decodeGreedy({ ...base, maxInitialTimestampIndex: 1 });
    expect(session.calls[1].inputIds).toEqual([tsBegin]);
    expect(result.tokenIds).toEqual(text);
    expect(result.stop).toBe("eot");
  });

  it("pairs timestamps at a boundary and stops at the second consecutive one", async () => {
    const first = bytesAsTokens(" hi");
    const second = bytesAsTokens(" bye");
    const { base, session } = tsSetup({ transcripts: { 1: [tsBegin, ...first, tsBegin + 2, ...second] } });
    const result = await decodeGreedy(base);
    expect(result.tokenIds).toEqual(first);
    expect(result.stop).toBe("timestamp");
    // The text after the boundary pair was never decoded.
    expect(session.calls.some((call) => call.inputIds.includes(second[1]))).toBe(false);
  });

  it("does not allow a second timestamp directly after the opening one (a pair needs a text span)", async () => {
    const text = bytesAsTokens(" ab");
    const { base } = tsSetup({
      transcripts: { 1: [tsBegin, ...text] },
      extraLogits: (_key, step) => (step === 1 ? [[tsBegin + 1, 50]] : []),
    });
    const result = await decodeGreedy(base);
    expect(result.tokenIds).toEqual(text);
    expect(result.stop).toBe("eot");
  });

  it("never lets a boundary timestamp decrease (strictly increasing)", async () => {
    const first = bytesAsTokens(" a");
    const { base, session } = tsSetup({
      // open, text, then a timestamp equal to the opening one: it must be masked and the next allowed one taken.
      transcripts: { 1: [tsBegin, ...first, tsBegin] },
      lenient: true,
    });
    const result = await decodeGreedy(base);
    expect(session.calls.at(-1)?.inputIds).toEqual([tsBegin + 1]);
    expect(result.tokenIds).toEqual(first);
    expect(result.stop).toBe("eot");
  });

  it("forces a timestamp when the timestamp mass beats the best text token", async () => {
    const text = bytesAsTokens(" ab");
    const { base, session } = tsSetup({
      transcripts: { 1: [tsBegin, ...text] },
      lenient: true,
      // At step 2 the script wants 'a' (logit 10), but one closing timestamp has 12: the timestamp mass wins.
      extraLogits: (_key, step) => (step === 2 ? [[tsBegin + 1, 12]] : []),
    });
    const result = await decodeGreedy(base);
    expect(result.tokenIds).toEqual([text[0]]);
    expect(result.stop).toBe("timestamp");
    // The forced timestamp (not the next text token) was fed back.
    expect(session.calls[3]?.inputIds).toEqual([tsBegin + 1]);
  });

  it("ignores minNewTokens in this mode (the end block must not run with timestamps)", async () => {
    const text = bytesAsTokens(" hi");
    const { base } = tsSetup({ transcripts: { 1: [tsBegin, ...text] } });
    const result = await decodeGreedy({ ...base, minNewTokens: 100 });
    expect(result.stop).toBe("eot");
    expect(result.tokenIds).toEqual(text);
    expect(result.endBlocked).toBe(0);
  });

  it("leaves the default (text-only) decode untouched: no timestamp can be chosen", async () => {
    const { base } = tsSetup({ transcripts: { 1: bytesAsTokens(" ab") } });
    const result = await decodeGreedy({ ...base, timestampRules: false });
    expect(result.tokenIds.every((id) => id < FAKE.eot)).toBe(true);
  });
});
