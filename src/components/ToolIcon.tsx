import {
  AudioLines,
  Blend,
  Captions,
  Crop,
  EyeOff,
  FastForward,
  Film,
  FlipHorizontal2,
  Gauge,
  Image,
  Images,
  Merge,
  Minimize2,
  Music,
  RefreshCw,
  Repeat,
  Rewind,
  RotateCw,
  Scaling,
  Scissors,

  Smartphone,
  Stamp,
  VolumeX,
} from "lucide-react";
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
  mute: VolumeX,
  rotate: RotateCw,
  speed: FastForward,
  reverse: Rewind,
  loop: Repeat,
  gif: Film,
  merge: Merge,
  watermark: Stamp,
  "add-audio": Music,
  slideshow: Images,
  "image-crop": Crop,
  "image-rotate": FlipHorizontal2,
  privacy: EyeOff,
  blur: Blend,
  "image-watermark": Stamp,
};


export function ToolIcon({ icon, size = 20 }: { icon: ToolDef["icon"]; size?: number }) {
  const Icon = ICONS[icon];
  return <Icon size={size} strokeWidth={1.8} />;
}
