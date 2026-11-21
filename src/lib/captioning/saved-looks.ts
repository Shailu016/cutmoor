import type { CaptionStyle } from "./contracts";
import { isAnimationName, MAX_ANIMATION_MS } from "./burn-in/animations";

/**
 * Named caption looks, kept in this browser only.
 *
 * Storage is injected (`StorageLike`) instead of reaching for `window.localStorage` inside every
 * function, so the whole module is testable in Node without a browser. `browserLookStorage()`
 * returns the real one when the page has it, and null when storage is blocked (private windows,
 * third-party iframes, a full quota): every operation then fails cleanly instead of throwing.
 *
 * What is stored: the preset id plus the look fields of CaptionStyle that a visitor can change
 * (see CUSTOM_LOOK_FIELDS: font, size, colours, capitals, outline, shadow, box, position,
 * animation, and the number highlight). The rest of the preset is not copied, so a later preset
 * tweak still reaches old saved looks. Everything is validated when read; an entry whose shape or
 * values are wrong is never half-applied. It is also never thrown away: it is kept as it was and
 * written back, so a look saved by a newer version survives an older one saving or deleting.
 *
 * Nothing here sends data anywhere. The only key ever touched is `cutmoor.captionLooks.v1`.
 */

export const SAVED_LOOKS_KEY = "cutmoor.captionLooks.v1";
export const MAX_SAVED_LOOKS = 20;
export const MAX_LOOK_NAME = 60;

export const CUSTOM_LOOK_FIELDS = [
  "fontKey",
  "sizeMul",
  "outlineWidth",
  "outlineColor",
  "shadow",
  "shadowColor",
  "boxOpacity",
  "boxColor",
  "anchorX",
  "anchorY",
  "align",
  "animation",
  "animationMs",
  // The Look tab and the number highlight also change these. They live on the preset too, so they
  // are overridden when a look is applied but never cleared from the preset (see CLEARED_ON_APPLY).
  "textColor",
  "activeColor",
  "uppercase",
  "highlightNumbers",
] as const;

/** The fields a preset does not own. Applying a look removes them from the preset first. */
const CLEARED_ON_APPLY = CUSTOM_LOOK_FIELDS.filter(
  (field) => field !== "textColor" && field !== "activeColor" && field !== "uppercase" && field !== "highlightNumbers",
);

export type CustomLookField = (typeof CUSTOM_LOOK_FIELDS)[number];
/** Only the custom-look slice of a CaptionStyle. Every field stays optional, as in the contract. */
export type CustomLook = Partial<Pick<CaptionStyle, CustomLookField>>;

export interface SavedLook {
  id: string;
  name: string;
  /** The preset this look starts from. Its own non-custom fields remain the preset's. */
  preset: CaptionStyle["id"];
  custom: CustomLook;
  /** Creation time (ms), used only to keep a stable newest-first order. */
  createdAt: number;
}

/** The small part of the Web Storage API this module needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SavedLookError =
  | "unavailable" // storage is blocked or absent
  | "invalid-name"
  | "limit"
  | "not-found"
  | "corrupt" // the stored JSON cannot be trusted; refuse to overwrite it
  | "read-failed"
  | "write-failed";

export interface SavedLookResult {
  ok: boolean;
  error?: SavedLookError;
  look?: SavedLook;
}

export interface SavedLooksRead {
  looks: SavedLook[];
  ok: boolean;
  error?: "unavailable" | "corrupt" | "read-failed";
  /** Entries that were ignored because their shape or values failed validation. */
  skipped?: number;
  /**
   * Entries that could not be used but must not be lost: ones this version cannot read (a newer
   * version's values) and ones beyond the 20-look cap. Writes put them back unchanged.
   */
  preserved?: unknown[];
}

/** A bound on what is carried along unread, so a hand-edited or hostile value cannot grow storage without limit. */
const MAX_PRESERVED = 40;

const PRESETS: readonly CaptionStyle["id"][] = ["clean", "shorts", "bold", "karaoke", "highlighter", "pop"];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const COLOUR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isPreset(value: unknown): value is CaptionStyle["id"] {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value);
}

