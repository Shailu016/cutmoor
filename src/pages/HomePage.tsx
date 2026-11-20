import { Link } from "../components/Link";
import { ArrowRight, Check, MonitorPlay, ShieldCheck, Zap } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { FormatSummary } from "../components/FormatSummary";
import { DemoStage } from "../components/DemoStage";
import { LiveDemo } from "../components/home/LiveDemo";
import { ShowcaseCard } from "../components/home/ShowcaseCard";
import { TrustRow } from "../components/home/TrustRow";
import { Seo } from "../components/Seo";
import { GUIDES } from "../content/guides";
import { HOME_FAQS } from "../lib/seo";
import { IMAGE_TOOLS, TOOL_CATEGORIES, TOOLS, toolsInCategory, VIDEO_TOOLS, type ToolDef } from "../lib/tools";

const homeTools = (slugs: string[]): ToolDef[] => slugs.map((slug) => TOOLS.find((tool) => tool.slug === slug)).filter((tool): tool is ToolDef => Boolean(tool));

const FEATURED_GUIDES = [
  "compress-video-for-whatsapp",
  "social-media-image-sizes",
  "heic-to-jpg-guide",
  "png-vs-jpg-vs-webp",
];

const POPULAR_TASKS = [
  { label: "Compress video for WhatsApp", to: "/guides/compress-video-for-whatsapp" },
  { label: "Compress video for Discord", to: "/guides/compress-video-for-discord" },
  { label: "Crop video to 9:16", to: "/guides/crop-video-to-9-16" },
  { label: "Convert MOV to MP4", to: "/guides/convert-mov-to-mp4" },
  { label: "HEIC to JPG", to: "/tools/heic-to-jpg" },
  { label: "Extract audio from video", to: "/guides/extract-audio-from-video" },
  { label: "Compress image to a target size", to: "/tools/compress-image" },
  { label: "Social media image sizes", to: "/guides/social-media-image-sizes" },
  { label: "Trim a video online", to: "/guides/trim-video-online" },
  { label: "SRT to VTT", to: "/guides/convert-srt-to-vtt" },
  { label: "Add captions without uploading", to: "/guides/how-to-add-captions-to-a-video-without-uploading" },
  { label: "Merge videos", to: "/tools/merge-videos" },
  { label: "GIF to MP4", to: "/tools/gif-to-mp4" },
  { label: "WebP to JPG", to: "/tools/webp-to-jpg" },
  { label: "PNG to JPG", to: "/tools/png-to-jpg" },
  { label: "Remove location from a photo", to: "/tools/remove-photo-metadata" },
  { label: "Blur a face in a photo", to: "/tools/blur-image" },
  { label: "Mute a video", to: "/tools/mute-video" },
  { label: "Rotate a video", to: "/tools/rotate-video" },
];

/** The home page shows the tools people reach for first; the full list is one click away on the tools page. */
const HOME_VIDEO = ["compress", "auto-captions", "trim", "video-speed", "rotate-video", "resize"];
const HOME_IMAGE = ["compress-image", "resize-image", "crop-image", "convert-image", "blur-image", "watermark-image"];

