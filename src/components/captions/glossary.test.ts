import { describe, expect, it } from "vitest";
import type { CaptionResult } from "../../lib/captioning/contracts";
import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { consonantSkeleton, SOUND_MATCH_MAX_CONFIDENCE, soundsLike, applyGlossary, applyGlossaryToEvents, parseGlossary } from "./glossary";

const word = (text: string, index: number): Word => ({
  text,
  startMs: 1000 + index * 500,
  endMs: 1400 + index * 500,
  confidence: 0.31 + index * 0.07,
  index,
  windowIndex: index % 2,
});

const texts = (list: Array<{ text: string }>): string[] => list.map((item) => item.text);

const result = (words: Word[], events: CaptionEvent[] = []): CaptionResult => ({
  words,
  events,
  uncoveredSpeech: [],
  stats: { audioSeconds: 4, speechSeconds: 3, windows: 1, flaggedWindows: 0, droppedWords: 0, stageMs: {}, engineId: "test", alignerId: "test" },
});

describe("parseGlossary", () => {
  it("splits entries on commas and new lines", () => {
    expect(parseGlossary("Mumma, Rahul\nCutmoor\nPapa, Didi")).toEqual(["Mumma", "Rahul", "Cutmoor", "Papa", "Didi"]);
  });

  it("trims each entry and collapses runs of inner spaces", () => {
    expect(parseGlossary("  Rahul   Sharma ,  Mumma  ")).toEqual(["Rahul Sharma", "Mumma"]);
  });

  it("drops empty entries from trailing commas and blank lines", () => {
    expect(parseGlossary("\n, Mumma,, \r\n, Rahul,\n")).toEqual(["Mumma", "Rahul"]);
  });

  it("returns an empty list for empty or whitespace-only text", () => {
    expect(parseGlossary("")).toEqual([]);
    expect(parseGlossary("  \n , \r\n ")).toEqual([]);
  });

  it("removes duplicates case-insensitively and keeps the first spelling", () => {
    expect(parseGlossary("Mumma, mumma, MUMMA, Rahul, rahul")).toEqual(["Mumma", "Rahul"]);
  });

  it("keeps the casing the visitor typed first", () => {
    expect(parseGlossary("cutmoor, Cutmoor")).toEqual(["cutmoor"]);
  });

  it("rejects entries with no letter", () => {
    expect(parseGlossary("123, !!!, ---, , ??, Mumma")).toEqual(["Mumma"]);
  });

  it("accepts an entry that mixes a digit with a letter", () => {
    expect(parseGlossary("4K, Studio 9")).toEqual(["4K", "Studio 9"]);
  });

  it("accepts letters outside plain ASCII", () => {
    expect(parseGlossary("José, राहुल")).toEqual(["José", "राहुल"]);
  });

  it("drops entries longer than 40 characters", () => {
    const tooLong = "a".repeat(41);
    const longest = "b".repeat(40);
    expect(parseGlossary(`${tooLong}, ${longest}`)).toEqual([longest]);
  });

  it("keeps at most 50 entries", () => {
    const input = Array.from({ length: 60 }, (_, index) => `name${index}`).join(", ");
    const parsed = parseGlossary(input);
    expect(parsed).toHaveLength(50);
    expect(parsed[0]).toBe("name0");
    expect(parsed[49]).toBe("name49");
  });
});

