/**
 * Merges card entries into src/lib/card-art.generated.ts (kept in git, so a partial run updates only the tools it ran).
 * Shared by scripts/make-card-art.mjs and scripts/make-captions-card.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DATA = "src/lib/card-art.generated.ts";

export function mergeCardArt(entries, { remove = [] } = {}) {
  let existing = {};
  try {
    const text = readFileSync(DATA, "utf8");
    const start = text.indexOf("{", text.indexOf("CARD_ART"));
    existing = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  } catch {}
  for (const slug of remove) delete existing[slug];
  Object.assign(existing, entries);
  writeFileSync(
    DATA,
    `// Written by scripts/make-card-art.mjs and scripts/make-captions-card.mjs from real runs of the tool pages. Do not edit by hand.
export interface CardArtFile { w: number; h: number; duration: number | null }
export interface CardArtEntry {
  /** split / strip: real before and after output. frames: a row of real frames of the tool's own live preview (Auto captions). */
  mode: "split" | "strip" | "frames";
  /** Sizes of the input and the output file. Not used by "frames" cards (zero). */
  beforeBytes: number;
  afterBytes: number;
  name: string;
  before: CardArtFile;
  after: CardArtFile;
  /** Trim only: the part of the source that was kept, in seconds (the settings the run used). */
  keep?: [number, number];
  /** frames only: how many frames the picture holds, and the sample text the tool's stand-in engine wrote. */
  frames?: number;
  sampleText?: string;
}

export const CARD_ART: Record<string, CardArtEntry> = ${JSON.stringify(existing, null, 2)};
`,
  );
}
