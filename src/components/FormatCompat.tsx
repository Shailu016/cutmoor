import { Check, TriangleAlert, X } from "lucide-react";
import {
  browserRequirement,
  compatForTool,
  STATUS_LABEL,
  TESTED_SETUP,
  type FormatEntry,
  type FormatStatus,
} from "../lib/formats";

/** Status is never shown by colour alone: every badge has an icon and a word. */
export function StatusBadge({ status }: { status: FormatStatus }) {
  const Icon = status === "supported" ? Check : status === "limited" ? TriangleAlert : X;
  return (
    <span className={`format-status format-status-${status}`}>
      <Icon size={12} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function FormatList({ title, entries, level = 3 }: { title: string; entries: FormatEntry[]; level?: 3 | 4 }) {
  const Heading = level === 4 ? "h4" : "h3";
  return (
    <div className="format-list">
      <Heading>{title}</Heading>
      <ul>
        {entries.map((entry) => (
          <li key={entry.label}>
            <div className="format-row">
              <strong>{entry.label}</strong>
              <StatusBadge status={entry.status} />
            </div>
            {entry.note && <p>{entry.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TestedNote() {
  return (
    <p className="format-tested">
      Verified on {TESTED_SETUP.date} with real files in {TESTED_SETUP.browser}. {TESTED_SETUP.scope}
    </p>
  );
}

/** Supported formats, limits and behaviour for one tool, read from the central table. */
export function FormatCompat({ slug, toolName }: { slug: string; toolName: string }) {
  const compat = compatForTool(slug);
  if (!compat) return null;

  const facts: { label: string; value: string }[] = [
    { label: "Largest tested", value: compat.maxTested },
    { label: "Resolutions", value: compat.resolutions },
    { label: "Codecs", value: compat.codecs },
    ...(compat.audio ? [{ label: "Audio", value: compat.audio }] : []),
    ...(compat.transparency ? [{ label: "Transparency", value: compat.transparency }] : []),
    { label: "Metadata", value: compat.metadata },
    { label: "Browser", value: browserRequirement(slug) },
  ];

  return (
    <section className="format-compat" aria-labelledby="format-compat-heading">
      <span className="mono-label">Formats and limits</span>
      <h2 id="format-compat-heading">{toolName}: supported formats and limits</h2>
      <div className="format-lists">
        <FormatList title="Accepts" entries={compat.inputs} />
        <FormatList title="Produces" entries={compat.outputs} />
      </div>
      <dl className="format-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className="format-limits">
        <h3>Known limitations</h3>
        <ul>
          {compat.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <TestedNote />
    </section>
  );
}