describe("applyGlossary", () => {
  it("returns the same object when the glossary is empty", () => {
    const input = result([word("Muma", 0)]);
    expect(applyGlossary(input, [])).toBe(input);
  });

  it("returns the same object when there are no words", () => {
    const input = result([]);
    expect(applyGlossary(input, ["Mumma"])).toBe(input);
  });

  it("fixes a capitalised word one letter away from an entry", () => {
    const fixed = applyGlossary(result([word("Muma", 0)]), ["Mumma"]);
    expect(texts(fixed.words)).toEqual(["Mumma"]);
  });

  it("fixes casing for an exact lowercase match", () => {
    const fixed = applyGlossary(result([word("mumma", 0), word("cutmoor", 1)]), ["Mumma", "Cutmoor"]);
    expect(texts(fixed.words)).toEqual(["Mumma", "Cutmoor"]);
  });

  it("leaves words that do not match an entry alone", () => {
    const input = result([word("Muma", 0), word("video", 1), word("Hello", 2), word("world", 3)]);
    const fixed = applyGlossary(input, ["Mumma"]);
    expect(texts(fixed.words)).toEqual(["Mumma", "video", "Hello", "world"]);
  });

  it("never changes timing, index, confidence or windowIndex", () => {
    const input = result([word("Muma", 0), word("mumma", 1), word("video", 2)]);
    const fixed = applyGlossary(input, ["Mumma"]);
    expect(fixed.words).toHaveLength(3);
    fixed.words.forEach((item, position) => {
      const before = input.words[position];
      expect(item.startMs).toBe(before.startMs);
      expect(item.endMs).toBe(before.endMs);
      expect(item.confidence).toBe(before.confidence);
      expect(item.index).toBe(before.index);
      expect(item.windowIndex).toBe(before.windowIndex);
    });
  });

  it("keeps leading and trailing punctuation around the corrected word", () => {
    const fixed = applyGlossary(result([word("Muma,", 0), word('"mumma"', 1)]), ["Mumma"]);
    expect(texts(fixed.words)).toEqual(["Mumma,", '"Mumma"']);
  });

  it("does not mutate the result it is given", () => {
    const input = result([word("Muma", 0)]);
    const snapshot = JSON.parse(JSON.stringify(input)) as CaptionResult;
    applyGlossary(input, ["Mumma"]);
    expect(input).toEqual(snapshot);
  });

  it("returns the same object when no word matches", () => {
    const input = result([word("video", 0), word("Hello", 1)]);
    expect(applyGlossary(input, ["Mumma", "Cutmoor"])).toBe(input);
  });

  it("only treats short entries as exact matches", () => {
    const fixed = applyGlossary(result([word("al", 0), word("Am", 1)]), ["Al"]);
    expect(texts(fixed.words)).toEqual(["Al", "Am"]);
  });

  it("applies several glossary entries in one pass", () => {
    const fixed = applyGlossary(result([word("Muma", 0), word("rahul", 1), word("didii", 2)]), ["Mumma", "Rahul", "Didi"]);
    expect(texts(fixed.words)).toEqual(["Mumma", "Rahul", "Didi"]);
  });

  it("is idempotent", () => {
    const once = applyGlossary(result([word("Muma", 0), word("mumma", 1)]), ["Mumma"]);
    const twice = applyGlossary(once, ["Mumma"]);
    expect(twice).toBe(once);
    expect(texts(twice.words)).toEqual(["Mumma", "Mumma"]);
  });

  it("rebuilds event lines with the corrected text and the same grouping", () => {
    const words = [word("Muma", 0), word("went", 1), word("home", 2), word("mumma", 3)];
    const events: CaptionEvent[] = [
      { index: 0, startMs: 1000, endMs: 2400, lines: [[words[0], words[1]], [words[2]]] },
      { index: 1, startMs: 2500, endMs: 3000, lines: [[words[3]]] },
    ];
    const input = result(words, events);
    const fixed = applyGlossary(input, ["Mumma"]);

    expect(fixed.events).toHaveLength(2);
    expect(fixed.events[0].index).toBe(0);
    expect(fixed.events[0].startMs).toBe(1000);
    expect(fixed.events[0].endMs).toBe(2400);
    expect(fixed.events[0].lines).toHaveLength(2);
    expect(fixed.events[0].lines[0]).toHaveLength(2);
    expect(fixed.events[0].lines[1]).toHaveLength(1);
    expect(texts(fixed.events[0].lines.flat())).toEqual(["Mumma", "went", "home"]);
    expect(texts(fixed.events[1].lines.flat())).toEqual(["Mumma"]);
  });

  it("handles event words that are copies rather than the result's own objects", () => {
    const words = [word("Muma", 0)];
    const copy: Word = { ...words[0] };
    const events: CaptionEvent[] = [{ index: 0, startMs: 1000, endMs: 1400, lines: [[copy]] }];
    const fixed = applyGlossary(result(words, events), ["Mumma"]);
    expect(texts(fixed.events[0].lines.flat())).toEqual(["Mumma"]);
  });

  it("leaves events untouched when the words did not change", () => {
    const words = [word("video", 0)];
    const event: CaptionEvent = { index: 0, startMs: 1000, endMs: 1400, lines: [[words[0]]] };
    const input = result(words, [event]);
    const fixed = applyGlossary(input, ["Mumma"]);
    expect(fixed).toBe(input);
    expect(fixed.events[0]).toBe(event);
  });
});

