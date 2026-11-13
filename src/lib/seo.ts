import { getGuideBody } from "../content/guide-content";
import { GUIDES } from "../content/guides";
import { SITE_PAGES } from "../content/site-pages";
import { TOOLS } from "./tools";

export const SITE = {
  name: "Cutmoor",
  legalName: "Cutmoor",
  url: String(import.meta.env.VITE_SITE_URL || "http://localhost:4173").replace(/\/$/, ""),
  tagline: "Cut more. Upload less.",
  description:
    "Compress, crop, trim, convert, and extract audio from video — or compress, resize, convert, and HEIC-to-JPG your images. Everything runs in your browser. No upload, no account, no watermark.",
  email: "hello@cutmoor.com",
  locale: "en_US",
  language: "en",
  themeColor: "#0b0f17",
  ogImage: "/og-image.png",
  ogImageAlt: "Cutmoor — edit video and photos in your browser, never upload a thing",
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
  title: "Cutmoor — compress video and images in your browser",
  description:
    "Free browser tools to compress video, crop to 9:16, trim, convert, resize photos and turn HEIC into JPG. No upload, no sign-up — files stay on your device.",
  path: "/",
};

const toolsIndex: PageMeta = {
  title: "Free video and image tools — no upload | Cutmoor",
  description:
    "Every Cutmoor tool runs in your browser: compress or trim video, crop to 9:16, extract audio, resize images and convert HEIC to JPG. Free, with no upload.",
  path: "/tools",
};

const guidesIndex: PageMeta = {
  title: "Video and image guides: sizes and settings | Cutmoor",
  description:
    "Practical guides for video and images: compress for WhatsApp and Discord, crop to 9:16, pick the right image size, convert HEIC, and choose PNG, JPG or WebP.",
  path: "/guides",
};

const notFound: PageMeta = {
  title: "Page not found — Cutmoor",
  description: "That page does not exist. Browse the video and image tools or the Cutmoor guides instead.",
  path: "/404",
  noindex: true,
};

const toolPages: PageMeta[] = TOOLS.map((tool) => ({
  title: tool.title,
  description: tool.description,
  path: `/tools/${tool.slug}`,
}));

/** Search results cut titles at roughly 60 characters, so long guide titles get a shorter form. */
const GUIDE_SEO_TITLES: Record<string, string> = {
  "trim-video-online": "How to trim a video online without re-encoding",
  "social-media-image-sizes": "Social media image sizes for 2026: every platform",
  "heic-to-jpg-guide": "HEIC to JPG: why iPhone photos need converting",
  "convert-video-to-gif": "Convert video to GIF: small files that still look good",
  "extract-frame-from-video": "Save a frame from a video as a high-quality image",
};

function guideSeoTitle(guide: { slug: string; title: string }): string {
  const base = GUIDE_SEO_TITLES[guide.slug] ?? guide.title;
  const branded = `${base} — ${SITE.name}`;
  return branded.length <= 60 ? branded : base;
}

const guidePages: PageMeta[] = GUIDES.map((guide) => ({
  title: guideSeoTitle(guide),
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
    slogan: SITE.tagline,
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
    url: `${SITE.url}/tools/`,
    description: SITE.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free tools supported by advertising." },
    featureList: [
      "Compress video to a target file size",
      "Crop and resize video to 9:16, 1:1, and 4:5",
      "Trim video with accurate cuts",
      "Convert MP4, WebM, GIF, and audio",
      "Extract a still frame",
      "Convert SRT and VTT subtitles",
      "Compress images to a target file size",
      "Resize and crop images to social presets",
      "Convert JPG, PNG, and WebP",
      "Convert iPhone HEIC and HEIF photos to JPG",
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
    author: { "@type": "Organization", name: "Cutmoor Team", url: `${SITE.url}/editorial/` },
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
        "@type": "WebApplication",
        "@id": `${canonicalFor(path)}#app`,
        name: `${tool.name} — ${SITE.name}`,
        url: canonicalFor(path),
        description: tool.description,
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Any modern browser",
        browserRequirements: "Requires JavaScript and WebAssembly.",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${SITE.url}/#organization` },
      });
      graph.push({
        "@type": "HowTo",
        name: `How to use ${tool.name} with Cutmoor`,
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
      const faqs = getGuideBody(guide.slug)?.faqs ?? [];
      if (faqs.length) graph.push(faqJsonLd(faqs));
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
    question: "Does Cutmoor upload my video or image?",
    answer:
      "No. Video is encoded inside your browser with WebAssembly, and images are decoded and re-encoded with the canvas API. Files are read from your device, processed in memory, and saved back to your device. There is no Cutmoor server that receives them.",
  },
  {
    question: "Is Cutmoor really free?",
    answer:
      "Yes. Every video and image tool is free, with no account, watermark, or export limit. The site is supported by advertising, which keeps every tool free.",
  },
  {
    question: "Which formats can I use?",
    answer:
      "Video inputs include MP4, MOV, WebM, MKV, and AVI. Image inputs include JPG, PNG, WebP, AVIF, GIF, BMP, HEIC, and HEIF. Exports include MP4, WebM, GIF, MP3, WAV, M4A, JPG, PNG, and WebP, depending on the tool and your browser.",
  },
  {
    question: "Does Cutmoor work offline?",
    answer:
      "Not as a promise. The page and the video encoder have to be downloaded the first time, and Cutmoor has no offline mode. Your browser may keep those files in its cache afterwards, but you should expect to need a connection to open the site.",
  },
  {
    question: "Why does processing speed vary?",
    answer:
      "Everything runs on your own device. The video encoder is a single-threaded WebAssembly build, so the time depends on the length and resolution of the video, the settings you choose, and how fast your device is. After every job the result card shows the processing time that job actually took.",
  },
  {
    question: "Does compression reduce quality?",
    answer:
      "Video compression re-encodes the file, which is lossy, so some detail is always lost. A smaller target size loses more. The before and after previews and the real file sizes on the result card let you judge the trade-off, and Best quality mode keeps more detail. PNG output is lossless.",
  },
  {
    question: "Does Cutmoor work on a phone?",
    answer:
      "It runs in modern mobile browsers, but we have not tested every phone. Phones have less memory than computers, so long or high-resolution videos are more likely to fail. Shorter clips and photos work best on a phone.",
  },
  {
    question: "Can Cutmoor download a video from YouTube or Instagram?",
    answer:
      "No. Cutmoor only works with files you already have. It does not fetch URLs or download content from streaming platforms, and it cannot bypass a platform player.",
  },
  {
    question: "How big can a file be?",
    answer:
      "Browser memory is the real limit. The largest video we have tested is 104 MB (a 20-second 1080p clip), which compressed in about a minute and a half on a desktop. Larger files may work, but they depend on your device's memory, and phones and older laptops are more likely to run out. Image output is capped at 16.7 megapixels for canvas safety, and very large photos are scaled down before export.",
  },
  {
    question: "Do I need to install anything?",
    answer:
      "No. Cutmoor runs in a modern browser on desktop, tablet, and phone. The first video job downloads the encoder once and the browser caches it. iPhone HEIC files may download a separate 3 MB local decoder on Chrome, Edge, and Firefox; Safari uses the system decoder.",
  },
  {
    question: "Why can't I export WebP in Safari?",
    answer:
      "Safari can display WebP but cannot encode it from a canvas, and it silently returns a PNG instead. Cutmoor tests the encoder at runtime and disables WebP export when it is unavailable, so a file with a .webp extension is never actually a PNG. JPG and PNG remain available.",
  },
];
