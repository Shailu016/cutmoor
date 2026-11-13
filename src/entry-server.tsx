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
import { TOOLS } from "./lib/tools";
import { GUIDES } from "./content/guides";

export const INDEXABLE_PATHS = INDEXABLE_PAGES.map((page) => page.path);
export { INDEXABLE_PAGES };
export const SITE_URL = SITE.url;
export const SITE_EMAIL = SITE.email;
export const SITE_INFO = { name: SITE.name, tagline: SITE.tagline, description: SITE.description, themeColor: SITE.themeColor };
export const LLM_TOOLS = TOOLS.map((t) => ({ slug: t.slug, name: t.name, description: t.description }));
export const LLM_GUIDES = GUIDES.map((g) => ({
  slug: g.slug,
  title: g.title,
  description: g.description,
  published: g.published,
  modified: g.modified,
}));

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
  const canonical = meta.noindex ? "" : `<link rel="canonical" href="${escapeHtml(url)}" />`;

  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    tag("description", meta.description),
    tag("robots", robots),
    tag("theme-color", SITE.themeColor),
    tag("color-scheme", "light"),
    tag("format-detection", "telephone=no"),
    tag("application-name", SITE.name),
    tag("apple-mobile-web-app-title", SITE.name),
    `<link rel="manifest" href="/manifest.webmanifest" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE.name)} guides" href="/feed.xml" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    adsenseClient ? tag("google-adsense-account", adsenseClient) : "",
    // The AdSense loader on every page: verifies the site for review and enables Auto ads.
    // Preconnecting saves the connection set-up time when the loader starts.
    adsenseClient ? `<link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin />` : "",
    adsenseClient
      ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}" crossorigin="anonymous" data-cutmoor-ads="true"></script>`
      : "",
    canonical,
    tag("og:type", meta.type ?? "website", "property"),
    tag("og:site_name", SITE.name, "property"),
    tag("og:locale", SITE.locale, "property"),
    tag("og:title", meta.title, "property"),
    tag("og:description", meta.description, "property"),
    tag("og:url", url, "property"),
    tag("og:image", image, "property"),
    tag("og:image:alt", SITE.ogImageAlt, "property"),
    tag("og:image:width", "1200", "property"),
    tag("og:image:height", "630", "property"),
    articleMeta(meta),
    tag("twitter:card", "summary_large_image"),
    tag("twitter:title", meta.title),
    tag("twitter:description", meta.description),
    tag("twitter:image", image),
    tag("twitter:image:alt", SITE.ogImageAlt),
    `<script id="cutmoor-structured-data" type="application/ld+json">${jsonLd}</script>`,
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
