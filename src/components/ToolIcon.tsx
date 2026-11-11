import { AudioLines, Captions, Crop, Gauge, Image, RefreshCw, Scissors } from "lucide-react";
import type { ToolDef } from "../lib/tools";

const ICONS = {
  compress: Gauge,
  crop: Crop,
  trim: Scissors,
  convert: RefreshCw,
  audio: AudioLines,
  frame: Image,
  captions: Captions,
};

export function ToolIcon({ icon, size = 20 }: { icon: ToolDef["icon"]; size?: number }) {
  const Icon = ICONS[icon];
  return <Icon size={size} strokeWidth={1.8} />;
}
