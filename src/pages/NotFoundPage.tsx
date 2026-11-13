import { Link } from "../components/Link";
import { ArrowRight } from "lucide-react";
import { Seo } from "../components/Seo";
import { TOOLS } from "../lib/tools";

export function NotFoundPage() {
  return (
    <>
      <Seo path="/404" />
      <div className="shell page not-found">
        <span className="mono-label">404</span>
        <h1>That page is not here.</h1>
        <p>The link may be old, or the tool may have moved. These pages are the useful ones.</p>
        <div className="hero-actions">
          <Link className="button button-primary" to="/tools">
            Open the toolkit <ArrowRight size={17} />
          </Link>
          <Link className="button button-ghost" to="/guides">
            Browse guides
          </Link>
        </div>
        <section className="not-found-popular" aria-labelledby="not-found-popular">
          <h2 id="not-found-popular">Popular pages</h2>
          <ul>
            {TOOLS.slice(0, 6).map((tool) => (
              <li key={tool.slug}>
                <Link to={`/tools/${tool.slug}`}>{tool.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
