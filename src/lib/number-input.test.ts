import { describe, expect, it } from "vitest";
import { isNumberDraft, parseNumberInput } from "./number-input";

describe("number fields", () => {
  it("lets every step of typing through", () => {
    for (const text of ["", "7", "75", "750", "7.", "7.5", ".5"]) expect(isNumberDraft(text), text).toBe(true);
  });

  it("refuses characters that cannot be part of a size", () => {
    for (const text of ["-1", "1e3", "12a", "1.2.3"]) expect(isNumberDraft(text), text).toBe(false);
  });

  it("reads any size at or above the minimum, with no upper limit", () => {
    expect(parseNumberInput("750", 1)).toBe(750);
    expect(parseNumberInput("1.5", 1)).toBe(1.5);
    expect(parseNumberInput("100000", 1)).toBe(100000);
  });

  it("has no value while the field is empty, unfinished, or too small", () => {
    expect(parseNumberInput("", 1)).toBeNull();
    expect(parseNumberInput(".", 1)).toBeNull();
    expect(parseNumberInput("0", 1)).toBeNull();
    expect(parseNumberInput("9", 10)).toBeNull();
  });
});
