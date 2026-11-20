import type { CaptionStyle } from "../../lib/captioning/contracts";

/**
 * The caption looks. The same objects drive the live preview and are handed to the MP4
 * exporter, so what you see here is what is burned in. Colours are chosen to read on any picture:
 * light text, with a dark outline or a dark pill behind it. Numbers get their own colour, different
 * from the spoken word's, so the highlight that follows the voice is never confused with them.
 */
const FONT = '"Geist Variable", "Noto Sans Devanagari", "Nirmala UI", system-ui, -apple-system, "Segoe UI", sans-serif';

export const CAPTION_STYLES: Record<CaptionStyle["id"], CaptionStyle> = {
  clean: {
    id: "clean",
    fontFamily: FONT,
    fontScale: 0.05,
    textColor: "#ffffff",
    activeColor: "#ffd84d",
    numberColor: "#7ee0ff",
    background: "outline",
    position: "bottom",
  },
  shorts: {
    id: "shorts",
    fontFamily: FONT,
    fontScale: 0.07,
    textColor: "#ffffff",
    activeColor: "#3ddc97",
    numberColor: "#ffd84d",
    background: "outline",
    position: "middle",
  },
  bold: {
    id: "bold",
    fontFamily: FONT,
    fontScale: 0.055,
    textColor: "#ffffff",
    activeColor: "#ffb35c",
    numberColor: "#7ee0ff",
    background: "pill",
    position: "bottom",
  },
  karaoke: {
    id: "karaoke",
    fontFamily: FONT,
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
    fontFamily: FONT,
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
    fontFamily: FONT,
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

export const CAPTION_STYLE_ORDER: CaptionStyle["id"][] = ["clean", "shorts", "bold", "karaoke", "highlighter", "pop"];

export const CAPTION_STYLE_LABELS: Record<CaptionStyle["id"], { name: string; detail: string }> = {
  clean: { name: "Clean", detail: "Outlined, near the bottom" },
  shorts: { name: "Shorts", detail: "Large, in the middle" },
  bold: { name: "Bold", detail: "On a dark pill" },
  karaoke: { name: "Karaoke", detail: "Words light up as they are said" },
  highlighter: { name: "Highlighter", detail: "A box hops from word to word" },
  pop: { name: "Pop", detail: "Builds word by word" },
};
