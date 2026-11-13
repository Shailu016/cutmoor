/**
 * Before/after maths for every tool. Everything here works on real byte
 * counts, and never reports a larger file as a saving.
 */

export type SizeChange = "smaller" | "larger" | "same" | "invalid";

export interface SizeComparison {
  change: SizeChange;
  originalBytes: number;
  processedBytes: number;
  /** Bytes saved. Zero unless the result is smaller. */
  savedBytes: number;
  /** Bytes added. Zero unless the result is larger. */
  addedBytes: number;
  /** Absolute difference from the original in percent, one decimal. Null when it cannot be computed. */
  percent: number | null;
}

const isUsableSize = (bytes: number) => Number.isFinite(bytes) && bytes > 0;

/**
 * Savings (%) = (original - processed) / original x 100, reported as an
 * absolute value plus a direction, so a larger file can never read as a saving.
 * An empty or unmeasurable output, or an unknown original size, is "invalid".
 */
export function compareSizes(originalBytes: number, processedBytes: number): SizeComparison {
  if (!isUsableSize(originalBytes) || !isUsableSize(processedBytes)) {
    return { change: "invalid", originalBytes, processedBytes, savedBytes: 0, addedBytes: 0, percent: null };
  }
  if (processedBytes === originalBytes) {
    return { change: "same", originalBytes, processedBytes, savedBytes: 0, addedBytes: 0, percent: 0 };
  }
  const difference = originalBytes - processedBytes;
  const percent = Math.round((Math.abs(difference) / originalBytes) * 1000) / 10;
  if (difference > 0) {
    return { change: "smaller", originalBytes, processedBytes, savedBytes: difference, addedBytes: 0, percent };
  }
  return { change: "larger", originalBytes, processedBytes, savedBytes: 0, addedBytes: -difference, percent };
}

/** "12%" or "12.5%": drops a trailing .0 so the figure reads naturally. */
export function formatPercent(percent: number): string {
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/** Real elapsed time for display: "640 ms", "4.2 s", "38 s", "2 min 5 s". */
export function formatElapsed(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "0 ms";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
