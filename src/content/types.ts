export interface GuideTable {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  table?: GuideTable;
  callout?: string;
}

export interface GuideFaq {
  question: string;
  answer: string;
}

/** What every page needs to list or link a guide. Small, and shipped with the main bundle. */
export interface GuideMeta {
  /** Position in lists and the sitemap. New guides take the next number. */
  order: number;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  category: string;
  published: string;
  modified: string;
  readingMinutes: number;
  tools: string[];
}

/** The article itself. Loaded only on that guide's page, as its own chunk. */
export interface GuideBody {
  sections: GuideSection[];
  faqs: GuideFaq[];
}

export type Guide = GuideMeta & GuideBody;
