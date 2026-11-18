import { smallestTargetMb } from "./format";

export type CompressResolution = "original" | "1080" | "720" | "480";

export interface CompressSource {
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
}

export interface CompressPlan {
  /** Target sizes this video can reach and that would make it smaller, smallest first. */
  sizes: number[];
  /** The size selected at the start, or null when no target size is possible. */
  defaultSize: number | null;
  /** The smallest result the encoder can reach for this length. */
  smallestMb: number;
  /** Lower resolutions for this video. Offering a higher one would only enlarge it. */
  resolutions: Exclude<CompressResolution, "original">[];
}

export interface EngineLimits {
  audioKbps: number;
  /** The lowest video bitrate this engine is allowed to use. */
  minVideoKbps: number;
}

export const FFMPEG_LIMITS: EngineLimits = { audioKbps: 128, minVideoKbps: 120 };

/** Long videos get a little less audio, so more of a small target goes to the picture. */
export function nativeLimits(durationSeconds: number): EngineLimits {
  return { audioKbps: durationSeconds >= 3600 ? 96 : 128, minVideoKbps: 100 };
}

const MB = 1024 * 1024;
/** Room left for the file's own index, and for encoders that land slightly over the requested bitrate. */
const SIZE_SAFETY = 0.9;
/** Sizes people need for messaging apps and upload limits. */
const COMMON_SIZES = [8, 10, 16, 25, 50, 100];
const SMALLER_BY = [25, 50, 75, 90];
const MAX_SIZES = 6;
/** A target must save at least this much of the original to be worth offering. */
const MUST_FIT_UNDER = 0.95;
const LOWER_RESOLUTIONS = ["1080", "720", "480"] as const;
/** Assumed frame rate and H.264 bits per pixel for a picture that still looks clean: about 1.5 Mbps at 1080p. */
const FRAMES_PER_SECOND = 30;
const BITS_PER_PIXEL = 0.025;

function roundingStep(value: number): number {
  if (value < 10) return 0.5;
  if (value < 100) return 5;
  return value < 1000 ? 50 : 100;
}

function isNear(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) < 0.1;
}

export function planCompression(
  { sizeBytes, durationSeconds, height }: CompressSource,
  limits: EngineLimits = FFMPEG_LIMITS,
): CompressPlan {
  const originalMb = sizeBytes / MB;
  const smallestMb = smallestTargetMb(durationSeconds, limits.audioKbps, limits.minVideoKbps);
  const resolutions = LOWER_RESOLUTIONS.filter((value) => height <= 0 || Number(value) < height);
  if (durationSeconds <= 0 || originalMb <= 0) return { sizes: [], defaultSize: null, smallestMb, resolutions };

  const lowest = Math.max(1, smallestMb);
  const fits = (size: number) => size >= lowest && size < originalMb * MUST_FIT_UNDER;
  const common = COMMON_SIZES.filter(fits);
  const shares = [0.25, 0.5, 0.75]
    .map((share) => originalMb * share)
    .map((size) => Math.round(size / roundingStep(size)) * roundingStep(size));
  // When every common size is out of reach, offer the smallest size this video can actually get to.
  const smallestReachable = common.length ? [] : [Math.ceil(lowest / roundingStep(lowest)) * roundingStep(lowest)];

  const sizes: number[] = [];
  for (const size of [...shares, ...smallestReachable, ...[...common].reverse()]) {
    if (fits(size) && sizes.length < MAX_SIZES && !sizes.some((existing) => isNear(existing, size))) sizes.push(size);
  }
  sizes.sort((a, b) => a - b);

  const middle = originalMb / 2;
  const defaultSize = sizes.length
    ? sizes.reduce((best, size) => (Math.abs(size - middle) < Math.abs(best - middle) ? size : best))
    : null;
  return { sizes, defaultSize, smallestMb, resolutions };
}

export interface SizeChoice {
  /** How much smaller than the original. */
  percent: number;
  targetMb: number;
}

/** The "percent smaller" choices this video can reach, and the one to start on. */
export function planSizeChoices(source: CompressSource, limits: EngineLimits = FFMPEG_LIMITS): { choices: SizeChoice[]; defaultPercent: number | null } {
  const originalMb = source.sizeBytes / MB;
  if (source.durationSeconds <= 0 || originalMb <= 0) return { choices: [], defaultPercent: null };
  const smallestMb = Math.max(1, smallestTargetMb(source.durationSeconds, limits.audioKbps, limits.minVideoKbps));
  const mostPossible = Math.floor(((1 - smallestMb / originalMb) * 100) / 5) * 5;
  if (mostPossible < 5) return { choices: [], defaultPercent: null };

  const percents = SMALLER_BY.filter((percent) => percent <= mostPossible);
  // When the usual steps stop early, also offer the most this video can really shrink.
  if (mostPossible < SMALLER_BY[SMALLER_BY.length - 1] && !percents.includes(mostPossible)) percents.push(mostPossible);
  const choices = percents.map((percent) => ({ percent, targetMb: Math.round(originalMb * (100 - percent)) / 100 }));
  return { choices, defaultPercent: percents.includes(50) ? 50 : percents[percents.length - 1] };
}

function kbpsForCleanPicture(width: number, height: number): number {
  return (width * height * FRAMES_PER_SECOND * BITS_PER_PIXEL) / 1000;
}

/** The video bitrate that lands near a target size with the browser's own encoder. */
export function videoKbpsForTarget(targetMb: number, durationSeconds: number, limits: EngineLimits): number {
  if (durationSeconds <= 0) return 0;
  const totalKbps = ((targetMb * 8 * 1024) / durationSeconds) * SIZE_SAFETY;
  return Math.max(limits.minVideoKbps, Math.round(totalKbps - limits.audioKbps));
}

export function outputSize(resolution: CompressResolution, width: number, height: number): { width: number; height: number } {
  if (resolution === "original" || height <= 0) return { width, height };
  const outputHeight = Number(resolution);
  return { width: Math.round((width * outputHeight) / height), height: outputHeight };
}

/** A target far above what the picture can use must not ask the encoder for an impossible bitrate. */
export function capKbps(kbps: number, width: number, height: number): number {
  if (width <= 0 || height <= 0) return kbps;
  return Math.min(kbps, Math.max(2000, Math.round(kbpsForCleanPicture(width, height) * 4)));
}

/** Best quality with the browser's encoder: generous for the picture size, but below what the source already uses. */
export function bestQualityKbps(width: number, height: number, source: CompressSource, audioKbps: number): number {
  const generous = kbpsForCleanPicture(width, height) * 2;
  if (source.durationSeconds <= 0) return Math.max(300, Math.round(generous));
  const sourceVideoKbps = (source.sizeBytes * 8) / 1000 / source.durationSeconds - audioKbps;
  return Math.max(150, Math.round(Math.min(generous, sourceVideoKbps * 0.8)));
}

/** The largest resolution that this much video bitrate can keep looking clean. */
export function recommendResolution(videoKbps: number, width: number, height: number, plan: CompressPlan): CompressResolution {
  if (videoKbps <= 0 || width <= 0 || height <= 0) return "original";
  if (videoKbps >= kbpsForCleanPicture(width, height)) return "original";
  const lower = plan.resolutions;
  const fitting = lower.find((value) => videoKbps >= kbpsForCleanPicture((width * Number(value)) / height, Number(value)));
  return fitting ?? lower[lower.length - 1] ?? "original";
}
