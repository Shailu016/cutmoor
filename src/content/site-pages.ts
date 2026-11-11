export interface SiteSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
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
    title: "About ClipKit — the browser video toolkit",
    description:
      "ClipKit is a free, local-first video toolkit for creators. Compress, crop, trim, convert, and extract audio without uploading your files.",
    eyebrow: "About",
    updated: UPDATED,
    intro: [
      "ClipKit is a small set of video tools that run in your browser. It exists because the everyday jobs around short-form video are boring, repetitive, and usually require a trip through an upload form on someone else's server.",
      "Drop a file, choose a preset, get a clean export. The file is processed on your device. There is no account, no storage bucket, and no queue.",
    ],
    sections: [
      {
        heading: "Who it is for",
        paragraphs: [
          "Creators who need a Reel to fit a size limit. Small teams making product clips on a laptop. Anyone who has recorded a video and discovered it is 180 MB when the app accepts 25 MB.",
          "The tools are deliberately narrow. ClipKit is not an editor, a timeline, or a replacement for Premiere, Final Cut, or CapCut. It is the step after editing: make the file fit, make it the right shape, and get it out.",
        ],
      },
      {
        heading: "Why local processing",
        paragraphs: [
          "Uploading a video is slow, costs the operator bandwidth, and creates a copy of your file on a machine you do not control. Running the encoder in the browser avoids all three.",
          "The tradeoff is honest: browser processing is limited by the memory of your device. Very large files, especially on phones, can fail. ClipKit shows the limit before you start and never pretends a job succeeded when it did not.",
        ],
      },
      {
        heading: "What ClipKit does not do",
        paragraphs: [
          "ClipKit does not download videos from YouTube, Instagram, TikTok, or any other platform. It only works with files you already have and have the right to use.",
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
    title: "Privacy policy — ClipKit",
    description:
      "How ClipKit handles your files, what stays in your browser, what advertising partners may collect, and how to control it.",
    eyebrow: "Privacy",
    updated: UPDATED,
    intro: [
      "ClipKit is designed so that the most sensitive thing you bring — the video itself — never leaves your device. This page explains exactly what that means, and what is still collected when you visit the site.",
    ],
    sections: [
      {
        heading: "Your video files",
        paragraphs: [
          "Video and audio files are read by your browser and processed in the page using WebAssembly. They are not uploaded to a ClipKit server. ClipKit does not operate a video storage service and does not keep a copy of your file.",
          "When you close or reload the tab, the working copy in memory is released by the browser. The exported file is saved wherever your browser saves downloads.",
        ],
      },
      {
        heading: "Information stored in your browser",
        paragraphs: [
          "ClipKit stores a small number of preferences in localStorage: your cookie choice, and interface settings such as the last tool you used. These stay on your device and are not sent to us.",
        ],
        bullets: [
          "Consent choice: accepted or rejected advertising cookies.",
          "Interface preferences: for example, a remembered output preset.",
          "No account, email, or payment information is required to use the tools.",
        ],
      },
      {
        heading: "Advertising and cookies",
        paragraphs: [
          "The free site may show Google AdSense ads. When advertising cookies are accepted, Google and its partners may use cookies or device identifiers to serve and measure ads, as described in Google's own privacy policy.",
          "If you reject advertising cookies, ClipKit does not load the ad script. A non-personalized fallback may be used only where permitted, and no advertising cookies are set by ClipKit.",
          "For visitors in the EEA, the UK, and Switzerland, ad serving requires a Google-certified consent management platform. The operator of a deployed copy of ClipKit must configure one before enabling ads in those regions.",
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
          "Because ClipKit does not create an account or store your files, there is usually no personal profile to export or delete. You can clear the stored preferences at any time through your browser's site data settings.",
          "If you believe a deployed copy of ClipKit is processing personal data unlawfully, contact the operator of that site. The contact address for this project is listed on the contact page.",
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
    title: "Terms of use — ClipKit",
    description:
      "The rules for using ClipKit, including acceptable use, intellectual property, warranties, and liability.",
    eyebrow: "Terms",
    updated: UPDATED,
    intro: [
      "These terms apply when you use ClipKit. By using the site, you agree to them. If you do not agree, do not use the tools.",
    ],
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "ClipKit provides browser-based tools that transform media files you supply. The tools are provided free of charge, as-is, and may change or be removed at any time.",
          "ClipKit is not affiliated with YouTube, Instagram, TikTok, Meta, Google, or any other platform. Platform names are used only to describe common file sizes and aspect ratios.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "You may use ClipKit for files you own or have permission to modify. You are responsible for the content you process and for how you use the result.",
        ],
        bullets: [
          "Do not use ClipKit to infringe copyright, privacy, or other rights.",
          "Do not use it to circumvent a platform's terms, paywall, or technical protection measure.",
          "Do not attempt to overload, probe, or break the site or its hosting.",
          "Do not resell the service as your own without permission.",
        ],
      },
      {
        heading: "No downloading of third-party content",
        paragraphs: [
          "ClipKit does not provide a downloader for YouTube, Instagram, TikTok, or other streaming services. It cannot fetch a URL or bypass a platform's player. Any claim that it does is false.",
          "If you need a copy of your own upload, use the export or download feature provided by the platform that hosts it.",
        ],
      },
      {
        heading: "Intellectual property",
        paragraphs: [
          "You keep all rights to the files you process. ClipKit claims no ownership over your input or output. The ClipKit name, design, copy, and code are protected by the operator's rights and may not be copied for a competing service without permission.",
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
    title: "Cookie and advertising settings — ClipKit",
    description:
      "What ClipKit stores in your browser, how advertising cookies work, and how to change your choice.",
    eyebrow: "Cookies",
    updated: UPDATED,
    intro: [
      "ClipKit uses the smallest amount of browser storage it can and still remember your choice. This page lists what is stored and how to change it.",
    ],
    sections: [
      {
        heading: "Essential storage",
        paragraphs: [
          "ClipKit stores your cookie choice in localStorage under a single key. Without it, the banner would reappear on every page. This storage contains no personal information and is not shared.",
        ],
        bullets: [
          "clipkit-consent — accepted or rejected.",
          "clipkit-preference — an optional interface setting, such as a saved preset.",
        ],
      },
      {
        heading: "Advertising cookies",
        paragraphs: [
          "When ads are enabled and you accept, Google AdSense may set cookies to select, deliver, and measure advertising. Those cookies are controlled by Google, not by ClipKit.",
          "When you reject, ClipKit does not load the AdSense script. You can change your choice at any time using the button below.",
        ],
      },
      {
        heading: "How to change your choice",
        paragraphs: [
          "Use the button below to clear your saved choice. The banner will appear again on the next page load, and you can accept or reject advertising cookies.",
          "You can also clear site data in your browser settings. Blocking all cookies may affect the ad-supported parts of the site, but the video tools will continue to work.",
        ],
      },
      {
        heading: "Third-party policies",
        paragraphs: [
          "Google's use of advertising cookies is described at policies.google.com/technologies/ads. ClipKit does not control those cookies and cannot delete them on your behalf; use your browser or Google's ad settings.",
        ],
      },
    ],
    footnote:
      "A production deployment that serves ads in the EEA, the UK, or Switzerland must use a Google-certified CMP in addition to this page.",
  },
  {
    slug: "contact",
    title: "Contact ClipKit — support and feedback",
    description:
      "Report a bug, ask a question, or suggest a tool. The real contact details for ClipKit.",
    eyebrow: "Contact",
    updated: UPDATED,
    intro: [
      "ClipKit is a small project. Messages are read, and bug reports with a file description are the fastest way to get a fix.",
    ],
    sections: [
      {
        heading: "Email",
        paragraphs: [
          "Write to hello@clipkit.tools. Include the tool you used and a short description of the file if you are reporting a bug.",
        ],
      },
      {
        heading: "What to include in a bug report",
        paragraphs: [
          "A short description of the file helps more than a screenshot of the error alone.",
        ],
        bullets: [
          "The tool you used and the preset you chose.",
          "File type, approximate size, and duration.",
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
          "ClipKit does not host or index third-party video. If you believe a deployed copy of the site is being used to infringe your rights, contact the operator of that copy with the URL, the work, and a description of the use. Do not send a video file by email.",
        ],
      },
    ],
  },
  {
    slug: "editorial",
    title: "Editorial policy — how ClipKit guides are made",
    description:
      "How ClipKit researches, writes, tests, and updates its video guides, and how corrections are handled.",
    eyebrow: "Editorial",
    updated: UPDATED,
    intro: [
      "ClipKit publishes guides because a tool without context is hard to trust. This page explains how the guides are produced and what they are based on.",
    ],
    sections: [
      {
        heading: "Who writes the guides",
        paragraphs: [
          "Guides are written and edited by the ClipKit team. Each guide is checked against the behavior of the tools on this site: the presets, the limits, the output formats, and the error messages a visitor will actually see.",
          "The team has hands-on experience preparing short-form video for social platforms. Where a recommendation depends on a platform's current rules, the guide says so and links to the platform's own documentation when possible.",
        ],
      },
      {
        heading: "How we test",
        paragraphs: [
          "A typical test uses three files: a 1080p phone clip, a vertical 9:16 clip, and a longer screen recording. We run each preset, inspect the output size and duration, and note where the browser approach fails.",
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
];

export function sitePageBySlug(slug: string): SitePage | undefined {
  return SITE_PAGES.find((page) => page.slug === slug);
}
