import { describe, expect, it } from "vitest";
import { compareSizes, formatElapsed, formatPercent } from "./results";

describe("compareSizes", () => {
  it("reports a smaller result with exact byte and percent savings", () => {
    const result = compareSizes(10_000_000, 2_500_000);
    expect(result.change).toBe("smaller");
    expect(result.savedBytes).toBe(7_500_000);
    expect(result.addedBytes).toBe(0);
    expect(result.percent).toBe(75);
  });

  it("keeps one decimal of precision", () => {
    expect(compareSizes(3_779_467, 1_000_000).percent).toBe(73.5);
  });

  it("never reports a larger file as a saving", () => {
    const result = compareSizes(1_000, 1_500);
    expect(result.change).toBe("larger");
    expect(result.savedBytes).toBe(0);
    expect(result.addedBytes).toBe(500);
    expect(result.percent).toBe(50);
  });

  it("handles identical sizes", () => {
    const result = compareSizes(4_096, 4_096);
    expect(result.change).toBe("same");
    expect(result.savedBytes).toBe(0);
    expect(result.addedBytes).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("treats an empty or unmeasurable output as invalid", () => {
    for (const processed of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = compareSizes(1_000, processed);
      expect(result.change, String(processed)).toBe("invalid");
      expect(result.percent).toBeNull();
      expect(result.savedBytes).toBe(0);
    }
  });

  it("cannot compare against an unknown original", () => {
    expect(compareSizes(0, 1_000).change).toBe("invalid");
    expect(compareSizes(Number.NaN, 1_000).change).toBe("invalid");
  });

  it("matches the published formula", () => {
    const original = 48_200_000;
    const processed = 6_400_000;
    const expected = ((original - processed) / original) * 100;
    expect(compareSizes(original, processed).percent).toBeCloseTo(expected, 1);
  });
});

describe("formatPercent", () => {
  it("drops a trailing .0", () => {
    expect(formatPercent(75)).toBe("75%");
    expect(formatPercent(73.5)).toBe("73.5%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("formatElapsed", () => {
  it("scales the unit to the duration", () => {
    expect(formatElapsed(640)).toBe("640 ms");
    expect(formatElapsed(4_230)).toBe("4.2 s");
    expect(formatElapsed(38_400)).toBe("38 s");
    expect(formatElapsed(125_000)).toBe("2 min 5 s");
  });

  it("is safe for bad input", () => {
    expect(formatElapsed(Number.NaN)).toBe("0 ms");
    expect(formatElapsed(-1)).toBe("0 ms");
  });
});
