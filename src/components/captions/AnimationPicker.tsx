import { useEffect, useRef } from "react";
import {
  ANIMATION_OPTIONS,
  animationDurationMs,
  animationFrame,
  animationText,
  isAnimationName,
  type AnimationFrame,
  type AnimationOption,
} from "../../lib/captioning/burn-in/animations";
import { usePrefersReducedMotion } from "../../hooks/useMotionPrefs";

interface Props {
  /** An animation id from ANIMATION_IDS. An unknown value shows and previews as "none". */
  value: string;
  ms: number;
  onChange(animation: string, ms: number): void;
}

/**
 * Task D: the entry-animation chooser. Each chip runs the same pure frame function the export
 * uses, looping a short demo, so the chip is a true preview and not a CSS imitation. With
 * `prefers-reduced-motion` the demos stay on the final frame; the exported video still animates
 * because the visitor asked for that animation explicitly (the preference is honoured in the
 * preview only, as the brief requires).
 */
export function AnimationPicker({ value, ms, onChange }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const selected = isAnimationName(value) ? value : "none";
  const duration = animationDurationMs(ms);
  // The slider has a usable range; the stored value may be outside it from another control.
  const shown = Math.min(1500, Math.max(100, duration));

  return (
    <div className="cap-section" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="mono-label" id="cap-animation-label">
        Animation
      </span>
      <div
        role="group"
        aria-labelledby="cap-animation-label"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(66px, 1fr))", gap: 6 }}
      >
        {ANIMATION_OPTIONS.map((option) => (
          <AnimationChip
            key={option.id}
            option={option}
            ms={duration}
            selected={option.id === selected}
            reducedMotion={reducedMotion}
            onSelect={() => onChange(option.id, duration)}
          />
        ))}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ flex: "none" }}>Length</span>
        <input
          type="range"
          min={100}
          max={1500}
          step={50}
          value={shown}
          disabled={selected === "none"}
          aria-label="Animation length in milliseconds"
          onChange={(event) => onChange(selected, Number(event.target.value))}
          style={{ flex: 1, minWidth: 0, accentColor: "var(--accent)" }}
        />
        <span style={{ flex: "none", minWidth: 58, textAlign: "right", fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>{shown} ms</span>
      </label>
      {reducedMotion && (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.7 }}>
          Your system asks for less motion, so these previews stay still. The video you export still uses the animation you pick.
        </p>
      )}
    </div>
  );
}

interface ChipProps {
  option: AnimationOption;
  ms: number;
  selected: boolean;
  reducedMotion: boolean;
  onSelect(): void;
}

/**
 * One chip. The loop is driven straight into the span's style (not React state) so eight chips
 * do not re-render the component sixty times a second while the picker is open.
 */
function AnimationChip({ option, ms, selected, reducedMotion, onSelect }: ChipProps) {
  const demoRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = demoRef.current;
    const show = (frame: AnimationFrame) => {
      if (!element) return;
      element.textContent = animationText("Aa", 0, frame) || "\u00a0";
      element.style.opacity = String(frame.opacity);
      element.style.transform = `translate(${frame.dx}em, ${frame.dy}em) scale(${frame.scale})`;
    };
    if (reducedMotion || option.id === "none" || typeof requestAnimationFrame !== "function") {
      show(animationFrame(option.id, 1, 2));
      return;
    }

    const now = () => (typeof performance !== "undefined" ? performance.now() : 0);
    const started = now();
    // A short animation, then a long hold so the eye can rest before the next loop.
    const cycle = Math.max(1, ms) + 900;
    let raf = 0;
    const tick = () => {
      const local = (now() - started) % cycle;
      show(animationFrame(option.id, Math.min(1, local / Math.max(1, ms)), 2));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [option.id, ms, reducedMotion]);

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={option.description}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        minHeight: 58,
        padding: "6px 4px",
        border: selected ? "1px solid var(--accent)" : "1px solid rgba(128, 128, 128, 0.45)",
        borderRadius: 8,
        background: selected ? "var(--accent-soft)" : "transparent",
        color: "inherit",
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      <span
        ref={demoRef}
        aria-hidden="true"
        style={{ display: "inline-block", minHeight: "1.25em", fontSize: 15, fontWeight: 800, lineHeight: 1.1, transformOrigin: "center" }}
      >
        Aa
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, opacity: 0.85 }}>{option.label}</span>
    </button>
  );
}