function isColour(value: unknown): boolean {
  return typeof value === "string" && COLOUR_PATTERN.test(value);
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

function numberIn(min: number, max: number): (value: unknown) => boolean {
  return (value) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** One validator per custom field. A value that fails is not guessed at: on read the entry is dropped. */
const FIELD_RULES: Readonly<Record<CustomLookField, (value: unknown) => boolean>> = {
  fontKey: (value) => typeof value === "string" && value.length > 0 && value.length <= 64 && !/[\u0000-\u001f]/.test(value),
  sizeMul: numberIn(0.5, 2),
  outlineWidth: numberIn(0, 1),
  outlineColor: isColour,
  shadow: numberIn(0, 1),
  shadowColor: isColour,
  boxOpacity: numberIn(0, 1),
  boxColor: isColour,
  anchorX: numberIn(0, 1),
  anchorY: numberIn(0, 1),
  align: (value) => value === "left" || value === "center" || value === "right",
  animation: (value) => isAnimationName(value),
  animationMs: numberIn(0, MAX_ANIMATION_MS),
  textColor: isColour,
  activeColor: isColour,
  uppercase: isBoolean,
  highlightNumbers: isBoolean,
};

/** Trims, collapses whitespace and caps the length. Returns null when nothing is left. */
function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_LOOK_NAME);
  return name.length > 0 ? name : null;
}

/**
 * Copies the fields in `style` that a saved look owns. `ignoreInvalidFields` is true when saving
 * (a NaN from an in-progress control must not stop the save) and false when reading (a stored
 * entry with one bad field is corrupt and is dropped whole).
 */
function readCustom(source: Record<string, unknown>, ignoreInvalidFields: boolean): CustomLook | null {
  const custom: Record<string, unknown> = {};
  for (const key of CUSTOM_LOOK_FIELDS) {
    const value = source[key];
    if (value === undefined) continue;
    if (!FIELD_RULES[key](value)) {
      if (ignoreInvalidFields) continue;
      return null;
    }
    custom[key] = key === "animationMs" ? Math.round(value as number) : value;
  }
  return custom as CustomLook;
}

/** The custom-look fields of a style, ready to store. Invalid values (NaN, unknown animation) are dropped. */
export function customFields(style: CaptionStyle): CustomLook {
  const source: Record<string, unknown> = {};
  for (const key of CUSTOM_LOOK_FIELDS) source[key] = style[key];
  return readCustom(source, true) ?? {};
}

function sanitizeLook(raw: unknown): SavedLook | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" && ID_PATTERN.test(item.id) ? item.id : null;
  const name = normalizeName(item.name);
  const preset = isPreset(item.preset) ? item.preset : null;
  const createdAt = typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : null;
  if (id === null || name === null || preset === null || createdAt === null) return null;

  let custom: CustomLook = {};
  if (item.custom !== undefined) {
    if (!item.custom || typeof item.custom !== "object" || Array.isArray(item.custom)) return null;
    const parsed = readCustom(item.custom as Record<string, unknown>, false);
    if (parsed === null) return null;
    custom = parsed;
  }
  return { id, name, preset, custom, createdAt };
}

/** The real localStorage, or null when the page blocks it. Never throws. */
export function browserLookStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads and validates the saved looks. A missing key is an empty list, not an error. Malformed
 * JSON is reported so the UI can say so; individual bad entries are skipped.
 */
