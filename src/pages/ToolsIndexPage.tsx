import { useEffect, useMemo, useState } from "react";
import { Link } from "../components/Link";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { ToolIcon } from "../components/ToolIcon";
import { IMAGE_TOOLS, TOOL_CATEGORIES, TOOLS, toolsInCategory, VIDEO_TOOLS } from "../lib/tools";
import { searchTools } from "../lib/tool-search";

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
  { need: "The video plays sideways", tool: "rotate-video", answer: "Turn it upright, or mirror it." },
  { need: "You have several clips to join", tool: "merge-videos", answer: "Put them in order and merge." },
  { need: "A GIF is too heavy to send", tool: "gif-to-mp4", answer: "Turn it into a small MP4." },
  { need: "A photo shows where you live", tool: "remove-photo-metadata", answer: "See and remove the hidden location." },
  { need: "A face or plate must not be seen", tool: "blur-image", answer: "Pixelate, blur, or black it out." },
  { need: "You want your name on your work", tool: "watermark-image", answer: "Stamp text or a logo." },
];

type Filter = "all" | "video" | "image";

export function ToolsIndexPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // A link such as /tools/?q=merge (the site search that search engines are told about) fills the box. It is read after
  // the first paint, so the prerendered page and the first browser render stay identical.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl) setQuery(fromUrl.slice(0, 80));
  }, []);

  const searching = query.trim().length > 0;
  const filtered = useMemo(
    () => searchTools(TOOLS.filter((tool) => filter === "all" || tool.kind === filter), query),
    [filter, query],
  );

  // While searching, the results are one list, best match first; otherwise the tools are grouped by job.
  const shown = new Set(filtered.map((tool) => tool.slug));
  const groups = searching
    ? filtered.length > 0
      ? [{ category: { id: "results", kind: "results" as const, label: "Results", title: `Tools for “${query.trim()}”`, slugs: [] }, tools: filtered }]
      : []
    : TOOL_CATEGORIES.map((category) => ({
        category,
        tools: toolsInCategory(category).filter((tool) => shown.has(tool.slug)),
      })).filter((group) => group.tools.length > 0);

  return (
    <>
      <Seo path="/tools" />
      <div className="shell page">
        <header className="page-hero">
          <span className="eyebrow eyebrow-lime">The toolkit</span>
          <h1>{TOOLS.length} small tools. One stubborn rule: no upload.</h1>
          <p>
            {VIDEO_TOOLS.length} video tools and {IMAGE_TOOLS.length} image tools, each doing one job on your device.
            Choose by the problem you have, not by the format list.
          </p>
        </header>

        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Filter tools">
            {(["all", "video", "image"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "segment active" : "segment"}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : value === "video" ? "Video" : "Images"}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tools"
              aria-label="Search tools"
            />
          </label>
        </div>

        {groups.length === 0 ? (
          <p className="empty-state">No tools match “{query}”. Try a broader search.</p>
        ) : (
          groups.map((group, index) => (
            <div className="tool-group" key={group.category.id} id={group.category.id === "image-size" ? "image-tools" : undefined}>
              <div className="tool-group-head">
                <div>
                  <span className="mono-label">
                    {group.category.kind === "results" ? "Best match first" : group.category.kind === "video" ? "Video" : "Images"} · {group.tools.length} {group.tools.length === 1 ? "tool" : "tools"}
                  </span>
                  <h2>{group.category.title}</h2>
                </div>
              </div>
              <div className="tool-grid tool-grid-wide">
                {group.tools.map((tool) => (
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
                {index === 0 && (
                  <a className="tool-card tool-card-cta" href="#choose">
                    <span className="tool-card-icon">
                      <Sparkles size={20} />
                    </span>
                    <strong>Not sure where to start?</strong>
                    <p>Tell us the problem and the directory will point to the right tool.</p>
                    <span className="tool-card-link">
                      Choose by problem <ArrowRight size={14} />
                    </span>
                  </a>
                )}
              </div>
            </div>
          ))
        )}

        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_ARTICLE} className="ad-inline" />

        <section className="choice-section" id="choose">
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
                Browser work is limited by tab memory. The largest video we have tested is 104 MB on a desktop; larger
                files depend on your device's memory, and a phone is more likely to run out. Images above 16.7 megapixels are capped for canvas safety. If a job
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
                Cutmoor only works with files you already have. It does not fetch a URL, bypass a platform player, or
                download third-party content. Use the platform's own export for your own uploads.
              </p>
            </details>
          </div>
        </section>
      </div>
    </>
  );
}
