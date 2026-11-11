import { useParams } from "react-router-dom";
import { Mail, RefreshCw } from "lucide-react";
import { Seo } from "../components/Seo";
import { resetConsent } from "../components/ConsentBanner";
import { sitePageBySlug } from "../content/site-pages";
import { SITE } from "../lib/seo";
import { NotFoundPage } from "./NotFoundPage";

export function SitePageView() {
  const { slug = "" } = useParams();
  const page = sitePageBySlug(slug);

  if (!page) return <NotFoundPage />;

  return (
    <>
      <Seo path={`/${page.slug}`} />
      <div className="shell page page-narrow">
        <header className="page-hero page-hero-left">
          <span className="eyebrow eyebrow-lime">{page.eyebrow}</span>
          <h1>{page.title}</h1>
          {page.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <span className="page-updated">Last updated {page.updated}</span>
        </header>

        <div className="legal-body">
          {page.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
              {page.slug === "cookies" && section.heading === "How to change your choice" && (
                <button className="button button-ghost" type="button" onClick={resetConsent}>
                  <RefreshCw size={15} /> Reset my cookie choice
                </button>
              )}
            </section>
          ))}

          {page.slug === "contact" && (
            <a className="contact-card" href={`mailto:${SITE.email}`}>
              <span className="feature-icon">
                <Mail size={20} />
              </span>
              <div>
                <strong>{SITE.email}</strong>
                <span>Support, bug reports, and feature requests.</span>
              </div>
            </a>
          )}

          {page.footnote && <p className="legal-footnote">{page.footnote}</p>}
        </div>
      </div>
    </>
  );
}
