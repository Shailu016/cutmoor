import { useState } from "react";
import { clamp } from "../lib/format";
import { isNumberDraft } from "../lib/number-input";

/** The "any size" choice beside the preset chips. It starts empty and keeps exactly what is typed. */
export function CustomSizeChip({
  value,
  unit,
  label,
  onChange,
}: {
  value: string;
  unit: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="chip chip-input">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="Custom"
        value={value}
        onChange={(event) => {
          if (isNumberDraft(event.target.value)) onChange(event.target.value);
        }}
        aria-label={label}
      />
      <span>{unit}</span>
    </label>
  );
}

/** A width or height. It can be cleared and retyped freely, and is held to its limits only on leaving the field. */
export function DimensionInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const typed = Number(event.target.value);
        if (event.target.value && typed >= min && typed <= max) onChange(typed);
      }}
      onBlur={() => {
        const typed = Number(text);
        const next = text && Number.isFinite(typed) ? clamp(Math.round(typed), min, max) : value;
        setText(String(next));
        onChange(next);
      }}
    />
  );
}
