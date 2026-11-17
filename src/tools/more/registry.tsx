import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";

/**
 * The editing tools added after the first set. Each loads only on its own page, so none of them adds to a
 * visitor's first download. `loaders` is the one list of which page shows which component.
 */
const loaders: Record<string, () => Promise<{ default: ComponentType }>> = {
  "mute-video": () => import("./MuteTool").then((m) => ({ default: m.MuteTool })),
  "rotate-video": () => import("./RotateVideoTool").then((m) => ({ default: m.RotateVideoTool })),
  "video-speed": () => import("./SpeedTool").then((m) => ({ default: m.SpeedTool })),
  "reverse-video": () => import("./ReverseTool").then((m) => ({ default: m.ReverseTool })),
  "loop-video": () => import("./LoopTool").then((m) => ({ default: m.LoopTool })),
  "gif-to-mp4": () => import("./GifToMp4Tool").then((m) => ({ default: m.GifToMp4Tool })),
  "compress-gif": () => import("./GifTool").then((m) => ({ default: () => <m.GifTool mode="compress" /> })),
  "resize-gif": () => import("./GifTool").then((m) => ({ default: () => <m.GifTool mode="resize" /> })),
  "merge-videos": () => import("./MergeTool").then((m) => ({ default: m.MergeTool })),
  "watermark-video": () => import("./WatermarkVideoTool").then((m) => ({ default: m.WatermarkVideoTool })),
  "add-audio-to-video": () => import("./AddAudioTool").then((m) => ({ default: m.AddAudioTool })),
  "slideshow-maker": () => import("./SlideshowTool").then((m) => ({ default: m.SlideshowTool })),
  "crop-image": () => import("./CropImageTool").then((m) => ({ default: m.CropImageTool })),
  "rotate-image": () => import("./RotateImageTool").then((m) => ({ default: m.RotateImageTool })),
  "remove-photo-metadata": () => import("./RemoveMetadataTool").then((m) => ({ default: m.RemoveMetadataTool })),
  "blur-image": () => import("./BlurImageTool").then((m) => ({ default: m.BlurImageTool })),
  "watermark-image": () => import("./WatermarkImageTool").then((m) => ({ default: m.WatermarkImageTool })),
  "remove-background": () => import("./RemoveBackgroundTool").then((m) => ({ default: m.RemoveBackgroundTool })),
  "upscale-image": () => import("./UpscaleTool").then((m) => ({ default: m.UpscaleTool })),
  "webp-to-jpg": () => import("./FormatPages").then((m) => ({ default: m.WebpToJpg })),
  "png-to-jpg": () => import("./FormatPages").then((m) => ({ default: m.PngToJpg })),
  "jpg-to-png": () => import("./FormatPages").then((m) => ({ default: m.JpgToPng })),
  "svg-to-png": () => import("./FormatPages").then((m) => ({ default: m.SvgToPng })),
  "avif-to-jpg": () => import("./FormatPages").then((m) => ({ default: m.AvifToJpg })),
};

const components = new Map<string, ComponentType>();

export function hasMoreTool(slug: string): boolean {
  return slug in loaders;
}

/**
 * Prerendering and hydration both show the placeholder (a lazy component cannot render on the server), so the
 * server and the first browser render agree. The placeholder keeps the page the same height until the tool arrives.
 */
export function MoreTool({ slug }: { slug: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const fallback = (
    <div className="tool-loading" style={{ minHeight: 640 }} role="status" aria-live="polite">
      Loading the tool…
    </div>
  );
  const load = loaders[slug];
  if (!load || !ready) return fallback;
  let Component = components.get(slug);
  if (!Component) {
    Component = lazy(load);
    components.set(slug, Component);
  }
  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  );
}
