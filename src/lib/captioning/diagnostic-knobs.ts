/**
 * Benchmarks and bug reports can set a few page globals (window.__cutmoorVadOverrides, __cutmoorOrtSessionOverrides, ...) to change
 * a setting for one run. Nothing in production sets them, but any script on the page could, so what they may change is limited to
 * a short list of harmless numbers and words, checked before use. Anything else is ignored.
 */

const VAD_KEYS = ["startThreshold", "endThreshold", "minSpeechMs", "minSilenceMs", "padMs", "mergeGapMs", "maxIntervalMs"] as const;
const ORT_FLAGS = ["enableMemPattern", "enableCpuMemArena"] as const;
const GRAPH_LEVELS = ["disabled", "basic", "extended", "all"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Only the named voice-detector settings, and only values the detector itself accepts: thresholds above 0 and up to 1 (the end
 * threshold not above the start), positive durations, a longest speech stretch of at least 5 s. A value outside that is ignored, so a
 * bad knob can never turn into a failed job.
 */
export function sanitizeVadOverrides(raw: unknown): Partial<Record<(typeof VAD_KEYS)[number], number>> {
  const out: Partial<Record<(typeof VAD_KEYS)[number], number>> = {};
  if (!isRecord(raw)) return out;
  for (const key of VAD_KEYS) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value > 600_000) continue;
    if ((key === "startThreshold" || key === "endThreshold") && !(value > 0 && value <= 1)) continue;
    if ((key === "minSpeechMs" || key === "minSilenceMs" || key === "mergeGapMs") && !(value > 0)) continue;
    if (key === "padMs" && value < 0) continue;
    if (key === "maxIntervalMs" && value < 5000) continue;
    out[key] = value;
  }
  // The detector needs the end threshold at or below the start threshold (defaults 0.5 and 0.35): an inconsistent pair is dropped.
  const start = out.startThreshold ?? 0.5;
  const end = out.endThreshold ?? 0.35;
  if (end > start) {
    delete out.startThreshold;
    delete out.endThreshold;
  }
  return out;
}

/** Only the optimisation level and two on/off flags: never the execution provider, model paths or anything else. */
export function sanitizeOrtOverrides(raw: unknown): { graphOptimizationLevel?: (typeof GRAPH_LEVELS)[number]; enableMemPattern?: boolean; enableCpuMemArena?: boolean } {
  const out: { graphOptimizationLevel?: (typeof GRAPH_LEVELS)[number]; enableMemPattern?: boolean; enableCpuMemArena?: boolean } = {};
  if (!isRecord(raw)) return out;
  const level = raw.graphOptimizationLevel;
  if (typeof level === "string" && (GRAPH_LEVELS as readonly string[]).includes(level)) out.graphOptimizationLevel = level as (typeof GRAPH_LEVELS)[number];
  for (const flag of ORT_FLAGS) if (typeof raw[flag] === "boolean") out[flag] = raw[flag] as boolean;
  return out;
}

/** Most decoder steps the attention recorder keeps (a long file would otherwise grow it without bound). */
export const MAX_ATTENTION_STEPS = 4000;

/** The song-mode pipeline switches a benchmark may set from the page (see PipelineTuning). */
const PIPELINE_TUNING_FLAGS = ["timestampRead", "c2Time", "reuseEncoder", "debugReads"] as const;

/**
 * Only the four song-mode switches, and only as booleans. Used by a development build's benchmark harness
 * (`captions-real.mjs --tuning=...` / `window.__cutmoorPipelineTuning`); a production build never reads it at all,
 * so this cannot become an end-user setting. An unknown key or a non-boolean value is ignored.
 */
export function sanitizePipelineTuning(raw: unknown): Partial<Record<(typeof PIPELINE_TUNING_FLAGS)[number], boolean>> {
  const out: Partial<Record<(typeof PIPELINE_TUNING_FLAGS)[number], boolean>> = {};
  if (!isRecord(raw)) return out;
  for (const key of PIPELINE_TUNING_FLAGS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  }
  return out;
}
