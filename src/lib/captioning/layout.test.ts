import { describe, expect, it } from "vitest";
import { layoutCaptions } from "./layout";
import type { CaptionEvent, Word } from "./types";

function word(text: string, startMs: number, endMs: number, index: number): Word {
  return { text, startMs, endMs, confidence: 1, index, windowIndex: 0 };
}

function words(texts: readonly string[], stepMs = 300, gapMs = 0): Word[] {
  return texts.map((text, i) => {
    const start = i * (stepMs + gapMs);
    return word(text, start, start + stepMs, i);
  });
}

function flatten(events: CaptionEvent[]): Word[] {
  return events.flatMap((event) => event.lines.flat());
}

const MIN_BLOCK_WORDS = 3;

/** Reading speed of a laid-out caption, measured the same way `layout.ts` measures a block. */
function captionCps(event: CaptionEvent): number {
  const eventWords = event.lines.flat();
  const chars = eventWords.reduce((sum, item) => sum + item.text.length, 0) + Math.max(0, eventWords.length - 1);
  const span = event.endMs - event.startMs;
  return span > 0 ? (chars * 1000) / span : Number.POSITIVE_INFINITY;
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Brute-force reference for the balanced-breaker oracle: every cut mask, legal layouts only. */
function bruteForceCost(lengths: readonly number[], maxChars: number, maxLines: number): number {
  const n = lengths.length;
  let best = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 1 << (n - 1); mask += 1) {
    const widths: number[] = [];
    let width = lengths[0];
    for (let i = 1; i < n; i += 1) {
      if ((mask >> (i - 1)) & 1) {
        widths.push(width);
        width = lengths[i];
      } else {
        width += 1 + lengths[i];
      }
    }
    widths.push(width);
    if (widths.length > maxLines) continue;
    if (widths.some((value) => value > maxChars)) continue;
    const cost = widths.reduce((sum, value) => sum + (maxChars - value) ** 2, 0);
    if (cost < best) best = cost;
  }
  return best;
}

