import type { CaptionStyle } from "../../lib/captioning/contracts";

/**
 * The three caption looks. The same objects drive the live preview and are handed to the MP4
 * exporter, so what you see here is what is burned in. Colours are chosen to read on any picture:
 * light text, with a dark outline or a dark pill behind it.
 */
const FONT = '"Geist Variable", "Noto Sans Devanagari", "Nirmala UI", system-ui, -apple-system, "Segoe UI", sans-serif';

export const CAPTION_STYLES: Record<CaptionStyle["id"], CaptionStyle> = {
  clean: {
    id: "clean",
    fontFamily: FONT,
    fontScale: 0.05,
    textColor: "#ffffff",
    activeColor: "#ffd84d",
    background: "outline",
    position: "bottom",
  },
  shorts: {
    id: "shorts",
    fontFamily: FONT,
    fontScale: 0.07,
    textColor: "#ffffff",
    activeColor: "#3ddc97",
    background: "outline",
    position: "middle",
  },
  bold: {
    id: "bold",
    fontFamily: FONT,
    fontScale: 0.055,
    textColor: "#ffffff",
    activeColor: "#ffb35c",
    background: "pill",
    position: "bottom",
  },
};

export const CAPTION_STYLE_ORDER: CaptionStyle["id"][] = ["clean", "shorts", "bold"];

export const CAPTION_STYLE_LABELS: Record<CaptionStyle["id"], { name: string; detail: string }> = {
  clean: { name: "Clean", detail: "Outlined, near the bottom" },
  shorts: { name: "Shorts", detail: "Large, in the middle" },
  bold: { name: "Bold", detail: "On a dark pill" },
};
