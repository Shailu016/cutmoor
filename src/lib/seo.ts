import { GUIDES } from "../content/guides";
import { SITE_PAGES } from "../content/site-pages";
import { TOOLS } from "./tools";

export const SITE = {
  name: "ClipKit",
  legalName: "ClipKit",
  url: (import.meta.env.VITE_SITE_URL || "https://clipkit.tools").replace(/\/$/, ""),
  tagline: "Your video. Ready for every platform.",
  description:
    "Compress, crop, trim, convert, and extract audio from video in your browser. No upload, no account, no watermark. Free tools for Reels, Shorts, and TikTok.",
  email: "hello@clipkit.tools",
  locale: "en_US",
  language: "en",
  themeColor: "#101311",
  ogImage: "/og-image.png",
  ogImageAlt: "ClipKit — browser video tools for Reels, Shorts, and TikTok",
};

export type PageType = "website" | "article";

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  type?: PageType;
  noindex?: boolean;
  published?: string;
  modified?: string;
  image?: string;
}

const home: PageMeta = {
  title: "ClipKit — compress, crop, and convert video in your browser",
  description:
    "Free browser video tools for creators: compress to a target size, crop to 9:16, trim, convert, and extract audio. Your file never leaves your device.",
  path: "/",
};

const toolsIndex: PageMeta = {
  title: "Free video tools — compress, crop, trim, convert | ClipKit",
  description:
    "Every ClipKit tool runs locally in your browser. Compress a video, crop it to 9:16, trim the ends, convert the format, or pull out the audio.",
  path: "/tools",
};

const guidesIndex: PageMeta = {
  title: "Video guides — sizes, limits, and settings | ClipKit",
  description:
    "Practical guides for short-form video: compress for WhatsApp and Discord, crop to 9:16, choose the right Reels size, and reduce file size without ruining quality.",
  path: "/guides",
};

const notFound: PageMeta = {
  title: "Page not found — ClipKit",
  description: "That page does not exist. Browse the video tools or the ClipKit guides instead.",
  path: "/404",
  noindex: true,
};

const toolPages: PageMeta[] = TOOLS.map((tool) => ({
  title: tool.title,
  description: tool.description,
  path: `/tools/${tool.slug}`,
}));

const guidePages: PageMeta[] = GUIDES.map((guide) => ({
  title: `${guide.title} — ClipKit`,
  description: guide.description,
  path: `/guides/${guide.slug}`,
  type: "article",
  published: guide.published,
  modified: guide.modified,
}));

const sitePages: PageMeta[] = SITE_PAGES.map((page) => ({
  title: page.title,
  description: page.description,
  path: `/${page.slug}`,
  modified: page.updated,
}));

export const PAGE_META: PageMeta[] = [home, toolsIndex, guidesIndex, ...toolPages, ...guidePages, ...sitePages, notFound];

export const INDEXABLE_PAGES: PageMeta[] = PAGE_META.filter((page) => !page.noindex);

export function normalizePath(pathname: string): string {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  if (clean === "/") return "/";
  return clean.replace(/\/+$/, "") || "/";
}

export function metaForPath(pathname: string): PageMeta {
  const path = normalizePath(pathname);
  return PAGE_META.find((page) => page.path === path) ?? { ...notFound, path };
}

export function canonicalFor(pathname: string): string {
  const path = normalizePath(pathname);
  return path === "/" ? `${SITE.url}/` : `${SITE.url}${path}/`;
}

export function absoluteUrl(pathname: string): string {
  return pathname.startsWith("http") ? pathname : `${SITE.url}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
}

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": `${SITE.url}/#organization`,
    name: SITE.name,
    url: `${SITE.url}/`,
    email: SITE.email,
    description: SITE.description,
    logo: { "@type": "ImageObject", url: absoluteUrl("/icon-512.png"), width: 512, height: 512 },
  };
}

export function websiteJsonLd() {
  return {
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    url: `${SITE.url}/`,
    name: SITE.name,
    description: SITE.description,
    publisher: { "@id": `${SITE.url}/#organization` },
    inLanguage: "en",
  };
}

export function softwareJsonLd() {
  return {
    "@type": "WebApplication",
    "@id": `${SITE.url}/#app`,
    name: SITE.name,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any modern browser",
    url: `${SITE.url}/tools`,
    description: SITE.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free tools supported by advertising." },
    featureList: [
      "Compress video to a target file size",
      "Crop and resize to 9:16, 1:1, and 4:5",
      "Trim video with accurate cuts",
      "Convert MP4, WebM, GIF, and audio",
      "Extract a still frame",
      "Convert SRT and VTT subtitles",
      "Local browser processing with no upload",
    ],
    isAccessibleForFree: true,
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: canonicalFor(item.path),
    })),
  };
}

