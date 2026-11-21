import { describe, expect, it } from "vitest";
import type { CaptionStyle } from "./contracts";
import { CAPTION_STYLES } from "./burn-in/styles";
import {
  applySavedLook,
  CUSTOM_LOOK_FIELDS,
  customFields,
  deleteLook,
  listLooks,
  MAX_LOOK_NAME,
  MAX_SAVED_LOOKS,
  readSavedLooks,
  renameLook,
  SAVED_LOOKS_KEY,
  saveLook,
  type SavedLook,
  type StorageLike,
} from "./saved-looks";

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error("storage is blocked");
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error("quota exceeded");
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const base: CaptionStyle = { ...CAPTION_STYLES.clean };
const styled: CaptionStyle = {
  ...base,
  textColor: "#abcdef", // not a custom-look field, must not be stored
  sizeMul: 1.25,
  outlineWidth: 0.2,
  outlineColor: "#112233",
  shadow: 0.4,
  shadowColor: "#445566",
  boxOpacity: 0.5,
  boxColor: "#778899",
  anchorX: 0.25,
  anchorY: 0.75,
  align: "left",
  animation: "pop",
  animationMs: 350,
  fontKey: "geist",
};

function storedDocument(storage: MemoryStorage): { version: number; looks: SavedLook[] } {
  const raw = storage.getItem(SAVED_LOOKS_KEY);
  if (!raw) throw new Error("nothing stored");
  return JSON.parse(raw) as { version: number; looks: SavedLook[] };
}

describe("customFields", () => {
  it("keeps the custom-look fields and drops everything else", () => {
    const custom = customFields(styled);
    expect(Object.keys(custom).sort()).toEqual([...CUSTOM_LOOK_FIELDS].sort());
    expect(custom.sizeMul).toBe(1.25);
    expect(custom.animation).toBe("pop");
    expect(custom.animationMs).toBe(350);
    expect("textColor" in custom).toBe(false);
    expect("id" in custom).toBe(false);
  });

  it("drops values that are not valid rather than storing them", () => {
    const bad: CaptionStyle = {
      ...base,
      sizeMul: Number.NaN,
      outlineWidth: -1,
      outlineColor: "url(https://example.com/x)",
      shadow: 2,
      boxColor: "red",
      anchorX: 3,
      align: "justify" as CaptionStyle["align"],
      animation: "glow",
      animationMs: -10,
      fontKey: "",
    };
    expect(customFields(bad)).toEqual({});
  });
});

