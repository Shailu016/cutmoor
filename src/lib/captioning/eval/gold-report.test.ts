import { describe, expect, it } from "vitest";
import type { Word } from "../types";
import {
  DEFAULT_GOLD_THRESHOLDS,
  evaluateGoldRun,
  goldReportToJson,
  renderGoldMarkdown,
  type GoldClip,
  type GoldManifest,
  type GoldReport,
} from "./gold";

function word(text: string, startMs: number, endMs: number): Word {
  return { text, startMs, endMs, confidence: 1, index: 0, windowIndex: 0 };
}

function clip(id: string, overrides: Partial<GoldClip> = {}): GoldClip {
  return {
    id,
    path: `media/${id}.mp4`,
    tags: [],
    references: ["a b"],
    expectNoWords: false,
    ...overrides,
  };
}

function reportFor(manifest: GoldManifest, words: Word[], seconds: number | null = 3): GoldReport {
  return evaluateGoldRun(
    manifest,
    {
      model: "model-x",
      backend: "webgpu",
      device: "laptop",
      clips: { [manifest.clips[0].id]: { words, seconds } },
    },
    DEFAULT_GOLD_THRESHOLDS,
  );
}

const cleanReport = reportFor(
  {
    notes: "fake | data",
    clips: [
      clip("clean-01", {
        tags: ["clean"],
        references: ["a b"],
        wordTimes: [
          { text: "a", startMs: 0, endMs: 100 },
          { text: "b", startMs: 100, endMs: 200 },
        ],
      }),
    ],
  },
  [word("a", 10, 110), word("b", 110, 210)],
);

const failingReport = evaluateGoldRun(
  { clips: [clip("s1", { tags: ["silence"], references: [], expectNoWords: true })] },
  {
    model: "model-x",
    backend: "cpu",
    device: "phone",
    clips: { s1: { words: [word("hello", 0, 100)], seconds: null } },
  },
  DEFAULT_GOLD_THRESHOLDS,
);

describe("JSON report", () => {
  it("is valid JSON with the documented schema and caller identity", () => {
    const parsed = JSON.parse(goldReportToJson(cleanReport));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.model).toBe("model-x");
    expect(parsed.backend).toBe("webgpu");
    expect(parsed.device).toBe("laptop");
    expect(parsed.manifestNotes).toBe("fake | data");
    expect(parsed.thresholds.meanWerMax).toBe(0.25);
    expect(parsed.summary.werClips).toBe(1);
    expect(parsed.clips[0].wer.bestReference).toBe(0);
    expect(parsed.byTag[0].tag).toBe("clean");
    expect(parsed.failures).toEqual([]);
    expect(parsed.pass).toBe(true);
  });

  it("never emits NaN, Infinity or undefined", () => {
    const json = goldReportToJson(failingReport);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("undefined");
    const parsed = JSON.parse(json);
    expect(parsed.clips[0].wer).toBeNull();
    expect(parsed.clips[0].timing).toBeNull();
    expect(parsed.clips[0].hallucination.wordsProduced).toBe(1);
  });

  it("is stable across two runs with the same input", () => {
    expect(goldReportToJson(cleanReport)).toBe(goldReportToJson(cleanReport));
  });
});

describe("markdown report", () => {
  it("renders identity, summary, clips, tags and the verdict", () => {
    const markdown = renderGoldMarkdown(cleanReport);
    expect(markdown).toContain("# Caption gold-set report");
    expect(markdown).toContain("Model: `model-x`");
    expect(markdown).toContain("Backend: `webgpu`");
    expect(markdown).toContain("Device: `laptop`");
    expect(markdown).toContain("Verdict: **PASS**");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Clips");
    expect(markdown).toContain("| clean-01 |");
    expect(markdown).toContain("## By tag");
    expect(markdown).toContain("| clean | 1 | 1 |");
    expect(markdown).toContain("## Failures");
    expect(markdown).toContain("_None._");
    expect(markdown).toMatch(/^\| mean OIWER \(best reference\) \| 0\.000 \|$/m);
  });

  it("renders manifest notes, escaping table-breaking characters", () => {
    expect(renderGoldMarkdown(cleanReport)).toContain("> fake \\| data");
  });

  it("escapes a pipe in a clip id", () => {
    const report = reportFor(
      { clips: [clip("odd|id", { references: ["a b"] })] },
      [word("a", 0, 10), word("b", 10, 20)],
    );
    const markdown = renderGoldMarkdown(report);
    expect(markdown).toContain("odd\\|id");
    expect(markdown).not.toContain("| odd|id |");
  });

  it("shows FAIL and the failing metric with its limit", () => {
    const markdown = renderGoldMarkdown(failingReport);
    expect(markdown).toContain("Verdict: **FAIL**");
    expect(markdown).toContain("hallucinatedWords");
    expect(markdown).toContain("limit <= 0");
    expect(markdown).toContain("hallucinated clips | 1");
  });

  it("shows notes for metrics that could not be measured", () => {
    const report = reportFor(
      { clips: [clip("clean-01", { references: ["a b"] })] },
      [word("a", 0, 10), word("b", 10, 20)],
    );
    const markdown = renderGoldMarkdown(report);
    expect(markdown).toContain("timing skipped: no wordTimes in the gold manifest");
    expect(markdown).toContain("| - | - | - | - |");
  });

  it("lists missing clips and unknown hypothesis clips", () => {
    const report = evaluateGoldRun(
      { clips: [clip("wanted", { references: ["a b"] })] },
      {
        model: "m",
        backend: "b",
        device: "d",
        clips: { extra: { words: [word("a", 0, 10)], seconds: null } },
      },
      DEFAULT_GOLD_THRESHOLDS,
    );
    const markdown = renderGoldMarkdown(report);
    expect(markdown).toContain("missing (no hypothesis)");
    expect(markdown).toContain("unknown hypothesis clips: extra");
  });
});
