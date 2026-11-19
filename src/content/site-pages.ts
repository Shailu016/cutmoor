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
/** The privacy policy was revised separately: analytics disclosure, the network check, and Cloudflare Web Analytics. */
const PRIVACY_UPDATED = "2026-11-17";
/** The About page was revised for the Add captions tool. */
const CAPTIONS_UPDATED = "2026-11-13";
/** The Licences page was revised when the second speech model shipped. */
const LICENCES_UPDATED = "2026-11-17";

export const SITE_PAGES: SitePage[] = [
  {
    slug: "about",
    title: "About Cutmoor — the browser media toolkit",
    description:
      "Cutmoor is a free, local-first toolkit for video and images. Compress, crop, trim, convert, resize, and extract audio without uploading your files.",
    eyebrow: "About",
    updated: CAPTIONS_UPDATED,
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
          "We never receive your media: the tools do not upload, store, or share your files. They do not require an account, and they do not add a watermark.",
          "One tool, Add captions, downloads a speech-recognition model to your browser the first time you use it. The model comes to your device; your audio, video, and transcript never go the other way.",
        ],
      },
      {
        heading: "How it is funded",
        paragraphs: [
          "The free tools are supported by advertising served by Google AdSense. There is no paywall on the tools and no plan to add one to the features described on this site.",
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
    updated: PRIVACY_UPDATED,
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
          "Cutmoor itself sets no tracking cookies and keeps no account data. The tools work without storing anything about you in the browser.",
        ],
        bullets: [
          "Advertising cookies, where used, are set by Google and its partners, not by Cutmoor. They are described in the next section.",
          "No account, email, or payment information is required to use the tools.",
        ],
      },
      {
        heading: "Advertising and cookies",
        paragraphs: [
          "The site shows ads served by Google AdSense. Third-party vendors, including Google, use cookies and device identifiers to serve and measure ads based on your prior visits to this website and other websites.",
          "Google's use of advertising cookies enables it and its partners to serve ads based on your visits to this site and other sites on the internet. You can opt out of personalised advertising at any time in Google's Ads Settings (adssettings.google.com), or opt out of many third-party vendors at aboutads.info/choices.",
          "Google requires consent before personalised ads are shown to visitors in the EEA, the UK, and Switzerland. Where it applies, that consent is collected by Google's own certified consent message, and you can change your answer from the same message. Your files are never part of advertising: ad partners cannot see the videos or images you process.",
        ],
      },
      {
        heading: "Analytics and server logs",
        paragraphs: [
          "Cutmoor counts visits with Cloudflare Web Analytics, the same company that hosts the site. It does not use cookies, does not follow you from one site to another, and does not build a profile of you. It records only what a normal web request already contains, such as the page visited, the country, the browser and device type, and how fast the page loaded. It never sees your files, their names, or any text you type: the tools run on your device and send nothing. The counting script is added by Cloudflare when a page is delivered; it is not part of Cutmoor's own code, and the Add captions page does not load it, because that page's security policy refuses every host except our model host.",
          "Cloudflare and the other hosts we use may also keep standard request logs, such as IP address, user agent, and the requested URL, for security and reliability. Those logs are controlled by the provider, not by the browser tools. Search engines such as Google may also tell us which searches led people to the site, through their own search reports; that data comes from the search engine, not from your device.",
          "The video encoder program file (FFmpeg compiled to WebAssembly) may be delivered from a public content network, unpkg.com, which receives the same standard request data when your browser downloads it. Only the program file is fetched from there; your videos and photos are never sent anywhere. The site checks the file's SHA-256 fingerprint before running it.",
        ],
      },
      {
        heading: "What we checked",
        paragraphs: [
          "On 13 November 2026 we recorded every network request the live site made while it compressed a multi-megabyte test video in Chrome. During processing, the only requests were downloads: the encoder program from unpkg.com and the page's own worker script. No request carried the video, and no request in the whole session had a body larger than 1 KB.",
          "When the page first loaded, the browser also contacted Google (AdSense and its consent message). Those requests carry ordinary page and device information, not your files.",
          "This is a point-in-time check of the live site, not a promise about future versions. You can repeat it yourself: open your browser's developer tools, go to the Network tab, process a file, and look for any request that sends data out.",
        ],
      },
      {
        heading: "Add captions and the model download",
        paragraphs: [
          "The Add captions tool needs a speech-recognition model, which is a large file. The first time you choose to use it, the page shows the download size and the host, and asks before anything is fetched. The model is downloaded from models.cutmoor.com, which is our own Cloudflare R2 storage, once, and your browser then keeps it so later jobs start without downloading again. The page checks each file against a known fingerprint (SHA-256) before using it.",
          "Your audio, video, and transcript are processed on your device and never leave it. We never receive your media. The only thing the tool requests from the network is the model file itself.",
        ],
        bullets: [
          "What the model host can see: your IP address, your browser's user agent, which file you requested, and the standard request details that web servers and Cloudflare keep in their logs. It cannot see your video, audio, transcript, or file names, because none of them are sent.",
          "To delete the cached model, use the tool's Delete model button, or clear this site's data in your browser settings. Deleting it means the next use will ask to download it again.",
          "The model download is separate from advertising: ad partners never receive your video, audio, or transcript.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "Because Cutmoor does not create an account or store your files, there is usually no personal profile to export or delete. Cutmoor does not keep cookies or local storage of its own; your browser may cache the site's files, which you can clear at any time through your browser's site data settings.",
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
      "The rules for using Cutmoor, including acceptable use, intellectual property, warranties, and liability, written in plain language.",
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
      "What Cutmoor stores in your browser, how Google advertising cookies work on this site, and how to control personalised ads or clear stored data.",
    eyebrow: "Cookies",
    updated: UPDATED,
    intro: [
      "Cutmoor uses as little browser storage as it can. This page lists what is stored, who stores it, and how you control it.",
    ],
    sections: [
      {
        heading: "Essential storage",
        paragraphs: [
          "The tools need no cookies of their own. Your browser caches the video encoder and, if you convert a HEIC photo, the HEIC decoder, so later jobs start faster. That cache holds program files only, never your media.",
        ],
        bullets: [
          "Browser cache — the encoder and decoder program files, stored by your browser and cleared with your site data.",
        ],
      },
      {
        heading: "Advertising cookies",
        paragraphs: [
          "Google AdSense and its partners set cookies to select, deliver, and measure advertising, including ads based on your earlier visits to this and other websites. Those cookies are controlled by Google, not by Cutmoor.",
          "In the EEA, the UK, and Switzerland, Google requires consent before personalised ads are shown and collects it through its own consent message. Everywhere, you can turn off personalised ads in Google's Ads Settings.",
        ],
      },
      {
        heading: "How to change your choice",
        paragraphs: [
          "Open adssettings.google.com to switch personalised ads on or off for your Google account or browser, or visit aboutads.info/choices to opt out of many advertising vendors at once. Where Google's consent message is shown, you can reopen it to change your answer.",
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
      "Advertising choices are managed by Google. Cutmoor cannot read or delete Google's cookies on your behalf.",
  },
  {
    slug: "contact",
    title: "Contact Cutmoor — support and feedback",
    description:
      "Report a bug, ask a question, or suggest a new tool. Contact details for the Cutmoor team, plus what to include so a bug gets fixed faster.",
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
      "The open-source components that power Cutmoor, including FFmpeg, libheif, ONNX Runtime Web, the AI models, React, and the site fonts, with their licences.",
    eyebrow: "Licences",
    updated: LICENCES_UPDATED,
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
        heading: "Add captions: runtime and video export",
        paragraphs: [
          "The Add captions tool runs its speech models with ONNX Runtime Web 1.31, published by Microsoft under the MIT licence. Burned-in caption video is written with Mediabunny, published by Vanilagy under the Mozilla Public License 2.0 (MPL-2.0).",
          "Cutmoor uses Mediabunny unmodified. MPL-2.0 is a file-level licence: its source files keep their licence headers, and anyone who changes those files and distributes them must publish the changes under the same licence. The video and audio codecs used for export come from your browser, not from Cutmoor.",
        ],
        links: [
          { label: "ONNX Runtime", href: "https://github.com/microsoft/onnxruntime", description: "MIT." },
          { label: "Mediabunny", href: "https://github.com/Vanilagy/mediabunny", description: "MPL-2.0." },
        ],
      },
      {
        heading: "Home page drawings and the AAC sound encoder",
        paragraphs: [
          "The small hand-drawn scenes on the home page are drawn with stick-scene by Kamran Ahmed, published under the MIT licence. Cutmoor ships its runtime unchanged and its own scenes beside it, and loads both from this site.",
          "When a browser cannot encode AAC sound, the compressor adds an AAC encoder from the @mediabunny/aac-encoder package by Vanilagy, published under the Mozilla Public License 2.0 (MPL-2.0). It is built on FFmpeg's AAC encoder, which is LGPL-licensed. It is used unmodified and loads only when it is needed.",
        ],
        links: [
          { label: "stick-scene", href: "https://github.com/nilbuild/stick-scene", description: "MIT." },
          { label: "@mediabunny/aac-encoder", href: "https://github.com/Vanilagy/mediabunny", description: "MPL-2.0, with FFmpeg's LGPL AAC encoder." },
        ],
      },
      {
        heading: "Add captions: speech models",
        paragraphs: [
          "The tool offers two speech-recognition models, both by Oriserve and both declared Apache-2.0. Draft is Whisper-Hindi2Hinglish-Swift, a fine-tune of OpenAI Whisper base. The Hugging Face user di12355 converted it to ONNX, and the download is about 160 MB. High accuracy is Whisper-Hindi2Hinglish-Apex, a fine-tune of OpenAI whisper-large-v3-turbo. Cutmoor converted it to ONNX and compressed the weights to 4-bit, and the download is about 800 MB. High accuracy needs WebGPU, so it runs in recent Chrome or Edge on a computer.",
          "Oriserve describes its training data as proprietary or partly proprietary and does not publish it. We rely on the Apache-2.0 licence each model page declares and have not independently verified the training data.",
          "Silero VAD v6 by the Silero Team is part of the app's model files, but Add captions does not run it: that page uses a small built-in vocal-activity detector to decide which stretches to read. The Silero repository's LICENSE file says MIT.",
          "Both models download once from models.cutmoor.com after the visitor agrees, are checked against SHA-256 fingerprints shipped with the site, and are stored in the browser. Nothing else is sent anywhere.",
        ],
        links: [
          {
            label: "Whisper-Hindi2Hinglish-Swift (Oriserve)",
            href: "https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Swift",
            description: "Apache-2.0.",
          },
          {
            label: "Whisper-Hindi2Hinglish-Apex (Oriserve)",
            href: "https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Apex",
            description: "Apache-2.0.",
          },
          {
            label: "whisper-hinglish-swift-onnx (di12355)",
            href: "https://huggingface.co/di12355/whisper-hinglish-swift-onnx",
            description: "ONNX conversion of the Draft model; Apache-2.0 with the OpenAI Whisper MIT notice.",
          },
          { label: "OpenAI Whisper", href: "https://github.com/openai/whisper", description: "MIT." },
          { label: "Silero VAD", href: "https://github.com/snakers4/silero-vad", description: "MIT per the repository LICENSE file; v6." },
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
          "Geist and Geist Mono are served through Fontsource and are licensed under the SIL Open Font License 1.1. The fonts are self-hosted with the site, not fetched from a third-party font service.",
        ],
        links: [
          { label: "Geist", href: "https://github.com/vercel/geist-font", description: "OFL-1.1." },
          { label: "Geist Mono", href: "https://github.com/vercel/geist-font", description: "OFL-1.1." },
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
