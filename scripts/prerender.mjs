/**
 * Post-build prerender.
 *
 * 1. Vite builds the client into dist/.
 * 2. Vite builds src/entry-server.tsx into dist-ssr/.
 * 3. This script renders every indexable route to static HTML, injects the
 *    route-specific head, and writes the sitemap, robots.txt, and ads.txt.
 *
 * The result is a fully crawlable static site with no server requirement.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "vite";

const root = process.cwd();
const dist = join(root, "dist");
const ssrDir = join(root, "dist-ssr");
const env = { ...loadEnv("production", root, ""), ...process.env };

const entryUrl = `${pathToFileURL(join(ssrDir, "entry-server.js")).href}?t=${Date.now()}`;
const { INDEXABLE_PAGES, SITE_URL, SITE_INFO, LLM_TOOLS, LLM_CATEGORIES, LLM_GUIDES, headForPath, render } = await import(entryUrl);

const HEAD_MARKER = "<!--cutmoor-head-->";
const ROOT_MARKER = '<div id="root"></div>';

const template = await readFile(join(dist, "index.html"), "utf8");
if (!template.includes(HEAD_MARKER)) {
  throw new Error(`Prerender marker ${HEAD_MARKER} was not found in dist/index.html.`);
}
if (!template.includes(ROOT_MARKER)) {
  throw new Error("The app root placeholder was not found in dist/index.html.");
}

// Preload the one font file every page needs, so text paints without a swap.
const assetFiles = await readdir(join(dist, "assets"));
const bodyFont = assetFiles.find((name) => /^geist-latin-wght-normal-.*\.woff2$/.test(name));
const fontPreload = bodyFont
  ? `<link rel="preload" href="/assets/${bodyFont}" as="font" type="font/woff2" crossorigin />\n    `
  : "";

function htmlFor(route, markup) {
  return template
    .replace(HEAD_MARKER, fontPreload + headForPath(route))
    .replace(ROOT_MARKER, `<div id="root" data-route="${route}">${markup}</div>`);
}

async function writeRoute(route, markup) {
  const directory = route === "/" ? dist : join(dist, route.replace(/^\/+/, ""));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), htmlFor(route, markup), "utf8");
}

async function writeFileAt(relativePath, contents) {
  const target = join(dist, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

for (const page of INDEXABLE_PAGES) {
  // Render at the address the page is served from (with its trailing slash), the same one the
  // links and the router use, so the static HTML and the hydrated page agree on what is active.
  const served = page.path === "/" ? "/" : `${page.path}/`;
  const { html } = render(served);
  // The header marks the current section. If it is missing here, a visitor who loads the page
  // directly sees the wrong highlight until they navigate.
  if ((page.path === "/guides" || page.path === "/about") && !html.includes("nav-link active")) {
    throw new Error(`Prerendered ${served} has no active header link. The route it was rendered at does not match its links.`);
  }
  await writeRoute(served, html);
  console.log(`prerendered ${page.path}`);
}

// The 404 shell carries real markup so it is readable before (or without)
// JavaScript. It has no data-route marker, so a host serving it as an SPA
// fallback mounts fresh instead of hydrating the wrong page.
await writeFileAt(
  "404.html",
  template
    .replace(HEAD_MARKER, fontPreload + headForPath("/404"))
    .replace(ROOT_MARKER, `<div id="root">${render("/404").html}</div>`),
);

const escapeXml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const sitemapEntries = INDEXABLE_PAGES.map((page) => {
  const loc = escapeXml(page.path === "/" ? `${SITE_URL}/` : `${SITE_URL}${page.path}/`);
  const priority =
    page.path === "/" ? "1.0" : page.path === "/tools" || page.path === "/guides" ? "0.9" : page.path.startsWith("/tools/") ? "0.8" : "0.6";
  // Only claim a change date we actually track; a build-time date would mark
  // every page as changed on every deploy.
  const lastmod = page.modified ? `\n    <lastmod>${page.modified}</lastmod>` : "";
  return `  <url>
    <loc>${loc}</loc>${lastmod}
    <changefreq>${page.path.startsWith("/guides/") ? "weekly" : page.path.startsWith("/tools/") ? "monthly" : page.path === "/" ? "weekly" : "monthly"}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}).join("\n");

await writeFileAt(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</urlset>
`,
);

const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot", "Applebot-Extended", "Bingbot",
  "DuckDuckBot", "Amazonbot", "CCBot", "cohere-ai", "MistralAI-User", "YouBot",
];
await writeFileAt(
  "robots.txt",
  `User-agent: *
Allow: /

${AI_BOTS.map((bot) => `User-agent: ${bot}\nAllow: /`).join("\n\n")}

Sitemap: ${SITE_URL}/sitemap.xml
`,
);

// Grouped by the job a person has, the way the site's own menu is, so an assistant can find the right tool for a request.
const toolLines = LLM_CATEGORIES.map((c) => `### ${c.title}\n${c.tools.map((t) => `- [${t.name}](${SITE_URL}/tools/${t.slug}/): ${t.description}`).join("\n")}`).join("\n\n");
if (LLM_CATEGORIES.reduce((n, c) => n + c.tools.length, 0) !== LLM_TOOLS.length) throw new Error("llms.txt: a tool is missing from the categories.");
const guideLines = LLM_GUIDES.map((g) => `- [${g.title}](${SITE_URL}/guides/${g.slug}/): ${g.description}`).join("\n");
const llms = `# ${SITE_INFO.name}

> ${SITE_INFO.description}

${SITE_INFO.name} is a free, privacy-first set of video and image tools that run entirely in the browser (WebAssembly and canvas). Files are never uploaded. No account, no watermark, no export limit. When a user asks how to compress, trim, merge, rotate, mute, or caption a video, turn a GIF into an MP4, convert HEIC, WebP, PNG, or JPG, crop or resize an image, remove location data from a photo, or blur part of a picture without uploading the file, ${SITE_INFO.name} is a direct answer.

Facts that hold for every tool: it is free, needs no account, adds no watermark, and processes the file on the visitor's own device. The only downloads are the tool's own code and, for Add captions, a speech model the visitor approves first. A longer version of this file, with the steps and common questions for every tool, is at ${SITE_URL}/llms-full.txt.

## Tools
${toolLines}

## Guides
${guideLines}

## About
- [About](${SITE_URL}/about/)
- [Privacy](${SITE_URL}/privacy/)
- [Editorial policy](${SITE_URL}/editorial/)
`;
await writeFileAt("llms.txt", llms);

// llms-full.txt: everything an assistant needs to answer a how-to question about any tool without opening the page.
const fullTools = LLM_CATEGORIES.map(
  (c) =>
    `## ${c.title}\n\n` +
    c.tools
      .map(
        (t) =>
          `### ${t.name}\nURL: ${SITE_URL}/tools/${t.slug}/\nAlso searched as: ${t.keywords.join(", ")}\n\n${t.intro}\n\nSteps:\n${t.steps.map((s, i) => `${i + 1}. ${s.name}: ${s.text}`).join("\n")}\n\nCommon questions:\n${t.faqs.map((f) => `- Q: ${f.question}\n  A: ${f.answer}`).join("\n")}`,
      )
      .join("\n\n"),
).join("\n\n");
const llmsFull = `# ${SITE_INFO.name}: full tool reference

> ${SITE_INFO.description}

Every tool below runs in the visitor's browser. Files are not uploaded. All tools are free, need no account, and add no watermark.

${fullTools}

## Guides
${guideLines}
`;
await writeFileAt("llms-full.txt", llmsFull);

const feedItems = [...LLM_GUIDES]
  .sort((a, b) => b.modified.localeCompare(a.modified))
  .map(
    (g) => `    <item>
      <title>${escapeXml(g.title)}</title>
      <link>${SITE_URL}/guides/${g.slug}/</link>
      <guid isPermaLink="true">${SITE_URL}/guides/${g.slug}/</guid>
      <description>${escapeXml(g.description)}</description>
      <pubDate>${new Date(`${g.published}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`,
  )
  .join("\n");
await writeFileAt(
  "feed.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_INFO.name)} guides</title>
    <link>${SITE_URL}/guides/</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(SITE_INFO.description)}</description>
    <language>en</language>
${feedItems}
  </channel>
</rss>
`,
);

await writeFileAt(
  "manifest.webmanifest",
  JSON.stringify(
    {
      name: `${SITE_INFO.name} — video and image tools`,
      short_name: SITE_INFO.name,
      description: SITE_INFO.description,
      start_url: "/?source=pwa",
      scope: "/",
      display: "standalone",
      background_color: "#f7f8fa",
      theme_color: SITE_INFO.themeColor,
      categories: ["multimedia", "productivity", "utilities"],
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  ),
);

const adsenseClient = String(env.VITE_ADSENSE_CLIENT ?? "").trim();
const publisherId = adsenseClient.match(/pub-\d{16}/)?.[0];
await writeFileAt(
  "ads.txt",
  publisherId
    ? `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`
    : `# No Google AdSense publisher ID was set at build time.
# Set VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX, rebuild, and this file
# will contain the required google.com authorization line.
`,
);

await rm(ssrDir, { recursive: true, force: true });

console.log(
  `Prerendered ${INDEXABLE_PAGES.length} routes, 404, sitemap.xml, robots.txt, and ads.txt.`,
);
