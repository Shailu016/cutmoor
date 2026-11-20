import { describe, expect, it } from "vitest";
import { displayText, isNumberToken, isWordVisible, wordColor, wordState } from "./word-look";

describe("isNumberToken", () => {
  it.each(["5,000", "$5,000", "₹15,00,000", "40%", "1991", "10k", "3.5", "1st", "22nd", "1990s", "२०२४", "€20", "-3", "10x", "5,000.", "(40%)", "“1991”", "₹2L", "₹5cr"])(
    "counts %s as a number",
    (text) => expect(isNumberToken(text)).toBe(true),
  );

  it.each(["", "gold", "mp4", "covid19", "B2B", "...", "%", "$", "five", "पांच", "1-2-3-go", "v2"])("does not count %s", (text) =>
    expect(isNumberToken(text)).toBe(false),
  );
});

describe("displayText", () => {
  it("trims, and uppercases only when asked", () => {
    expect(displayText("  hello ", {})).toBe("hello");
    expect(displayText(" hello", { uppercase: true })).toBe("HELLO");
    expect(displayText("नमस्ते", { uppercase: true })).toBe("नमस्ते");
  });
});

describe("wordState and isWordVisible", () => {
  it("splits words around the spoken one", () => {
    expect([0, 1, 2].map((i) => wordState(i, 1))).toEqual(["spoken", "active", "upcoming"]);
    expect([0, 1].map((i) => wordState(i, -1))).toEqual(["upcoming", "upcoming"]);
  });

  it("hides only upcoming words, and only for a spoken reveal", () => {
    expect(isWordVisible("upcoming", { reveal: "spoken" })).toBe(false);
    expect(isWordVisible("active", { reveal: "spoken" })).toBe(true);
    expect(isWordVisible("upcoming", {})).toBe(true);
  });
});

describe("wordColor", () => {
  const style = { textColor: "#fff", activeColor: "#ff0", upcomingColor: "#888" };

  it("picks the spoken, active and upcoming colours", () => {
    expect(wordColor("a", "spoken", style)).toBe("#fff");
    expect(wordColor("a", "active", style)).toBe("#ff0");
    expect(wordColor("a", "upcoming", style)).toBe("#888");
    expect(wordColor("a", "upcoming", { textColor: "#fff", activeColor: "#ff0" })).toBe("#fff");
  });

  it("colours numbers when asked, falling back to the active colour, but the spoken word wins", () => {
    expect(wordColor("40%", "spoken", { ...style, highlightNumbers: true, numberColor: "#0f0" })).toBe("#0f0");
    expect(wordColor("40%", "upcoming", { ...style, highlightNumbers: true })).toBe("#ff0");
    expect(wordColor("40%", "active", { ...style, highlightNumbers: true, numberColor: "#0f0" })).toBe("#ff0");
    expect(wordColor("40%", "spoken", style)).toBe("#fff");
  });
});
