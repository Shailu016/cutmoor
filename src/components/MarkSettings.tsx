import { useEffect, useRef, useState } from "react";
import { releaseBlobUrl } from "../lib/blob-url";
import { imageToPngBlob, renderTextMark } from "../lib/watermark";
import type { WatermarkPosition } from "../lib/video-edit-args";
import { Chips, RangeField, Segmented, SettingsHead } from "./Controls";

export interface MarkState {
  mode: "text" | "logo";
  text: string;
  color: string;
  bold: boolean;
  outline: boolean;
  logo: File | null;
  position: WatermarkPosition;
  /** Mark width as a share of the picture width, percent. */
  size: number;
  /** Percent, 5 to 100. */
  opacity: number;
}

export const DEFAULT_MARK: MarkState = {
  mode: "text",
  text: "cutmoor.com",
  color: "#ffffff",
  bold: true,
  outline: true,
  logo: null,
  position: "bottom-right",
  size: 22,
  opacity: 80,
};

/** The margin around a mark, as a share of the picture width. The preview and the encoder use the same number. */
export const MARK_MARGIN_PERCENT = 2;

const POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "center", label: "Centre" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

/** Keeps the mark as a PNG and its preview URL up to date as the settings change. */
export function useMarkImage(state: MarkState): { blob: Blob | null; url: string | null; error: string | null } {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = state.mode === "text" ? (state.text.trim() ? await renderTextMark(state) : null) : state.logo ? await imageToPngBlob(state.logo) : null;
        if (cancelled) return;
        if (urlRef.current) releaseBlobUrl(urlRef.current);
        urlRef.current = next ? URL.createObjectURL(next) : null;
        setBlob(next);
        setUrl(urlRef.current);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setBlob(null);
        setUrl(null);
        setError(cause instanceof Error ? cause.message : "The watermark could not be prepared.");
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state.mode, state.text, state.color, state.bold, state.outline, state.logo]);

  useEffect(
    () => () => {
      if (urlRef.current) releaseBlobUrl(urlRef.current);
    },
    [],
  );

  return { blob, url, error };
}

const ALIGN: Record<WatermarkPosition, { alignItems: string; justifyContent: string }> = {
  "top-left": { alignItems: "flex-start", justifyContent: "flex-start" },
  "top-right": { alignItems: "flex-start", justifyContent: "flex-end" },
  "bottom-left": { alignItems: "flex-end", justifyContent: "flex-start" },
  "bottom-right": { alignItems: "flex-end", justifyContent: "flex-end" },
  center: { alignItems: "center", justifyContent: "center" },
};

/** A picture or paused video with the mark drawn on top where the encoder will put it. */
export function MarkPreview({ base, kind, markUrl, state }: { base: string; kind: "video" | "image"; markUrl: string | null; state: MarkState }) {
  const content = 100 - MARK_MARGIN_PERCENT * 2;
  return (
    <div className="mark-preview" role="group" aria-label="Preview of the watermark position">
      {kind === "video" ? <video src={`${base}#t=0.1`} muted playsInline preload="metadata" /> : <img className="mark-base" src={base} alt="Your picture, with the watermark previewed on it" />}
      {markUrl && (
        <div
          style={{ position: "absolute", inset: 0, padding: `${MARK_MARGIN_PERCENT}%`, display: "flex", pointerEvents: "none", ...ALIGN[state.position] }}
          aria-hidden="true"
        >
          <img className="mark-overlay" src={markUrl} alt="" style={{ width: `${(state.size / content) * 100}%`, opacity: state.opacity / 100 }} />
        </div>
      )}
    </div>
  );
}

/** The controls shared by the video and picture watermark tools. */
export function MarkSettings({ state, onChange, disabled, error }: { state: MarkState; onChange: (next: MarkState) => void; disabled: boolean; error: string | null }) {
  const set = <K extends keyof MarkState>(key: K, value: MarkState[K]) => onChange({ ...state, [key]: value });
  return (
    <>
      <SettingsHead label="01 · What to stamp" />
      <Segmented
        label="Watermark type"
        value={state.mode}
        disabled={disabled}
        onChange={(mode) => set("mode", mode)}
        options={[
          { value: "text", label: "Text" },
          { value: "logo", label: "Logo or picture" },
        ]}
      />
      {state.mode === "text" ? (
        <div className="field-row">
          <label htmlFor="mark-text">Text (up to 4 lines)</label>
          <textarea id="mark-text" rows={2} maxLength={120} value={state.text} disabled={disabled} onChange={(event) => set("text", event.target.value)} />
          <div className="chips">
            <label className="check-row">
              Colour
              <input type="color" value={state.color} disabled={disabled} onChange={(event) => set("color", event.target.value)} aria-label="Text colour" />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={state.bold} disabled={disabled} onChange={(event) => set("bold", event.target.checked)} /> Bold
            </label>
            <label className="check-row">
              <input type="checkbox" checked={state.outline} disabled={disabled} onChange={(event) => set("outline", event.target.checked)} /> Outline
            </label>
          </div>
        </div>
      ) : (
        <div className="field-row">
          <label htmlFor="mark-logo">Logo file (PNG with a clear background works best)</label>
          <input
            id="mark-logo"
            type="file"
            accept="image/*"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              set("logo", file);
              event.target.value = "";
            }}
          />
          {state.logo && <small className="settings-hint">{state.logo.name}</small>}
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <SettingsHead label="02 · Where" />
      <Chips label="Position" value={state.position} options={POSITIONS} onChange={(position) => set("position", position)} disabled={disabled} />
      <SettingsHead label="03 · Size" hint={`${state.size}% of the width`} />
      <RangeField label="Watermark size" value={state.size} min={5} max={60} display={`${state.size}%`} onChange={(size) => set("size", size)} disabled={disabled} />
      <SettingsHead label="04 · See-through" hint={`${state.opacity}% visible`} />
      <RangeField label="Watermark opacity" value={state.opacity} min={10} max={100} step={5} display={`${state.opacity}%`} onChange={(opacity) => set("opacity", opacity)} disabled={disabled} />
    </>
  );
}
