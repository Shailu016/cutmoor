import { describe, expect, it } from "vitest";
import { compressionRatio, dropCollapsedTail, evaluateTranscript, longestRepeat } from "./hallucination-gate";
import type { Word } from "./types";

/** Words spaced evenly: `perSecond` words a second starting at `from`. */
function speak(texts: string[], from = 0, perSecond = 3): Word[] {
  const step = 1000 / perSecond;
  return texts.map((text, i) => ({
    text,
    startMs: Math.round(from + i * step),
    endMs: Math.round(from + i * step + step * 0.8),
    confidence: 0.9,
    index: i,
    windowIndex: 0,
  }));
}

const NATURAL = "aaj main aapko ek bahut mazedaar baat batane wala hoon jo kal mere saath hui thi jab main market gaya tha".split(" ");

describe("compressionRatio", () => {
  it("is near 1 for ordinary text and high for repetition", () => {
    expect(compressionRatio("")).toBe(1);
    expect(compressionRatio(NATURAL.join(" "))).toBeLessThan(1.6);
    expect(compressionRatio("thank you for watching ".repeat(10))).toBeGreaterThan(5);
  });
});

describe("longestRepeat", () => {
  it("counts a word or short phrase repeated back to back", () => {
    expect(longestRepeat([])).toBe(0);
    expect(longestRepeat(["ek", "do", "teen"])).toBe(1);
    expect(longestRepeat(["bahut", "bahut", "bahut"])).toBe(3);
    expect(longestRepeat("thank you thank you thank you thank you".split(" "))).toBe(4);
    expect(longestRepeat(["Haan,", "haan!", "HAAN"])).toBe(3); // case and punctuation do not hide a repeat
  });

  it("does not count words that merely appear again later", () => {
    expect(longestRepeat("main aaj main kal main parson".split(" "))).toBe(1);
  });
});

