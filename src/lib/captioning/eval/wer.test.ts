import { describe, expect, it } from "vitest";
import {
  matchedWordPairs,
  normalizeForWer,
  tokenizeForWer,
  wordEditDistance,
  wordErrorRate,
  type EditOp,
} from "./wer";

/**
 * Independent oracle: the textbook full-matrix Levenshtein implementation. It is deliberately the
 * dumbest possible version, sharing no code with the Hirschberg alignment it checks.
 */
function bruteForceDistance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Seeded LCG so a failing random case is reproducible from the seed printed in the assertion. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomSequence(random: () => number, vocabulary: readonly string[], maxLength: number): string[] {
  const length = Math.floor(random() * (maxLength + 1));
  return Array.from({ length }, () => vocabulary[Math.floor(random() * vocabulary.length)]);
}

function checkOps(ops: readonly EditOp[], ref: readonly string[], hyp: readonly string[]): void {
  let refCursor = 0;
  let hypCursor = 0;
  for (const op of ops) {
    if (op.type === "match" || op.type === "substitution" || op.type === "deletion") {
      expect(op.refIndex).toBe(refCursor);
      expect(op.refToken).toBe(ref[refCursor]);
      refCursor += 1;
    }
    if (op.type === "match" || op.type === "substitution" || op.type === "insertion") {
      expect(op.hypIndex).toBe(hypCursor);
      expect(op.hypToken).toBe(hyp[hypCursor]);
      hypCursor += 1;
    }
    if (op.type === "match") expect(op.refToken).toBe(op.hypToken);
    if (op.type === "substitution") expect(op.refToken).not.toBe(op.hypToken);
  }
  expect(refCursor).toBe(ref.length);
  expect(hypCursor).toBe(hyp.length);
}

describe("wordErrorRate against a brute-force oracle", () => {
  const vocabulary = ["alpha", "beta", "gamma", "hai", "nahi", "video", "7"];

  it("matches the true edit distance on 300 seeded random pairs", () => {
    const random = makeRandom(0xc0ffee);
    for (let trial = 0; trial < 300; trial += 1) {
      const reference = randomSequence(random, vocabulary, 14);
      const hypothesis = randomSequence(random, vocabulary, 14);
      const result = wordErrorRate(reference, hypothesis);
      expect(result.errors, `trial ${trial}: ${reference.join(" ")} / ${hypothesis.join(" ")}`).toBe(
        bruteForceDistance(reference, hypothesis),
      );
      expect(result.wer).toBeCloseTo(reference.length === 0 ? (hypothesis.length === 0 ? 0 : 1) : result.errors / reference.length, 12);
      checkOps(result.ops, result.refTokens, result.hypTokens);
    }
  });

  it("agrees with the oracle on a longer pair", () => {
    const random = makeRandom(42);
    const reference = randomSequence(random, vocabulary, 200);
    const hypothesis = randomSequence(random, vocabulary, 200);
    const result = wordErrorRate(reference, hypothesis);
    expect(result.errors).toBe(bruteForceDistance(reference, hypothesis));
    checkOps(result.ops, result.refTokens, result.hypTokens);
  });

  it("is deterministic: two runs return the same script", () => {
    const first = wordErrorRate("alpha beta gamma", "alpha delta gamma");
    const second = wordErrorRate("alpha beta gamma", "alpha delta gamma");
    expect(first).toEqual(second);
  });

  it("counts substitutions, deletions and insertions separately", () => {
    // one substitution (b->x) and one deletion (c missing) against a three-word reference
    const result = wordErrorRate("a b c", "a x");
    expect(result).toMatchObject({ correct: 1, substitutions: 1, deletions: 1, insertions: 0, refWords: 3, hypWords: 2, errors: 2 });
    expect(result.wer).toBeCloseTo(2 / 3, 12);

    const inserted = wordErrorRate("a c", "a b c");
    expect(inserted).toMatchObject({ correct: 2, substitutions: 0, deletions: 0, insertions: 1, errors: 1 });
    expect(inserted.wer).toBeCloseTo(0.5, 12);
  });

  it("reports matched pairs with their original indices", () => {
    const result = wordErrorRate("a b c", "a x c");
    expect(matchedWordPairs(result)).toEqual([
      { refIndex: 0, hypIndex: 0 },
      { refIndex: 2, hypIndex: 2 },
    ]);
  });
});