export function readSavedLooks(storage: StorageLike | null): SavedLooksRead {
  if (!storage) return { looks: [], ok: false, error: "unavailable" };

  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_LOOKS_KEY);
  } catch {
    return { looks: [], ok: false, error: "read-failed" };
  }
  if (raw === null || raw === "") return { looks: [], ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { looks: [], ok: false, error: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { looks: [], ok: false, error: "corrupt" };
  const document = parsed as { version?: unknown; looks?: unknown };
  if (document.version !== 1 || !Array.isArray(document.looks)) return { looks: [], ok: false, error: "corrupt" };

  const looks: SavedLook[] = [];
  const preserved: unknown[] = [];
  const keep = (entry: unknown) => {
    if (preserved.length < MAX_PRESERVED) preserved.push(entry);
  };
  const ids = new Set<string>();
  let skipped = 0;
  for (let index = 0; index < document.looks.length; index += 1) {
    const entry: unknown = document.looks[index];
    if (looks.length >= MAX_SAVED_LOOKS) {
      // Over the cap: not shown, but not deleted either.
      keep(entry);
      continue;
    }
    const look = sanitizeLook(entry);
    if (!look) {
      skipped += 1;
      keep(entry);
      continue;
    }
    if (ids.has(look.id)) {
      skipped += 1;
      continue;
    }
    ids.add(look.id);
    looks.push(look);
  }
  looks.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return { looks, ok: true, skipped, preserved };
}

/** Just the looks, newest first. Use `readSavedLooks` when the UI needs the failure reason. */
export function listLooks(storage: StorageLike | null): SavedLook[] {
  return readSavedLooks(storage).looks;
}

function writeLooks(storage: StorageLike, looks: readonly SavedLook[], preserved: readonly unknown[] = []): boolean {
  try {
    storage.setItem(SAVED_LOOKS_KEY, JSON.stringify({ version: 1, looks: [...looks, ...preserved] }));
    return true;
  } catch {
    return false;
  }
}

export interface SaveLookOptions {
  /** For tests: a fixed creation time and id. */
  now?: number;
  id?: string;
}

function createId(now: number): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (typeof uuid === "string" && uuid.length > 0) return `look-${uuid}`;
  } catch {
    /* fall through to the timestamp form */
  }
  return `look-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Saves the custom fields of `style` under `name`. Fails cleanly at the 20-look cap. */
export function saveLook(storage: StorageLike | null, name: string, style: CaptionStyle, options: SaveLookOptions = {}): SavedLookResult {
  if (!storage) return { ok: false, error: "unavailable" };
  const cleanName = normalizeName(name);
  if (cleanName === null) return { ok: false, error: "invalid-name" };

  const read = readSavedLooks(storage);
  if (read.error) return { ok: false, error: read.error };
  if (read.looks.length >= MAX_SAVED_LOOKS) return { ok: false, error: "limit" };

  const now = typeof options.now === "number" && Number.isFinite(options.now) ? options.now : Date.now();
  let id = options.id && ID_PATTERN.test(options.id) ? options.id : createId(now);
  if (read.looks.some((look) => look.id === id)) id = createId(now);

  const look: SavedLook = { id, name: cleanName, preset: style.id, custom: customFields(style), createdAt: now };
  if (!writeLooks(storage, [...read.looks, look], read.preserved)) return { ok: false, error: "write-failed" };
  return { ok: true, look };
}

export function renameLook(storage: StorageLike | null, id: string, name: string): SavedLookResult {
  if (!storage) return { ok: false, error: "unavailable" };
  const cleanName = normalizeName(name);
  if (cleanName === null) return { ok: false, error: "invalid-name" };

  const read = readSavedLooks(storage);
  if (read.error) return { ok: false, error: read.error };
  const index = read.looks.findIndex((look) => look.id === id);
  if (index < 0) return { ok: false, error: "not-found" };

  const looks = read.looks.slice();
  const look: SavedLook = { ...looks[index], name: cleanName };
  looks[index] = look;
  if (!writeLooks(storage, looks, read.preserved)) return { ok: false, error: "write-failed" };
  return { ok: true, look };
}

export function deleteLook(storage: StorageLike | null, id: string): SavedLookResult {
  if (!storage) return { ok: false, error: "unavailable" };

  const read = readSavedLooks(storage);
  if (read.error) return { ok: false, error: read.error };
  const looks = read.looks.filter((look) => look.id !== id);
  if (looks.length === read.looks.length) return { ok: false, error: "not-found" };
  if (!writeLooks(storage, looks, read.preserved)) return { ok: false, error: "write-failed" };
  return { ok: true };
}

/**
 * Builds the style to preview/export from a saved look and a preset. Custom fields already on
 * the preset (today none, but a preset may gain them) are cleared first, so applying a look
 * never leaves a field from the previously applied look behind.
 */
export function applySavedLook(look: SavedLook, preset: CaptionStyle): CaptionStyle {
  const next: CaptionStyle = { ...preset, id: look.preset };
  const writable = next as unknown as Record<string, unknown>;
  for (const key of CLEARED_ON_APPLY) delete writable[key];
  return { ...next, ...look.custom };
}
