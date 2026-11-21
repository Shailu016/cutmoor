import { useId, useState } from "react";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import type { CaptionScript } from "../../lib/captioning/translit";
import { AnimationPicker } from "./AnimationPicker";
import { LookControls } from "./LookControls";
import { PositionControls } from "./PositionControls";
import { SavedLooks } from "./SavedLooks";
import type { SafeAreaKey } from "./SafeAreaOverlay";
import { WordsControls } from "./WordsControls";

type TabId = "look" | "position" | "words" | "motion" | "mine";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "look", label: "Look" },
  { id: "position", label: "Position" },
  { id: "words", label: "Words" },
  { id: "motion", label: "Motion" },
  { id: "mine", label: "My looks" },
];

interface Props {
  /** The style on screen now: the preset plus the visitor's custom fields. */
  style: CaptionStyle;
  onChange: (patch: Partial<CaptionStyle>) => void;
  /** Applies a whole saved look (a preset plus its custom fields). */
  onApplyLook: (style: CaptionStyle) => void;
  safeArea: SafeAreaKey | null;
  onSafeArea: (key: SafeAreaKey) => void;
  wordsPerCaption: number | undefined;
  onWordsPerCaption: (value: number | undefined) => void;
  script: CaptionScript;
  onScript: (script: CaptionScript) => void;
  hasDevanagari: boolean;
}

/**
 * Everything the visitor can change about how the captions look, in one tabbed card under the
 * presets. The panels are the standalone controls; this file only arranges them. Nothing here
 * talks to a server: choices live in the page, and saved looks in this browser's localStorage.
 */
export function CustomizePanel({ style, onChange, onApplyLook, safeArea, onSafeArea, wordsPerCaption, onWordsPerCaption, script, onScript, hasDevanagari }: Props) {
  const [tab, setTab] = useState<TabId>("look");
  const base = useId();

  return (
    <div className="cap-section cap-customize">
      <span className="mono-label">Customize</span>
      <div role="tablist" aria-label="Caption customization" className="cap-tabs" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 10px" }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`${base}-panel-${item.id}`}
            className={tab === item.id ? "button button-primary" : "button button-ghost"}
            style={{ width: "auto", minHeight: 32, padding: "4px 12px", fontSize: 13 }} /* the panel makes buttons full width; tabs sit in a row */
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel-${tab}`} aria-labelledby={`${base}-tab-${tab}`}>
        {tab === "look" && <LookControls style={style} onChange={onChange} />}
        {tab === "position" && <PositionControls style={style} onChange={onChange} safeArea={safeArea} onSafeArea={onSafeArea} />}
        {tab === "words" && (
          <WordsControls
            wordsPerCaption={wordsPerCaption}
            onWordsPerCaption={onWordsPerCaption}
            script={script}
            onScript={onScript}
            hasDevanagari={hasDevanagari}
          />
        )}
        {tab === "motion" && (
          <AnimationPicker value={style.animation ?? "none"} ms={style.animationMs ?? 200} onChange={(animation, animationMs) => onChange({ animation, animationMs })} />
        )}
        {tab === "mine" && <SavedLooks current={style} onApply={onApplyLook} />}
      </div>
    </div>
  );
}
