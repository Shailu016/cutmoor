import type { CaptionStyle } from "../contracts";

/**
 * Starting styles for the three presets named in contracts.ts. The UI may tweak them; the exporter
 * accepts any CaptionStyle. Geist Variable is the site font and is loaded by the page's CSS.
 */
export const CAPTION_STYLES: Readonly<Record<CaptionStyle["id"], CaptionStyle>> = {
  clean: {
    id: "clean",
    fontFamily: '"Geist Variable"',
    fontScale: 0.045,
    textColor: "#ffffff",
    activeColor: "#ffd84a",
    background: "pill",
    position: "bottom",
  },
  shorts: {
    id: "shorts",
    fontFamily: '"Geist Variable"',
    fontScale: 0.06,
    textColor: "#ffffff",
    activeColor: "#39e58c",
    background: "outline",
    position: "middle",
  },
  bold: {
    id: "bold",
    fontFamily: '"Geist Variable"',
    fontScale: 0.055,
    textColor: "#ffffff",
    activeColor: "#ff4d6d",
    background: "none",
    position: "bottom",
  },
};
