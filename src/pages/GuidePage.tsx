import { Link, useParams } from "react-router-dom";
import { ArrowRight, Calendar, ChevronRight, Clock } from "lucide-react";
import { AdSlot } from "../components/AdSlot";
import { Seo } from "../components/Seo";
import { GUIDES, guideBySlug } from "../content/guides";
import { TOOLS } from "../lib/tools";
import { NotFoundPage } from "./NotFoundPage";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function GuidePage() {
  const { slug = "" } = useParams();
  const guide = guideBySlug(slug);

  if (!guide) return <NotFoundPage />;

  const relatedTools = TOOLS.filter((tool) => {
    if (guide.slug.includes("compress")) return ["compress", "resize"].includes(tool.slug);
    if (guide.slug.includes("crop") || guide.slug.includes("size")) return ["resize", "compress"].includes(tool.slug);
    if (guide.slug.includes("trim")) return tool.slug === "trim";
    if (guide.slug.includes("audio")) return tool.slug === "audio";
    if (guide.slug.includes("subtitle") || guide.slug.includes("srt")) return tool.slug === "captions";
    return ["compress", "convert"].includes(tool.slug);
  }).slice(0, 2);

  const moreGuides = GUIDES.filter((item) => item.slug !== guide.slug).slice(0, 3);

  return (
    <>
      <Seo path={`/guides/${guide.slug}`} />
      <div className="shell page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <ChevronRight size={14} />
          <Link to="/guides">Guides</Link>
          <ChevronRight size={14} />
          <span>{guide.category}</span>
        </nav>

        <div className="article-layout">
          <article className="article">
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
                {guide.sections.map((section) => (
                  <a key={section.heading} href={`#${slugify(section.heading)}`}>
                    {section.heading}
                  </a>
                ))}
              </nav>
            </div>
            <div className="aside-card aside-cta">
              <span className="mono-label">Free tool</span>
              <strong>No upload. No account.</strong>
              <p>Compress, crop, trim, and convert in the browser.</p>
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