describe("saveLook", () => {
  it("stores the preset id and only the custom-look fields", () => {
    const storage = new MemoryStorage();
    const result = saveLook(storage, "  Big   yellow  ", styled, { now: 1000, id: "look-one" });
    expect(result.ok).toBe(true);
    expect(result.look).toEqual({
      id: "look-one",
      name: "Big yellow",
      preset: "clean",
      custom: customFields(styled),
      createdAt: 1000,
    });

    const document = storedDocument(storage);
    expect(document.version).toBe(1);
    expect(document.looks).toHaveLength(1);
    const saved = document.looks[0] as unknown as Record<string, unknown>;
    expect(saved.preset).toBe("clean");
    expect(saved.name).toBe("Big yellow");
    const custom = saved.custom as Record<string, unknown>;
    expect(custom.textColor).toBeUndefined();
    expect(custom.sizeMul).toBe(1.25);
    expect(custom.animation).toBe("pop");
  });

  it("trims, collapses and caps the name and rejects an empty one", () => {
    const storage = new MemoryStorage();
    const long = saveLook(storage, `  ${"x".repeat(100)}  `, base, { id: "long" });
    expect(long.ok).toBe(true);
    expect(long.look?.name).toHaveLength(MAX_LOOK_NAME);

    const empty = saveLook(storage, "   ", base);
    expect(empty).toEqual({ ok: false, error: "invalid-name" });
  });

  it("lists newest first", () => {
    const storage = new MemoryStorage();
    saveLook(storage, "older", base, { now: 100, id: "older" });
    saveLook(storage, "newer", base, { now: 200, id: "newer" });
    expect(listLooks(storage).map((look) => look.name)).toEqual(["newer", "older"]);
  });

  it("keeps at most 20 looks", () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < MAX_SAVED_LOOKS; i++) {
      expect(saveLook(storage, `look ${i}`, base, { now: i, id: `look-${i}` }).ok).toBe(true);
    }
    const full = saveLook(storage, "one too many", base, { now: 99, id: "extra" });
    expect(full).toEqual({ ok: false, error: "limit" });
    expect(listLooks(storage)).toHaveLength(MAX_SAVED_LOOKS);
  });

  it("reports blocked and full storage instead of throwing", () => {
    expect(readSavedLooks(null)).toEqual({ looks: [], ok: false, error: "unavailable" });
    expect(saveLook(null, "x", base)).toEqual({ ok: false, error: "unavailable" });

    const blocked = new MemoryStorage();
    blocked.failRead = true;
    expect(readSavedLooks(blocked)).toEqual({ looks: [], ok: false, error: "read-failed" });
    expect(saveLook(blocked, "x", base)).toEqual({ ok: false, error: "read-failed" });

    const full = new MemoryStorage();
    full.failWrite = true;
    expect(saveLook(full, "x", base, { id: "x" })).toEqual({ ok: false, error: "write-failed" });
  });

  it("replaces a duplicate injected id so two looks never share one", () => {
    const storage = new MemoryStorage();
    saveLook(storage, "first", base, { id: "same" });
    const second = saveLook(storage, "second", base, { id: "same" });
    expect(second.ok).toBe(true);
    expect(second.look?.id).not.toBe("same");
    const ids = listLooks(storage).map((look) => look.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("renameLook and deleteLook", () => {
  it("renames one look and keeps the rest", () => {
    const storage = new MemoryStorage();
    saveLook(storage, "one", base, { id: "one" });
    saveLook(storage, "two", base, { id: "two" });
    const renamed = renameLook(storage, "one", "  First look ");
    expect(renamed.ok).toBe(true);
    expect(renamed.look?.name).toBe("First look");
    expect(listLooks(storage).map((look) => look.name).sort()).toEqual(["First look", "two"]);
  });

  it("reports a missing look and an invalid name", () => {
    const storage = new MemoryStorage();
    saveLook(storage, "one", base, { id: "one" });
    expect(renameLook(storage, "missing", "x")).toEqual({ ok: false, error: "not-found" });
    expect(renameLook(storage, "one", " ")).toEqual({ ok: false, error: "invalid-name" });
    expect(deleteLook(storage, "missing")).toEqual({ ok: false, error: "not-found" });
  });

  it("deletes only the chosen look", () => {
    const storage = new MemoryStorage();
    saveLook(storage, "one", base, { id: "one" });
    saveLook(storage, "two", base, { id: "two" });
    expect(deleteLook(storage, "one").ok).toBe(true);
    expect(listLooks(storage).map((look) => look.id)).toEqual(["two"]);
  });
});

describe("reading saved looks", () => {
  it("returns an empty list for a missing key without calling it an error", () => {
    expect(readSavedLooks(new MemoryStorage())).toEqual({ looks: [], ok: true });
  });

  it("ignores a corrupt document instead of guessing", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVED_LOOKS_KEY, "{not json");
    expect(readSavedLooks(storage)).toEqual({ looks: [], ok: false, error: "corrupt" });

    storage.setItem(SAVED_LOOKS_KEY, JSON.stringify({ version: 2, looks: [] }));
    expect(readSavedLooks(storage)).toEqual({ looks: [], ok: false, error: "corrupt" });

    storage.setItem(SAVED_LOOKS_KEY, JSON.stringify({ version: 1, looks: {} }));
    expect(readSavedLooks(storage)).toEqual({ looks: [], ok: false, error: "corrupt" });
  });

  it("keeps valid entries and skips corrupt ones", () => {
    const storage = new MemoryStorage();
    const valid = { id: "good", name: "Good", preset: "bold", custom: { sizeMul: 1.1 }, createdAt: 1 };
    const badPreset = { id: "bad-preset", name: "Bad", preset: "unknown", custom: {}, createdAt: 2 };
    const badNumber = { id: "bad-number", name: "Bad", preset: "clean", custom: { sizeMul: 9 }, createdAt: 3 };
    const badColour = { id: "bad-colour", name: "Bad", preset: "clean", custom: { outlineColor: "javascript:alert(1)" }, createdAt: 4 };
    const badName = { id: "bad-name", name: "", preset: "clean", custom: {}, createdAt: 5 };
    const duplicate = { ...valid, name: "Duplicate", createdAt: 6 };
    const notAnObject = "nope";
    storage.setItem(
      SAVED_LOOKS_KEY,
      JSON.stringify({ version: 1, looks: [valid, badPreset, badNumber, badColour, badName, duplicate, notAnObject] }),
    );
    const read = readSavedLooks(storage);
    expect(read.ok).toBe(true);
    expect(read.looks).toEqual([{ id: "good", name: "Good", preset: "bold", custom: { sizeMul: 1.1 }, createdAt: 1 }]);
    expect(read.skipped).toBe(6);
  });

  it("caps a hand-edited list at 20 entries", () => {
    const storage = new MemoryStorage();
    const looks = Array.from({ length: 25 }, (_, i) => ({
      id: `look-${i}`,
      name: `Look ${i}`,
      preset: "clean",
      custom: {},
      createdAt: i,
    }));
    storage.setItem(SAVED_LOOKS_KEY, JSON.stringify({ version: 1, looks }));
    expect(readSavedLooks(storage).looks).toHaveLength(MAX_SAVED_LOOKS);
  });

  it("drops a stored animation this version does not know", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVED_LOOKS_KEY,
      JSON.stringify({
        version: 1,
        looks: [{ id: "future", name: "Future", preset: "clean", custom: { animation: "sparkle" }, createdAt: 1 }],
      }),
    );
    expect(readSavedLooks(storage).looks).toEqual([]);
    expect(readSavedLooks(storage).skipped).toBe(1);
  });
});