describe("applyGlossaryToEvents", () => {
  it("returns the same array when the glossary is empty", () => {
    const words = [word("Muma", 0)];
    const events: CaptionEvent[] = [{ index: 0, startMs: 1000, endMs: 1400, lines: [[words[0]]] }];
    expect(applyGlossaryToEvents(events, words, [])).toBe(events);
  });

  it("fixes first-caption events while a job is still running", () => {
    const words = [word("Muma", 0), word("video", 1)];
    const events: CaptionEvent[] = [{ index: 0, startMs: 1000, endMs: 2000, lines: [[words[0], words[1]]] }];
    const fixed = applyGlossaryToEvents(events, words, ["Mumma"]);
    expect(texts(fixed[0].lines.flat())).toEqual(["Mumma", "video"]);
    expect(fixed[0].lines[0]).toHaveLength(2);
    expect(fixed[0].startMs).toBe(1000);
  });

  it("leaves ALL-CAPS words alone, like applySpelling does", () => {
    const done = applyGlossary(result([word("RAHUL", 0)]), ["Rahul"]);
    expect(done.words[0].text).toBe("RAHUL");
  });

  it("does not turn an ordinary word into a short name one letter away ('did' vs 'Didi')", () => {
    const done = applyGlossary(result([word("did", 0)]), ["Didi"]);
    expect(done.words[0].text).toBe("did");
  });

  describe("sound-alike names", () => {
    it("builds the same skeleton for spellings that sound alike", () => {
      expect(consonantSkeleton("Lucknow")).toBe("lkn");
      expect(consonantSkeleton("lakhanoo")).toBe("lkn");
      expect(consonantSkeleton("Sitapur")).toBe(consonantSkeleton("sitaapur"));
      expect(consonantSkeleton("")).toBe("");
    });

    it("matches a heard word to a listed name only when it is long enough, starts the same way and has a real skeleton", () => {
      expect(soundsLike("lakhanoo", "Lucknow")).toBe(true);
      expect(soundsLike("lucky", "Lucknow")).toBe(false);
      expect(soundsLike("lakhanoo", "Rahul")).toBe(false);
      expect(soundsLike("raaj", "Raj")).toBe(false); // too short a name to trust a skeleton
      expect(soundsLike("rahool", "Rahul")).toBe(true);
      expect(soundsLike("kakhanoo", "Lucknow")).toBe(false); // different first letter
    });

    it("rewrites the heard word to the name and changes nothing else about it", () => {
      const heard = [word("Sitapur", 0), word("road", 1), word("lakhanoo.", 2)];
      const done = applyGlossary(result(heard), ["Lucknow", "Sitapur"]);
      expect(done.words.map((w) => w.text)).toEqual(["Sitapur", "road", "Lucknow."]);
      expect(done.words.map((w) => [w.startMs, w.endMs, w.confidence, w.index])).toEqual(heard.map((w) => [w.startMs, w.endMs, w.confidence, w.index]));
    });

    it("matches a two-word name word for word, keeping the number of words", () => {
      const done = applyGlossary(result([word("sitaapur", 0), word("roed", 1), word("hai", 2)]), ["Sitapur Road"]);
      expect(done.words.map((w) => w.text)).toEqual(["Sitapur", "Road", "hai"]);
    });

    it("leaves acronyms typed in capitals, ordinary words and unrelated names alone", () => {
      const heard = [word("LAKHANOO", 0), word("lucky", 1), word("market", 2)];
      const done = applyGlossary(result(heard), ["Lucknow"]);
      expect(done.words.map((w) => w.text)).toEqual(["LAKHANOO", "lucky", "market"]);
    });

    const sure = (text: string, index: number): Word => ({ ...word(text, index), confidence: 0.95 });

    it("leaves ordinary words the model was sure of alone, even when their consonants match a listed name", () => {
      const heard = [sure("makes", 0), sure("nurse", 1), sure("series", 2), sure("lakhon", 3)];
      const done = applyGlossary(result(heard), ["Mukesh", "Naresh", "Suresh", "Lucknow"]);
      expect(done.words.map((w) => w.text)).toEqual(["makes", "nurse", "series", "lakhon"]);
    });

    it("still applies the visitor's capitals to a confidently heard name, single word or several", () => {
      const heard = [sure("study", 0), sure("point", 1), sure("classes", 2), sure("lucknow", 3)];
      const done = applyGlossary(result(heard), ["Study Point Classes", "Lucknow"]);
      expect(done.words.map((w) => w.text)).toEqual(["Study", "Point", "Classes", "Lucknow"]);
    });

    it("repairs a mishearing the model was fairly (but not fully) sure of, as seen on a real clip (0.82)", () => {
      const heard: Word[] = [{ ...word("lakhanoo.", 0), confidence: 0.82 }];
      expect(applyGlossary(result(heard), ["Lucknow"]).words[0].text).toBe("Lucknow.");
    });

    it("still repairs the same words when the model was unsure of them", () => {
      expect(SOUND_MATCH_MAX_CONFIDENCE).toBeLessThanOrEqual(0.9);
      const unsure = [word("makes", 0), word("lakhanoo", 1)];
      const done = applyGlossary(result(unsure), ["Mukesh", "Lucknow"]);
      expect(done.words.map((w) => w.text)).toEqual(["Mukesh", "Lucknow"]);
    });

    it("prefers a listed full name over its own first word", () => {
      const done = applyGlossary(result([word("sitaapur", 0), word("roed", 1), word("hai", 2)]), ["Sitapur", "Sitapur Road"]);
      expect(done.words.map((w) => w.text)).toEqual(["Sitapur", "Road", "hai"]);
    });

    it("returns the same object when no name matches", () => {
      const input = result([word("hello", 0), word("world", 1)]);
      expect(applyGlossary(input, ["Lucknow"])).toBe(input);
    });
  });
});
