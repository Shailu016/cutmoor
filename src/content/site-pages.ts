export interface SiteLink {
  label: string;
  href: string;
  description?: string;
}

export interface SiteSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  links?: SiteLink[];
}

export interface SitePage {
  slug: string;
  title: string;
  description: string;
  eyebrow: string;
  updated: string;
  intro: string[];
  sections: SiteSection[];
  footnote?: string;
}

const UPDATED = "2026-11-11";

export const SITE_PAGES: SitePage[] = [
  {
    slug: "about",
    title: "About Cutmoor — the browser media toolkit",
    description:
      "Cutmoor is a free, local-first toolkit for video and images. Compress, crop, trim, convert, resize, and extract audio without uploading your files.",
    eyebrow: "About",
    updated: UPDATED,
    intro: [
      "Cutmoor is a small set of video and image tools that run in your browser. It exists because the everyday jobs around short-form media are boring, repetitive, and usually require a trip through an upload form on someone else's server.",
      "Drop a file, choose a preset, get a clean export. The file is processed on your device. There is no account, no storage bucket, and no queue.",
    ],
    sections: [
      {
        heading: "Who it is for",
        paragraphs: [
          "Creators who need a Reel to fit a size limit. Small teams making product clips and social images on a laptop. Anyone who has recorded a video and discovered it is 180 MB when the app accepts 25 MB, or exported a photo that a job portal refuses because it is 6 MB.",
          "The tools are deliberately narrow. Cutmoor is not an editor, a timeline, or a replacement for Premiere, Final Cut, CapCut, or Photoshop. It is the step after editing: make the file fit, make it the right shape, and get it out.",
        ],
      },
      {
        heading: "Why local processing",
        paragraphs: [
          "Uploading a video or photo is slow, costs the operator bandwidth, and creates a copy of your file on a machine you do not control. Running the encoder in the browser avoids all three.",
          "Video is handled by a WebAssembly build of FFmpeg. Images are decoded and re-encoded with the browser's canvas API, with a lazily loaded HEIC decoder where the operating system does not provide one. The tradeoff is honest: browser processing is limited by the memory of your device. Very large files, especially on phones, can fail. Cutmoor shows the limit before you start and never pretends a job succeeded when it did not.",
        ],
      },
      {
        heading: "What Cutmoor does not do",
        paragraphs: [
          "Cutmoor does not download videos from YouTube, Instagram, TikTok, or any other platform. It only works with files you already have and have the right to use.",
          "It does not upload, store, or share your files. It does not require an account, and it does not add a watermark.",
        ],
      },
      {
        heading: "How it is funded",
        paragraphs: [
          "The free tools are supported by advertising. Ads are only loaded if you accept advertising cookies. There is no paywall on the tools and no plan to add one to the features described on this site.",
          "If you have a question, a bug, or a feature request, use the contact page. Real messages are read.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy policy — Cutmoor",
    description:
      "How Cutmoor handles your files, what stays in your browser, what advertising partners may collect, and how to control it.",
    eyebrow: "Privacy",
    updated: UPDATED,
    intro: [
      "Cutmoor is designed so that the most sensitive thing you bring — the video or photo itself — never leaves your device. This page explains exactly what that means, and what is still collected when you visit the site.",
    ],
    sections: [
      {
        heading: "Your video and image files",
        paragraphs: [
          "Video and audio files are read by your browser and processed in the page using WebAssembly. Images are decoded and re-encoded with the canvas API. They are not uploaded to a Cutmoor server. Cutmoor does not operate a media storage service and does not keep a copy of your file.",
          "HEIC photos are decoded locally. Safari uses the operating system decoder. Chrome, Edge, and Firefox download an open-source libheif decoder once, only when a HEIC file is selected; it runs in the page and does not send the photo anywhere.",
          "When you close or reload the tab, the working copy in memory is released by the browser. The exported file is saved wherever your browser saves downloads.",
        ],
      },
      {
        heading: "Information stored in your browser",
        paragraphs: [
          "Cutmoor stores a single preference in localStorage: your cookie choice. It stays on your device and is not sent to us.",
        ],
        bullets: [
          "Consent choice: accepted or rejected advertising cookies.",
          "No account, email, or payment information is required to use the tools.",
        ],
      },
      {
        heading: "Advertising and cookies",
        paragraphs: [
          "The free site may show Google AdSense ads. When advertising cookies are accepted, Google and its partners may use cookies or device identifiers to serve and measure ads, as described in Google's own privacy policy.",
          "If you reject advertising cookies, Cutmoor does not load the ad script. A non-personalized fallback may be used only where permitted, and no advertising cookies are set by Cutmoor.",
          "For visitors in the EEA, the UK, and Switzerland, ad serving requires a Google-certified consent management platform. The operator of a deployed copy of Cutmoor must configure one before enabling ads in those regions.",
        ],
      },
      {
        heading: "Analytics and server logs",
        paragraphs: [
          "The default build does not include a third-party analytics script. The hosting provider may keep standard request logs, such as IP address, user agent, and the requested URL, for security and reliability. Those logs are controlled by the host, not by the browser tools.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "Because Cutmoor does not create an account or store your files, there is usually no personal profile to export or delete. You can clear the stored preferences at any time through your browser's site data settings.",
          "If you believe a deployed copy of Cutmoor is processing personal data unlawfully, contact the operator of that site. The contact address for this project is listed on the contact page.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If this policy changes, the updated date at the top of the page changes with it. Material changes will be described on this page rather than hidden in a changelog.",
        ],
      },
    ],
    footnote:
      "This page is a plain-language policy, not legal advice. A commercial deployment should have it reviewed for the operator's jurisdiction and ad configuration.",
  },
  {
    slug: "terms",
    title: "Terms of use — Cutmoor",
    description:
      "The rules for using Cutmoor, including acceptable use, intellectual property, warranties, and liability.",
    eyebrow: "Terms",
    updated: UPDATED,
    intro: [
      "These terms apply when you use Cutmoor. By using the site, you agree to them. If you do not agree, do not use the tools.",
    ],
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "Cutmoor provides browser-based tools that transform media files you supply. The tools are provided free of charge, as-is, and may change or be removed at any time.",
          "Cutmoor is not affiliated with YouTube, Instagram, TikTok, Meta, Google, or any other platform. Platform names are used only to describe common file sizes and aspect ratios.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "You may use Cutmoor for files you own or have permission to modify. You are responsible for the content you process and for how you use the result.",
        ],
        bullets: [
          "Do not use Cutmoor to infringe copyright, privacy, or other rights.",
          "Do not use it to circumvent a platform's terms, paywall, or technical protection measure.",
          "Do not attempt to overload, probe, or break the site or its hosting.",
          "Do not resell the service as your own without permission.",
        ],
      },
      {
        heading: "No downloading of third-party content",
        paragraphs: [
          "Cutmoor does not provide a downloader for YouTube, Instagram, TikTok, or other streaming services. It cannot fetch a URL or bypass a platform's player. Any claim that it does is false.",
          "If you need a copy of your own upload, use the export or download feature provided by the platform that hosts it.",
        ],
      },
      {
        heading: "Intellectual property",
        paragraphs: [
          "You keep all rights to the files you process. Cutmoor claims no ownership over your input or output. The Cutmoor name, design, copy, and code are protected by the operator's rights and may not be copied for a competing service without permission.",
        ],
      },
      {
        heading: "No warranty",
        paragraphs: [
          "The tools are provided without warranties of any kind, express or implied, including fitness for a particular purpose. Encoding can fail, produce a different size than requested, or lose quality. Always keep the original file.",
        ],
      },
      {
        heading: "Limitation of liability",
        paragraphs: [
          "To the maximum extent permitted by law, the operator is not liable for indirect, incidental, special, or consequential damages arising from use of the site, including lost content, lost revenue, or damage to a device.",
        ],
      },
      {
        heading: "Changes and contact",
        paragraphs: [
          "These terms may be updated. The date at the top of the page will change. Questions can be sent to the address on the contact page.",
        ],
      },
    ],
    footnote:
      "This page is a plain-language template, not legal advice. A commercial deployment should have it reviewed for the operator's jurisdiction.",
  },
  {
    slug: "cookies",
    title: "Cookie and advertising settings — Cutmoor",
    description:
      "What Cutmoor stores in your browser, how advertising cookies work, and how to change your choice.",
    eyebrow: "Cookies",
    updated: UPDATED,
    intro: [
      "Cutmoor uses the smallest amount of browser storage it can and still remember your choice. This page lists what is stored and how to change it.",
    ],
    sections: [
      {
        heading: "Essential storage",
        paragraphs: [
          "Cutmoor stores your cookie choice in localStorage under a single key. Without it, the banner would reappear on every page. This storage contains no personal information and is not shared.",
        ],
        bullets: [
          "cutmoor-consent — accepted or rejected.",
        ],
      },
      {
        heading: "Advertising cookies",
        paragraphs: [
          "When ads are enabled and you accept, Google AdSense may set cookies to select, deliver, and measure advertising. Those cookies are controlled by Google, not by Cutmoor.",
          "When you reject, Cutmoor does not load the AdSense script. You can change your choice at any time using the button below.",
        ],
      },
      {
        heading: "How to change your choice",
        paragraphs: [
          "Use the button below to clear your saved choice. The banner will appear again on the next page load, and you can accept or reject advertising cookies.",
          "You can also clear site data in your browser settings. Blocking all cookies may affect the ad-supported parts of the site, but the video and image tools will continue to work.",
        ],
      },
      {
        heading: "Third-party policies",
        paragraphs: [
          "Google's use of advertising cookies is described at policies.google.com/technologies/ads. Cutmoor does not control those cookies and cannot delete them on your behalf; use your browser or Google's ad settings.",
        ],
      },
    ],
    footnote:
      "A production deployment that serves ads in the EEA, the UK, or Switzerland must use a Google-certified CMP in addition to this page.",
  },
  {
    slug: "contact",
    title: "Contact Cutmoor — support and feedback",
    description:
      "Report a bug, ask a question, or suggest a tool. The real contact details for Cutmoor.",
    eyebrow: "Contact",
    updated: UPDATED,
    intro: [
      "Cutmoor is a small project. Messages are read, and bug reports with a file description are the fastest way to get a fix.",
    ],
    sections: [
      {
        heading: "Email",
        paragraphs: [
          "Write to hello@cutmoor.com. Include the tool you used and a short description of the file if you are reporting a bug.",
        ],
      },
      {
        heading: "What to include in a bug report",
        paragraphs: [
          "A short description of the file helps more than a screenshot of the error alone.",
        ],
        bullets: [
          "The tool you used and the preset you chose.",
          "File type, approximate size, and dimensions or duration.",
          "Browser and operating system.",
          "What you expected and what happened instead.",
        ],
      },
      {
        heading: "Feature requests",
        paragraphs: [
          "Requests that fit the local-first model are the easiest to add: another preset, another output format, a better limit warning, a batch queue. Requests that require uploading files to a server are unlikely to be accepted.",
        ],
      },
      {
        heading: "Copyright",
        paragraphs: [
          "Cutmoor does not host or index third-party video. If you believe a deployed copy of the site is being used to infringe your rights, contact the operator of that copy with the URL, the work, and a description of the use. Do not send a video file by email.",
        ],
      },
    ],
  },
  {
    slug: "editorial",
    title: "Editorial policy — how Cutmoor guides are made",
    description:
      "How Cutmoor researches, writes, tests, and updates its video and image guides, and how corrections are handled.",
    eyebrow: "Editorial",
    updated: UPDATED,
    intro: [
      "Cutmoor publishes guides because a tool without context is hard to trust. This page explains how the guides are produced and what they are based on.",
    ],
    sections: [
      {
        heading: "Who writes the guides",
        paragraphs: [
          "Guides are written and edited by the Cutmoor team. Each guide is checked against the behavior of the tools on this site: the presets, the limits, the output formats, and the error messages a visitor will actually see.",
          "The team has hands-on experience preparing short-form video and social images for publishing. Where a recommendation depends on a platform's current rules, the guide says so and links to the platform's own documentation when possible.",
        ],
      },
      {
        heading: "How we test",
        paragraphs: [
          "A typical video test uses three files: a 1080p phone clip, a vertical 9:16 clip, and a longer screen recording. An image test uses a 12 MP phone photo, a transparent PNG screenshot, and an iPhone HEIC original. We run each preset, inspect the output size and dimensions, and note where the browser approach fails.",
          "We do not publish invented benchmarks, fake studies, or precise speed claims that depend on a device we cannot see. When we give a number, it is a limit, a platform recommendation, or a setting you can reproduce.",
        ],
      },
      {
        heading: "Updates and corrections",
        paragraphs: [
          "Platform size limits and recommended resolutions change. Guides show a published and updated date. A material change is reflected in both the guide and the date.",
          "If a guide is wrong, email the contact address with the URL and the correction. Confirmed errors are fixed and the updated date changes. We do not quietly edit a claim and leave the old date in place.",
        ],
      },
      {
        heading: "Independence",
        paragraphs: [
          "Guides are not paid placements. Advertising is separated from editorial content and does not determine which tools or settings we recommend. The site is supported by ads, not by sponsored rankings.",
        ],
      },
    ],
  },
  {
    slug: "licences",
    title: "Third-party licences — Cutmoor",
    description:
      "The open-source components that power Cutmoor, including FFmpeg, heic-to, libheif, React, Lucide, and the site fonts, with links to their licences.",
    eyebrow: "Licences",
    updated: UPDATED,
    intro: [
      "Cutmoor is built on open-source software. The browser does the heavy lifting, and several of those components carry obligations that are worth stating plainly.",
      "The list below covers the components that are distributed to visitors as part of the site, plus the libraries used to build it. Full licence texts are available at the linked upstream projects and in the repository's THIRD_PARTY_NOTICES.md.",
    ],
    sections: [
      {
        heading: "FFmpeg and ffmpeg.wasm",
        paragraphs: [
          "Video decoding and encoding use FFmpeg, compiled to WebAssembly and delivered by the ffmpeg.wasm project. The @ffmpeg/core build used by Cutmoor is licensed under the GNU General Public License version 2 or later (GPL-2.0-or-later).",
          "The corresponding source code is available from the FFmpeg project and the ffmpeg.wasm repository, including the scripts used to build the WebAssembly core. If you deploy a modified version of the core, you are responsible for providing the corresponding source under the GPL.",
        ],
        links: [
          { label: "FFmpeg", href: "https://ffmpeg.org/", description: "GPL-2.0-or-later for this build." },
          {
            label: "ffmpeg.wasm",
            href: "https://github.com/ffmpegwasm/ffmpeg.wasm",
            description: "build and packaging source.",
          },
          { label: "@ffmpeg/ffmpeg and @ffmpeg/util", href: "https://github.com/ffmpegwasm/ffmpeg.wasm", description: "MIT." },
        ],
      },
      {
        heading: "HEIC decoding",
        paragraphs: [
          "The HEIC converter uses the heic-to library, which bundles a WebAssembly build of libheif and the libde265 decoder. These components are licensed under the GNU Lesser General Public License version 3 (LGPL-3.0).",
          "The decoder is loaded lazily, only when a HEIC file is selected, and runs entirely in the browser. Cutmoor does not modify the library. The upstream source is linked below so the corresponding source can be obtained.",
        ],
        links: [
          { label: "heic-to by Hopper Gee", href: "https://github.com/hoppergee/heic-to", description: "LGPL-3.0." },
          { label: "libheif", href: "https://github.com/strukturag/libheif", description: "LGPL-3.0." },
          { label: "libde265", href: "https://github.com/strukturag/libde265", description: "LGPL-3.0." },
        ],
      },
      {
        heading: "Interface and build libraries",
        paragraphs: [
          "The interface is built with React and React Router under the MIT licence. Icons come from Lucide under the ISC licence. The site is built with Vite under the MIT licence.",
        ],
        links: [
          { label: "React and React DOM", href: "https://github.com/facebook/react", description: "MIT." },
          { label: "React Router", href: "https://github.com/remix-run/react-router", description: "MIT." },
          { label: "Lucide", href: "https://github.com/lucide-icons/lucide", description: "ISC." },
          { label: "Vite", href: "https://github.com/vitejs/vite", description: "MIT." },
        ],
      },
      {
        heading: "Fonts",
        paragraphs: [
          "Fraunces and Manrope are served through Fontsource and are licensed under the SIL Open Font License 1.1. The fonts are self-hosted with the site, not fetched from a third-party font service.",
        ],
        links: [
          { label: "Fraunces", href: "https://github.com/undercasetype/Fraunces", description: "OFL-1.1." },
          { label: "Manrope", href: "https://github.com/sharanda/manrope", description: "OFL-1.1." },
          { label: "Fontsource", href: "https://github.com/fontsource/fontsource", description: "MIT packaging." },
        ],
      },
      {
        heading: "No warranty",
        paragraphs: [
          "These components are provided as-is, without warranty of any kind. The licence texts control the rights and obligations that apply to each component; this page is a summary, not a substitute for those texts.",
        ],
      },
    ],
    footnote:
      "If you deploy Cutmoor commercially, review the GPL and LGPL obligations with your own counsel and keep the linked source and notices available to visitors.",
  },
];

export function sitePageBySlug(slug: string): SitePage | undefined {
  return SITE_PAGES.find((page) => page.slug === slug);
}
