/**
 * Scaffold a new guide:
 *
 *   npm run new:guide -- how-to-compress-a-gif
 *
 * Creates src/content/guides/<slug>/meta.ts and body.ts with the next order
 * number and today's date. Fill in every TODO: the tests fail while any
 * remain, so an unfinished guide cannot be merged.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error("Usage: npm run new:guide -- <slug>   (lowercase words joined by hyphens)");
  process.exit(1);
}

const root = join(process.cwd(), "src", "content", "guides");
const dir = join(root, slug);
if (existsSync(dir)) {
  console.error(`A guide called "${slug}" already exists.`);
  process.exit(1);
}

const orders = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => Number(readFileSync(join(root, entry.name, "meta.ts"), "utf8").match(/order:\s*(\d+)/)?.[1] ?? 0));
const order = Math.max(0, ...orders) + 1;
const today = new Date().toISOString().slice(0, 10);

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "meta.ts"),
  `import type { GuideMeta } from "../../types";

export const meta: GuideMeta = {
  order: ${order},
  slug: "${slug}",
  title: "TODO: the headline readers search for",
  description: "TODO: one or two sentences for search results, under 300 characters.",
  excerpt: "TODO: the answer in a sentence or two, under 260 characters.",
  category: "TODO: Compression, Conversion, Editing, Audio, Subtitles, Social media or a new category",
  published: "${today}",
  modified: "${today}",
  readingMinutes: 6,
  // Tool slugs from src/lib/tools.ts that this guide should promote.
  tools: ["compress"],
};
`,
);
writeFileSync(
  join(dir, "body.ts"),
  `import type { GuideBody } from "../../types";

export const body: GuideBody = {
  sections: [
    {
      heading: "TODO: first heading",
      paragraphs: ["TODO: write the first paragraph."],
    },
    {
      heading: "TODO: second heading",
      paragraphs: ["TODO: write the second paragraph."],
    },
    {
      heading: "TODO: third heading",
      paragraphs: ["TODO: write the third paragraph."],
      // Optional: bullets: [...], table: { headers: [...], rows: [[...]] }, callout: "..."
    },
  ],
  faqs: [
    {
      question: "TODO: a question readers ask?",
      answer: "TODO: a complete answer of at least a sentence or two, so it can stand alone in search results.",
    },
  ],
};
`,
);
console.log(`Created src/content/guides/${slug}/ (order ${order}). Fill in every TODO, then run npm test.`);
