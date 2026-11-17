import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { ArrowRight } from "lucide-react";
import { cardPicture } from "../../lib/card-art";
import { CARD_ART, type CardArtEntry } from "../../lib/card-art.generated";
import { extensionOf, formatBytes } from "../../lib/format";
import type { ToolDef } from "../../lib/tools";
import { useNearScreen } from "../../hooks/useNearScreen";
import { Link } from "../Link";

/**
 * A home-page tool card whose picture PLAYS the tool's change: a rotated clip turns upright, a crop frame closes in and
 * zooms to the result, trim brackets close, two playheads race at 1x and 2x, a file-size bar shrinks. Every picture and
 * number comes from a real run of the tool (scripts/make-card-art.mjs). The animation starts when the card scrolls into
 * view; hovering pauses it, and on the wipe cards hovering scrubs the before/after divider instead.
 */

type Anim = "size" | "wipe" | "crop" | "rotate" | "trim" | "speed" | "captions";

const ANIM: Record<string, Anim> = {
  compress: "size",
  "compress-image": "size",
  "convert-image": "size",
  "blur-image": "wipe",
  "watermark-image": "wipe",
  resize: "crop",
  "resize-image": "crop",
  "crop-image": "crop",
  "rotate-video": "rotate",
  trim: "trim",
  "video-speed": "speed",
  "auto-captions": "captions",
};

/** Where the "before" came from (the art script's source files). Only the format is shown. */
const BEFORE_FORMAT: Record<string, string> = {
  "compress-image": "PNG",
  "resize-image": "PNG",
  "crop-image": "PNG",
  "convert-image": "PNG",
  "blur-image": "PNG",
  "watermark-image": "PNG",
};

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
      return `Wide to vertical ${ratio(a.w, a.h)}. The rider stays in frame.`;
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

/** How a picture of the given shape sits inside the 16:10 art box (object-fit: contain), as shares of the box. */
function fitted(w: number, h: number) {
  const box = 10 / 16;
  const aspect = w / h;
  return aspect * box >= 1 ? { w: 1, h: 1 / (aspect * box) } : { w: aspect * box, h: 1 };
}

/** The geometry the crop and rotate animations need, worked out from the real picture sizes. */
function geometry(art: CardArtEntry): Record<string, string> {
  const before = fitted(art.before.w, art.before.h);
  const after = fitted(art.after.w, art.after.h);
  const box = 10 / 16;
  const aAfter = art.after.w / art.after.h;
  const aBefore = art.before.w / art.before.h;
  // the centred crop inside the before picture, then the zoom from that rectangle up to where the result is shown
  const crop = aAfter <= aBefore ? { h: before.h, w: before.h * box * aAfter } : { w: before.w, h: before.w / (aAfter * box) };
  return {
    "--cw": `${(crop.w * 100).toFixed(2)}%`,
    "--ch": `${(crop.h * 100).toFixed(2)}%`,
    "--zoom": (crop.w / after.w).toFixed(4),
    "--rs": ((after.h * box) / before.w).toFixed(4),
  };
}

function Pills({ art, beforeFormat }: { art: CardArtEntry; beforeFormat: string }) {
  return (
    <>
      <span className="sc-pill sc-pill-before">
        <b>Before</b>
        <i>
          {beforeFormat} · {formatBytes(art.beforeBytes)}
        </i>
      </span>
      <span className="sc-pill sc-pill-after">
        <b>After</b>
        <i>
          {extensionOf(art.name).toUpperCase()} · {formatBytes(art.afterBytes)}
        </i>
      </span>
    </>
  );
}

