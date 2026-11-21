import { useId } from "react";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import { CAPTION_FONTS, preloadCaptionFont } from "../../lib/captioning/burn-in/font-catalog";
import { PRESET_OUTLINE_WIDTH } from "../../lib/captioning/burn-in/look";

/**
 * The custom look editor. Standalone and typed so the lead can drop it into the output panel
 * without this file knowing about the job: every control sends a `Partial<CaptionStyle>` patch.
 *
 * All the fields are optional by contract, so "off" is expressed by the value that means off
 * (`outlineWidth: 0`, `shadow: 0`, `boxOpacity: 0`) rather than by removing a key. "Reset look"
 * re-adds `undefined` for every field this panel owns, which returns the preset exactly.
 *
 * Accessibility: native select/range/checkbox/colour inputs, a visible label each, 44 px rows, and
 * a single-column layout below 520 px (the panel is narrow inside the tool's side column).
 */

interface Props {
  style: CaptionStyle;
  onChange(patch: Partial<CaptionStyle>): void;
}

const DEFAULT_SHADOW = 0.5;
const DEFAULT_BOX_OPACITY = 0.66;

/** `input[type=color]` only accepts #rrggbb; presets use that, but a stack or named colour needs a fallback. */
function hexFor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function LookControls({ style, onChange }: Props) {
  const id = useId();
  const controlId = (name: string) => `${id}-${name}`;

  const size = style.sizeMul ?? 1;
  const outlineOn = style.outlineWidth !== undefined ? style.outlineWidth > 0 : style.background === "outline";
  const outlineValue = style.outlineWidth ?? PRESET_OUTLINE_WIDTH;
  const shadowOn = style.shadow !== undefined ? style.shadow > 0 : style.background === "none";
  const shadowValue = style.shadow ?? DEFAULT_SHADOW;
  const boxOn = style.boxOpacity !== undefined ? style.boxOpacity > 0 : style.background === "pill" || Boolean(style.boxColor);
  const boxValue = style.boxOpacity ?? DEFAULT_BOX_OPACITY;
  const uppercase = style.uppercase ?? false;

  const fontOption = style.fontKey ?? "";

  return (
    <div className="cap-look">
      <div className="cap-look-head">
        <span className="mono-label">Custom look</span>
        <button
          type="button"
          className="cap-look-reset"
          onClick={() =>
            onChange({
              fontKey: undefined,
              sizeMul: undefined,
              outlineWidth: undefined,
              outlineColor: undefined,
              shadow: undefined,
              shadowColor: undefined,
              boxOpacity: undefined,
              boxColor: undefined,
              textColor: undefined,
              activeColor: undefined,
              uppercase: undefined,
            })
          }
        >
          Reset look
        </button>
      </div>

      <div className="cap-look-field">
        <label htmlFor={controlId("font")}>Font</label>
        <select
          id={controlId("font")}
          value={fontOption}
          onChange={(event) => {
            const key = event.currentTarget.value;
            onChange({ fontKey: key === "" ? undefined : key });
            // Load the CSS chunk now, so the preview switches straight away and an export later
            // does not have to wait. Unknown keys simply keep the preset font.
            if (key !== "") void preloadCaptionFont(key);
          }}
        >
          <option value="">Preset font</option>
          {CAPTION_FONTS.map((font) => (
            <option key={font.key} value={font.key}>
              {font.label}
            </option>
          ))}
        </select>
      </div>

      <div className="cap-look-field">
        <div className="cap-look-label-row">
          <label htmlFor={controlId("size")}>Text size</label>
          <output htmlFor={controlId("size")} className="cap-look-value">
            {percent(size)}
          </output>
        </div>
        <input
          id={controlId("size")}
          type="range"
          min={50}
          max={200}
          step={5}
          value={Math.round(size * 100)}
          aria-valuetext={percent(size)}
          onChange={(event) => onChange({ sizeMul: Number(event.currentTarget.value) / 100 })}
        />
      </div>

      <div className="cap-look-colors">
        <div className="cap-look-field cap-look-color">
          <label htmlFor={controlId("text-color")}>Text colour</label>
          <input
            id={controlId("text-color")}
            type="color"
            value={hexFor(style.textColor, "#ffffff")}
            onChange={(event) => onChange({ textColor: event.currentTarget.value })}
          />
        </div>
        <div className="cap-look-field cap-look-color">
          <label htmlFor={controlId("active-color")}>Highlight colour</label>
          <input
            id={controlId("active-color")}
            type="color"
            value={hexFor(style.activeColor, "#ffffff")}
            onChange={(event) => onChange({ activeColor: event.currentTarget.value })}
          />
        </div>
      </div>

      <div className="cap-look-field">
        <div className="cap-look-label-row">
          <label htmlFor={controlId("outline")}>Outline</label>
          <input
            id={controlId("outline")}
            className="cap-look-switch"
            type="checkbox"
            checked={outlineOn}
            onChange={(event) =>
              onChange({ outlineWidth: event.currentTarget.checked ? (outlineValue > 0 ? outlineValue : PRESET_OUTLINE_WIDTH) : 0 })
            }
          />
        </div>
        <div className="cap-look-label-row">
          <label htmlFor={controlId("outline-width")}>Outline thickness</label>
          <output htmlFor={controlId("outline-width")} className="cap-look-value">
            {percent(outlineValue)}
          </output>
        </div>
        <input
          id={controlId("outline-width")}
          type="range"
          // The slider stops at 1%: a value of 0 would switch the effect off and disable this very slider
          // mid-drag. The checkbox above is how it is turned off.
          min={1}
          max={30}
          step={1}
          value={Math.round(outlineValue * 100)}
          disabled={!outlineOn}
          aria-valuetext={percent(outlineValue)}
          onChange={(event) => onChange({ outlineWidth: Number(event.currentTarget.value) / 100 })}
        />
        <div className="cap-look-label-row">
          <label htmlFor={controlId("outline-color")}>Outline colour</label>
          <input
            id={controlId("outline-color")}
            className="cap-look-swatch"
            type="color"
            value={hexFor(style.outlineColor, "#000000")}
            onChange={(event) =>
              onChange({ outlineColor: event.currentTarget.value, ...(outlineOn ? {} : { outlineWidth: PRESET_OUTLINE_WIDTH }) })
            }
          />
        </div>
      </div>

      <div className="cap-look-field">
        <div className="cap-look-label-row">
          <label htmlFor={controlId("shadow")}>Shadow</label>
          <input
            id={controlId("shadow")}
            className="cap-look-switch"
            type="checkbox"
            checked={shadowOn}
            onChange={(event) => onChange({ shadow: event.currentTarget.checked ? (shadowValue > 0 ? shadowValue : DEFAULT_SHADOW) : 0 })}
          />
        </div>
        <div className="cap-look-label-row">
          <label htmlFor={controlId("shadow-strength")}>Shadow strength</label>
          <output htmlFor={controlId("shadow-strength")} className="cap-look-value">
            {percent(shadowValue)}
          </output>
        </div>
        <input
          id={controlId("shadow-strength")}
          type="range"
          min={5}
          max={100}
          step={5}
          value={Math.round(shadowValue * 100)}
          disabled={!shadowOn}
          aria-valuetext={percent(shadowValue)}
          onChange={(event) => onChange({ shadow: Number(event.currentTarget.value) / 100 })}
        />
        <div className="cap-look-label-row">
          <label htmlFor={controlId("shadow-color")}>Shadow colour</label>
          <input
            id={controlId("shadow-color")}
            className="cap-look-swatch"
            type="color"
            value={hexFor(style.shadowColor, "#000000")}
            onChange={(event) =>
              onChange({ shadowColor: event.currentTarget.value, ...(shadowOn ? {} : { shadow: DEFAULT_SHADOW }) })
            }
          />
        </div>
      </div>

      <div className="cap-look-field">
        <div className="cap-look-label-row">
          <label htmlFor={controlId("box")}>Box behind text</label>
          <input
            id={controlId("box")}
            className="cap-look-switch"
            type="checkbox"
            checked={boxOn}
            onChange={(event) =>
              onChange({ boxOpacity: event.currentTarget.checked ? (boxValue > 0 ? boxValue : DEFAULT_BOX_OPACITY) : 0 })
            }
          />
        </div>
        <div className="cap-look-label-row">
          <label htmlFor={controlId("box-opacity")}>Box opacity</label>
          <output htmlFor={controlId("box-opacity")} className="cap-look-value">
            {percent(boxValue)}
          </output>
        </div>
        <input
          id={controlId("box-opacity")}
          type="range"
          min={5}
          max={100}
          step={5}
          value={Math.round(boxValue * 100)}
          disabled={!boxOn}
          aria-valuetext={percent(boxValue)}
          onChange={(event) => onChange({ boxOpacity: Number(event.currentTarget.value) / 100 })}
        />
        <div className="cap-look-label-row">
          <label htmlFor={controlId("box-color")}>Box colour</label>
          <input
            id={controlId("box-color")}
            className="cap-look-swatch"
            type="color"
            value={hexFor(style.boxColor, "#000000")}
            onChange={(event) =>
              onChange({ boxColor: event.currentTarget.value, ...(boxOn ? {} : { boxOpacity: DEFAULT_BOX_OPACITY }) })
            }
          />
        </div>
      </div>

      <label className="cap-look-check" htmlFor={controlId("uppercase")}>
        <input
          id={controlId("uppercase")}
          type="checkbox"
          checked={uppercase}
          onChange={(event) => onChange({ uppercase: event.currentTarget.checked })}
        />
        <span>All capitals</span>
      </label>
    </div>
  );
}