describe("evaluateTranscript", () => {
  const speech = [{ startMs: 0, endMs: 6000 }];

  it("passes natural speech", () => {
    const result = evaluateTranscript({ words: speak(NATURAL, 0, 3), speech });
    expect(result.flagged).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("flags a looping, over-compressible transcript", () => {
    const loop = speak("thank you for watching ".repeat(6).trim().split(" "), 0, 4);
    const result = evaluateTranscript({ words: loop, speech });
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain("looping");
    expect(result.reasons).toContain("repetitive");
  });

  it("flags words in a silent stretch, even when the model was confident", () => {
    const result = evaluateTranscript({ words: speak(["thank", "you", "for", "watching"], 100, 2), speech: [] });
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain("outside-speech");
    expect(result.reasons).not.toContain("too-fast"); // there is no speech time to divide by, so no rate
    expect(result.metrics.wordsPerSecond).toBe(0); // finite, so it survives JSON
  });

  it("skips every speech-based check when no detector ran, instead of failing the whole transcript", () => {
    const result = evaluateTranscript({ words: speak(NATURAL, 0, 3) });
    expect(result.flagged).toBe(false);
    expect(result.metrics.outsideSpeechShare).toBe(0);
  });

  it("keeps different Devanagari words apart: marks are part of the word", () => {
    // Four different-looking words used to count as one word repeated 4 times; now it is a two-word phrase said twice.
    expect(longestRepeat(["मेरा", "मेरी", "मेरा", "मेरी"])).toBe(2);
    expect(longestRepeat(["मेरा", "मेरी", "मेरीी"])).toBe(1);
    expect(longestRepeat(["मेरा", "मेरा", "मेरा", "मेरा"])).toBe(4);
  });

  it("flags an implausible speaking rate", () => {
    const result = evaluateTranscript({ words: speak(NATURAL.concat(NATURAL, NATURAL), 0, 12), speech: [{ startMs: 0, endMs: 6000 }] });
    expect(result.reasons).toContain("too-fast");
  });

  it("flags almost no words for a long stretch of speech", () => {
    const result = evaluateTranscript({ words: speak(["hmm"], 0, 1), speech: [{ startMs: 0, endMs: 20_000 }] });
    expect(result.reasons).toContain("too-slow");
    expect(result.reasons).toContain("long-gap");
  });

  it("flags a long silence between words inside speech", () => {
    const words = [...speak(NATURAL.slice(0, 5), 0, 3), ...speak(NATURAL.slice(5, 10), 5000, 3)];
    const result = evaluateTranscript({ words, speech: [{ startMs: 0, endMs: 7000 }] });
    expect(result.reasons).toContain("long-gap");
    expect(result.metrics.longestGapMs).toBeGreaterThan(1500);
  });

  it("does not count a gap that sits between two separate speech regions", () => {
    const words = [...speak(NATURAL.slice(0, 6), 0, 3), ...speak(NATURAL.slice(6, 12), 8000, 3)];
    const result = evaluateTranscript({ words, speech: [{ startMs: 0, endMs: 2200 }, { startMs: 8000, endMs: 10_200 }] });
    expect(result.reasons).not.toContain("long-gap");
  });

  it("flags a high no-speech probability and respects custom limits", () => {
    const words = speak(NATURAL, 0, 3);
    expect(evaluateTranscript({ words, speech, noSpeechProbability: 0.9 }).reasons).toContain("no-speech");
    expect(evaluateTranscript({ words, speech, noSpeechProbability: 0.5 }).reasons).not.toContain("no-speech");
    expect(evaluateTranscript({ words, speech, noSpeechProbability: 0.5 }, { maxNoSpeechProbability: 0.4 }).reasons).toContain("no-speech");
  });

  it("flags a window that is only the model's junk token, but only when the caller names it", () => {
    const nan = speak(["nan"], 0, 1);
    // Speech mode passes no junk list: "nan" alone stays a (weak) caption, as it may be a real word.
    expect(evaluateTranscript({ words: nan, speech: [{ startMs: 0, endMs: 30_000 }] }).reasons).not.toContain("junk-text");
    // Music mode names it: one "nan" for a whole window is the model admitting it heard nothing.
    const music = evaluateTranscript({ words: nan, speech: [{ startMs: 0, endMs: 30_000 }] }, { junkWords: ["nan"] });
    expect(music.reasons).toContain("junk-text");
    expect(music.flagged).toBe(true);
    // A real word next to it means the window is not junk.
    const mixed = evaluateTranscript({ words: speak(["nan", "banana"]), speech: [{ startMs: 0, endMs: 30_000 }] }, { junkWords: ["nan"] });
    expect(mixed.reasons).not.toContain("junk-text");
  });

  it("handles an empty transcript without dividing by zero", () => {
    const quiet = evaluateTranscript({ words: [], speech: [] });
    expect(quiet.flagged).toBe(false);
    expect(quiet.metrics.wordsPerSecond).toBe(0);
    const silentButSpeech = evaluateTranscript({ words: [], speech: [{ startMs: 0, endMs: 10_000 }] });
    expect(silentButSpeech.reasons).toContain("too-slow");
    expect(Number.isFinite(silentButSpeech.metrics.outsideSpeechShare)).toBe(true);
  });

  it("does not trust the compression ratio on a handful of words", () => {
    const result = evaluateTranscript({ words: speak(["ha", "ha", "ha"], 0, 3), speech: [{ startMs: 0, endMs: 1000 }] });
    expect(result.reasons).not.toContain("repetitive");
  });
});

describe("dropCollapsedTail (music only)", () => {
  const word = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs, confidence: 0.9, index: 0, windowIndex: 0 });

  it("drops the repeated line that the aligner crushed into the last milliseconds of the window", () => {
    // The measured Sajan shape: nine words of a repeated line all between 29.79 s and 29.93 s.
    const collapsed = ["Aani", "vaala", "hai", "jo,", "vah", "yaad", "aa", "raha", "hai."].map((text, i) =>
      word(text, 29_790 + i * 15, 29_790 + (i + 1) * 15),
    );
    const real = ["Meri", "zindagi", "mera,", "kya", "gayaan", "aa", "raha", "hai,"].map((text, i) => word(text, 2000 + i * 400, 2300 + i * 400));
    expect(dropCollapsedTail([...real, ...collapsed], 30_000).map((item) => item.text)).toEqual(real.map((item) => item.text));
  });

  it("keeps ordinary fast singing and a short normal ending", () => {
    // Eight words a second is fast rap; 125 ms each is possible, so nothing is dropped.
    const fast = ["ek", "do", "teen", "chaar", "paanch", "chhe", "saat", "aath"].map((text, i) => word(text, 28_500 + i * 125, 28_620 + i * 125));
    expect(dropCollapsedTail(fast, 30_000)).toHaveLength(8);
    // Two words in the tail are a normal ending even when close together.
    const ending = [word("haan", 29_800, 29_850), word("hai.", 29_860, 29_900)];
    expect(dropCollapsedTail(ending, 30_000)).toHaveLength(2);
    // Three words spread over a normal half second are kept.
    const normal = [word("ab", 29_200, 29_400), word("to", 29_450, 29_650), word("chal", 29_700, 29_950)];
    expect(dropCollapsedTail(normal, 30_000)).toHaveLength(3);
  });

  it("does not touch a collapsed run that is not at the end of the window", () => {
    const middle = [word("a", 10_000, 10_010), word("b", 10_010, 10_020), word("c", 10_020, 10_030)];
    const after = [word("real", 20_000, 20_400)];
    expect(dropCollapsedTail([...middle, ...after], 30_000)).toHaveLength(4);
  });
});
