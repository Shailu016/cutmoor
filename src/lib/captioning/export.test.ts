import { describe, expect, it } from "vitest";
import { toSrt, toVtt, toWordJson } from "./export";
import type { CaptionEvent, Word } from "./types";

const word = (text: string, startMs: number, endMs: number, index = 0, confidence = 1): Word => ({
  text,
  startMs,
  endMs,
  confidence,
  index,
  windowIndex: 0,
});

const event = (index: number, startMs: number, endMs: number, lines: Word[][]): CaptionEvent => ({
  index,
  startMs,
  endMs,
  lines,
});

interface ParsedWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  index: number;
  windowIndex: number;
  eventIndex: number;
}

interface ParsedJson {
  version: number;
  words: ParsedWord[];
}

const sample: CaptionEvent[] = [
  event(0, 0, 2000, [
    [word("hello", 0, 700, 0), word("world", 700, 1500, 1)],
    [word("again", 1500, 2000, 2)],
  ]),
  event(1, 61_000, 62_500, [[word("second", 61_000, 62_500, 3)]]),
];

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function parseStamp(value: string): number {
  const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  expect(match).not.toBeNull();
  if (!match) return Number.NaN;
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + Number(match[4]);
}

function hasVisibleText(item: CaptionEvent): boolean {
  return item.lines.some((line) => line.some((part) => part.text.trim().length > 0));
}

/** Cue text (everything after the timing line) of the first cue in a VTT/SRT export. */
function firstCueText(output: string): string {
  return output.trimEnd().split("\n\n")[1].split("\n").slice(1).join("\n");
}

describe("toSrt", () => {
  it("formats cues exactly", () => {
    expect(toSrt(sample)).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:02,000",
        "hello world",
        "again",
        "",
        "2",
        "00:01:01,000 --> 00:01:02,500",
        "second",
        "",
      ].join("\n"),
    );
  });

  it("returns an empty string for no events", () => {
    expect(toSrt([])).toBe("");
  });

  it("uses a comma for milliseconds and never a period", () => {
    const output = toSrt(sample);
    expect(output).toContain("00:00:00,000");
    expect(output).not.toContain("00:00:00.000");
  });

  it("formats hours, including more than 99 of them", () => {
    expect(toSrt([event(0, 3_600_000, 3_601_000, [[word("hour", 3_600_000, 3_601_000)]])])).toContain(
      "01:00:00,000 --> 01:00:01,000",
    );
    expect(toSrt([event(0, 3_599_999, 3_600_000, [[word("edge", 3_599_999, 3_600_000)]])])).toContain(
      "00:59:59,999 --> 01:00:00,000",
    );
    expect(toSrt([event(0, 360_000_000, 360_001_000, [[word("late", 360_000_000, 360_001_000)]])])).toContain(
      "100:00:00,000 --> 100:00:01,000",
    );
  });

  it("never emits end <= start", () => {
    const output = toSrt([
      event(0, 500, 500, [[word("same", 500, 500, 0)]]),
      event(1, 900, 100, [[word("back", 900, 100, 1)]]),
      event(2, -400, -100, [[word("neg", -400, -100, 2)]]),
      event(3, 1000.9, 2000.2, [[word("float", 1000.9, 2000.2, 3)]]),
    ]);
    expect(output).toContain("00:00:00,500 --> 00:00:00,501");
    expect(output).toContain("00:00:00,900 --> 00:00:00,901");
    expect(output).toContain("00:00:00,000 --> 00:00:00,001");
    expect(output).toContain("00:00:01,000 --> 00:00:02,000");
  });

  it("numbers cues sequentially, ignoring event.index", () => {
    const output = toSrt([
      event(7, 0, 100, [[word("a", 0, 100)]]),
      event(3, 200, 300, [[word("b", 200, 300)]]),
    ]);
    expect(output.startsWith("1\n")).toBe(true);
    expect(output).toContain("\n\n2\n");
    expect(output).not.toMatch(/^7$/m);
  });

  it("guards an arrow inside cue text", () => {
    const output = toSrt([event(0, 0, 1000, [[word("a-->b", 0, 1000)]])]);
    const textLine = output.split("\n")[2];
    expect(textLine).not.toContain("-->");
    expect(textLine).toContain("--\u203A");
    expect(output.match(/-->/g)).toHaveLength(1); // only the timing separator
  });

  it("guards newlines inside a word", () => {
    const output = toSrt([event(0, 0, 1000, [[word("one\ntwo", 0, 1000)]])]);
    expect(output.trimEnd().split("\n")).toHaveLength(3);
    expect(output).toContain("one two");
  });

  it("leaves ampersands and angle brackets as plain text", () => {
    const output = toSrt([event(0, 0, 1000, [[word("AT&T R&D 5 < 6 a>b", 0, 1000)]])]);
    expect(output).toContain("AT&T R&D 5 < 6 a>b");
    expect(output).not.toContain("&amp;");
    expect(output).not.toContain("&lt;");
    expect(output).not.toContain("&gt;");
  });

  it("skips events with nothing visible to show", () => {
    const output = toSrt([
      event(0, 0, 100, [[]]),
      event(1, 200, 300, [[word("", 200, 300)]]),
      event(2, 400, 500, [[word("kept", 400, 500)]]),
    ]);
    expect(output).toBe("1\n00:00:00,400 --> 00:00:00,500\nkept\n");
  });

  it("is deterministic", () => {
    expect(toSrt(sample)).toBe(toSrt(sample));
  });
});

