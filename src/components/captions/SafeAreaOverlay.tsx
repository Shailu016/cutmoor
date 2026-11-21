import type { CSSProperties } from "react";

/**
 * Approximate platform safe areas, as guides only.
 *
 * These are the strips the app itself covers with its own buttons, captions and progress
 * bars. The numbers are rough fractions of the picture (top/bottom of the height, sides of
 * the width) taken from the platforms' published layouts; they change with app versions and
 * devices, so the overlay always says "approximate". Nothing here is burned into the video:
 * the visitor places the caption with anchors, and the guide only shows where it may be safe.
 */
export type SafeAreaKey = "instagram-reels" | "instagram-stories" | "youtube-shorts" | "tiktok";

export interface SafeAreaPreset {
  key: SafeAreaKey;
  name: string;
  /** Fraction of the frame height covered at the top. */
  top: number;
  /** Fraction of the frame height covered at the bottom. */
  bottom: number;
  /** Fraction of the frame width covered at each side. */
  side: number;
  /** One sentence explaining what the app puts there. */
  detail: string;
}

export const SAFE_AREA_PRESETS: readonly SafeAreaPreset[] = [
  {
    key: "instagram-stories",
    name: "Instagram Stories",
    top: 0.13,
    bottom: 0.16,
    side: 0.05,
    detail: "Progress and profile at the top; the reply bar and send buttons at the bottom.",
  },
  {
    key: "instagram-reels",
    name: "Instagram Reels",
    top: 0.08,
    bottom: 0.18,
    side: 0.05,
    detail: "Top tabs and the caption, audio and action buttons down the right and bottom.",
  },
  {
    key: "youtube-shorts",
    name: "YouTube Shorts",
    top: 0.06,
    bottom: 0.18,
    side: 0.05,
    detail: "Shorts header at the top; the title, channel and action bar at the bottom.",
  },
  {
    key: "tiktok",
    name: "TikTok",
    top: 0.1,
    bottom: 0.2,
    side: 0.05,
    detail: "Following/For You tabs at the top; the caption, music and action buttons at the bottom.",
  },
];

export function findSafeArea(key: SafeAreaKey): SafeAreaPreset {
  return SAFE_AREA_PRESETS.find((preset) => preset.key === key) ?? SAFE_AREA_PRESETS[0];
}

export interface PictureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  /** Which guide to draw, or null for none. */
  safeArea: SafeAreaKey | null;
  /** Where the video picture sits inside the preview stage, in CSS pixels. */
  picture: PictureBox;
}

const UNSAFE: CSSProperties = {
  position: "absolute",
  background: "rgba(255, 82, 104, 0.16)",
  borderColor: "rgba(255, 125, 143, 0.55)",
  borderStyle: "dashed",
  // Per-side widths only: React warns when a shorthand `borderWidth` is mixed with `borderBottomWidth` and the like.
  borderTopWidth: 0,
  borderRightWidth: 0,
  borderBottomWidth: 0,
  borderLeftWidth: 0,
  pointerEvents: "none",
};

/**
 * Shades the strips a phone app covers and outlines the remaining safe area. Preview only:
 * it is rendered beside the caption, never handed to the exporter.
 */
export function SafeAreaOverlay({ safeArea, picture }: Props) {
  if (!safeArea || !(picture.width > 0) || !(picture.height > 0)) return null;
  const preset = findSafeArea(safeArea);
  const top = preset.top * 100;
  const bottom = preset.bottom * 100;
  const side = preset.side * 100;

  return (
    <div
      className="cap-safe-area"
      data-safe-area={preset.key}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: picture.x,
        top: picture.y,
        width: picture.width,
        height: picture.height,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <div style={{ ...UNSAFE, left: 0, right: 0, top: 0, height: `${top}%`, borderBottomWidth: 1 }} />
      <div style={{ ...UNSAFE, left: 0, right: 0, bottom: 0, height: `${bottom}%`, borderTopWidth: 1 }} />
      <div style={{ ...UNSAFE, left: 0, top: `${top}%`, bottom: `${bottom}%`, width: `${side}%`, borderRightWidth: 1 }} />
      <div style={{ ...UNSAFE, right: 0, top: `${top}%`, bottom: `${bottom}%`, width: `${side}%`, borderLeftWidth: 1 }} />
      <div
        data-safe-area-box="true"
        style={{
          position: "absolute",
          left: `${side}%`,
          right: `${side}%`,
          top: `${top}%`,
          bottom: `${bottom}%`,
          border: "1px dashed rgba(255, 255, 255, 0.65)",
          borderRadius: 4,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: `${side}%`,
          top: `calc(${top}% + 6px)`,
          maxWidth: `calc(${100 - 2 * side}% - 12px)`,
          padding: "2px 6px",
          borderRadius: 4,
          background: "rgba(5, 7, 12, 0.68)",
          color: "#f3f5f8",
          fontSize: 11,
          lineHeight: 1.35,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {preset.name} · approximate
      </span>
    </div>
  );
}
