import { useEffect } from "react";
import { canonicalFor, jsonLdForPath, metaForPath, SITE } from "../lib/seo";

function upsertMeta(attribute: "name" | "property", key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.rel = rel;
    document.head.appendChild(tag);
  }
  tag.href = href;
}

/**
 * Client-side head updates for navigation. The first paint is already correct
 * because the build prerenders every indexable route; this keeps the title,
 * canonical, social tags, and JSON-LD correct when the visitor moves between
 * pages without a reload.
 */
export function Seo({ path }: { path: string }) {
  useEffect(() => {
    const meta = metaForPath(path);
    const url = canonicalFor(path);
    const image = new URL(meta.image ?? SITE.ogImage, SITE.url).toString();

    document.title = meta.title;
    upsertMeta("name", "description", meta.description);
    upsertMeta("name", "robots", meta.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large");
    upsertLink("canonical", url);

    upsertMeta("property", "og:type", meta.type ?? "website");
    upsertMeta("property", "og:site_name", SITE.name);
    upsertMeta("property", "og:title", meta.title);
    upsertMeta("property", "og:description", meta.description);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:image", image);
    upsertMeta("property", "og:image:alt", SITE.ogImageAlt);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", meta.title);
    upsertMeta("name", "twitter:description", meta.description);
    upsertMeta("name", "twitter:image", image);

    let script = document.getElementById("clipkit-structured-data");
    if (!script) {
      script = document.createElement("script");
      script.id = "clipkit-structured-data";
      script.setAttribute("type", "application/ld+json");
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLdForPath(path)).replace(/</g, "\\u003c");
  }, [path]);

  return null;
}