describe("toVtt", () => {
  it("formats cues exactly with a WEBVTT header", () => {
    expect(toVtt(sample)).toBe(
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:02.000",
        "hello world",
        "again",
        "",
        "00:01:01.000 --> 00:01:02.500",
        "second",
        "",
      ].join("\n"),
    );
  });

  it("keeps the header even when there are no cues", () => {
    expect(toVtt([])).toBe("WEBVTT\n\n");
    expect(toVtt([event(0, 0, 100, [[]])])).toBe("WEBVTT\n\n");
  });

  it("uses a period for milliseconds and never a comma", () => {
    const output = toVtt(sample);
    expect(output).toContain("00:00:00.000");
    expect(output).not.toContain("00:00:00,000");
  });

  it("has exactly one header", () => {
    expect(toVtt(sample).match(/WEBVTT/g)).toHaveLength(1);
  });

  it("guards arrows and newlines in cue text", () => {
    const output = toVtt([event(0, 0, 1000, [[word("a-->b\nc", 0, 1000)]])]);
    const blocks = output.trimEnd().split("\n\n");
    expect(blocks).toHaveLength(2); // header + cue
    const cueLines = blocks[1].split("\n");
    expect(cueLines[0]).toBe("00:00:00.000 --> 00:00:01.000");
    for (const line of cueLines.slice(1)) expect(line).not.toContain("-->");
    expect(cueLines.slice(1).join("\n")).toContain("a--\u203Ab c");
    expect(output.match(/-->/g)).toHaveLength(1);
  });

  it("escapes &, < and > inside cue text", () => {
    const output = toVtt([event(0, 0, 1000, [[word("AT&T R&D 5 < 6 a>b", 0, 1000)]])]);
    expect(firstCueText(output)).toBe("AT&amp;T R&amp;D 5 &lt; 6 a&gt;b");
  });

  it("escapes each character exactly once per pass", () => {
    const output = toVtt([event(0, 0, 1000, [[word("AT&T <b>", 0, 1000)]])]);
    expect(firstCueText(output)).toBe("AT&amp;T &lt;b&gt;");
    expect(output.match(/&amp;/g)).toHaveLength(1);
    expect(output).not.toContain("&amp;amp;");
    expect(output).not.toContain("&amp;lt;");
    expect(output).not.toContain("&amp;gt;");
  });

  it("leaves no raw markup outside the timing separator", () => {
    const output = toVtt([event(0, 0, 1000, [[word("a<b & c>d", 0, 1000)]])]);
    const withoutEntities = output.replace(/&amp;|&lt;|&gt;/g, "");
    expect(withoutEntities).not.toContain("&");
    expect(withoutEntities).not.toContain("<");
  });
});

describe("toWordJson", () => {
  it("is valid JSON with all words in reading order", () => {
    const parsed = JSON.parse(toWordJson(sample)) as ParsedJson;
    expect(parsed.version).toBe(1);
    expect(parsed.words.map((item) => item.text)).toEqual(["hello", "world", "again", "second"]);
    expect(parsed.words.map((item) => item.eventIndex)).toEqual([0, 0, 0, 1]);
    expect(parsed.words[0]).toMatchObject({
      startMs: 0,
      endMs: 700,
      confidence: 1,
      index: 0,
      windowIndex: 0,
    });
  });

  it("is valid JSON for an empty transcript", () => {
    expect(toWordJson([])).toBe('{\n  "version": 1,\n  "words": []\n}\n');
    const parsed = JSON.parse(toWordJson([])) as ParsedJson;
    expect(parsed.words).toEqual([]);
  });

  it("guards word times and confidence but keeps the text exact", () => {
    const tricky = 'a "quoted" --> नहीं\nnext';
    const parsed = JSON.parse(
      toWordJson([
        event(0, 0, 1000, [
          [
            word("x", 500, 500, 0, Number.NaN),
            word("y", 700, 600, 1, 2),
            word("z", 800, 900, 2, -1),
            word(tricky, 900, 950, 3, 0.25),
          ],
        ]),
      ]),
    ) as ParsedJson;

    expect(parsed.words[0]).toMatchObject({ startMs: 500, endMs: 501, confidence: 1 });
    expect(parsed.words[1]).toMatchObject({ startMs: 700, endMs: 701, confidence: 1 });
    expect(parsed.words[2]).toMatchObject({ startMs: 800, endMs: 900, confidence: 0 });
    expect(parsed.words[3].text).toBe(tricky);
    expect(parsed.words[3].confidence).toBe(0.25);
  });

  it("keeps every word, including invisible ones", () => {
    const events = [
      event(0, 0, 100, [[]]),
      event(1, 200, 300, [[word("", 200, 300, 0), word("kept", 200, 300, 1)]]),
    ];
    const parsed = JSON.parse(toWordJson(events)) as ParsedJson;
    expect(parsed.words.map((item) => item.text)).toEqual(["", "kept"]);
  });
});

