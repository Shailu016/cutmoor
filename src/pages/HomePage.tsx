import { Link } from "react-router-dom";
import { ArrowRight, Check, Lock, MonitorPlay, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { ToolIcon } from "../components/ToolIcon";
import { GUIDES } from "../content/guides";
import { HOME_FAQS } from "../lib/seo";
import { IMAGE_TOOLS, VIDEO_TOOLS } from "../lib/tools";

const FEATURED_GUIDES = [
  "compress-video-for-whatsapp",
  "social-media-image-sizes",
  "heic-to-jpg-guide",
  "png-vs-jpg-vs-webp",
];

export function HomePage() {
  const featuredGuides = FEATURED_GUIDES.map((slug) => GUIDES.find((guide) => guide.slug === slug)).filter(
    (guide): guide is (typeof GUIDES)[number] => Boolean(guide),
  );

  return (
    <>
      <Seo path="/" />
      <section className="hero">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <span className="eyebrow eyebrow-lime">
              <Sparkles size={15} /> The browser media toolkit
            </span>
            <h1>
              Your video.
              <br />
              <em>Ready for every platform.</em>
            </h1>
            <p className="hero-lede">
              Compress to a target size, crop to 9:16, trim the ends, convert the format, and pull out the audio. Resize a
              photo for a feed, or turn an iPhone HEIC into a JPG. All in your browser. No upload, no account, no
              watermark.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary button-lg" to="/tools/compress">
                Compress a video <ArrowRight size={18} />
              </Link>
              <Link className="button button-ghost button-lg" to="/tools#image-tools">
                Browse image tools
              </Link>
            </div>
            <ul className="hero-points">
              <li>
                <Check size={15} /> Free forever
              </li>
              <li>
                <Check size={15} /> Files stay on your device
              </li>
              <li>
                <Check size={15} /> Works on phone and desktop
              </li>
            </ul>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="phone-frame">
              <div className="phone-screen">
                <div className="phone-topbar">
                  <span />
                  <span />
                </div>
                <div className="phone-clip">
                  <span className="phone-play">▶</span>
                  <span className="phone-tag">9:16</span>
                </div>
                <div className="phone-caption">
                  <strong>Reel ready</strong>
                  <span>1080 × 1920 · 24.8 MB</span>
                </div>
              </div>
            </div>
            <div className="float-card float-card-a">
              <span className="float-icon">
                <Zap size={15} />
              </span>
              <div>
                <strong>Compressed</strong>
                <span>182 MB → 24.6 MB</span>
              </div>
            </div>
            <div className="float-card float-card-b">
              <span className="float-icon">
                <Lock size={15} />
              </span>
              <div>
                <strong>Never uploaded</strong>
                <span>Processed in this tab</span>
              </div>
            </div>
            <div className="float-pill">0 uploads · 0 accounts</div>
          </div>
        </div>
        <div className="shell hero-strip">
          <span>MP4</span>
          <span>MOV</span>
          <span>WebM</span>
          <span>MKV</span>
          <span>AVI</span>
          <span>GIF</span>
          <span>JPG</span>
          <span>PNG</span>
          <span>WebP</span>
          <span>HEIC</span>
          <span className="strip-note">Files stay local. No upload bar.</span>
        </div>
      </section>

      <section className="section shell" id="tools">
        <div className="section-head">
          <div>
            <span className="mono-label">The toolkit</span>
            <h2>Two toolkits. One local-first rule.</h2>
          </div>
          <p>
            No editor timeline. No sign-up wall. Choose the job you have, drop a file, and take the export. Every tool is
            built to do one thing and tell you the truth about the result.
          </p>
        </div>

        <div className="tool-group">
          <div className="tool-group-head">
            <span className="mono-label">Video · {VIDEO_TOOLS.length} tools</span>
            <h3>Cut, shrink, and convert footage</h3>
          </div>
          <div className="tool-grid">
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
            <h3>Resize, compress, and fix the format</h3>
          </div>
          <div className="tool-grid">
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
      </section>

      <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_HOME} className="ad-inline shell" />

      <section className="section shell why-section">
        <div className="why-copy">
          <span className="mono-label">Why local</span>
          <h2>The upload is the slowest part. So we removed it.</h2>
          <p>
            Most converters take your file, put it on a server, queue it behind other jobs, and send back a link. ClipKit
            opens the file in your browser, encodes it with WebAssembly or the canvas API, and saves the result straight
            to your downloads folder.
          </p>
          <p>
            That means no upload wait, no storage bucket, and no third party holding a copy of your footage or photos. It
            also means the limits are honest: your device's memory is the ceiling, not a subscription tier.
          </p>
          <Link className="text-link" to="/about">
            How ClipKit works <ArrowRight size={15} />
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
      </section>

      <section className="section shell steps-section">
        <div className="section-head">
          <div>
            <span className="mono-label">The flow</span>
            <h2>Drop. Choose. Done.</h2>
          </div>
          <p>Three steps, whether the job is a 12-second Reel, a 48-megapixel photo, or a 40-minute screen recording.</p>
        </div>
        <ol className="home-steps">
          <li>
            <span>01</span>
            <strong>Drop your file</strong>
            <p>The browser reads the duration, format, and dimensions locally. Nothing is sent anywhere.</p>
          </li>
          <li>
            <span>02</span>
            <strong>Pick the outcome</strong>
            <p>Target size, aspect ratio, format, or timestamp. The presets match the platforms people actually use.</p>
          </li>
          <li>
            <span>03</span>
            <strong>Take the export</strong>
            <p>Download a clean file. No watermark, no account, no “upgrade to remove the limit” screen.</p>
          </li>
        </ol>
      </section>

      {featuredGuides.length > 0 && (
        <section className="section shell">
          <div className="section-head">
            <div>
              <span className="mono-label">Guides</span>
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

      <section className="section shell faq-section">
        <div className="section-head">
          <div>
            <span className="mono-label">Questions</span>
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
          <span className="mono-label">Ready when you are</span>
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
