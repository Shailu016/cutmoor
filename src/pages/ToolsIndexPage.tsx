import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { ToolIcon } from "../components/ToolIcon";
import { IMAGE_TOOLS, TOOLS, VIDEO_TOOLS } from "../lib/tools";

const CHOICES = [
  { need: "An app says the video is too large", tool: "compress", answer: "Compress to a target size." },
  { need: "The video is horizontal but the feed is vertical", tool: "resize", answer: "Crop to 9:16 or 4:5." },
  { need: "The good part starts 20 seconds in", tool: "trim", answer: "Cut the start and end." },
  { need: "The platform will not accept the video format", tool: "convert", answer: "Export MP4, WebM, or GIF." },
  { need: "You only want the sound", tool: "audio", answer: "Extract MP3, M4A, or WAV." },
  { need: "You need a cover image", tool: "frame", answer: "Save a still at any timestamp." },
  { need: "The captions are in the wrong format", tool: "captions", answer: "Convert SRT to VTT or back." },
  { need: "A photo is too large to upload", tool: "compress-image", answer: "Hit a target size like 200 KB." },
  { need: "The photo does not fit the feed", tool: "resize-image", answer: "Crop or pad to a platform preset." },
  { need: "An image is in the wrong format", tool: "convert-image", answer: "Convert JPG, PNG, and WebP." },
  { need: "Windows will not open an iPhone photo", tool: "heic-to-jpg", answer: "Turn HEIC into a standard JPG." },
];

export function ToolsIndexPage() {
  return (
    <>
      <Seo path="/tools" />
      <div className="shell page">
        <header className="page-hero">
          <span className="eyebrow eyebrow-lime">The toolkit</span>
          <h1>{TOOLS.length} small tools. One stubborn rule: no upload.</h1>
          <p>
            {VIDEO_TOOLS.length} video tools and {IMAGE_TOOLS.length} image tools, each doing one job on your device.
            Choose by the problem you have, not by the format list. Every export is clean, free, and watermark-free.
          </p>
        </header>

        <div className="tool-group">
          <div className="tool-group-head">
            <span className="mono-label">Video · {VIDEO_TOOLS.length} tools</span>
            <h2>Cut, shrink, and convert footage</h2>
          </div>
          <div className="tool-grid tool-grid-wide">
            {VIDEO_TOOLS.map((tool) => (
              <Link key={tool.slug} className="tool-card" to={`/tools/${tool.slug}`}>
                <span className={`tool-card-icon icon-${tool.accent}`}>
                  <ToolIcon icon={tool.icon} />
                </span>
                <strong>{tool.name}</strong>
                <p>{tool.short}</p>
                <span className="tool-card-link">
                  Open tool <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="tool-group" id="image-tools">
          <div className="tool-group-head">
            <span className="mono-label">Images · {IMAGE_TOOLS.length} tools</span>
            <h2>Resize, compress, and fix the format</h2>
          </div>
          <div className="tool-grid tool-grid-wide">
            {IMAGE_TOOLS.map((tool) => (
              <Link key={tool.slug} className="tool-card" to={`/tools/${tool.slug}`}>
                <span className={`tool-card-icon icon-${tool.accent}`}>
                  <ToolIcon icon={tool.icon} />
                </span>
                <strong>{tool.name}</strong>
                <p>{tool.short}</p>
                <span className="tool-card-link">
                  Open tool <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </div>

        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_ARTICLE} className="ad-inline" />

        <section className="choice-section">
          <span className="mono-label">Choose by problem</span>
          <h2>What are you trying to fix?</h2>
          <div className="choice-table">
            {CHOICES.map((choice) => {
              const tool = TOOLS.find((item) => item.slug === choice.tool);
              if (!tool) return null;
              return (
                <Link key={choice.need} className="choice-row" to={`/tools/${tool.slug}`}>
                  <span>{choice.need}</span>
                  <strong>{choice.answer}</strong>
                  <ArrowRight size={16} />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="faq-section">
          <span className="mono-label">Before you start</span>
          <h2>Four honest limits</h2>
          <div className="faq-list">
            <details className="faq">
              <summary>Very large files can fail.</summary>
              <p>
                Browser work is limited by tab memory. A 500 MB video is usually fine on a desktop with 8 GB of RAM; a
                phone should stay under 200 MB. Images above 16.7 megapixels are capped for canvas safety. If a job
                fails, try a smaller file or a lower resolution.
              </p>
            </details>
            <details className="faq">
              <summary>The first video run downloads a 32 MB encoder.</summary>
              <p>
                The WebAssembly video encoder is fetched once and cached by your browser. After that, jobs start quickly.
                It is a one-time cost, not a per-video upload.
              </p>
            </details>
            <details className="faq">
              <summary>HEIC files may download a separate 3 MB decoder.</summary>
              <p>
                Safari uses the system HEIC decoder. Chrome, Edge, and Firefox load an open-source libheif decoder only
                when a HEIC file is selected. It runs locally in the tab and is cached for later visits.
              </p>
            </details>
            <details className="faq">
              <summary>We cannot download from YouTube or Instagram.</summary>
              <p>
                ClipKit only works with files you already have. It does not fetch a URL, bypass a platform player, or
                download third-party content. Use the platform's own export for your own uploads.
              </p>
            </details>
          </div>
        </section>
      </div>
    </>
  );
}
