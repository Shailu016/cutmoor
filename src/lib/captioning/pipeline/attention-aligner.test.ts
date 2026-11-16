import { describe, expect, it } from "vitest";
import type { WindowAudio, WindowTranscript } from "../contracts";
import { createAttentionAligner, wordsFromModelTimes } from "./attention-aligner";
import { uniformAlign } from "./uniform-aligner";

const audio = (usedMs: number, index = 3): WindowAudio =>
  ({ samples: new Float32Array(0), window: { index, lengthMs: 30_000, usedMs, regions: [{ sourceStartMs: 0, sourceEndMs: usedMs, packOffsetMs: 0 }] } }) as unknown as WindowAudio;
const transcript = (words: string[], extra: Partial<WindowTranscript> = {}): WindowTranscript => ({
  windowIndex: 3,
  words,
  tokenIds: [],
  noSpeechProbability: 0,
  averageLogProbability: 0,
  ...extra,
});

describe("wordsFromModelTimes", () => {
  it("uses the model's times, its confidences and the window index", () => {
    const out = wordsFromModelTimes(
      audio(5000),
      transcript(["Kya", "haal", "hai"], { wordTimes: [{ startMs: 100, endMs: 400 }, { startMs: 450, endMs: 900 }, { startMs: 1000, endMs: 1300 }], wordConfidence: [0.9, 0.4, 0.8] }),
    );
    expect(out).toEqual([
      { text: "Kya", startMs: 100, endMs: 400, confidence: 0.9, index: 0, windowIndex: 3 },
      { text: "haal", startMs: 450, endMs: 900, confidence: 0.4, index: 1, windowIndex: 3 },
      { text: "hai", startMs: 1000, endMs: 1300, confidence: 0.8, index: 2, windowIndex: 3 },
    ]);
  });

  it("returns null when there are no times or the count differs", () => {
    expect(wordsFromModelTimes(audio(5000), transcript(["a", "b"]))).toBeNull();
    expect(wordsFromModelTimes(audio(5000), transcript(["a", "b"], { wordTimes: [{ startMs: 0, endMs: 10 }] }))).toBeNull();
    expect(wordsFromModelTimes(audio(5000), transcript([], { wordTimes: [] }))).toBeNull();
  });

  it("returns null for times that go backwards, are empty, not finite, or run past the audio", () => {
    const bad = (wordTimes: { startMs: number; endMs: number }[]) => wordsFromModelTimes(audio(1000), transcript(["a", "b"], { wordTimes }));
    expect(bad([{ startMs: 500, endMs: 600 }, { startMs: 100, endMs: 200 }])).toBeNull();
    expect(bad([{ startMs: 100, endMs: 100 }, { startMs: 200, endMs: 300 }])).toBeNull();
    expect(bad([{ startMs: Number.NaN, endMs: 100 }, { startMs: 200, endMs: 300 }])).toBeNull();
    expect(bad([{ startMs: 100, endMs: 200 }, { startMs: 900, endMs: 1500 }])).toBeNull();
    expect(bad([{ startMs: -5, endMs: 200 }, { startMs: 300, endMs: 400 }])).toBeNull();
  });

  it("caps a word that was held across a pause", () => {
    const out = wordsFromModelTimes(
      audio(15_000),
      transcript(["pata", "hai.", "Kyon?"], { wordTimes: [{ startMs: 4500, endMs: 4800 }, { startMs: 5420, endMs: 14_200 }, { startMs: 14_200, endMs: 14_500 }] }),
    );
    // Usual word here is 300 ms, so the cap is the 700 ms floor.
    expect(out?.[1]).toMatchObject({ startMs: 5420, endMs: 6120 });
    expect(out?.[2]).toMatchObject({ startMs: 14_200, endMs: 14_500 });
  });

  it("rejects a word that starts at or after the end of the audio, so no word ever ends past usedMs", () => {
    expect(wordsFromModelTimes(audio(1000), transcript(["a"], { wordTimes: [{ startMs: 1000, endMs: 1000.4 }] }))).toBeNull();
    const ok = wordsFromModelTimes(audio(1000), transcript(["a"], { wordTimes: [{ startMs: 990, endMs: 1000.4 }] }));
    expect(ok?.[0].endMs).toBeLessThanOrEqual(1000);
  });

  it("never returns an empty or backwards word and falls back to confidence 0.5 without model confidences", () => {
    const out = wordsFromModelTimes(audio(1000), transcript(["a"], { wordTimes: [{ startMs: 990, endMs: 1000.4 }] }));
    expect(out).toEqual([{ text: "a", startMs: 990, endMs: 1000, confidence: 0.5, index: 0, windowIndex: 3 }]);
  });
});

describe("createAttentionAligner", () => {
  it("falls back to even spacing when the model gave no usable times", async () => {
    const aligner = createAttentionAligner();
    const input = audio(3000);
    const t = transcript(["one", "two", "three"]);
    expect(await aligner.align(input, t)).toEqual(uniformAlign(input, t));
    expect(aligner.id).toBe("whisper-attention");
  });

  it("uses model times when they are there", async () => {
    const out = await createAttentionAligner().align(audio(3000), transcript(["one"], { wordTimes: [{ startMs: 200, endMs: 600 }] }));
    expect(out[0]).toMatchObject({ startMs: 200, endMs: 600 });
  });
});
