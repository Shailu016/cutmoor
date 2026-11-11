import { AudioLines, Captions, Crop, Gauge, Image, Minimize2, RefreshCw, Scaling, Scissors, Smartphone } from "lucide-react";
import type { ToolDef } from "../lib/tools";

const ICONS = {
  compress: Gauge,
  crop: Crop,
  trim: Scissors,
  convert: RefreshCw,
  audio: AudioLines,
  frame: Image,
  captions: Captions,
  "image-compress": Minimize2,
  "image-resize": Scaling,
  "image-convert": RefreshCw,
  heic: Smartphone,
};

export function ToolIcon({ icon, size = 20 }: { icon: ToolDef["icon"]; size?: number }) {
  const Icon = ICONS[icon];
  return <Icon size={size} strokeWidth={1.8} />;
}
