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

function removeMeta(attribute: "name" | "property", key: string) {
  document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)?.remove();
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

function removeLink(rel: string) {
  document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)?.remove();
}

/**
 * Client-side head updates for navigation. The first paint is already correct
 * because the build prerenders every indexable route; this keeps the title,
 * canonical, social tags, article metadata, and JSON-LD correct when the
 * visitor moves between pages without a reload.
 */
export function Seo({ path }: { path: string }) {
  useEffect(() => {
    const meta = metaForPath(path);
    const url = canonicalFor(path);
    const image = new URL(meta.image ?? SITE.ogImage, SITE.url).toString();
    const adsenseClient = String(import.meta.env.VITE_ADSENSE_CLIENT ?? "").trim();

    document.title = meta.title;
    upsertMeta("name", "description", meta.description);
    upsertMeta("name", "robots", meta.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large");
    upsertMeta("name", "theme-color", SITE.themeColor);

    if (meta.noindex) {
      removeLink("canonical");
    } else {
      upsertLink("canonical", url);
    }

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
    upsertMeta("name", "twitter:image:alt", SITE.ogImageAlt);

    if (meta.type === "article" && meta.published && meta.modified) {
      upsertMeta("property", "article:published_time", `${meta.published}T00:00:00Z`);
      upsertMeta("property", "article:modified_time", `${meta.modified}T00:00:00Z`);
    } else {
      removeMeta("property", "article:published_time");
      removeMeta("property", "article:modified_time");
    }

    if (adsenseClient) {
      upsertMeta("name", "google-adsense-account", adsenseClient);
    } else {
      removeMeta("name", "google-adsense-account");
    }

    let script = document.getElementById("cutmoor-structured-data");
    if (!script) {
      script = document.createElement("script");
      script.id = "cutmoor-structured-data";
      script.setAttribute("type", "application/ld+json");
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLdForPath(path)).replace(/</g, "\\u003c");
  }, [path]);

  return null;
}
