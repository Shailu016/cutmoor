import { describe, expect, it } from "vitest";
import { TOOLS } from "./tools";
import {
  DEMO_SCENARIOS,
  demoImageTargetBytes,
  demoOutputName,
  demoVideoArgs,
  optionById,
  scenarioById,
  walkthroughPosterUrl,
  walkthroughUrl,
} from "./demo";

describe("demo scenarios", () => {
  it("has unique ids and points at real tools", () => {
    const ids = DEMO_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tools = new Set(TOOLS.map((tool) => tool.slug));
    for (const scenario of DEMO_SCENARIOS) {
      expect(tools.has(scenario.tool), scenario.id).toBe(true);
    }
  });

  it("has a default option that exists, and at least two options", () => {
    for (const scenario of DEMO_SCENARIOS) {
      expect(scenario.options.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(scenario.options.some((option) => option.id === scenario.defaultOption), scenario.id).toBe(true);
    }
  });

  it("falls back to the first option for an unknown id", () => {
    const scenario = scenarioById("compress");
    expect(optionById(scenario, "nope")).toBe(scenario.options[0]);
  });
});

describe("demoVideoArgs", () => {
  const videoScenarios = DEMO_SCENARIOS.filter((scenario) => scenario.source === "video");

  it("builds a command for every video option that writes the output last", () => {
    for (const scenario of videoScenarios) {
      for (const option of scenario.options) {
        const output = demoOutputName("clip", scenario.id, option.id);
        const args = demoVideoArgs(scenario.id, option.id, { input: "input.mp4", output });
        expect(args.slice(-2), `${scenario.id}/${option.id}`).toEqual(["-y", output]);
        expect(args, `${scenario.id}/${option.id}`).toContain("input.mp4");
      }
    }
  });

  it("names each output with an extension that matches what it produces", () => {
    for (const scenario of DEMO_SCENARIOS) {
      for (const option of scenario.options) {
        const name = demoOutputName("clip", scenario.id, option.id);
        const extension = name.split(".").pop() ?? "";
        const expected = option.output === "video" ? ["mp4", "webm"] : option.output === "audio" ? ["mp3", "m4a", "wav"] : ["gif", "png", "jpg"];
        expect(expected, `${scenario.id}/${option.id} -> ${name}`).toContain(extension);
      }
    }
  });

  it("keeps every trim window inside the sample clip", () => {
    for (const option of scenarioById("trim").options) {
      const args = demoVideoArgs("trim", option.id, { input: "i", output: "o" });
      const start = Number(args[args.indexOf("-ss") + 1]);
      const length = Number(args[args.indexOf("-t") + 1]);
      expect(start + length, option.id).toBeLessThanOrEqual(6);
      expect(length, option.id).toBeGreaterThan(0);
    }
  });

  it("never lets a trim run past a shorter clip", () => {
    const args = demoVideoArgs("trim", "end", { input: "i", output: "o", durationSeconds: 5 });
    expect(Number(args[args.indexOf("-t") + 1])).toBe(1);
  });

  it("takes frames only from inside the clip", () => {
    for (const option of scenarioById("frame").options) {
      const args = demoVideoArgs("frame", option.id, { input: "i", output: "o.png" });
      expect(Number(args[args.indexOf("-ss") + 1]), option.id).toBeLessThan(6);
    }
  });

  it("runs Compress with the same settings as the tool", () => {
    const args = demoVideoArgs("compress", "2", { input: "input.mp4", output: "o.mp4" });
    expect(args).toEqual(expect.arrayContaining(["libx264", "-b:v"]));
  });

  it("rejects the image tab", () => {
    expect(() => demoVideoArgs("image", "50", { input: "i", output: "o" })).toThrow();
  });
});

describe("image demo and URLs", () => {
  it("converts the KB option to bytes", () => {
    expect(demoImageTargetBytes("50")).toBe(51_200);
    expect(demoImageTargetBytes("30")).toBe(30_720);
    expect(demoImageTargetBytes("bad")).toBe(51_200);
  });

  it("builds walkthrough URLs under the app base", () => {
    expect(walkthroughUrl("/", "trim")).toBe("/walkthroughs/trim.mp4");
    expect(walkthroughPosterUrl("/", "trim")).toBe("/walkthroughs/trim.webp");
  });
});
