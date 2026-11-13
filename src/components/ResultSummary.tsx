import { ArrowRight, Check, Info, TriangleAlert } from "lucide-react";
import { formatBytes } from "../lib/format";
import { compareSizes, formatElapsed, formatPercent } from "../lib/results";

export interface ResultFileInfo {
  name: string;
  bytes: number;
  /** Short format label such as "MOV", "MP4", "PNG". */
  format: string;
  /** Optional extra detail: dimensions, duration. */
  detail?: string;
}

interface ResultSummaryProps {
  original: ResultFileInfo;
  processed: ResultFileInfo;
  /** Measured processing time in milliseconds. */
  processMs: number;
  /** Measured encoder download time for this run, if any. */
  engineLoadMs?: number;
  /** Shown only when the output is larger, to suggest a next step. */
  largerHint?: string;
}

/** Engine downloads shorter than this are cache hits and not worth mentioning. */
const NOTEWORTHY_LOAD_MS = 500;

/**
 * The before/after card for every tool: real byte counts, an honest verdict,
 * and a measured processing time. Never presents a larger file as a saving.
 */
export function ResultSummary({ original, processed, processMs, engineLoadMs = 0, largerHint }: ResultSummaryProps) {
  const comparison = compareSizes(original.bytes, processed.bytes);
  const formatChanged = original.format !== processed.format;
  const showLoad = engineLoadMs >= NOTEWORTHY_LOAD_MS;

  return (
    <section className="result-summary" aria-label="Before and after">
      <div className="result-cards">
        <div className="result-card result-card-original">
          <span className="mono-label">Original</span>
          <strong>{formatBytes(original.bytes)}</strong>
          <span className="result-card-format">
            {original.format}
            {original.detail ? ` · ${original.detail}` : ""}
          </span>
          <span className="result-card-name" title={original.name}>
            {original.name}
          </span>
        </div>
        <ArrowRight className="result-arrow" size={18} aria-hidden="true" />
        <div className={`result-card result-card-processed result-card-${comparison.change}`}>
          <span className="mono-label">Processed</span>
          <strong>{formatBytes(processed.bytes)}</strong>
          <span className="result-card-format">
            {processed.format}
            {processed.detail ? ` · ${processed.detail}` : ""}
          </span>
          <span className="result-card-name" title={processed.name}>
            {processed.name}
          </span>
        </div>
      </div>

      <p className={`result-verdict result-verdict-${comparison.change}`} role="status">
        {comparison.change === "smaller" && comparison.percent !== null && (
          <>
            <Check size={15} aria-hidden="true" />
            <span>
              <strong>{formatPercent(comparison.percent)} smaller</strong> · {formatBytes(comparison.savedBytes)} saved
            </span>
          </>
        )}
        {comparison.change === "larger" && comparison.percent !== null && (
          <>
            <TriangleAlert size={15} aria-hidden="true" />
            <span>
              <strong>{formatPercent(comparison.percent)} larger</strong> than the original (+
              {formatBytes(comparison.addedBytes)}). {largerHint ?? "Keep the original, or try a lower quality or a different format."}
            </span>
          </>
        )}
        {comparison.change === "same" && (
          <>
            <Info size={15} aria-hidden="true" />
            <span>The processed file is exactly the same size as the original.</span>
          </>
        )}
        {comparison.change === "invalid" && (
          <>
            <TriangleAlert size={15} aria-hidden="true" />
            <span>
              The size could not be compared because the output is empty or unreadable. Do not use it; keep your
              original file.
            </span>
          </>
        )}
      </p>

      {formatChanged && comparison.change !== "invalid" && (
        <p className="result-footnote">
          The format changed from {original.format} to {processed.format}, so the size difference includes the effect of
          the new format.
        </p>
      )}

      <dl className="result-stats">
        <div>
          <dt>Processing time</dt>
          <dd>{formatElapsed(processMs)}</dd>
        </div>
        <div>
          <dt>Output format</dt>
          <dd>{processed.format}</dd>
        </div>
        {showLoad && (
          <div>
            <dt>Encoder download</dt>
            <dd>{formatElapsed(engineLoadMs)}</dd>
          </div>
        )}
      </dl>
      {showLoad && (
        <p className="result-footnote">
          The encoder is downloaded once and cached. That time is shown separately and is not part of the processing
          time.
        </p>
      )}
    </section>
  );
}
