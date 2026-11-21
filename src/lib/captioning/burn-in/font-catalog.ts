import type { CaptionStyle } from "../contracts";

/**
 * The fonts a caption can be drawn in, taken only from the font packages already bundled for the
 * site. Nothing here is fetched from another host: each entry's `load` imports the font's own CSS
 * through the bundler, which Vite turns into files served from this site.
 *
 * The CSS is loaded lazily (only when the visitor picks the font), so a visitor who never opens
 * the font menu downloads none of these files. `load` is cached: picking a font again costs
 * nothing.
 *
 * An unknown key is not an error: the preset's own `fontFamily` is used, exactly as before these
 * fields existed.
 */

export interface CaptionFont {
  key: string;
  /** What the font menu shows. */
  label: string;
  /** The CSS family name the bundled files declare. */
  family: string;
  /** Weights the package actually ships (used to pick the nearest one the font has). */
  weights: readonly number[];
  /** The package CSS files this entry imports, for tests and for the lazy loader. */
  cssFiles: readonly string[];
  /** Imports the CSS once. Rejects if the bundled files cannot be loaded; the caller falls back. */
  load(): Promise<void>;
}

/** A rejected import is not cached, so a later pick can try again. */
function once(load: () => Promise<unknown>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending === null) {
      pending = load().then(
        () => undefined,
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  };
}

/**
 * Vite needs every `import()` written out statically to create a chunk for it, so the files are
 * listed here rather than derived from a string at runtime.
 */
const IMPORTS: Readonly<Record<string, () => Promise<unknown>>> = {
  "@fontsource-variable/geist/index.css": () => import("@fontsource-variable/geist/index.css"),
  "@fontsource-variable/inter/index.css": () => import("@fontsource-variable/inter/index.css"),
  "@fontsource-variable/montserrat/index.css": () => import("@fontsource-variable/montserrat/index.css"),
  "@fontsource-variable/noto-sans-devanagari/index.css": () => import("@fontsource-variable/noto-sans-devanagari/index.css"),
  "@fontsource/poppins/400.css": () => import("@fontsource/poppins/400.css"),
  "@fontsource/poppins/600.css": () => import("@fontsource/poppins/600.css"),
  "@fontsource/poppins/700.css": () => import("@fontsource/poppins/700.css"),
  "@fontsource/poppins/800.css": () => import("@fontsource/poppins/800.css"),
  "@fontsource/bebas-neue/400.css": () => import("@fontsource/bebas-neue/400.css"),
};

function loaderFor(cssFiles: readonly string[]): () => Promise<void> {
  return once(() => Promise.all(cssFiles.map((file) => IMPORTS[file]())));
}

/** Variable fonts cover the whole weight range; static packages list each file they ship. */
const VARIABLE_WEIGHTS = [400, 500, 600, 700, 800] as const;

export const CAPTION_FONTS: readonly CaptionFont[] = [
  {
    key: "geist",
    label: "Geist",
    family: "Geist Variable",
    weights: VARIABLE_WEIGHTS,
    cssFiles: ["@fontsource-variable/geist/index.css"],
    load: loaderFor(["@fontsource-variable/geist/index.css"]),
  },
  {
    key: "inter",
    label: "Inter",
    family: "Inter Variable",
    weights: VARIABLE_WEIGHTS,
    cssFiles: ["@fontsource-variable/inter/index.css"],
    load: loaderFor(["@fontsource-variable/inter/index.css"]),
  },
  {
    key: "montserrat",
    label: "Montserrat",
    family: "Montserrat Variable",
    weights: VARIABLE_WEIGHTS,
    cssFiles: ["@fontsource-variable/montserrat/index.css"],
    load: loaderFor(["@fontsource-variable/montserrat/index.css"]),
  },
  {
    key: "noto-sans-devanagari",
    label: "Noto Sans Devanagari",
    family: "Noto Sans Devanagari Variable",
    weights: VARIABLE_WEIGHTS,
    cssFiles: ["@fontsource-variable/noto-sans-devanagari/index.css"],
    load: loaderFor(["@fontsource-variable/noto-sans-devanagari/index.css"]),
  },
  {
    key: "poppins",
    label: "Poppins",
    family: "Poppins",
    weights: [400, 600, 700, 800],
    cssFiles: ["@fontsource/poppins/400.css", "@fontsource/poppins/600.css", "@fontsource/poppins/700.css", "@fontsource/poppins/800.css"],
    load: loaderFor(["@fontsource/poppins/400.css", "@fontsource/poppins/600.css", "@fontsource/poppins/700.css", "@fontsource/poppins/800.css"]),
  },
  {
    key: "bebas-neue",
    label: "Bebas Neue",
    family: "Bebas Neue",
    weights: [400],
    cssFiles: ["@fontsource/bebas-neue/400.css"],
    load: loaderFor(["@fontsource/bebas-neue/400.css"]),
  },
];

const BY_KEY = new Map(CAPTION_FONTS.map((font) => [font.key, font]));

/** The catalog entry for a key, or null for absent/unknown keys (which keep the preset font). */
export function captionFontFor(key: string | undefined): CaptionFont | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * The family a style is drawn in. A known `fontKey` wins; anything else is the preset's own
 * family, so old styles and unknown keys render exactly as before.
 */
export function fontFamilyFor(style: Pick<CaptionStyle, "fontFamily" | "fontKey">): string {
  return captionFontFor(style.fontKey)?.family ?? style.fontFamily;
}

/** The nearest weight the chosen font actually ships. Ties go heavier, which reads better on video. */
export function nearestFontWeight(desired: number, weights: readonly number[]): number {
  if (weights.length === 0) return desired;
  let best = weights[0];
  let bestDistance = Math.abs(desired - best);
  for (const weight of weights.slice(1)) {
    const distance = Math.abs(desired - weight);
    if (distance < bestDistance || (distance === bestDistance && weight > best)) {
      best = weight;
      bestDistance = distance;
    }
  }
  return best;
}

/** Loads the chosen font's CSS ahead of time. Never throws: a failure just leaves the fallbacks. */
export async function preloadCaptionFont(key: string | undefined): Promise<boolean> {
  const font = captionFontFor(key);
  if (!font) return false;
  try {
    await font.load();
    return true;
  } catch {
    return false;
  }
}