export function faqJsonLd(faqs: { question: string; answer: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

export function articleJsonLd(guide: {
  slug: string;
  title: string;
  description: string;
  published: string;
  modified: string;
  readingMinutes: number;
}) {
  return {
    "@type": "Article",
    "@id": `${SITE.url}/guides/${guide.slug}#article`,
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.modified,
    timeRequired: `PT${guide.readingMinutes}M`,
    mainEntityOfPage: canonicalFor(`/guides/${guide.slug}`),
    image: [absoluteUrl(SITE.ogImage)],
    author: { "@type": "Organization", name: "ClipKit Team", url: `${SITE.url}/editorial/` },
    publisher: { "@id": `${SITE.url}/#organization` },
    isAccessibleForFree: true,
  };
}

export function jsonLdForPath(pathname: string): Record<string, unknown> {
  const path = normalizePath(pathname);
  const graph: Record<string, unknown>[] = [organizationJsonLd(), websiteJsonLd()];

  if (path === "/" || path === "/tools") {
    graph.push(softwareJsonLd());
  }

  if (path === "/") {
    graph.push(faqJsonLd(HOME_FAQS));
  }

  if (path === "/tools") {
    graph.push({
      "@type": "CollectionPage",
      name: toolsIndex.title,
      description: toolsIndex.description,
      hasPart: TOOLS.map((tool) => ({
        "@type": "WebApplication",
        name: tool.name,
        url: canonicalFor(`/tools/${tool.slug}`),
        description: tool.description,
      })),
    });
  }

  if (path.startsWith("/tools/")) {
    const tool = TOOLS.find((item) => `/tools/${item.slug}` === path);
    if (tool) {
      graph.push({
        "@type": "HowTo",
        name: `How to ${tool.name.toLowerCase()} with ClipKit`,
        description: tool.intro,
        step: tool.steps.map((step, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          name: step.name,
          text: step.text,
        })),
      });
      graph.push(faqJsonLd(tool.faqs));
      graph.push(
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Tools", path: "/tools" },
          { name: tool.name, path: `/tools/${tool.slug}` },
        ]),
      );
    }
  }

  if (path === "/guides") {
    graph.push({
      "@type": "CollectionPage",
      name: guidesIndex.title,
      description: guidesIndex.description,
      hasPart: GUIDES.map((guide) => ({
        "@type": "Article",
        headline: guide.title,
        url: canonicalFor(`/guides/${guide.slug}`),
        description: guide.description,
        datePublished: guide.published,
      })),
    });
  }

  if (path.startsWith("/guides/")) {
    const guide = GUIDES.find((item) => `/guides/${item.slug}` === path);
    if (guide) {
      graph.push(articleJsonLd(guide));
      graph.push(
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Guides", path: "/guides" },
          { name: guide.title, path: `/guides/${guide.slug}` },
        ]),
      );
      if (guide.faqs.length) graph.push(faqJsonLd(guide.faqs));
    }
  }

  if (path !== "/" && !path.startsWith("/tools") && !path.startsWith("/guides")) {
    const meta = metaForPath(path);
    graph.push({
      "@type": "WebPage",
      name: meta.title,
      description: meta.description,
      url: canonicalFor(path),
      isPartOf: { "@id": `${SITE.url}/#website` },
      dateModified: meta.modified,
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

export const HOME_FAQS = [
  {
    question: "Does ClipKit upload my video?",
    answer:
      "No. The encoder runs inside your browser using WebAssembly. The file is read from your device, processed in memory, and saved back to your device. There is no ClipKit server that receives the video.",
  },
  {
    question: "Is ClipKit really free?",
    answer:
      "Yes. Every tool is free and there is no account, watermark, or export limit. The site is supported by advertising, which only loads if you accept advertising cookies.",
  },
  {
    question: "Which video formats can I use?",
    answer:
      "MP4, MOV, WebM, MKV, and AVI are accepted as inputs. Exports are MP4 by default, with WebM, GIF, MP3, WAV, M4A, PNG, and JPG available depending on the tool.",
  },
  {
    question: "Can ClipKit download a video from YouTube or Instagram?",
    answer:
      "No. ClipKit only works with files you already have. It does not fetch URLs or download content from streaming platforms, and it cannot bypass a platform player.",
  },
  {
    question: "How big can a video be?",
    answer:
      "Browser memory is the real limit. Files up to about 500 MB work on a desktop with 8 GB of RAM. Phones and older laptops should stay under 200 MB. A very large file may run out of memory in the tab.",
  },
  {
    question: "Do I need to install anything?",
    answer:
      "No. ClipKit runs in a modern browser on desktop, tablet, and phone. The first job downloads the encoder once, then the browser caches it for later jobs.",
  },
];
