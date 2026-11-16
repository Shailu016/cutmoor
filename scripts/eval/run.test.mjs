// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the CLI. They spawn real `node`, so they also prove that the TypeScript
 * scorer loads with the repo's extensionless imports and that the exit code is usable from CI.
 */

const SCRIPT = fileURLToPath(new URL("./run.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLE = join(ROOT, "scripts", "eval", "example");

let workDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "cutmoor-eval-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
}

function exampleArgs(hypothesis, out, extra = []) {
  return [
    "--clips",
    join(EXAMPLE, "clips.json"),
    "--hypothesis",
    join(EXAMPLE, hypothesis),
    "--thresholds",
    join(EXAMPLE, "thresholds.json"),
    "--out",
    join(workDir, out),
    ...extra,
  ];
}

function readReport(file) {
  return JSON.parse(readFileSync(join(workDir, file), "utf8"));
}

function cliTest(name, fn) {
  // Spawning a fresh Node process is slow on Windows (and slower under antivirus), so give each
  // end-to-end case its own generous timeout instead of relying on the suite default.
  return it(name, fn, 30_000);
}

describe("scripts/eval/run.mjs", () => {
  cliTest("passes the good example and writes a report with real metric values", () => {
    const result = runCli(exampleArgs("hypothesis.json", "good.json"));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("hinglish-talking-head");
    expect(result.stdout).toContain("hindi-explainer");
    expect(result.stdout).toContain("english-demo");
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).toContain("clips 3 | scored 3 | passed 3 | failed 0 | missing 0");

    const report = readReport("good.json");
    expect(report.pass).toBe(true);
    expect(report.schemaVersion).toBe(1);
    expect(report.clips.map((clip) => clip.id)).toEqual(["hinglish-talking-head", "hindi-explainer", "english-demo"]);
    expect(report.clips[0].metrics.wer.wer).toBeCloseTo(0.125, 12);
    expect(report.clips[0].metrics.wer.substitutions).toBe(1);
    expect(report.clips[0].metrics.timing.boundary.maeMs).toBeCloseTo(97.5 / 7, 12);
    expect(report.clips[0].metrics.coverage.coverage).toBe(1);
    expect(report.byLanguage.map((entry) => entry.language)).toEqual(["hinglish", "hindi", "english"]);
  });

  cliTest("fails the bad example with exit code 1 while still writing evidence", () => {
    const result = runCli(exampleArgs("hypothesis-bad.json", "bad.json"));
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain("fail hinglish-talking-head: wer");
    expect(result.stdout).toContain("fail hinglish-talking-head: coverage");

    const report = readReport("bad.json");
    expect(report.pass).toBe(false);
    expect(report.summary.failed).toBe(1);
    const clip = report.clips[0];
    expect(clip.pass).toBe(false);
    expect(clip.metrics.wer.wer).toBeGreaterThan(0.18);
    expect(clip.failures.map((failure) => failure.metric)).toEqual(expect.arrayContaining(["wer", "coverage"]));
  });

  cliTest("prints the JSON report with --json", () => {
    const result = runCli(exampleArgs("hypothesis.json", "json.json", ["--json"]));
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.clips).toHaveLength(3);
  });

  cliTest("fails a clip that has no hypothesis", () => {
    const partial = join(workDir, "partial.json");
    writeFileSync(partial, JSON.stringify({ "english-demo": { words: [] } }), "utf8");
    const result = runCli([
      "--clips",
      join(EXAMPLE, "clips.json"),
      "--hypothesis",
      partial,
      "--thresholds",
      join(EXAMPLE, "thresholds.json"),
      "--out",
      join(workDir, "partial-report.json"),
      "--json",
    ]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.missingClips).toEqual(["hinglish-talking-head", "hindi-explainer"]);
    expect(report.clips.filter((clip) => !clip.scored).map((clip) => clip.id)).toEqual([
      "hinglish-talking-head",
      "hindi-explainer",
    ]);
  });

  cliTest("exits 2 with a useful message for bad usage", () => {
    const unknown = runCli(["--nope"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown option "--nope"');

    const missing = runCli([]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("--hypothesis is required");

    const missingFile = runCli([
      "--clips",
      join(EXAMPLE, "clips.json"),
      "--hypothesis",
      join(workDir, "nope.json"),
      "--out",
      join(workDir, "x.json"),
    ]);
    expect(missingFile.status).toBe(2);
    expect(missingFile.stderr).toContain("cannot read hypothesis file");
  });

  cliTest("exits 2 when the input JSON is malformed", () => {
    const broken = join(workDir, "broken.json");
    writeFileSync(broken, "{not json", "utf8");
    const result = runCli([
      "--clips",
      join(EXAMPLE, "clips.json"),
      "--hypothesis",
      broken,
      "--out",
      join(workDir, "broken-report.json"),
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("is not valid JSON");
  });

  cliTest("exits 2 when an explicitly requested thresholds file is missing", () => {
    const result = runCli(exampleArgs("hypothesis.json", "none.json", ["--thresholds", join(workDir, "absent.json")]));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
  });

  cliTest("prints usage with --help and exits 0", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("scripts/eval/README.md");
  });
});
