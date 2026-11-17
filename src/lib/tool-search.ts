import type { ToolDef } from "./tools";

/**
 * The search box on the tools page. A visitor types what they want in their own words ("make video smaller", "jpeg to
 * png", "remove sound"), so the search matches every word in any order, treats common spellings as the same word, and
 * knows a few everyday words that the tool names do not use.
 */

/** Words people type, and the word the tool pages use for the same thing. An empty value is a filler word. */
const SAME_WORD: Record<string, string> = {
  jpeg: "jpg",
  photo: "image",
  photos: "image",
  picture: "image",
  pictures: "image",
  pic: "image",
  pics: "image",
  images: "image",
  videos: "video",
  clip: "video",
  clips: "video",
  movie: "video",
  film: "video",
  gifs: "gif",
  subtitles: "subtitle",
  captions: "caption",
  sound: "audio",
  music: "audio",
  song: "audio",
  shrink: "compress",
  smaller: "compress",
  reduce: "compress",
  compressor: "compress",
  join: "merge",
  combine: "merge",
  stitch: "merge",
  cut: "trim",
  shorten: "trim",
  flip: "rotate",
  mirror: "rotate",
  turn: "rotate",
  silent: "mute",
  silence: "mute",
  faster: "speed",
  slower: "speed",
  slow: "speed",
  fast: "speed",
  backwards: "reverse",
  rewind: "reverse",
  repeat: "loop",
  logo: "watermark",
  stamp: "watermark",
  exif: "metadata",
  gps: "metadata",
  location: "metadata",
  censor: "blur",
  pixelate: "blur",
  hide: "blur",
  face: "blur",
  faces: "blur",
  iphone: "heic",
  thumbnail: "frame",
  screenshot: "frame",
  transcribe: "caption",
  transcript: "caption",
  change: "convert",
  converter: "convert",
  make: "",
  add: "",
  remove: "",
  play: "",
  to: "",
  a: "",
  an: "",
  the: "",
  my: "",
  from: "",
  of: "",
  in: "",
  for: "",
  online: "",
  free: "",
  how: "",
};

function canonical(word: string): string {
  return word in SAME_WORD ? SAME_WORD[word] : word;
}

/** The meaningful words of a search, lower-case, with filler words dropped and spellings unified. */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(canonical)
    .filter((word) => word.length > 0);
}

const haystacks = new WeakMap<ToolDef, string>();

function haystack(tool: ToolDef): string {
  let text = haystacks.get(tool);
  if (text === undefined) {
    const raw = [tool.name, tool.short, tool.title, tool.description, tool.slug.replace(/-/g, " "), ...tool.keywords].join(" ").toLowerCase();
    // The page text goes through the same word map, so "photo" in a description is found by "image" and the other way round.
    text = ` ${raw} ${raw.split(/[^a-z0-9]+/).map(canonical).join(" ")} `;
    haystacks.set(tool, text);
  }
  return text;
}

/** True when every search word appears in the name, description, or keywords of the tool. An empty search matches everything. */
export function matchesSearch(tool: ToolDef, words: readonly string[]): boolean {
  const text = haystack(tool);
  return words.every((word) => text.includes(word));
}

/** Whole phrases that name one job, checked before the words are split, mapped to the tool that does it. */
const PHRASES: Array<[RegExp, string]> = [
  [/\b(remove|delete|strip|take out|no|without)\s+(the\s+)?(sound|audio|music)\b/, "mute-video"],
  [/\bmute\b/, "mute-video"],
  [/\b(remove|delete|strip)\s+(the\s+)?(exif|metadata|location|gps)\b/, "remove-photo-metadata"],
  [/\b(extract|get|save|rip)\s+(the\s+)?(audio|sound|music|mp3)\b/, "audio"],
  [/\b(slow motion|slow mo|slowmo|speed up)\b/, "video-speed"],
  // Making captions is the caption tool; converting or shifting a subtitle file is the "captions" converter page.
  [/\b(add|generate|make|create|auto|automatic|burn|burned|burnt)\s+(the\s+|in\s+)?(captions?|subtitles?)\b/, "auto-captions"],
  [/\b(caption|subtitle)s?\s+(generator|maker|creator)\b/, "auto-captions"],
  [/^captions?$/, "auto-captions"],
];

/**
 * The tools for a search, best first. A phrase that names one job ("remove sound") or a conversion whose page exists
 * ("jpeg to png" when there is a jpg-to-png page) gives that one tool; anything else gives every tool whose text has every
 * word, with tools whose name or address has the words ahead of tools that only mention them in passing.
 */
export function searchTools(tools: readonly ToolDef[], query: string): ToolDef[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [...tools];
  for (const [pattern, slug] of PHRASES) {
    const hit = pattern.test(lower) ? tools.find((tool) => tool.slug === slug) : undefined;
    if (hit) return [hit];
  }
  const conversion = lower.match(/\b([a-z0-9]+)\s*(?:to|2|->|into)\s*([a-z0-9]+)\b/);
  if (conversion) {
    const exact = tools.find((tool) => tool.slug === `${canonical(conversion[1])}-to-${canonical(conversion[2])}`);
    if (exact) return [exact];
  }
  const words = searchWords(query);
  const score = (tool: ToolDef) => {
    const name = ` ${tool.name} ${tool.slug.replace(/-/g, " ")} `.toLowerCase();
    const nameWords = name.split(/[^a-z0-9]+/).map(canonical).join(" ");
    return words.filter((word) => name.includes(word) || nameWords.includes(word)).length;
  };
  return tools
    .filter((tool) => matchesSearch(tool, words))
    .map((tool, index) => ({ tool, index, score: score(tool) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.tool);
}