describe("applySavedLook", () => {
  it("builds the full style from the preset plus the saved custom fields", () => {
    const look: SavedLook = {
      id: "x",
      name: "Look",
      preset: "karaoke",
      custom: { sizeMul: 1.4, animation: "fade", animationMs: 400 },
      createdAt: 1,
    };
    const applied = applySavedLook(look, CAPTION_STYLES.karaoke);
    expect(applied.id).toBe("karaoke");
    expect(applied.sizeMul).toBe(1.4);
    expect(applied.animation).toBe("fade");
    expect(applied.animationMs).toBe(400);
    // Non-custom fields still come from the preset.
    expect(applied.textColor).toBe(CAPTION_STYLES.karaoke.textColor);
    expect(applied.background).toBe(CAPTION_STYLES.karaoke.background);
  });

  it("does not leave a custom field from the preset behind", () => {
    const preset: CaptionStyle = { ...CAPTION_STYLES.clean, sizeMul: 1.9, shadow: 0.9, animation: "shake" };
    const look: SavedLook = { id: "x", name: "Look", preset: "clean", custom: { sizeMul: 1.1 }, createdAt: 1 };
    const applied = applySavedLook(look, preset);
    expect(applied.sizeMul).toBe(1.1);
    expect(applied.shadow).toBeUndefined();
    expect(applied.animation).toBeUndefined();
  });

  it("does not mutate the preset", () => {
    const preset: CaptionStyle = { ...CAPTION_STYLES.clean };
    const look: SavedLook = { id: "x", name: "Look", preset: "clean", custom: { boxOpacity: 0.2 }, createdAt: 1 };
    applySavedLook(look, preset);
    expect(preset.boxOpacity).toBeUndefined();
  });
});
