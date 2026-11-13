import { useMemo, useState } from "react";
import { Link } from "../components/Link";
import { ArrowRight, Search, Sparkles } from "lucide-react";
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

type Filter = "all" | "video" | "image";

export function ToolsIndexPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TOOLS.filter((tool) => {
      if (filter !== "all" && tool.kind !== filter) return false;
      if (!needle) return true;
      const haystack = [tool.name, tool.short, tool.description, ...tool.keywords].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, query]);

  const groups = [
    { kind: "video" as const, title: "Cut, shrink, and convert footage", tools: filtered.filter((tool) => tool.kind === "video") },
    { kind: "image" as const, title: "Resize, compress, and fix the format", tools: filtered.filter((tool) => tool.kind === "image") },
  ].filter((group) => group.tools.length > 0);

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
          groups.map((group) => (
            <div className="tool-group" key={group.kind} id={group.kind === "image" ? "image-tools" : undefined}>
              <div className="tool-group-head">
                <div>
                  <span className="mono-label">
                    {group.kind === "video" ? "Video" : "Images"} · {group.tools.length} tools
                  </span>
                  <h2>{group.title}</h2>
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
                {group.kind === "video" && (
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
