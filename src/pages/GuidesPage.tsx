import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { GUIDES, guidesByCategory } from "../content/guides";

export function GuidesPage() {
  const groups = guidesByCategory();
  const [category, setCategory] = useState("All");
  const visible = category === "All" ? groups : groups.filter((group) => group.category === category);

  return (
    <>
      <Seo path="/guides" />
      <div className="shell page">
        <header className="page-hero">
          <span className="eyebrow eyebrow-sky">Guides</span>
          <h1>Sizes, limits, and settings that actually matter.</h1>
          <p>
            {GUIDES.length} practical guides for video and images: file limits, aspect ratios, bitrates, formats, and
            the settings that make a clean export. No filler, no invented benchmarks.
          </p>
        </header>

        <div className="toolbar">
          <div className="chips" role="group" aria-label="Filter guides by category">
            <button
              type="button"
              className={category === "All" ? "chip active" : "chip"}
              aria-pressed={category === "All"}
              onClick={() => setCategory("All")}
            >
              All
            </button>
            {groups.map((group) => (
              <button
                key={group.category}
                type="button"
                className={category === group.category ? "chip active" : "chip"}
                aria-pressed={category === group.category}
                onClick={() => setCategory(group.category)}
              >
                {group.category}
              </button>
            ))}
          </div>
        </div>

        <div className="guide-list">
          {visible.map((group) => (
            <section key={group.category} className="guide-group">
              <h2>{group.category}</h2>
              <div className="guide-grid">
                {group.guides.map((guide) => (
                  <Link key={guide.slug} className="guide-card" to={`/guides/${guide.slug}`}>
                    <span className="mono-label">{guide.readingMinutes} min read</span>
                    <strong>{guide.title}</strong>
                    <p>{guide.excerpt}</p>
                    <span className="guide-meta">
                      Read guide <ArrowRight size={14} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {GUIDES.length === 0 && <p className="empty-state">Guides are being prepared. Check back shortly.</p>}

        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_ARTICLE} className="ad-inline" />

        <section className="cta-inline">
          <div>
            <h2>Put the guide to work.</h2>
            <p>Every guide ends with a tool that does the job locally.</p>
          </div>
          <Link className="button button-primary" to="/tools">
            Open the toolkit <ArrowRight size={17} />
          </Link>
        </section>
      </div>
    </>
  );
}