export function HomePage() {
  const featuredGuides = FEATURED_GUIDES.map((slug) => GUIDES.find((guide) => guide.slug === slug)).filter(
    (guide): guide is (typeof GUIDES)[number] => Boolean(guide),
  );

  return (
    <>
      <Seo path="/" />
      <section className="hero hero-v3">
        <div className="hero-glow" aria-hidden="true" />
        <div className="shell hero-split">
        <div className="hero-center">
          <h1>
            Edit video &amp; photos.{" "}
            <br />
            <span className="hero-h1-second">Never upload a thing.</span>
          </h1>
          <p className="hero-lede">
            Compress, trim, merge and caption video. Crop, convert and clean up photos. {TOOLS.length} free tools, no
            sign-up, no watermark — your files never leave your device.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary button-lg" to="/tools/compress">
              Compress a video <ArrowRight size={18} />
            </Link>
            <Link className="button button-ghost button-lg" to="/tools">
              See all {TOOLS.length} tools
            </Link>
          </div>
          <ul className="hero-points">
            <li>
              <Check size={15} /> Free forever
            </li>
            <li>
              <Check size={15} /> No account
            </li>
            <li>
              <Check size={15} /> Phone &amp; desktop
            </li>
          </ul>
        </div>
        <div className="hero-art">
          <DemoStage />
        </div>
        </div>

      </section>

      <TrustRow />

      <LiveDemo />

      <section className="section shell" id="tools">
        <div className="section-head">
          <div>
            <h2>Two toolkits. One local-first rule.</h2>
          </div>
          <p>
            No editor timeline. No sign-up wall. Choose the job you have, drop a file, and take the export. Every tool
            does one thing and tells you the truth about the result.
          </p>
        </div>

        <div className="tool-group">
          <div className="tool-group-head">
            <h3>Cut, shrink, edit, and convert footage</h3>
            <Link className="text-link" to="/tools">
              All {VIDEO_TOOLS.length} video tools <ArrowRight size={15} />
            </Link>
          </div>
          <div className="tool-grid tool-grid-showcase">
            {homeTools(HOME_VIDEO).map((tool, index) => (
              <ShowcaseCard key={tool.slug} tool={tool} index={index} />
            ))}
          </div>
        </div>

        <div className="tool-group" id="image-tools">
          <div className="tool-group-head">
            <h3>Resize, crop, convert, and protect pictures</h3>
            <Link className="text-link" to="/tools#image-tools">
              All {IMAGE_TOOLS.length} image tools <ArrowRight size={15} />
            </Link>
          </div>
          <div className="tool-grid tool-grid-showcase">
            {homeTools(HOME_IMAGE).map((tool, index) => (
              <ShowcaseCard key={tool.slug} tool={tool} index={index} />
            ))}
          </div>
        </div>
      </section>

      <div className="shell">
        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_HOME} className="ad-inline" />
      </div>

      <section className="shell section all-tools" aria-labelledby="all-tools-heading">
        <div className="section-head">
          <div>
            <h2 id="all-tools-heading">Start with the job you came for.</h2>
          </div>
          <p>The most common jobs first, then all {TOOLS.length} tools in plain links. Each one runs on your device and never uploads your file.</p>
        </div>
        <ul className="popular-list">
          {POPULAR_TASKS.map((task) => (
            <li key={task.to}>
              <Link to={task.to}>
                {task.label} <ArrowRight size={14} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="all-tools-grid">
          {TOOL_CATEGORIES.map((category) => (
            <div key={category.id}>
              <h3>
                {category.kind === "video" ? "Video" : "Images"} · {category.label}
              </h3>
              <ul>
                {toolsInCategory(category).map((tool) => (
                  <li key={tool.slug}>
                    <Link to={`/tools/${tool.slug}`}>{tool.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="shell section">
        <div className="why-section">
          <div className="why-copy">
            <h2>The upload is the slowest part. So we removed it.</h2>
            <p>
              Most converters take your file, put it on a server, queue it behind other jobs, and send back a link.
              Cutmoor opens the file in your browser, encodes it with WebAssembly or the canvas API, and saves the
              result straight to your downloads folder.
            </p>
            <p>
              That means no upload wait, no storage bucket, and no third party holding a copy of your footage or photos.
              It also means the limits are honest: your device's memory is the ceiling, not a subscription tier.
            </p>
            <Link className="text-link" to="/about">
              How Cutmoor works <ArrowRight size={15} />
            </Link>
          </div>
          <div className="feature-stack">
            <div className="feature-card">
              <span className="feature-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>Private by architecture</strong>
                <p>There is no upload endpoint. The encoder runs in the page, and the file is released when you close it.</p>
              </div>
            </div>
            <div className="feature-card">
              <span className="feature-icon">
                <Zap size={20} />
              </span>
              <div>
                <strong>No queue, no account</strong>
                <p>Open the page and start. The first video job loads the encoder once; the browser caches it for the next one.</p>
              </div>
            </div>
            <div className="feature-card">
              <span className="feature-icon">
                <MonitorPlay size={20} />
              </span>
              <div>
                <strong>Built for feeds</strong>
                <p>Presets for Reels, Shorts, TikTok, WhatsApp, Instagram posts, YouTube thumbnails, and link previews.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {featuredGuides.length > 0 && (
        <section className="section shell">
          <div className="section-head">
            <div>
              <h2>Know the limit before you hit it.</h2>
            </div>
            <Link className="text-link" to="/guides">
              All guides <ArrowRight size={15} />
            </Link>
          </div>
          <div className="guide-grid">
            {featuredGuides.map((guide) => (
              <Link key={guide.slug} className="guide-card" to={`/guides/${guide.slug}`}>
                <span className="mono-label">{guide.category}</span>
                <strong>{guide.title}</strong>
                <p>{guide.excerpt}</p>
                <span className="guide-meta">
                  {guide.readingMinutes} min read <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <FormatSummary />

      <section className="section shell faq-section">
        <div className="section-head">
          <div>
            <h2>What people ask before the first file.</h2>
          </div>
        </div>
        <div className="faq-list">
          {HOME_FAQS.map((faq) => (
            <details key={faq.question} className="faq">
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="shell cta-band">
        <div>
          <h2>Make the file fit. Keep the quality.</h2>
          <p>Video and image tools, local processing, and an export that does not ask you to make an account.</p>
        </div>
        <Link className="button button-primary button-lg" to="/tools">
          Open the toolkit <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
