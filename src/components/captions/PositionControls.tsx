import { useId, type CSSProperties } from "react";
import { AlignCenter, AlignLeft, AlignRight, Crosshair } from "lucide-react";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import { effectiveAnchor } from "../../lib/captioning/burn-in/position";
import { SAFE_AREA_PRESETS, type SafeAreaKey } from "./SafeAreaOverlay";

interface Props {
  style: CaptionStyle;
  onChange: (patch: Partial<CaptionStyle>) => void;
  /** Which safe-area guide the preview is showing, if any. */
  safeArea: SafeAreaKey | null;
  onSafeArea: (key: SafeAreaKey) => void;
}

const GRID: readonly { x: number; y: number; label: string }[] = [
  { x: 0, y: 0, label: "Top left" },
  { x: 0.5, y: 0, label: "Top centre" },
  { x: 1, y: 0, label: "Top right" },
  { x: 0, y: 0.5, label: "Middle left" },
  { x: 0.5, y: 0.5, label: "Centre" },
  { x: 1, y: 0.5, label: "Middle right" },
  { x: 0, y: 1, label: "Bottom left" },
  { x: 0.5, y: 1, label: "Bottom centre" },
  { x: 1, y: 1, label: "Bottom right" },
];

const ALIGNMENTS: readonly { value: NonNullable<CaptionStyle["align"]>; label: string; Icon: typeof AlignLeft }[] = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
];

const BUTTON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  minHeight: 30,
  padding: "4px 9px",
  // Long-hand border parts, so BUTTON_ON can change just the colour without React's shorthand/long-hand warning.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--panel-line, rgba(255, 255, 255, 0.16))",
  borderRadius: 7,
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const BUTTON_ON: CSSProperties = {
  ...BUTTON,
  borderColor: "var(--accent, #2d4bf0)",
  background: "var(--accent, #2d4bf0)",
  color: "#fff",
};

const LABEL: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 };
const SLIDER: CSSProperties = { width: "100%", margin: 0, accentColor: "var(--accent, #2d4bf0)", cursor: "pointer" };
const SMALL: CSSProperties = { fontSize: 11, color: "var(--panel-muted, #98a2b3)" };

/**
 * Position, alignment and safe-area controls for a caption style.
 *
 * The 3×3 grid sets the block's anchor inside the safe area; the two sliders give the same
 * anchors finer steps. `style` may leave the anchors out (the preset defaults), in which case
 * the grid and sliders show the effective position without writing it into the style until
 * the visitor changes something.
 */
export function PositionControls({ style, onChange, safeArea, onSafeArea }: Props) {
  const acrossId = useId();
  const heightId = useId();
  const anchor = effectiveAnchor(style);
  const align = style.align ?? "center";
  const selected = safeArea ? SAFE_AREA_PRESETS.find((preset) => preset.key === safeArea) : undefined;

  return (
    <div className="cap-position" style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--panel-text, #f3f5f8)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span className="mono-label">Position</span>
        <button
          type="button"
          style={{ ...BUTTON, minHeight: 26, padding: "3px 8px", fontSize: 11 }}
          onClick={() => onChange({ anchorX: 0.5, anchorY: style.position === "middle" ? 0.5 : 1, align: "center" })}
          title="Back to the preset's position and centred text"
        >
          <Crosshair size={13} aria-hidden="true" /> Reset
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div role="group" aria-label="Caption position" style={{ display: "grid", gridTemplateColumns: "repeat(3, 30px)", gap: 5 }}>
          {GRID.map((cell) => {
            const on = Math.abs(anchor.x - cell.x) < 0.005 && Math.abs(anchor.y - cell.y) < 0.005;
            return (
              <button
                key={cell.label}
                type="button"
                data-cell={`${cell.x},${cell.y}`}
                aria-label={cell.label}
                aria-pressed={on}
                title={cell.label}
                style={{
                  ...(on ? BUTTON_ON : BUTTON),
                  width: 30,
                  minHeight: 28,
                  padding: 0,
                  borderRadius: 6,
                }}
                onClick={() => onChange({ anchorX: cell.x, anchorY: cell.y })}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "#fff" : "currentColor", opacity: on ? 1 : 0.55 }}
                />
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 128 }}>
          <span style={SMALL}>Text alignment</span>
          <div role="group" aria-label="Text alignment" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {ALIGNMENTS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={align === value}
                style={{ ...(align === value ? BUTTON_ON : BUTTON), padding: "4px 7px" }}
                onClick={() => onChange({ align: value })}
                title={`Align text ${label.toLowerCase()}`}
              >
                <Icon size={14} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 7 }}>
        <label htmlFor={acrossId} style={LABEL}>
          <span>Across</span>
          <output htmlFor={acrossId} style={SMALL}>
            {Math.round(anchor.x * 100)}%
          </output>
        </label>
        <input
          id={acrossId}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={anchor.x}
          aria-label="Across"
          aria-valuetext={`${Math.round(anchor.x * 100)} percent from the left`}
          style={SLIDER}
          onChange={(event) => onChange({ anchorX: Number(event.target.value) })}
        />
        <label htmlFor={heightId} style={LABEL}>
          <span>Height</span>
          <output htmlFor={heightId} style={SMALL}>
            {Math.round(anchor.y * 100)}%
          </output>
        </label>
        <input
          id={heightId}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={anchor.y}
          aria-label="Height"
          aria-valuetext={`${Math.round(anchor.y * 100)} percent from the top`}
          style={SLIDER}
          onChange={(event) => onChange({ anchorY: Number(event.target.value) })}
        />
        <div style={{ ...SMALL, display: "flex", justifyContent: "space-between" }}>
          <span>Top</span>
          <span>Bottom</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={SMALL}>Safe area guide (approximate)</span>
        <div role="group" aria-label="Safe area guide" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {SAFE_AREA_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              data-safe-area-choice={preset.key}
              aria-pressed={safeArea === preset.key}
              style={{ ...(safeArea === preset.key ? BUTTON_ON : BUTTON), minHeight: 27, padding: "3px 8px", fontSize: 11 }}
              onClick={() => onSafeArea(preset.key)}
              title={`${preset.detail} Guide only; never burned in.`}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p style={{ ...SMALL, margin: 0 }}>
          {selected ? `${selected.name}: ${selected.detail}` : "Choose a platform to see the strips its app covers."} These guides are approximate and preview-only; nothing is burned into the video.
        </p>
      </div>
    </div>
  );
}
