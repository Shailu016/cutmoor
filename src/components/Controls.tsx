import type { ReactNode } from "react";

/** Small form pieces the editing tools share, so every tool uses the same markup and classes as the older ones. */

export function SettingsHead({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <div className="settings-head">
      <span className="mono-label">{label}</span>
      {hint !== undefined && hint !== null && <span className="settings-hint">{hint}</span>}
    </div>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: ReactNode;
  note?: string;
}

/** One choice out of a few, shown as joined buttons. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  wrap = false,
  disabled = false,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  wrap?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={wrap ? "segmented segmented-wrap" : "segmented"} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={value === option.value ? "segment active" : "segment"}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A row of small round choices, for numbers such as 0.5x or 15 fps. */
export function Chips<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={value === option.value ? "chip active" : "chip"}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="range-row">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <span className="range-value">{display ?? value}</span>
    </div>
  );
}

/** The big primary button at the bottom of every settings card. */
export function RunButton({
  working,
  idleLabel,
  workingLabel,
  disabled = false,
  onClick,
}: {
  working: boolean;
  idleLabel: string;
  workingLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="button button-primary button-block button-lg" type="button" onClick={onClick} disabled={disabled || working}>
      {working ? workingLabel : idleLabel}
    </button>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="field-error" id={id} role="alert">
      {children}
    </p>
  );
}
