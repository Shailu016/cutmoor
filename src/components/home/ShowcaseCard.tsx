import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { CARD_ART, type CardArtEntry } from "../../lib/card-art.generated";
import { extensionOf } from "../../lib/format";
import { loadStickScenes } from "../../lib/stick-scenes";
import type { ToolDef } from "../../lib/tools";
import { useNearScreen } from "../../hooks/useNearScreen";
import { Link } from "../Link";

/**
 * A home-page tool card with a small hand-drawn scene: a stick figure does the tool's job once when the card scrolls
 * into view (public/stick/scenes.js, drawn with the MIT-licensed stick-scene runtime). Hovering the card plays it again.
 * The sentence under it still comes from the real run of the tool (scripts/make-card-art.mjs).
 */

const seconds = (value: number) => `${value.toFixed(1)} s`;
const ratio = (w: number, h: number) => {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
};

/** One plain sentence that says what changed. Sizes, lengths and shapes are read from the real files. */
export function caption(slug: string, art: CardArtEntry): string {
  const saved = art.beforeBytes > 0 ? Math.round((1 - art.afterBytes / art.beforeBytes) * 100) : 0;
  const b = art.before, a = art.after;
  switch (slug) {
    case "compress":
    case "compress-image":
      return `Looks the same. ${saved}% smaller.`;
    case "auto-captions":
      return "Captions that light up word by word. Sample text.";
    case "convert-image":
      return `PNG to ${extensionOf(art.name).toUpperCase()}. ${saved}% smaller.`;
    case "resize":
      return `Wide to vertical ${ratio(a.w, a.h)}. The walker stays in frame.`;
    case "resize-image":
      return `${b.w}×${b.h} to a ${a.w}×${a.h} square post.`;
    case "crop-image":
      return `Cropped to a square around the bottle.`;
    case "rotate-video":
      return `A sideways phone clip, turned upright.`;
    case "trim":
      return `Slate cut off: ${seconds(b.duration ?? 0)} to ${seconds(a.duration ?? 0)}.`;
    case "video-speed":
      return `Twice as fast: ${seconds(b.duration ?? 0)} to ${seconds(a.duration ?? 0)}.`;
    case "blur-image":
      return `The number plate, pixelated.`;
    case "watermark-image":
      return `Your name, stamped in the corner.`;
    default:
      return "";
  }
}

interface StickElement extends HTMLElement {
  v?: { play: () => void };
}

export function ShowcaseCard({ tool }: { tool: ToolDef; index?: number }) {
  const art = CARD_ART[tool.slug];
  const [near, nearRef] = useNearScreen<HTMLDivElement>("300px");
  const scene = useRef<StickElement | null>(null);

  // The scene code loads only when the card is close to the screen; it plays once when the card is mostly in view.
  useEffect(() => {
    const el = nearRef.current;
    if (!near || !el || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    let played = false;
    const tryPlay = () => {
      const view = scene.current?.v;
      if (view) view.play();
      return Boolean(view);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || played) return;
        played = true;
        void loadStickScenes().then(() => {
          // the element starts a moment after the scripts load
          let tries = 0;
          const wait = () => {
            if (cancelled || tryPlay() || ++tries > 60) return;
            setTimeout(wait, 100);
          };
          wait();
        });
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    void loadStickScenes();
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [near, nearRef]);

  if (!art) return null;

  return (
    <Link className="tool-card showcase-card" to={`/tools/${tool.slug}`} onPointerEnter={(event) => event.pointerType === "mouse" && scene.current?.v?.play()}>
      <div ref={nearRef} className="sc-art">
        {near ? <stick-scene ref={scene} scene={tool.slug} play="idle" zoom="1.06" no-font="" /> : null}
      </div>
      <div className="sc-body">
        <strong>{tool.name}</strong>
        <p className="sc-caption">{caption(tool.slug, art)}</p>
        <span className="tool-card-link">
          Open tool <ArrowRight size={14} />
        </span>
      </div>
    </Link>
  );
}
