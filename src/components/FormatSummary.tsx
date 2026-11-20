import { Link } from "./Link";
import { ArrowRight, Check, TriangleAlert, X } from "lucide-react";
import { TestedNote } from "./FormatCompat";
import { STATUS_LABEL, summarizeFormats, type FormatEntry, type FormatStatus } from "../lib/formats";
import { IMAGE_TOOLS, VIDEO_TOOLS } from "../lib/tools";

const ICON = { supported: Check, limited: TriangleAlert, unsupported: X } as const;

/**
 * Entries that describe ONE format ("MP4 (H.264 + AAC)", "AVIF"), not a tool-specific combination ("WebP, GIF, BMP, SVG",
 * "Same format (JPG, PNG, WebP)", "Logo: PNG, ..."). Those combined lines stay on the tool pages; the overview is a
 * table of single formats you can scan in a glance.
 */
export function isSingleFormat(entry: FormatEntry): boolean {
  return !/[,:]|^Same |^AVIF and HEIC|redrawn|burned|captions|JSON/i.test(entry.label);
}

function Matrix({ title, entries }: { title: string; entries: FormatEntry[] }) {
  return (
    <table className="fm">
      <caption>{title}</caption>
      <tbody>
        {entries.filter(isSingleFormat).map((entry) => {
          const Icon = ICON[entry.status];
          return (
            <tr key={entry.label} className={`fm-${entry.status}`} title={entry.status === "supported" ? undefined : entry.note}>
              <th scope="row">
                <span className="fm-mark" role="img" aria-label={STATUS_LABEL[entry.status]}>
                  <Icon size={13} strokeWidth={3} aria-hidden="true" />
                </span>
                <span className="fm-name">
                  {entry.label}
                  {entry.status !== "supported" && entry.note ? <small>{entry.note}</small> : null}
                </span>
              </th>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const LEGEND: FormatStatus[] = ["supported", "limited", "unsupported"];

/** Homepage overview of what the tools accept and produce, built from the same table as the tool pages. */
export function FormatSummary() {
  const videoSlugs = VIDEO_TOOLS.filter((tool) => tool.slug !== "captions").map((tool) => tool.slug);
  const imageSlugs = IMAGE_TOOLS.map((tool) => tool.slug);

  return (
    <section className="section shell format-summary" aria-labelledby="format-summary-heading">
      <div className="section-head">
        <div>
          <h2 id="format-summary-heading">Know what works before you start.</h2>
        </div>
        <Link className="text-link" to="/tools">
          Every tool, with its limits <ArrowRight size={15} />
        </Link>
      </div>
      <ul className="fm-legend" aria-label="Key">
        {LEGEND.map((status) => {
          const Icon = ICON[status];
          return (
            <li key={status} className={`fm-${status}`}>
              <span className="fm-mark" aria-hidden="true">
                <Icon size={13} strokeWidth={3} />
              </span>
              {status === "supported" ? "Works" : STATUS_LABEL[status]}
            </li>
          );
        })}
      </ul>
      <div className="fm-grid">
        <Matrix title="Video: accepts" entries={summarizeFormats(videoSlugs, "inputs")} />
        <Matrix title="Video: produces" entries={summarizeFormats(videoSlugs, "outputs")} />
        <Matrix title="Images: accepts" entries={summarizeFormats(imageSlugs, "inputs")} />
        <Matrix title="Images: produces" entries={summarizeFormats(imageSlugs, "outputs")} />
      </div>
      <TestedNote />
    </section>
  );
}
