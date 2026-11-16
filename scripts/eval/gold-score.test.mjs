// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the gold-set CLI. They spawn real `node`, so they also prove that the
 * TypeScript scorer loads with the repo's extensionless imports and that the exit code is usable
 * from CI. The example data is fake; these tests never open media and never touch the network.
 */

const SCRIPT = fileURLToPath(new URL("./gold-score.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GOLD = join(ROOT, "scripts", "eval", "gold", "example-gold.json");
const HYPOTHESES = join(ROOT, "scripts", "eval", "gold", "example-hypotheses.json");

let workDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "cutmoor-gold-"));
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

function writeHypotheses(name, value) {
  const file = join(workDir, name);
  writeFileSync(file, JSON.stringify(value), "utf8");
  return file;
}

function cliTest(name, fn) {
  return it(name, fn, 30_000);
}

describe("scripts/eval/gold-score.mjs", () => {
  cliTest("scores the example, writes both reports and exits 0", () => {
    const result = runCli(outputArgs(HYPOTHESES));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Caption gold-set report");
    expect(result.stdout).toContain("Verdict: **PASS**");
    expect(result.stdout).toContain("example-clean-2ref");

    const report = JSON.parse(readFileSync(join(workDir, "results.json"), "utf8"));
    expect(report.pass).toBe(true);
    expect(report.model).toBe("example-model-v0");
    expect(report.backend).toBe("example-backend");
    expect(report.device).toBe("example-device");
    expect(report.summary.clips).toBe(3);
    expect(report.summary.meanWer).toBeCloseTo(1 / 12, 12);
    expect(report.clips[0].wer.bestReference).toBe(1);
    expect(report.clips[0].wer.plainWer).toBeCloseTo(1 / 6, 12);
    expect(report.clips[2].hallucination.wordsProduced).toBe(0);
    expect(report.byTag.map((entry) => entry.tag)).toEqual([
      "clean",
      "noisy",
      "code-switch",
      "phone",
      "silence",
      "long-pause",
    ]);

    const markdown = readFileSync(join(workDir, "report.md"), "utf8");
    expect(markdown).toContain("Verdict: **PASS**");
    expect(markdown).toContain("## By tag");
  });

  cliTest("exits 1 on a hard clip and still writes the evidence", () => {
    const bad = writeHypotheses("bad.json", {
      model: "example-model-v0",
      backend: "example-backend",
      device: "example-device",
      clips: {
        "example-clean-2ref": {
          words: [
            { text: "totally", startMs: 0, endMs: 300 },
            { text: "wrong", startMs: 320, endMs: 600 },
            { text: "words", startMs: 620, endMs: 850 },
            { text: "here", startMs: 870, endMs: 1200 },
            { text: "again", startMs: 1220, endMs: 1500 },
            { text: "now", startMs: 1520, endMs: 1800 },
          ],
        },
        "example-noisy-phone": {
          words: [
            { text: "delivery", startMs: 100, endMs: 500 },
            { text: "kal", startMs: 520, endMs: 700 },
            { text: "shaam", startMs: 720, endMs: 1000 },
            { text: "tak", startMs: 1020, endMs: 1150 },
            { text: "aa", startMs: 1170, endMs: 1300 },
            { text: "jayegi", startMs: 1320, endMs: 1700 },
          ],
        },
        "example-silence": { words: [] },
      },
    });

    const result = runCli(outputArgs(bad));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Verdict: **FAIL**");

    const report = JSON.parse(readFileSync(join(workDir, "results.json"), "utf8"));
    expect(report.pass).toBe(false);
    expect(report.clips[0].hard).toBe(true);
    expect(report.hardFailures).toEqual([{ id: "example-clean-2ref", wer: 1 }]);
    expect(report.failures.some((failure) => failure.metric === "clipWer")).toBe(true);
    expect(existsSync(join(workDir, "report.md"))).toBe(true);
  });

  cliTest("fails missing clips and reports them", () => {
    const empty = writeHypotheses("empty.json", {
      model: "m",
      backend: "b",
      device: "d",
      clips: {},
    });
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

  cliTest("prints the JSON report with --json", () => {
    const result = runCli(outputArgs(HYPOTHESES, ["--json"]));
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.pass).toBe(true);
    expect(parsed.clips).toHaveLength(3);
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

  cliTest("exits 2 when an explicitly requested thresholds file is missing", () => {
    const result = runCli(outputArgs(HYPOTHESES, ["--thresholds", join(workDir, "absent-thresholds.json")]));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
  });

  cliTest("prints usage with --help and exits 0", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("scripts/eval/gold/README.md");
  });
});
