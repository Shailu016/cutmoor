import type { CaptionStyle } from "../contracts";

/**
 * Starting styles for the presets named in contracts.ts. The UI may tweak them; the exporter
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
  karaoke: {
    id: "karaoke",
    fontFamily: '"Geist Variable"',
    fontScale: 0.05,
    fontWeight: 650,
    textColor: "#ffffff",
    upcomingColor: "#9aa2b1",
    activeColor: "#ffffff",
    numberColor: "#ffd84d",
    background: "pill",
    position: "bottom",
  },
  highlighter: {
    id: "highlighter",
    fontFamily: '"Geist Variable"',
    fontScale: 0.062,
    fontWeight: 800,
    uppercase: true,
    textColor: "#ffffff",
    activeColor: "#10140a",
    activeBox: "#c6f432",
    numberColor: "#c6f432",
    background: "outline",
    position: "middle",
  },
  pop: {
    id: "pop",
    fontFamily: '"Geist Variable"',
    fontScale: 0.072,
    fontWeight: 800,
    uppercase: true,
    reveal: "spoken",
    textColor: "#ffffff",
    activeColor: "#ffd84d",
    numberColor: "#7ee0ff",
    background: "outline",
    position: "middle",
  },
};