describe("Hinglish-aware normalisation", () => {
  const sameWord = (a: string, b: string, strictCase = false): boolean =>
    wordErrorRate([a], [b], { strictCase }).errors === 0;

  it("maps lexicon spelling variants to one spelling", () => {
    expect(sameWord("Nahin", "nahi")).toBe(true);
    expect(sameWord("NAHIN", "nahi")).toBe(true);
    expect(sameWord("bohot", "bahut")).toBe(true);
    expect(sameWord("muje", "mujhe")).toBe(true);
    expect(sameWord("kro", "karo")).toBe(true);
  });

  it("normalises product and initialism casing", () => {
    expect(sameWord("YOUTUBE", "youtube")).toBe(true);
    expect(sameWord("whatsap", "WhatsApp")).toBe(true);
    expect(sameWord("ai", "AI")).toBe(true);
  });

  it("strips punctuation on both sides, including the Devanagari danda", () => {
    expect(sameWord("yaar,", "yaar")).toBe(true);
    expect(sameWord("(video)", "video")).toBe(true);
    expect(sameWord("नहीं।", "नहीं")).toBe(true);
    expect(sameWord("I'm", "im")).toBe(true);
    // A dash between words disappears without becoming a word of its own.
    const result = wordErrorRate("hello — world", "hello world");
    expect(result.errors).toBe(0);
    expect(result.refWords).toBe(2);
  });

  it("keeps Devanagari marks, so different words stay different", () => {
    expect(sameWord("है", "हैं")).toBe(false);
    expect(sameWord("मेरा", "मेरी")).toBe(false);
    const result = wordErrorRate(["है"], ["हैं"]);
    expect(result.substitutions).toBe(1);
  });

  it("ignores case by default but honours strictCase", () => {
    expect(sameWord("Delhi", "delhi")).toBe(true);
    expect(sameWord("Delhi", "delhi", true)).toBe(false);
    // strictCase still applies the lexicon's canonical spelling, so this is a real difference.
    expect(sameWord("Delhi", "Delhi", true)).toBe(true);
  });

  it("keeps original indices when punctuation-only tokens are dropped", () => {
    const result = wordErrorRate("hello — world", "hello world");
    expect(result.refTokens).toEqual(["hello", "world"]);
    expect(result.hypTokens).toEqual(["hello", "world"]);
    expect(result.ops.map((op) => [op.type, op.refIndex, op.hypIndex])).toEqual([
      ["match", 0, 0],
      ["match", 2, 1],
    ]);
  });

  it("is idempotent for scoring: normalising an already-normalised token changes nothing", () => {
    for (const token of ["nahin", "YouTube", "नहीं", "I'm", "AI"]) {
      const once = normalizeForWer(token);
      expect(normalizeForWer(once)).toBe(once);
    }
  });

  it("splits on any whitespace and drops empty pieces", () => {
    expect(tokenizeForWer("  ek\u00a0do\n teen\t")).toEqual(["ek", "do", "teen"]);
  });
});

describe("edge cases", () => {
  it("scores two empty transcripts as zero", () => {
    const result = wordErrorRate([], []);
    expect(result).toMatchObject({ refWords: 0, hypWords: 0, errors: 0, wer: 0 });
    expect(result.ops).toEqual([]);
  });

  it("does not reward a hypothesis when the reference is empty", () => {
    const result = wordErrorRate([], ["hello", "there"]);
    expect(result).toMatchObject({ refWords: 0, hypWords: 2, insertions: 2, wer: 1 });
  });

  it("counts every reference word as a deletion when the hypothesis is empty", () => {
    const result = wordErrorRate(["hello", "there"], []);
    expect(result).toMatchObject({ refWords: 2, hypWords: 0, deletions: 2, wer: 1 });
  });

  it("accepts plain text as well as token arrays", () => {
    expect(wordEditDistance("ek do teen", "ek teen")).toBe(1);
    expect(wordEditDistance("ek do teen", ["ek", "teen"])).toBe(1);
  });

  it("handles a single word on each side", () => {
    const match = wordErrorRate(["alpha"], ["alpha"]);
    expect(match.ops).toEqual([{ type: "match", refIndex: 0, hypIndex: 0, refToken: "alpha", hypToken: "alpha" }]);

    const inserted = wordErrorRate(["alpha"], ["beta", "alpha"]);
    expect(inserted.errors).toBe(1);
    checkOps(inserted.ops, inserted.refTokens, inserted.hypTokens);

    const deleted = wordErrorRate(["alpha", "beta"], ["beta"]);
    expect(deleted.errors).toBe(1);
    checkOps(deleted.ops, deleted.refTokens, deleted.hypTokens);
  });
});
