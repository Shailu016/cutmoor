import { describe, expect, it } from "vitest";
import {
  detectSubtitleFormat,
  looksLikeVtt,
  shiftSubtitles,
  srtToVtt,
  vttToSrt,
} from "./subtitles";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello there.

2
00:00:05,500 --> 00:00:08,000
Second line.`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello there.

00:00:05.500 --> 00:00:08.000
Second line.`;

describe("srtToVtt", () => {
  it("adds the WEBVTT header and dot separators", () => {
    const output = srtToVtt(SRT);
    expect(output.startsWith("WEBVTT\n\n")).toBe(true);
    expect(output).toContain("00:00:01.000 --> 00:00:04.000");
    expect(output).not.toContain("00:00:01,000");
  });

  it("removes SRT cue numbers", () => {
    const output = srtToVtt(SRT);
    expect(output).not.toMatch(/^1$/m);
    expect(output).toContain("Hello there.");
  });

  it("handles CRLF input and a BOM", () => {
    const output = srtToVtt(`\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n`);
    expect(output).toContain("00:00:01.000 --> 00:00:02.000");
    expect(output).toContain("Hi");
    expect(output).not.toContain("\r");
  });
});

describe("vttToSrt", () => {
  it("drops the header and uses commas", () => {
    const output = vttToSrt(VTT);
    expect(output.startsWith("1\n")).toBe(true);
    expect(output).toContain("00:00:01,000 --> 00:00:04,000");
    expect(output).not.toContain("WEBVTT");
  });

  it("renumbers cues", () => {
    const output = vttToSrt(VTT);
    expect(output).toContain("1\n00:00:01");
    expect(output).toContain("2\n00:00:05");
  });

  it("strips cue settings SRT cannot represent", () => {
    const input = `WEBVTT

00:00:01.000 --> 00:00:02.000 align:start position:10%
Hello.`;
    const output = vttToSrt(input);
    expect(output).toContain("00:00:01,000 --> 00:00:02,000");
    expect(output).not.toContain("align:");
  });

  it("ignores NOTE blocks", () => {
    const input = `WEBVTT

NOTE this is a comment

00:00:01.000 --> 00:00:02.000
Kept.`;
    const output = vttToSrt(input);
    expect(output).not.toContain("comment");
    expect(output).toContain("Kept.");
  });
});

describe("detectSubtitleFormat", () => {
  it("recognizes VTT", () => {
    expect(detectSubtitleFormat(VTT)).toBe("vtt");
    expect(looksLikeVtt("\uFEFFWEBVTT\n\n")).toBe(true);
  });

  it("defaults to SRT", () => {
    expect(detectSubtitleFormat(SRT)).toBe("srt");
    expect(looksLikeVtt(SRT)).toBe(false);
  });
});

describe("shiftSubtitles", () => {
  it("moves cues later", () => {
    const output = shiftSubtitles(SRT, 1.5);
    expect(output).toContain("00:00:02.500 --> 00:00:05.500");
  });

  it("moves cues earlier", () => {
    const output = shiftSubtitles(SRT, -1);
    expect(output).toContain("00:00:00.000 --> 00:00:03.000");
  });

  it("clamps at zero", () => {
    const output = shiftSubtitles(SRT, -10);
    expect(output).toContain("00:00:00.000 --> 00:00:00.000");
  });
});
