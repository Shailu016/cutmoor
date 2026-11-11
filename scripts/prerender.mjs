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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "vite";

const root = process.cwd();
const dist = join(root, "dist");
const ssrDir = join(root, "dist-ssr");
const env = { ...loadEnv("production", root, ""), ...process.env };

const entryUrl = `${pathToFileURL(join(ssrDir, "entry-server.js")).href}?t=${Date.now()}`;
const { INDEXABLE_PAGES, SITE_URL, headForPath, render } = await import(entryUrl);

const HEAD_MARKER = "<!--clipkit-head-->";
const ROOT_MARKER = '<div id="root"></div>';

const template = await readFile(join(dist, "index.html"), "utf8");
if (!template.includes(HEAD_MARKER)) {
  throw new Error(`Prerender marker ${HEAD_MARKER} was not found in dist/index.html.`);
}
if (!template.includes(ROOT_MARKER)) {
  throw new Error("The app root placeholder was not found in dist/index.html.");
}

function htmlFor(route, markup) {
  return template
    .replace(HEAD_MARKER, headForPath(route))
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
  const { html } = render(page.path);
  await writeRoute(page.path, html);
  console.log(`prerendered ${page.path}`);
}

await writeFileAt("404.html", htmlFor("/404", ""));

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
  const lastmod = page.modified ? `\n    <lastmod>${page.modified}</lastmod>` : "";
  return `  <url>
    <loc>${loc}</loc>${lastmod}
    <changefreq>${page.path.startsWith("/guides/") ? "monthly" : "monthly"}</changefreq>
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

await writeFileAt(
  "robots.txt",
  `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`,
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
