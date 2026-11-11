import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Calendar, ChevronRight, Clock } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { relatedGuides, toolsForGuide } from "../content/guide-helpers";
import { GUIDES, guideBySlug } from "../content/guides";
import { slugify } from "../lib/slug";
import { TOOLS } from "../lib/tools";
import { NotFoundPage } from "./NotFoundPage";

export function GuidePage() {
  const { slug = "" } = useParams();
  const guide = guideBySlug(slug);
  const articleRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState("");

  const relatedTools = useMemo(() => (guide ? toolsForGuide(guide, TOOLS) : []), [guide]);
  const moreGuides = useMemo(() => (guide ? relatedGuides(guide, GUIDES, TOOLS, 3) : []), [guide]);

  useEffect(() => {
    if (!guide) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const article = articleRef.current;
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setProgress(total > 0 ? scrolled / total : 0);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [guide]);

  useEffect(() => {
    if (!guide) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".article-section[id]"));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-25% 0px -65% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [guide]);

  if (!guide) return <NotFoundPage />;

  return (
    <>
      <Seo path={`/guides/${guide.slug}`} />
      <div className="reading-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="shell page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <ChevronRight size={14} />
          <Link to="/guides">Guides</Link>
          <ChevronRight size={14} />
          <span>{guide.category}</span>
        </nav>

        <div className="article-layout">
          <article className="article" ref={articleRef}>
            <header className="article-head">
              <span className="eyebrow eyebrow-sky">{guide.category}</span>
              <h1>{guide.title}</h1>
              <p className="article-excerpt">{guide.excerpt}</p>
              <div className="article-meta">
                <span>
                  <Calendar size={14} /> Updated {guide.modified}
                </span>
                <span>
                  <Clock size={14} /> {guide.readingMinutes} min read
                </span>
                <span>By the ClipKit Team</span>
              </div>
            </header>

            {guide.sections.map((section) => (
              <section key={section.heading} className="article-section" id={slugify(section.heading)}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className="article-list">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {section.table && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {section.table.headers.map((header) => (
                            <th key={header}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row) => (
                          <tr key={row.join("|")}>
                            {row.map((cell) => (
                              <td key={cell}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {section.table.caption && <p className="table-caption">{section.table.caption}</p>}
                  </div>
                )}
                {section.callout && <div className="callout">{section.callout}</div>}
              </section>
            ))}

            <div className="article-cta">
              <div>
                <span className="mono-label">Do it now</span>
                <h2>Put this guide to work.</h2>
                <p>Open the matching tool. Your file stays on your device.</p>
              </div>
              <div className="article-cta-actions">
                {relatedTools.map((tool) => (
                  <Link key={tool.slug} className="button button-primary" to={`/tools/${tool.slug}`}>
                    {tool.name} <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            </div>

            {guide.faqs.length > 0 && (
              <section className="faq-section">
                <span className="mono-label">Questions</span>
                <h2>Frequently asked</h2>
                <div className="faq-list">
                  {guide.faqs.map((faq) => (
                    <details key={faq.question} className="faq">
                      <summary>{faq.question}</summary>
                      <p>{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            <div className="author-box">
              <span className="author-mark">CK</span>
              <div>
                <strong>The ClipKit Team</strong>
                <p>
                  We write and test the guides against the tools on this site. Read the{" "}
                  <Link to="/editorial">editorial policy</Link> to see how limits and recommendations are checked.
                </p>
              </div>
            </div>

            <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_ARTICLE} className="ad-inline" />
          </article>

          <aside className="article-aside">
            <div className="aside-card">
              <span className="mono-label">On this page</span>
              <nav>
                {guide.sections.map((section) => {
                  const id = slugify(section.heading);
                  return (
                    <a
                      key={section.heading}
                      href={`#${id}`}
                      className={activeId === id ? "active" : undefined}
                      aria-current={activeId === id ? "true" : undefined}
                    >
                      {section.heading}
                    </a>
                  );
                })}
              </nav>
            </div>
            <div className="aside-card aside-cta">
              <span className="mono-label">Free tool</span>
              <strong>No upload. No account.</strong>
              <p>Compress, resize, trim, and convert video and images in the browser.</p>
              <Link className="button button-primary button-block" to="/tools">
                Open the toolkit
              </Link>
            </div>
          </aside>
        </div>

        {moreGuides.length > 0 && (
          <section className="related-section">
            <span className="mono-label">Keep reading</span>
            <h2>More guides</h2>
            <div className="guide-grid">
              {moreGuides.map((item) => (
                <Link key={item.slug} className="guide-card" to={`/guides/${item.slug}`}>
                  <span className="mono-label">{item.category}</span>
                  <strong>{item.title}</strong>
                  <p>{item.excerpt}</p>
                  <span className="guide-meta">
                    {item.readingMinutes} min read <ArrowRight size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
