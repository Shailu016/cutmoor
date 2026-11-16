// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the score2 CLI. They spawn real `node`, so they also prove that the
 * TypeScript scorer loads with the repo's extensionless imports and that the exit codes are usable
 * from CI. The data is fake; these tests never open media and never touch the network.
 */

const SCRIPT = fileURLToPath(new URL("./score2.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GOLD = join(ROOT, "scripts", "eval", "gold", "example-gold.json");
const HYPOTHESES = join(ROOT, "scripts", "eval", "gold", "example-hypotheses.json");

let workDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "cutmoor-score2-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
}

function outputArgs(hypotheses, extra = []) {
  return [
    "--gold",
    GOLD,
    "--hypotheses",
    hypotheses,
    "--out",
    join(workDir, "results.json"),
    "--md",
    join(workDir, "report.md"),
    ...extra,
  ];
}

function writeJson(name, value) {
  const file = join(workDir, name);
  writeFileSync(file, JSON.stringify(value), "utf8");
  return file;
}

function cliTest(name, fn) {
  return it(name, fn, 30_000);
}

describe("scripts/eval/score2.mjs", () => {
  cliTest("scores the example, writes both reports and exits 0", () => {
    const result = runCli(outputArgs(HYPOTHESES, ["--duration", "example-silence=10000"]));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Caption score2 report (script-aware)");
    expect(result.stdout).toContain("mean OIWER");
    expect(result.stdout).toContain("F1@50");
    expect(result.stdout).toContain("example-clean-2ref");

    const report = JSON.parse(readFileSync(join(workDir, "results.json"), "utf8"));
    expect(report.schemaVersion).toBe(2);
    expect(report.model).toBe("example-model-v0");
    expect(report.backend).toBe("example-backend");
    expect(report.device).toBe("example-device");
    expect(report.summary.clips).toBe(3);
    expect(report.summary.missing).toBe(0);
    expect(report.summary.silenceWordsPerMinute).toBe(0);
    expect(report.clips[0].wer.raw.bestReference).toBe(1);
    expect(report.clips[0].timing.boundary.maeMs).toBeCloseTo(9, 12);
    expect(report.clips[0].timing.f1.find((entry) => entry.toleranceMs === 50).f1).toBeCloseTo(5 / 6, 12);
    expect(report.clips[2].hallucination.wordsProduced).toBe(0);

    const markdown = readFileSync(join(workDir, "report.md"), "utf8");
    expect(markdown).toContain("# Caption score2 report (script-aware)");
    expect(markdown).toContain("## Timing (wordTimes ground truth)");
  });

  cliTest("prints the JSON report with --json", () => {
    const result = runCli(outputArgs(HYPOTHESES, ["--json"]));
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.clips).toHaveLength(3);
    expect(parsed.summary.missing).toBe(0);
  });

  cliTest("scores a Devanagari hypothesis against a Roman reference without a ~100% aware WER", () => {
    const gold = writeJson("deva-gold.json", {
      clips: [
        {
          id: "studypoint-prefix",
          path: "studypoint-prefix.wav",
          tags: ["clean"],
          references: [
            "Parents, kya aap jaante hain ek hi school mein padhne wale do students ke marks itne different kyu hote hain?",
          ],
        },
      ],
    });
    const devanagari =
      "पैरेंट्स, क्या आप जानते हैं एक ही स्कूल में पढ़ने वाले दो स्टूडेंट्स के मार्क्स इतने डिफरेंट क्यु होते हैं?";
    const hypotheses = writeJson("deva-hyp.json", {
      model: "hand-written-devanagari",
      backend: "none",
      device: "none",
      clips: {
        "studypoint-prefix": {
          words: devanagari.split(/\s+/u).map((text, index) => ({
            text,
            startMs: index * 300,
            endMs: index * 300 + 250,
          })),
        },
      },
    });

    const result = runCli([
      "--gold",
      gold,
      "--hypotheses",
      hypotheses,
      "--out",
      join(workDir, "deva.json"),
      "--md",
      join(workDir, "deva.md"),
      "--json",
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.clips[0].wer.raw.oiwer).toBe(1);
    expect(report.clips[0].wer.scriptAware.oiwer).toBeCloseTo(1 / 20, 12);
    expect(report.clips[0].wer.scriptAware.transliteration.applied).toBe(true);
    expect(report.clips[0].wer.scriptAware.transliteration.translateHypothesis).toBe(true);
  });

  cliTest("accepts repeated --no-voice-span and --duration overrides", () => {
    const gold = writeJson("span-gold.json", {
      clips: [
        {
          id: "song",
          path: "song.mp3",
          tags: ["music"],
          references: ["la la la"],
        },
      ],
    });
    const hypotheses = writeJson("span-hyp.json", {
      model: "m",
      backend: "b",
      device: "d",
      clips: {
        song: {
          words: [
            { text: "la", startMs: 2_400, endMs: 2_600 },
            { text: "la", startMs: 11_900, endMs: 12_100 },
          ],
        },
      },
    });

    const result = runCli([
      "--gold",
      gold,
      "--hypotheses",
      hypotheses,
      "--out",
      join(workDir, "span.json"),
      "--md",
      join(workDir, "span.md"),
      "--no-voice-span",
      "song=0-6000",
      "--no-voice-span",
      "song=4000-10000",
      "--json",
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    const hallucination = report.clips[0].hallucination;
    expect(hallucination.spanWords).toBe(1);
    expect(hallucination.spanDurationMs).toBe(10_000); // overlapping spans are unioned
    expect(hallucination.spanWordsPerMinute).toBe(6);
  });

  cliTest("exits 1 when a clip has no hypothesis and reports it", () => {
    const empty = writeJson("empty.json", { model: "m", backend: "b", device: "d", clips: {} });
    const result = runCli(outputArgs(empty));
    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(join(workDir, "results.json"), "utf8"));
    expect(report.missingClips).toEqual([
      "example-clean-2ref",
      "example-noisy-phone",
      "example-silence",
    ]);
    expect(report.summary.missing).toBe(3);
  });

  cliTest("is deterministic: two runs produce byte-identical markdown", () => {
    const first = runCli(outputArgs(HYPOTHESES, ["--md", join(workDir, "one.md")]));
    const second = runCli(outputArgs(HYPOTHESES, ["--md", join(workDir, "two.md")]));
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(readFileSync(join(workDir, "one.md"), "utf8")).toBe(readFileSync(join(workDir, "two.md"), "utf8"));
  });

  cliTest("exits 2 with a useful message for bad usage", () => {
    const missingGold = runCli(["--hypotheses", HYPOTHESES]);
    expect(missingGold.status).toBe(2);
    expect(missingGold.stderr).toContain("--gold is required");

    const missingHypotheses = runCli(["--gold", GOLD]);
    expect(missingHypotheses.status).toBe(2);
    expect(missingHypotheses.stderr).toContain("--hypotheses is required");

    const unknown = runCli(["--nope"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown option "--nope"');

    const badDuration = runCli(outputArgs(HYPOTHESES, ["--duration", "silence"]));
    expect(badDuration.status).toBe(2);
    expect(badDuration.stderr).toContain("must look like <clip>=<ms>");

    const unknownDuration = runCli(outputArgs(HYPOTHESES, ["--duration", "nope=1000"]));
    expect(unknownDuration.status).toBe(2);
    expect(unknownDuration.stderr).toContain('unknown clip "nope"');

    const badSpan = runCli(outputArgs(HYPOTHESES, ["--no-voice-span", "silence=10-5"]));
    expect(badSpan.status).toBe(2);
    expect(badSpan.stderr).toContain("endMs must be after startMs");
  });

  cliTest("exits 2 for unreadable and malformed input", () => {
    const missing = runCli([
      "--gold",
      join(workDir, "absent.json"),
      "--hypotheses",
      HYPOTHESES,
      "--out",
      join(workDir, "x.json"),
      "--md",
      join(workDir, "x.md"),
    ]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("cannot read gold manifest");

    const broken = join(workDir, "broken.json");
    writeFileSync(broken, "{not json", "utf8");
    const malformed = runCli(outputArgs(broken));
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toContain("is not valid JSON");
  });

  cliTest("exits 2 for an invalid manifest", () => {
    const invalid = writeJson("invalid-gold.json", {
      clips: [{ id: "x", path: "x", tags: ["clean"], references: ["a"], surprise: 1 }],
    });
    const result = runCli(["--gold", invalid, "--hypotheses", HYPOTHESES, "--out", join(workDir, "i.json"), "--md", join(workDir, "i.md")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a known field");
  });

  cliTest("prints usage with --help and exits 0", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("scripts/eval/README.md");
  });
});
