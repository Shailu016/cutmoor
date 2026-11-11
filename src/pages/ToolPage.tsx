import { Link, useParams } from "react-router-dom";
import { ArrowRight, ChevronRight, Lock, ShieldCheck, Zap } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { ToolIcon } from "../components/ToolIcon";
import { CompressTool } from "../tools/CompressTool";
import { ResizeTool } from "../tools/ResizeTool";
import { TrimTool } from "../tools/TrimTool";
import { ConvertTool } from "../tools/ConvertTool";
import { AudioTool } from "../tools/AudioTool";
import { FrameTool } from "../tools/FrameTool";
import { CaptionsTool } from "../tools/CaptionsTool";
import { CompressImageTool } from "../tools/CompressImageTool";
import { ResizeImageTool } from "../tools/ResizeImageTool";
import { ConvertImageTool } from "../tools/ConvertImageTool";
import { HeicTool } from "../tools/HeicTool";
import { toolBySlug, TOOLS } from "../lib/tools";
import { NotFoundPage } from "./NotFoundPage";

const IMAGE_GUIDES: Record<string, { to: string; label: string }> = {
  "compress-image": {
    to: "/guides/compress-image-without-visible-quality-loss",
    label: "How to compress an image without visible quality loss",
  },
  "resize-image": {
    to: "/guides/social-media-image-sizes",
    label: "Social media image sizes, in one place",
  },
  "convert-image": {
    to: "/guides/png-vs-jpg-vs-webp",
    label: "PNG vs JPG vs WebP: which one to use",
  },
  "heic-to-jpg": {
    to: "/guides/heic-to-jpg-guide",
    label: "HEIC to JPG: why iPhone photos need converting",
  },
};

function ToolRenderer({ slug }: { slug: string }) {
  if (slug === "compress") return <CompressTool />;
  if (slug === "resize") return <ResizeTool />;
  if (slug === "trim") return <TrimTool />;
  if (slug === "convert") return <ConvertTool />;
  if (slug === "audio") return <AudioTool />;
  if (slug === "frame") return <FrameTool />;
  if (slug === "captions") return <CaptionsTool />;
  if (slug === "compress-image") return <CompressImageTool />;
  if (slug === "resize-image") return <ResizeImageTool />;
  if (slug === "convert-image") return <ConvertImageTool />;
  if (slug === "heic-to-jpg") return <HeicTool />;
  return null;
}

export function ToolPage() {
  const { slug = "" } = useParams();
  const tool = toolBySlug(slug);

  if (!tool) return <NotFoundPage />;

  const related = tool.related.map((item) => TOOLS.find((entry) => entry.slug === item)).filter(Boolean);

  return (
    <>
      <Seo path={`/tools/${tool.slug}`} />
      <div className="shell page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <ChevronRight size={14} />
          <Link to="/tools">Tools</Link>
          <ChevronRight size={14} />
          <span>{tool.name}</span>
        </nav>

        <header className="tool-hero">
          <div className="tool-hero-copy">
            <span className={`eyebrow eyebrow-${tool.accent}`}>
              <ToolIcon icon={tool.icon} size={16} /> {tool.name}
            </span>
            <h1>{tool.title}</h1>
            <p>{tool.intro}</p>
          </div>
          <ul className="trust-list">
            <li>
              <Lock size={16} /> No upload
            </li>
            <li>
              <Zap size={16} /> No account
            </li>
            <li>
              <ShieldCheck size={16} /> No watermark
            </li>
          </ul>
        </header>

        <ToolRenderer slug={tool.slug} />

        <div className="tool-lower">
          <section className="tool-steps">
            <span className="mono-label">How it works</span>
            <h2>From file to download, with no upload bar</h2>
            <ol className="steps">
              {tool.steps.map((step, index) => (
                <li key={step.name}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{step.name}</strong>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <aside className="tool-side-card">
            <h3>Good to know</h3>
            {tool.kind === "image" ? (
              <p>
                Image work happens in a canvas in this tab. Photos above 16.7 megapixels are capped for browser safety,
                JPG cannot store transparency, and the first HEIC conversion may download a one-time local decoder. Keep
                the original file until you have checked the preview.
              </p>
            ) : (
              <p>
                Browser encoding uses your device's memory. Close other heavy tabs, keep the original file, and prefer a
                desktop for files above 200 MB.
              </p>
            )}
            <Link
              className="text-link"
              to={IMAGE_GUIDES[tool.slug]?.to ?? "/guides/reduce-video-file-size-without-losing-quality"}
            >
              {IMAGE_GUIDES[tool.slug]?.label ?? "How to reduce size without losing quality"} <ArrowRight size={15} />
            </Link>
          </aside>
        </div>

        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_ARTICLE} className="ad-inline" />

        <section className="faq-section">
          <span className="mono-label">Questions</span>
          <h2>{tool.name}: common questions</h2>
          <div className="faq-list">
            {tool.faqs.map((faq) => (
              <details key={faq.question} className="faq">
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {related.length > 0 && (
          <section className="related-section">
            <span className="mono-label">Next</span>
            <h2>Related tools</h2>
            <div className="tool-grid tool-grid-small">
              {related.map((item) =>
                item ? (
                  <Link key={item.slug} className="tool-card" to={`/tools/${item.slug}`}>
                    <span className={`tool-card-icon icon-${item.accent}`}>
                      <ToolIcon icon={item.icon} />
                    </span>
                    <strong>{item.name}</strong>
                    <p>{item.short}</p>
                    <span className="tool-card-link">
                      Open tool <ArrowRight size={14} />
                    </span>
                  </Link>
                ) : null,
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