export function ShowcaseCard({ tool, index = 0 }: { tool: ToolDef; index?: number }) {
  const art = CARD_ART[tool.slug];
  const box = useRef<HTMLDivElement>(null);
  // The picture is built only when the card is close to the screen (see useNearScreen); its box is sized by CSS.
  const [near, nearRef] = useNearScreen<HTMLDivElement>("300px");

  // Play only while the card is on screen: nothing runs for cards nobody is looking at.
  useEffect(() => {
    const el = box.current;
    if (!near || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => el.classList.toggle("is-live", entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  if (!art) return null;
  const anim = ANIM[tool.slug] ?? "wipe";
  const beforeFormat = BEFORE_FORMAT[tool.slug] ?? "MP4";
  const strip = art.mode === "strip";
  const share = art.beforeBytes > 0 ? art.afterBytes / art.beforeBytes : 1;
  const beforeDur = art.before.duration ?? 1;
  const afterDur = art.after.duration ?? 1;

  const style = {
    "--d": `${(index % 3) * 0.6}s`,
    "--share": `${Math.max(2, share * 100).toFixed(1)}%`,
    "--sharen": Math.max(0.02, share).toFixed(3),
    ...(art.mode === "frames" ? { "--frames": art.frames ?? 1, "--sprite": `url(${cardPicture(tool.slug, "frames")})` } : {}),
    "--aw": `${((afterDur / beforeDur) * 100).toFixed(1)}%`,
    "--awn": (afterDur / beforeDur).toFixed(3),
    ...(art.keep ? { "--kl": `${((art.keep[0] / beforeDur) * 100).toFixed(1)}%`, "--kw": `${(((art.keep[1] - art.keep[0]) / beforeDur) * 100).toFixed(1)}%` } : {}),
    ...(anim === "crop" || anim === "rotate" ? geometry(art) : {}),
  } as CSSProperties;

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    if (anim !== "wipe" && anim !== "size") return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--split", `${((Math.min(Math.max(event.clientX - rect.left, 0), rect.width) / rect.width) * 100).toFixed(1)}%`);
  };
  const rest = (event: PointerEvent<HTMLDivElement>) => event.currentTarget.style.removeProperty("--split");

  const speedLabel = `${Math.round((beforeDur / afterDur) * 4) / 4}×`;

  return (
    <Link className="tool-card showcase-card" to={`/tools/${tool.slug}`}>
      <div
        ref={(el) => {
          box.current = el;
          nearRef.current = el;
        }}
        className={`sc-art${strip ? " is-strip" : ""}`}
        data-anim={anim}
        style={style}
        onPointerMove={scrub}
        onPointerLeave={rest}
      >
        {!near ? null : art.mode === "frames" ? (
          <>
            <span className="sc-sprite" role="img" aria-label={`Captions lighting up word by word on a presenter clip: ${art.sampleText ?? ""}`} />
            <span className="sc-pill sc-pill-before sc-pill-note">
              <b>Sample captions</b>
              <i>written by the test engine</i>
            </span>
          </>
        ) : strip ? (
          <>
            <div className="sc-strip sc-strip-before">
              <span className="sc-strip-label">
                Before <em>{anim === "speed" ? "1×" : null} {seconds(beforeDur)}</em>
              </span>
              <div className="sc-reel">
                <img src={cardPicture(tool.slug, "before-strip")} width={960} height={Math.round((960 * (art.before.h / art.before.w)) / 6)} alt="" loading="lazy" decoding="async" />
                {anim === "trim" && <span className="sc-keep" aria-hidden="true" />}
                {anim === "speed" && <span className="sc-ph sc-ph-before" aria-hidden="true" />}
              </div>
            </div>
            <div className="sc-strip sc-strip-after">
              <span className="sc-strip-label">
                After <em>{anim === "speed" ? speedLabel : null} {seconds(afterDur)}</em>
              </span>
              <div className="sc-reel sc-reel-after">
                <img src={cardPicture(tool.slug, "after-strip")} width={960} height={Math.round((960 * (art.after.h / art.after.w)) / 6)} alt="" loading="lazy" decoding="async" />
                {anim === "speed" && <span className="sc-ph sc-ph-after" aria-hidden="true" />}
              </div>
            </div>
          </>
        ) : (
          <>
            <img className="sc-img sc-img-before" src={cardPicture(tool.slug, "before")} width={720} height={405} alt="" loading="lazy" decoding="async" />
            <img
              className="sc-img sc-img-after"
              src={cardPicture(tool.slug, "after")}
              width={art.after.w >= art.after.h ? 720 : 405}
              height={art.after.w >= art.after.h ? 405 : 720}
              alt=""
              loading="lazy"
              decoding="async"
            />
            {(anim === "wipe" || anim === "size") && (
              <span className="sc-divider" aria-hidden="true">
                <i />
              </span>
            )}
            {anim === "crop" && <span className="sc-frame" aria-hidden="true" />}
            <Pills art={art} beforeFormat={beforeFormat} />
            {anim === "size" && (
              <span className="sc-meter" aria-hidden="true">
                <span>
                  <b>Before</b>
                  <i className="sc-bar" />
                  <em className="num">{formatBytes(art.beforeBytes)}</em>
                </span>
                <span>
                  <b>After</b>
                  <i className="sc-bar sc-bar-after" />
                  <em className="num">{formatBytes(art.afterBytes)}</em>
                </span>
              </span>
            )}
          </>
        )}
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
