import { describe, expect, it } from "vitest";
import {
  BLOCKED_PHONETIC_KEYS,
  REJECTED_SPELLINGS,
  SPELLING_FAMILIES,
} from "../data/hinglish-variants";
import { applySpelling, phoneticKey } from "../spelling";
import type { Word } from "../types";

/**
 * Locks the safety properties the WP-H spelling audit established.
 *
 * The audit checked every spelling in the table, and every one-edit neighbour the fuzzy path
 * can reach, against real English and Roman-Hindi words. Two variants were removed, nine
 * phonetic keys were blocked and one data-built family was added; this file makes those
 * decisions regressions rather than comments.
 */

const word = (text: string, index = 0): Word => ({
  text,
  startMs: index * 100,
  endMs: index * 100 + 80,
  confidence: 0.5,
  index,
  windowIndex: 0,
});

const spellOne = (text: string): string => applySpelling([word(text)])[0].text;

/**
 * Words the fuzzy path used to rewrite into a DIFFERENT word, and what that word is.
 * They must come back exactly as they went in.
 */
const MUST_NOT_MOVE: ReadonlyArray<readonly [string, string]> = [
  ["sat", "English sat"],
  ["saat", "Hindi saat (seven)"],
  ["sun", "English sun"],
  ["bass", "English bass"],
  ["dill", "English dill (herb)"],
  ["saab", "Hindi saab (sir)"],
  ["patta", "Hindi patta (leaf)"],
  ["kaal", "Hindi kaal (time/death)"],
  ["ana", "English ana / coin anna"],
  ["anna", "the coin anna"],
  ["janta", "Hindi janta (the public)"],
  ["kam", "Hindi kam (less)"],
  ["log", "English log"],
  ["din", "English din"],
  ["tab", "English tab"],
];

/**
 * Real-word homographs the audit looked at and deliberately KEPT, with the spelling the pass
 * produces for each. They are safe in captioning: the Hinglish reading is the same word (v/w
 * variation), the English reading is archaic, or the canonical spelling is the homograph itself
 * so nothing is rewritten. Recorded here so a future edit revisits the decision, not just the list.
 */
const KEPT_HOMOGRAPHS = new Map<string, string>([
  ["vala", "wala"],
  ["vale", "wale"],
  ["vali", "wali"],
  ["ye", "yeh"],
  ["sunn", "sunna"],
  ["nam", "naam"],
  ["pani", "paani"],
  ["humen", "humein"],
  ["hue", "hue"],
  ["tum", "tum"],
  ["kar", "kar"],
  ["kare", "kare"],
  ["sahi", "sahi"],
  ["abhi", "abhi"],
  ["magar", "magar"],
  ["jata", "jata"],
  ["bas", "bas"],
  ["dono", "dono"],
]);

describe("spelling audit: table shape", () => {
  const allSpellings = SPELLING_FAMILIES.flatMap((family) => [family.canonical, ...family.variants]);

  it("stays at the shrunk size, so the table cannot grow silently", () => {
    // Before WP-H: 147 families, 427 spellings, 40 blocked keys. After: one data-built family
    // added, no family removed, two variants removed, nine fuzzy keys blocked.
    expect(SPELLING_FAMILIES.length).toBeLessThanOrEqual(148);
    expect(allSpellings.length).toBeLessThanOrEqual(430);
    expect(BLOCKED_PHONETIC_KEYS).toHaveLength(49);
  });

  it("does not list the removed different-word variants", () => {
    for (const removed of ["janta", "ana"]) {
      expect(allSpellings, removed).not.toContain(removed);
    }
  });

  it("keeps every WP-H blocked key live: it is the phonetic key of a real table spelling", () => {
    const spellings = new Set(allSpellings);
    const added = ["janta", "sat", "sun", "bas", "dil", "sab", "pata", "kal", "ana"];
    for (const key of added) {
      expect(BLOCKED_PHONETIC_KEYS, key).toContain(key);
      expect(
        [...spellings].some((spelling) => phoneticKey(spelling) === key),
        `${key} is a dead block`,
      ).toBe(true);
    }
  });
});

describe("spelling audit: kept homographs still resolve as documented", () => {
  it("produces the recorded canonical spelling for every kept homograph", () => {
    for (const [input, expected] of KEPT_HOMOGRAPHS) {
      expect(spellOne(input), input).toBe(expected);
    }
  });
});

describe("spelling audit: wrong merges stay fixed", () => {
  it("returns every different real word exactly as it arrived", () => {
    for (const [input, meaning] of MUST_NOT_MOVE) {
      expect(spellOne(input), `${input} (${meaning})`).toBe(input);
    }
  });

  it("keeps the rejected-word contract for every documented rejection", () => {
    for (const rejected of REJECTED_SPELLINGS) {
      expect(spellOne(rejected.word), rejected.word).toBe(rejected.word);
    }
  });

  it("still applies the corrections the blocked keys sit next to", () => {
    expect(spellOne("sath")).toBe("saath");
    expect(spellOne("sunn")).toBe("sunna");
    expect(spellOne("aana")).toBe("aana");
    expect(spellOne("jaanta")).toBe("jaanta");
    expect(spellOne("oopar")).toBe("upar");
    expect(spellOne("paisaa")).toBe("paisa");
    expect(spellOne("samj")).toBe("samajh");
  });
});

describe("spelling audit: data-built canonical lexicon", () => {
  it("maps the non-word sunie to the standard -iye imperative", () => {
    expect(spellOne("sunie")).toBe("suniye");
    expect(spellOne("suniye")).toBe("suniye");
    expect(spellOne("sunie.")).toBe("suniye.");
  });

  it("is idempotent over the audit vocabulary", () => {
    const vocabulary = [
      ...MUST_NOT_MOVE.map(([input]) => input),
      ...KEPT_HOMOGRAPHS.keys(),
      ...REJECTED_SPELLINGS.map((entry) => entry.word),
      "sunie",
      "suniye",
      "sath",
      "jaanta",
      "aana",
    ];
    for (const input of vocabulary) {
      const once = spellOne(input);
      expect(spellOne(once), input).toBe(once);
    }
  });
});

describe("spelling audit: documented limitation", () => {
  it("samaj still becomes samajh through the v1 lexicon in normalize.ts", () => {
    // The table still lists samaj as a samajh variant, but removing it alone changes nothing:
    // the v1 LEXICON in normalize.ts maps samaj -> samajh for every word that is not in a family.
    // Removing that entry is outside WP-H's file set; see .team/auto/wp-h.md.
    expect(spellOne("samaj")).toBe("samajh");
  });
});
