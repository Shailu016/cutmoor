import { buildFontStack } from "./font-stack";
import { captionFontFor } from "./font-catalog";

/**
 * Makes sure the caption fonts are ready before the first frame is drawn.
 *
 * Why this exists: drawing text with a font that has not finished loading silently uses a fallback,
 * so the first seconds of an export would look different from the rest. We wait for the fonts, but
 * never forever and never by throwing: if a font cannot load, the stack's fallbacks (system
 * Devanagari fonts, then sans-serif) take over and the report says so. The result is always usable.
 *
 * `self.fonts` exists on the main thread and in workers, so this works in both. The site's own CSS
 * already declares "Geist Variable" (main.tsx imports @fontsource-variable/geist), which is why no
 * font file is bundled here. A worker has no page CSS, so the caller can pass `extraFaces` with a URL.
 */

export interface FontFaceLike {
  family: string;
  load(): Promise<unknown>;
}

export interface FontFaceSetLike {
  add(face: FontFaceLike): unknown;
  load(font: string, text?: string): Promise<readonly unknown[]>;
  ready: Promise<unknown>;
}

export interface FontEnv {
  fonts: FontFaceSetLike;
  FontFace?: new (family: string, source: string | ArrayBuffer, descriptors?: { weight?: string; display?: string }) => FontFaceLike;
}

export interface ExtraFontFace {
  family: string;
  /** A URL string or the raw font bytes. */
  source: string | ArrayBuffer;
  /** CSS weight or range, e.g. "100 900" for a variable font. */
  weight?: string;
}

export interface FontLoadOptions {
  env?: FontEnv | null;
  /** Families that must be ready. Default: the site font, or the chosen bundled font. */
  families?: readonly string[];
  /** Weights the presets use. */
  weights?: readonly number[];
  extraFaces?: readonly ExtraFontFace[];
  /**
   * The custom look's font. The catalog CSS for it is imported and the family awaited before the
   * first export frame; absent/unknown means the site font, as before.
   */
  fontKey?: string;
  /**
   * The text that is about to be drawn. A browser loads only the font files that cover the characters it
   * is asked for, so this decides which of a font's script files (Latin, accented Latin, Devanagari) are
   * ready before the first frame. Default "Aa", which is the Latin file only.
   */
  text?: string;
  /** Give up waiting after this long. Default 4000 ms. */
  timeoutMs?: number;
}

export interface FontLoadReport {
  /** Families confirmed loaded. */
  loaded: string[];
  /** Families that did not load, with a plain reason. Drawing continues with fallbacks. */
  failed: { family: string; reason: string }[];
}

export const SITE_FONT_FAMILY = "Geist Variable";

function defaultEnv(): FontEnv | null {
  const g = globalThis as unknown as { document?: { fonts?: FontFaceSetLike }; fonts?: FontFaceSetLike; FontFace?: FontEnv["FontFace"] };
  const fonts = g.document?.fonts ?? g.fonts;
  return fonts ? { fonts, FontFace: g.FontFace } : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TIMED_OUT = Symbol("timed out");

/** Resolves with the promise's value, or with TIMED_OUT if it takes longer than `ms`. Rejections pass through. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadCaptionFonts(options: FontLoadOptions = {}): Promise<FontLoadReport> {
  const env = options.env === undefined ? defaultEnv() : options.env;
  const chosen = options.fontKey ? captionFontFor(options.fontKey) : null;
  const families = options.families ?? (chosen ? [chosen.family] : [SITE_FONT_FAMILY]);
  const weights = options.weights ?? (chosen ? chosen.weights : [600, 700, 800]);
  const timeoutMs = options.timeoutMs ?? 4000;
  const report: FontLoadReport = { loaded: [], failed: [] };

  if (!env) {
    for (const family of families) report.failed.push({ family, reason: "This browser has no font loading API." });
    return report;
  }

  // A bundled font is CSS + font files that only exist once its chunk is imported. Do that first,
  // then the normal `fonts.load` below proves the face is really usable. A failed import is not
  // fatal: the stack's fallbacks draw the caption and the report says why.
  let importReason: string | null = null;
  if (chosen) {
    try {
      const loaded = await withTimeout(chosen.load(), timeoutMs);
      if (loaded === TIMED_OUT) importReason = "Timed out while loading the bundled font files.";
    } catch (error) {
      importReason = describe(error);
    }
  }

  for (const extra of options.extraFaces ?? []) {
    if (!env.FontFace) {
      report.failed.push({ family: extra.family, reason: "FontFace is not available here." });
      continue;
    }
    try {
      const face = new env.FontFace(extra.family, extra.source, { weight: extra.weight, display: "block" });
      const loaded = await withTimeout(face.load(), timeoutMs);
      if (loaded === TIMED_OUT) {
        report.failed.push({ family: extra.family, reason: "Timed out while loading." });
        continue;
      }
      env.fonts.add(face);
    } catch (error) {
      report.failed.push({ family: extra.family, reason: describe(error) });
    }
  }

  for (const family of families) {
    let ready = true;
    let reason = "";
    for (const weight of weights) {
      try {
        // fonts.load resolves with the faces it loaded; an empty list means nothing declared that family.
        const faces = await withTimeout(env.fonts.load(`${weight} 32px ${buildFontStack(family)}`, options.text || "Aa"), timeoutMs);
        if (faces === TIMED_OUT) {
          ready = false;
          reason = "Timed out while loading.";
        } else if (faces.length === 0) {
          ready = false;
          reason = "The page does not declare this font.";
        }
      } catch (error) {
        ready = false;
        reason = describe(error);
      }
    }
    if (ready) report.loaded.push(family);
    else report.failed.push({ family, reason: importReason ? `${importReason} The fallback font is used.` : reason });
  }

  try {
    await withTimeout(env.fonts.ready, timeoutMs);
  } catch {
    /* a failed "ready" only means some font did not load; that is already in the report */
  }
  return report;
}