describe("layoutCaptions", () => {
  it("returns nothing for an empty transcript", () => {
    expect(layoutCaptions([])).toEqual([]);
  });

  it("lays out a single word, taking its times from the word", () => {
    const input = words(["namaste"]);
    const events = layoutCaptions(input, { minDurationMs: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ index: 0, startMs: 0, endMs: 300 });
    expect(events[0].lines).toEqual([[input[0]]]);
  });

  it("extends a too-short caption to the minimum duration", () => {
    const events = layoutCaptions(words(["hi"]));
    expect(events).toHaveLength(1);
    expect(events[0].startMs).toBe(0);
    expect(events[0].endMs).toBe(1000);
  });

  it("does not extend a short caption past the next caption's start", () => {
    const input = [word("supercalifragilistic", 0, 200, 0), word("x", 400, 600, 1)];
    const events = layoutCaptions(input);
    expect(events).toHaveLength(2);
    expect(events[0].endMs).toBe(400);
    expect(events[1].startMs).toBe(400);
    expect(events[1].endMs).toBe(1400);
  });

  it("balances two lines instead of filling the first one", () => {
    const input = words(["word", "word", "word", "word", "word", "word", "word", "word", "word", "word"], 400);
    const events = layoutCaptions(input);
    expect(events).toHaveLength(1);
    expect(events[0].lines.map((line) => line.length)).toEqual([5, 5]);
  });

  it("splits by characters per second", () => {
    // Ten characters every 100 ms is 100 CPS; no grouping can satisfy a 17 CPS budget, so every
    // word stands alone. The point is that the split is stable and loses no words.
    const input = words(Array.from({ length: 20 }, () => "abcdefghij"), 100);
    const events = layoutCaptions(input, { minDurationMs: 0 });
    expect(events).toHaveLength(20);
    for (const event of events) expect(event.lines.flat()).toHaveLength(1);
    expect(flatten(events)).toEqual(input);
  });

  it("splits by maximum duration", () => {
    const input = words(Array.from({ length: 40 }, () => "word"), 500);
    const events = layoutCaptions(input, { maxCps: 1_000_000, minDurationMs: 0, maxDurationMs: 2000 });
    expect(events).toHaveLength(10);
    for (const event of events) {
      expect(event.endMs - event.startMs).toBe(2000);
      expect(event.lines).toHaveLength(1);
    }
    expect(flatten(events)).toEqual(input);
  });

  it("gives an over-long word its own line and terminates", () => {
    const long = "x".repeat(200);
    const input = [word("start", 0, 300, 0), word(long, 300, 900, 1), word("end", 900, 1200, 2)];
    const events = layoutCaptions(input, {
      maxCharsPerLine: 20,
      maxLines: 2,
      maxCps: 1_000_000,
      minDurationMs: 0,
      maxDurationMs: 1_000_000,
    });
    expect(flatten(events)).toEqual(input);
    const holding = events.flatMap((event) => event.lines).find((line) => line.some((item) => item.text === long));
    expect(holding).toBeDefined();
    expect(holding?.length).toBe(1);
  });

  it("regression: never merges a neighbour into an over-long word's line (BUG 1)", () => {
    // With maxCharsPerLine 20 the 24-character word overflows on its own, and "xxx" would still be
    // legal on its own line (slack 17). Merging them costs 8^2 of slack while separating them costs
    // 17^2 + 4^2, so the old DP preferred the overflowing merge. A multi-word line must never
    // overflow when a legal split exists.
    const long = "x".repeat(24);
    const input = words([long, "xxx"], 300);
    const events = layoutCaptions(input, {
      maxCharsPerLine: 20,
      maxLines: 2,
      minDurationMs: 0,
      maxCps: 1000,
      maxDurationMs: 60000,
    });
    expect(events).toHaveLength(1);
    expect(flatten(events)).toEqual(input);
    expect(events[0].lines.map((line) => line.map((item) => item.text))).toEqual([[long], ["xxx"]]);
  });

  it("does not depend on empty word text", () => {
    const input = [word("", 0, 300, 0), word("hi", 300, 600, 1)];
    const events = layoutCaptions(input, { minDurationMs: 0 });
    expect(flatten(events)).toEqual(input);
  });

  it("survives words whose times are inverted", () => {
    const input = [word("a", 500, 400, 0), word("b", 900, 1000, 1)];
    expect(() => layoutCaptions(input)).not.toThrow();
    expect(flatten(layoutCaptions(input))).toEqual(input);
  });

  it("produces positive-length events for zero-length words", () => {
    const input = [word("a", 0, 0, 0), word("b", 0, 0, 1), word("c", 0, 0, 2)];
    const events = layoutCaptions(input);
    expect(flatten(events)).toEqual(input);
    for (const event of events) expect(event.endMs).toBeGreaterThan(event.startMs);
  });

  it("sanitises impossible options instead of hanging", () => {
    const input = words(["alpha", "beta", "gamma"], 300);
    const events = layoutCaptions(input, {
      maxCharsPerLine: 0,
      maxLines: 0,
      maxCps: 0,
      minDurationMs: -50,
      maxDurationMs: 0,
    });
    expect(flatten(events)).toEqual(input);
    expect(events).toHaveLength(3);
  });

  it("is deterministic and never mutates its input", () => {
    const input = words(["a", "bb", "ccc"], 300);
    const snapshot = input.map((item) => ({ ...item }));
    const first = layoutCaptions(input);
    const second = layoutCaptions(input);
    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });

  it("handles a long transcript without losing words", () => {
    const input = Array.from({ length: 1000 }, (_, i) => word(`w${i}`, i * 120, i * 120 + 110, i));
    const events = layoutCaptions(input);
    expect(flatten(events)).toEqual(input);
  });

  it("matches a brute-force oracle for balanced line breaking", () => {
    const random = makeRandom(4242);
    for (let round = 0; round < 120; round += 1) {
      const n = 1 + Math.floor(random() * 6);
      const maxChars = 8 + Math.floor(random() * 8);
      const maxLines = n;
      const texts: string[] = [];
      for (let i = 0; i < n; i += 1) {
        texts.push("x".repeat(1 + Math.floor(random() * (maxChars - 1))));
      }
      const input = words(texts, 800);
      const events = layoutCaptions(input, {
        maxCharsPerLine: maxChars,
        maxLines,
        maxCps: 1_000_000,
        minDurationMs: 0,
        maxDurationMs: 1_000_000,
      });
      expect(events).toHaveLength(1);
      const widths = events[0].lines.map(
        (line) => line.reduce((sum, item) => sum + item.text.length, 0) + Math.max(0, line.length - 1),
      );
      const actual = widths.reduce((sum, value) => sum + (maxChars - value) ** 2, 0);
      expect(actual).toBe(bruteForceCost(texts.map((text) => text.length), maxChars, maxLines));
      for (const width of widths) expect(width).toBeLessThanOrEqual(maxChars);
    }
  });

  it("keeps every invariant on random transcripts (seeded fuzz)", () => {
    const random = makeRandom(12345);
    for (let round = 0; round < 200; round += 1) {
      const count = Math.floor(random() * 40);
      const input: Word[] = [];
      let cursor = 0;
      for (let i = 0; i < count; i += 1) {
        const length = 1 + Math.floor(random() * 24);
        const text = "abcdefghijklmnopqrstuvwxyz".slice(0, Math.min(length, 26));
        const duration = 40 + Math.floor(random() * 600);
        cursor += Math.floor(random() * 400);
        input.push(word(text, cursor, cursor + duration, i));
        cursor += duration;
      }

      const options =
        random() < 0.5
          ? undefined
          : {
              maxCharsPerLine: 8 + Math.floor(random() * 50),
              maxLines: 1 + Math.floor(random() * 3),
              maxCps: 5 + Math.floor(random() * 30),
              minDurationMs: Math.floor(random() * 1500),
              maxDurationMs: 500 + Math.floor(random() * 6000),
            };
      const events = layoutCaptions(input, options);
      expect(flatten(events)).toEqual(input);

      const maxChars = options?.maxCharsPerLine ?? 42;
      const maxLines = options?.maxLines ?? 2;
      const maxCps = options?.maxCps ?? 17;
      const maxDuration = options?.maxDurationMs ?? 6000;

      let seen = 0;
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const eventWords = event.lines.flat();
        expect(event.index).toBe(index);
        expect(eventWords.length).toBeGreaterThan(0);
        expect(event.startMs).toBe(eventWords[0].startMs);
        expect(event.endMs).toBeGreaterThanOrEqual(eventWords[eventWords.length - 1].endMs);
        expect(event.endMs).toBeGreaterThan(event.startMs);
        expect(event.lines.length).toBeLessThanOrEqual(maxLines);
        if (index + 1 < events.length) expect(event.endMs).toBeLessThanOrEqual(events[index + 1].startMs);

        const chars = eventWords.reduce((sum, item) => sum + item.text.length, 0) + eventWords.length - 1;
        if (eventWords.length > 1) {
          expect(event.endMs - event.startMs).toBeLessThanOrEqual(maxDuration);
          // Reading speed is soft: up to twice the preferred speed is allowed when the preferred one would leave under three words.
          expect((chars * 1000) / (event.endMs - event.startMs)).toBeLessThanOrEqual(maxCps * 2 + 0.5);
        }

        for (const line of event.lines) {
          expect(line.length).toBeGreaterThan(0);
          const width = line.reduce((sum, item) => sum + item.text.length, 0) + line.length - 1;
          if (line.length > 1) expect(width).toBeLessThanOrEqual(maxChars);
        }

        expect(flatWordAt(events, seen)).toBe(eventWords[0]);
        seen += eventWords.length;
      }
      expect(seen).toBe(input.length);
    }
  });

  describe("fast real speech", () => {
    // Words and times from a real 59-second Hinglish reel (the fast part: 100 to 400 ms per word, no gaps).
    const reel = [
      ["mein", 2920, 3180], ["padhane", 3180, 3640], ["wale do", 3640, 4000], ["students", 4000, 4200], ["ke", 4200, 4360], ["maan", 4360, 4460],
      ["se", 4460, 4680], ["itne", 4680, 4980], ["different", 4980, 5400], ["kyun", 5400, 5800], ["hote", 5800, 6100], ["hain?", 6100, 6500],
    ] as const;
    const fast = reel.flatMap(([text, start, end], i) => text.split(" ").map((piece, k, all) => word(piece, start + (k * (end - start)) / all.length, start + ((k + 1) * (end - start)) / all.length, i + k)));

    it("keeps a few words together instead of one word per caption", () => {
      const events = layoutCaptions(fast.map((w, i) => ({ ...w, startMs: Math.round(w.startMs), endMs: Math.round(w.endMs), index: i })));
      expect(events.length).toBeLessThan(fast.length / 2);
      expect(events.filter((event) => event.lines.flat().length === 1).length).toBeLessThanOrEqual(1);
      expect(flatten(events).map((w) => w.text)).toEqual(fast.map((w) => w.text));
    });

    it("never starts a new caption in the middle of a sentence when the sentence ended earlier in the block", () => {
      const texts = ["Kya", "haal", "hai.", "Main", "theek", "hoon", "yaar", "tum", "batao"];
      const input = texts.map((text, i) => word(text, i * 250, i * 250 + 250, i));
      const events = layoutCaptions(input);
      const eventTexts = events.map((event) => event.lines.flat().map((w) => w.text));
      // The sentence "Kya haal hai." is one caption and the next sentence starts the next one.
      expect(eventTexts[0]).toEqual(["Kya", "haal", "hai."]);
      expect(eventTexts[1]?.[0]).toBe("Main");
      expect(eventTexts.flat()).toEqual(texts);
    });

    it("still gives a single very fast word its own caption rather than failing", () => {
      const events = layoutCaptions([word("extraordinarily", 0, 100, 0)]);
      expect(events).toHaveLength(1);
      expect(events[0].lines.flat()).toHaveLength(1);
    });
  });

  describe("preferred caption breaks (pasted lyric line starts)", () => {
    // Generous line/duration limits, so only the character budget (20) decides: 7 three-character
    // words per caption (20 characters exactly).
    const roomy = {
      maxCharsPerLine: 20,
      maxLines: 1,
      maxCps: 1_000_000,
      minDurationMs: 0,
      maxDurationMs: 1_000_000,
    } as const;

    it("keeps the existing layout exactly when the option is absent", () => {
      // Mixed word lengths, 320 ms words with 60 ms pauses, so both the duration and the line
      // budgets are active. This list is the fixed reference for "no preference == old layout".
      const texts = [
        "Kya", "haal", "hai.", "Main", "theek", "hoon", "yaar", "tum", "batao",
        "kya", "kar", "rahe", "ho", "aaj", "kal", "phir", "milte", "hain",
      ];
      const input = words(texts, 320, 60);
      const events = layoutCaptions(input);
      expect(events.map((event) => ({
        startMs: event.startMs,
        endMs: event.endMs,
        lines: event.lines.map((line) => line.map((item) => item.text)),
      }))).toEqual([
        { startMs: 0, endMs: 1080, lines: [["Kya", "haal", "hai."]] },
        {
          startMs: 1140,
          endMs: 6780,
          lines: [
            ["Main", "theek", "hoon", "yaar", "tum", "batao", "kya"],
            ["kar", "rahe", "ho", "aaj", "kal", "phir", "milte", "hain"],
          ],
        },
      ]);
      // The same call with an explicitly empty preference is byte-for-byte the same layout.
      expect(layoutCaptions(input, { preferredBreakBefore: [] })).toEqual(events);
    });

    it("takes a preferred break that is a legal end (inside the allowed range)", () => {
      const input = words(Array.from({ length: 20 }, () => "aa"), 300);
      const baseline = layoutCaptions(input, roomy);
      // The old breaker fills seven words per caption; index 6 is one word earlier, so the
      // documented slack lets the pasted line break win.
      expect(baseline.map((event) => event.lines.flat().length)).toEqual([7, 7, 6]);
      const events = layoutCaptions(input, { ...roomy, preferredBreakBefore: [6] });
      expect(events.map((event) => event.lines.flat().length)).toEqual([6, 7, 7]);
      expect(flatten(events)).toEqual(input);
      // It never extends: a preferred break after the chosen end is ignored.
      const later = layoutCaptions(input, { ...roomy, preferredBreakBefore: [8] });
      expect(later.map((event) => event.lines.flat().length)).toEqual([7, 7, 6]);
    });

    it("never leaves a trailing caption below MIN_BLOCK_WORDS", () => {
      // Finding 6 reproduction: 14 words at seven per caption. A break at 6 used to leave a
      // one-word final caption ([6, 7, 1]); the remainder cannot be split into >= 3-word blocks,
      // so the preference must be ignored.
      const input = words(Array.from({ length: 14 }, () => "aa"), 300);
      const baseline = layoutCaptions(input, roomy);
      expect(baseline.map((event) => event.lines.flat().length)).toEqual([7, 7]);
      const events = layoutCaptions(input, { ...roomy, preferredBreakBefore: [6] });
      expect(events.map((event) => event.lines.flat().length)).toEqual([7, 7]);
      for (const event of events) expect(event.lines.flat().length).toBeGreaterThanOrEqual(MIN_BLOCK_WORDS);
      expect(flatten(events)).toEqual(input);

      // Same break, but 20 words: the 14-word remainder splits as 7 + 7, so it stays honoured.
      const divisible = words(Array.from({ length: 20 }, () => "aa"), 300);
      expect(
        layoutCaptions(divisible, { ...roomy, preferredBreakBefore: [6] }).map((event) => event.lines.flat().length),
      ).toEqual([6, 7, 7]);
    });

    it("does not raise reading speed above maxCps for a preferred break", () => {
      // Finding 7 reproduction shape: 23 four-character words. The first seven are fast (230 ms),
      // the eighth is long, the rest are 300 ms. Baseline is [8, 8, 7] at 19.5 / 16.25 / 16.19 CPS.
      const input: Word[] = [];
      for (let i = 0; i < 23; i += 1) {
        const start = i < 7 ? i * 230 : i === 7 ? 1610 : 2000 + (i - 8) * 300;
        const end = i < 7 ? start + 230 : i === 7 ? 2000 : start + 300;
        input.push(word("abcd", start, end, i));
      }
      const options = { maxCharsPerLine: 19, maxLines: 2, maxCps: 20, minDurationMs: 0 };
      const baseline = layoutCaptions(input, options);
      expect(baseline.map((event) => event.lines.flat().length)).toEqual([8, 8, 7]);
      for (const event of baseline) expect(captionCps(event)).toBeLessThanOrEqual(20);

      // Prefix 7 is 21.1 CPS. The old soft-2x "allowed" rule took it, producing a caption faster
      // than maxCps although the baseline end (8) was legal. Now it is ignored.
      const events = layoutCaptions(input, { ...options, preferredBreakBefore: [7] });
      expect(events.map((event) => event.lines.flat().length)).toEqual([8, 8, 7]);
      for (const event of events) expect(captionCps(event)).toBeLessThanOrEqual(20);
      expect(flatten(events)).toEqual(input);
    });

    it("does not take a preferred break that would violate maxCps, maxCharsPerLine or maxDuration", () => {
      // maxCps: four 10-character words at 100 ms each are far above the soft 34 CPS ceiling;
      // only after the 3 s pause does prefix 5 become legal, so index 4 must not be used.
      const fast = [
        word("abcdefghij", 0, 100, 0),
        word("abcdefghij", 100, 200, 1),
        word("abcdefghij", 200, 300, 2),
        word("abcdefghij", 300, 400, 3),
        word("abcdefghij", 4000, 4300, 4),
        word("abcdefghij", 4300, 4600, 5),
      ];
      const cpsEvents = layoutCaptions(fast, { preferredBreakBefore: [4], minDurationMs: 0 });
      // The break after word 4 sits above the soft ceiling, so it is not taken; the layout is
      // exactly the one without the preference.
      expect(cpsEvents).toEqual(layoutCaptions(fast, { minDurationMs: 0 }));
      expect(cpsEvents[0].lines.flat().length).toBeGreaterThan(4);

      // maxCharsPerLine 14 holds three 4-character words; a break after four would overflow.
      const charsInput = words(["aaaa", "aaaa", "aaaa", "aaaa", "aaaa", "aaaa"], 300);
      const charsOptions = { maxCharsPerLine: 14, maxLines: 1, maxCps: 1_000_000, minDurationMs: 0 };
      const charsEvents = layoutCaptions(charsInput, { ...charsOptions, preferredBreakBefore: [4] });
      expect(charsEvents[0].lines.flat()).toHaveLength(3);

      // maxDurationMs 3000 holds three 1 s words; index 4 is past the hard duration limit.
      const longInput = words(Array.from({ length: 10 }, () => "word"), 1000);
      const durationEvents = layoutCaptions(longInput, {
        maxCharsPerLine: 1_000_000,
        maxLines: 3,
        maxCps: 1_000_000,
        minDurationMs: 0,
        maxDurationMs: 3000,
        preferredBreakBefore: [4],
      });
      expect(durationEvents[0].lines.flat()).toHaveLength(3);

      for (const [input, events] of [
        [fast, cpsEvents],
        [charsInput, charsEvents],
        [longInput, durationEvents],
      ] as const) {
        expect(flatten(events)).toEqual(input);
      }
    });

    it("ignores empty, unsorted, duplicated and out-of-range preferred breaks", () => {
      const input = words(Array.from({ length: 12 }, () => "aa"), 300);
      const baseline = layoutCaptions(input, roomy);
      expect(layoutCaptions(input, { ...roomy, preferredBreakBefore: [] })).toEqual(baseline);
      expect(
        layoutCaptions(input, {
          ...roomy,
          preferredBreakBefore: [Number.NaN, -3, 2.5, 0, input.length, 999, Number.POSITIVE_INFINITY],
        }),
      ).toEqual(baseline);
      // Duplicates and a different order are harmless (5 is the only usable one).
      const duplicate = layoutCaptions(input, { ...roomy, preferredBreakBefore: [5, 5, 5] });
      expect(duplicate.map((event) => event.lines.flat().length)).toEqual([5, 7]);
      expect(flatten(duplicate)).toEqual(input);
    });

    it("never makes an empty caption or a one-word orphan when the limits allow more", () => {
      const input = words(Array.from({ length: 30 }, () => "aa"), 300);
      // Dense pasted line starts: every third word. Each caption may still hold seven words, so
      // every accepted break must keep at least MIN_BLOCK_WORDS words on both sides. The exact
      // counts also prove the preference is actually used (the baseline is [7, 7, 7, 7, 2]).
      expect(layoutCaptions(input, roomy).map((event) => event.lines.flat().length)).toEqual([7, 7, 7, 7, 2]);
      const preferredBreakBefore = Array.from({ length: 10 }, (_, i) => (i + 1) * 3);
      const events = layoutCaptions(input, { ...roomy, preferredBreakBefore });
      expect(events.map((event) => event.lines.flat().length)).toEqual([6, 6, 6, 6, 6]);
      expect(flatten(events)).toEqual(input);
      for (const event of events) {
        expect(event.lines.flat().length).toBeGreaterThanOrEqual(MIN_BLOCK_WORDS);
        for (const line of event.lines) expect(line.length).toBeGreaterThan(0);
      }
      // A line start too close to the caption start is ignored rather than emptied: with 28 words
      // (four full seven-word captions) the result is exactly the baseline.
      const nearStartInput = words(Array.from({ length: 28 }, () => "aa"), 300);
      const nearStart = layoutCaptions(nearStartInput, { ...roomy, preferredBreakBefore: [1, 2] });
      expect(nearStart.map((event) => event.lines.flat().length)).toEqual([7, 7, 7, 7]);
      for (const event of nearStart) expect(event.lines.flat().length).toBeGreaterThanOrEqual(MIN_BLOCK_WORDS);
    });

    it("keeps every limit on random transcripts with random preferred breaks (seeded fuzz)", () => {
      const random = makeRandom(778899);
      for (let round = 0; round < 120; round += 1) {
        const count = 1 + Math.floor(random() * 40);
        const input: Word[] = [];
        let cursor = 0;
        for (let i = 0; i < count; i += 1) {
          const text = "abcdefghij".slice(0, 1 + Math.floor(random() * 9));
          const duration = 80 + Math.floor(random() * 500);
          cursor += Math.floor(random() * 300);
          input.push(word(text, cursor, cursor + duration, i));
          cursor += duration;
        }

        const baseLimits = {
          maxCharsPerLine: 10 + Math.floor(random() * 40),
          maxLines: 1 + Math.floor(random() * 3),
          maxCps: 8 + Math.floor(random() * 25),
          minDurationMs: Math.floor(random() * 800),
          maxDurationMs: 1000 + Math.floor(random() * 5000),
        };
        const options = {
          ...baseLimits,
          // Includes -1 and indices past the end on purpose: they must be ignored.
          preferredBreakBefore: Array.from({ length: count }, () => Math.floor(random() * (count + 3)) - 1),
        };
        const baseline = layoutCaptions(input, baseLimits);
        const events = layoutCaptions(input, options);
        expect(flatten(events)).toEqual(input);
        expect(events).toEqual(layoutCaptions(input, options));

        // A preference may not invent a short or fast caption that the baseline layout did not have.
        const baselineMinWords = baseline.every((event) => event.lines.flat().length >= MIN_BLOCK_WORDS);
        if (input.length >= MIN_BLOCK_WORDS && baselineMinWords) {
          for (const event of events) {
            expect(event.lines.flat().length).toBeGreaterThanOrEqual(MIN_BLOCK_WORDS);
          }
        }
        const baselineCpsOk = baseline.every((event) => captionCps(event) <= baseLimits.maxCps + 1e-9);
        if (baselineCpsOk) {
          for (const event of events) expect(captionCps(event)).toBeLessThanOrEqual(baseLimits.maxCps + 1e-9);
        }

        for (const event of events) {
          const eventWords = event.lines.flat();
          expect(eventWords.length).toBeGreaterThan(0);
          expect(event.lines.every((line) => line.length > 0)).toBe(true);
          expect(event.lines.length).toBeLessThanOrEqual(options.maxLines);

          const chars = eventWords.reduce((sum, item) => sum + item.text.length, 0) + eventWords.length - 1;
          if (eventWords.length > 1) {
            expect(event.endMs - event.startMs).toBeLessThanOrEqual(options.maxDurationMs);
            expect((chars * 1000) / (event.endMs - event.startMs)).toBeLessThanOrEqual(options.maxCps * 2 + 0.5);
          }
          for (const line of event.lines) {
            if (line.length > 1) {
              const width = line.reduce((sum, item) => sum + item.text.length, 0) + line.length - 1;
              expect(width).toBeLessThanOrEqual(options.maxCharsPerLine);
            }
          }
        }
      }
    });
  });

  describe("words per caption", () => {
    function captionsOf(events: CaptionEvent[]): Word[] {
      return events.flatMap((event) => event.lines.flat());
    }

    it("is the old layout exactly when the option is absent", () => {
      const input = words(["Kya", "haal", "hai.", "Main", "theek", "hoon", "yaar", "tum", "batao", "aaj", "kal"], 320, 60);
      const baseline = layoutCaptions(input);
      expect(layoutCaptions(input, { maxWordsPerCaption: undefined })).toEqual(baseline);
      // A non-finite value is "no limit", which also keeps the old path.
      expect(layoutCaptions(input, { maxWordsPerCaption: Number.NaN })).toEqual(baseline);
      expect(layoutCaptions(input, { maxWordsPerCaption: Number.POSITIVE_INFINITY })).toEqual(baseline);
    });

    it("never puts more than the chosen number of words in a caption", () => {
      const input = words(Array.from({ length: 40 }, () => "word"), 300);
      for (const cap of [1, 2, 3, 4, 5]) {
        const events = layoutCaptions(input, { maxWordsPerCaption: cap });
        expect(captionsOf(events)).toEqual(input);
        for (const event of events) {
          const count = event.lines.flat().length;
          expect(count).toBeGreaterThan(0);
          expect(count).toBeLessThanOrEqual(cap);
          expect(event.lines.length).toBeLessThanOrEqual(2);
        }
      }
    });

    it("keeps the duration, line and reading-speed rules at the smaller size", () => {
      // Mixed lengths and a pause, so line width, duration and CPS all get a chance to bite.
      const input: Word[] = [];
      let cursor = 0;
      for (let i = 0; i < 30; i += 1) {
        const duration = 120 + ((i * 97) % 500);
        const text = "x".repeat(2 + ((i * 5) % 9));
        input.push(word(text, cursor, cursor + duration, i));
        cursor += duration + (i % 4 === 0 ? 450 : 0);
      }
      const options = { maxWordsPerCaption: 3, maxCharsPerLine: 20, maxLines: 2, maxCps: 17, minDurationMs: 0, maxDurationMs: 3000 };
      const events = layoutCaptions(input, options);
      expect(captionsOf(events)).toEqual(input);
      for (const event of events) {
        const eventWords = event.lines.flat();
        expect(eventWords.length).toBeLessThanOrEqual(3);
        expect(event.lines.length).toBeLessThanOrEqual(2);
        for (const line of event.lines) {
          if (line.length > 1) {
            const width = line.reduce((sum, item) => sum + item.text.length, 0) + line.length - 1;
            expect(width).toBeLessThanOrEqual(20);
          }
        }
        if (eventWords.length > 1) {
          expect(event.endMs - event.startMs).toBeLessThanOrEqual(3000);
          const chars = eventWords.reduce((sum, item) => sum + item.text.length, 0) + eventWords.length - 1;
          expect((chars * 1000) / (event.endMs - event.startMs)).toBeLessThanOrEqual(34.5);
        }
      }
    });

    it("changes nothing when the cap is at least as large as the old captions", () => {
      const input = words(Array.from({ length: 12 }, () => "word"), 300);
      const baseline = layoutCaptions(input);
      const largest = Math.max(...baseline.map((event) => event.lines.flat().length));
      expect(layoutCaptions(input, { maxWordsPerCaption: largest })).toEqual(baseline);
      expect(layoutCaptions(input, { maxWordsPerCaption: 100 })).toEqual(baseline);
    });

    it("sanitises impossible values instead of losing words", () => {
      const input = words(["alpha", "beta", "gamma", "delta", "epsilon"], 300);
      for (const cap of [0, -3, 1.9]) {
        const events = layoutCaptions(input, { maxWordsPerCaption: cap });
        expect(captionsOf(events)).toEqual(input);
        // 0 and negatives clamp to one word; 1.9 floors to one.
        for (const event of events) expect(event.lines.flat()).toHaveLength(1);
      }
    });

    it("keeps the preferred-break guarantees with a word cap", () => {
      const input = words(Array.from({ length: 20 }, () => "aa"), 300);
      const events = layoutCaptions(input, {
        maxCharsPerLine: 20,
        maxLines: 1,
        maxCps: 1_000_000,
        minDurationMs: 0,
        maxDurationMs: 1_000_000,
        preferredBreakBefore: [6, 12],
        maxWordsPerCaption: 3,
      });
      expect(captionsOf(events)).toEqual(input);
      for (const event of events) expect(event.lines.flat().length).toBeLessThanOrEqual(3);
      // A break cannot extend a caption past the cap, so every event ends on a real word boundary.
      for (const event of events) expect(event.lines.every((line) => line.length > 0)).toBe(true);
    });

    it("reuses the same word objects, so every word keeps its timing and confidence", () => {
      const input = words(["ek", "do", "teen", "chaar", "paanch"], 280, 80);
      const snapshot = input.map((item) => ({ ...item }));
      const flat = captionsOf(layoutCaptions(input, { maxWordsPerCaption: 2 }));
      expect(flat).toEqual(input);
      for (let index = 0; index < input.length; index += 1) expect(flat[index]).toBe(input[index]);
      expect(input).toEqual(snapshot);
    });
  });

  it("never makes two captions overlap, even when several words share one instant (zero-length words)", () => {
    const input = ["a", "b", "c"].map((text, index) => word(text, 0, 0, index));
    const events = layoutCaptions(input, { maxCharsPerLine: 1, maxLines: 1 });
    expect(flatten(events).map((w) => w.text)).toEqual(["a", "b", "c"]);
    for (let i = 0; i < events.length; i += 1) {
      expect(events[i].endMs).toBeGreaterThan(events[i].startMs);
      if (i > 0) expect(events[i].startMs).toBeGreaterThanOrEqual(events[i - 1].endMs);
    }
  });
});

/** Small helper so the fuzz test can prove event boundaries land on real words, in order. */
function flatWordAt(events: CaptionEvent[], offset: number): Word | undefined {
  return flatten(events)[offset];
}
