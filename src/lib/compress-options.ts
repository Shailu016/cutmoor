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

const MB = 1024 * 1024;
/** Sizes people need for messaging apps and upload limits. */
const COMMON_SIZES = [8, 10, 16, 25, 50, 100];
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

export function planCompression({ sizeBytes, durationSeconds, height }: CompressSource): CompressPlan {
  const originalMb = sizeBytes / MB;
  const smallestMb = smallestTargetMb(durationSeconds);
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

function kbpsForCleanPicture(width: number, height: number): number {
  return (width * height * FRAMES_PER_SECOND * BITS_PER_PIXEL) / 1000;
}

/** The largest resolution that this much video bitrate can keep looking clean. */
export function recommendResolution(videoKbps: number, width: number, height: number, plan: CompressPlan): CompressResolution {
  if (videoKbps <= 0 || width <= 0 || height <= 0) return "original";
  if (videoKbps >= kbpsForCleanPicture(width, height)) return "original";
  const lower = plan.resolutions;
  const fitting = lower.find((value) => videoKbps >= kbpsForCleanPicture((width * Number(value)) / height, Number(value)));
  return fitting ?? lower[lower.length - 1] ?? "original";
}