describe("cross-format and fuzz", () => {
  it("formats every cue of random caption data consistently (seeded fuzz)", () => {
    const random = makeRandom(2024);
    const textPool = ["hello", "नहीं", "a-->b", "x\ny", "", 'q"q', "YouTube", "...", "  ", "AT&T", "a<b", "5>3"];

    for (let round = 0; round < 150; round += 1) {
      const events: CaptionEvent[] = [];
      let cursor = 0;
      const eventCount = Math.floor(random() * 8);

      for (let e = 0; e < eventCount; e += 1) {
        cursor += Math.floor(random() * 500);
        const start = cursor;
        const lines: Word[][] = [];
        const lineCount = Math.floor(random() * 4);
        let wordIndex = 0;
        for (let l = 0; l < lineCount; l += 1) {
          const line: Word[] = [];
          const wordsInLine = Math.floor(random() * 4);
          for (let k = 0; k < wordsInLine; k += 1) {
            const duration = Math.floor(random() * 600);
            const text = textPool[Math.floor(random() * textPool.length)];
            line.push({
              text,
              startMs: cursor,
              endMs: cursor + duration,
              confidence: random(),
              index: wordIndex,
              windowIndex: 0,
            });
            wordIndex += 1;
            cursor += duration;
          }
          lines.push(line);
        }
        const end = cursor;
        events.push({ index: e, startMs: start, endMs: end, lines });
        cursor = end + 10;
      }

      const srt = toSrt(events);
      const vtt = toVtt(events);
      const json = toWordJson(events);
      expect(toSrt(events)).toBe(srt);

      const usable = events.filter(hasVisibleText);

      const srtBlocks = srt.length === 0 ? [] : srt.trimEnd().split("\n\n");
      expect(srtBlocks).toHaveLength(usable.length);
      expect(srt.match(/-->/g) ?? []).toHaveLength(usable.length);

      srtBlocks.forEach((block, index) => {
        const [number, timing, ...text] = block.split("\n");
        expect(Number(number)).toBe(index + 1);
        expect(timing).toMatch(/^\d{2,}:\d{2}:\d{2},\d{3} --> \d{2,}:\d{2}:\d{2},\d{3}$/);
        for (const line of text) expect(line).not.toContain("-->");

        const [from, to] = timing.split(" --> ");
        const expected = usable[index];
        const expectedStart = Math.max(0, Math.trunc(expected.startMs));
        const expectedEnd = Math.max(expectedStart + 1, Math.max(0, Math.trunc(expected.endMs)));
        expect(parseStamp(from)).toBe(expectedStart);
        expect(parseStamp(to)).toBe(expectedEnd);
        expect(parseStamp(from)).toBeLessThan(parseStamp(to));
      });

      expect(vtt.startsWith("WEBVTT")).toBe(true);
      const vttBlocks = vtt.trimEnd().split("\n\n").slice(1);
      expect(vttBlocks).toHaveLength(usable.length);
      expect(vtt.match(/-->/g) ?? []).toHaveLength(usable.length);
      // Every raw "&" and "<" left after removing the entities we emit would be unescaped markup.
      const vttWithoutEntities = vtt.replace(/&amp;|&lt;|&gt;/g, "");
      expect(vttWithoutEntities).not.toContain("&");
      expect(vttWithoutEntities).not.toContain("<");
      for (const block of vttBlocks) {
        const [timing, ...text] = block.split("\n");
        expect(timing).toMatch(/^\d{2,}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/);
        for (const line of text) expect(line).not.toContain("-->");
      }

      const parsed = JSON.parse(json) as ParsedJson;
      const allWords = events.flatMap((item) => item.lines.flat());
      expect(parsed.words).toHaveLength(allWords.length);
      expect(parsed.words.map((item) => item.text)).toEqual(allWords.map((item) => item.text));
      for (const parsedWord of parsed.words) {
        expect(parsedWord.startMs).toBeGreaterThanOrEqual(0);
        expect(parsedWord.endMs).toBeGreaterThan(parsedWord.startMs);
        expect(parsedWord.confidence).toBeGreaterThanOrEqual(0);
        expect(parsedWord.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});
