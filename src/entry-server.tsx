import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { App } from "./App";
import {
  INDEXABLE_PAGES,
  SITE,
  absoluteUrl,
  canonicalFor,
  jsonLdForPath,
  metaForPath,
  type PageMeta,
} from "./lib/seo";

export const INDEXABLE_PATHS = INDEXABLE_PAGES.map((page) => page.path);
export { INDEXABLE_PAGES };
export const SITE_URL = SITE.url;
export const SITE_EMAIL = SITE.email;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tag(name: string, content: string, attr: "name" | "property" = "name") {
  return `<meta ${attr}="${escapeHtml(name)}" content="${escapeHtml(content)}" />`;
}

function articleMeta(meta: PageMeta) {
  if (meta.type !== "article" || !meta.published || !meta.modified) return "";
  return [
    tag("article:published_time", `${meta.published}T00:00:00Z`, "property"),
    tag("article:modified_time", `${meta.modified}T00:00:00Z`, "property"),
  ].join("\n    ");
}

export function headForPath(pathname: string): string {
  const meta = metaForPath(pathname);
  const url = canonicalFor(pathname);
  const image = absoluteUrl(meta.image ?? SITE.ogImage);
  const robots = meta.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  const jsonLd = JSON.stringify(jsonLdForPath(pathname)).replace(/</g, "\\u003c");
  const adsenseClient = String(import.meta.env.VITE_ADSENSE_CLIENT ?? "").trim();

  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    tag("description", meta.description),
    tag("robots", robots),
    tag("theme-color", SITE.themeColor),
    adsenseClient ? tag("google-adsense-account", adsenseClient) : "",
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    tag("og:type", meta.type ?? "website", "property"),
    tag("og:site_name", SITE.name, "property"),
    tag("og:locale", SITE.locale, "property"),
    tag("og:title", meta.title, "property"),
    tag("og:description", meta.description, "property"),
    tag("og:url", url, "property"),
    tag("og:image", image, "property"),
    tag("og:image:alt", SITE.ogImageAlt, "property"),
    articleMeta(meta),
    tag("twitter:card", "summary_large_image"),
    tag("twitter:title", meta.title),
    tag("twitter:description", meta.description),
    tag("twitter:image", image),
    tag("twitter:image:alt", SITE.ogImageAlt),
    `<script id="clipkit-structured-data" type="application/ld+json">${jsonLd}</script>`,
  ]
    .filter(Boolean)
    .join("\n    ");
}

export function render(pathname: string) {
  const html = renderToString(
    <StrictMode>
      <StaticRouter location={pathname}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );

  return { html, head: headForPath(pathname) };
}
