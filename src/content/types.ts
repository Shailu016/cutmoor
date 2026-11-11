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

export interface Guide {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  category: string;
  published: string;
  modified: string;
  readingMinutes: number;
  tools: string[];
  sections: GuideSection[];
  faqs: GuideFaq[];
}
