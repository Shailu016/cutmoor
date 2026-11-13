/**
 * Every page is served at a URL that ends in a slash (/tools/compress/). A link
 * without it still works, but the host answers with a redirect first, which
 * costs visitors a round trip and search engines a wasted fetch. All internal
 * links go through this so they point straight at the real address.
 */
export function canonicalPath(to: string): string {
  // Leave alone: other sites, mail links, in-page anchors and relative paths.
  if (!to.startsWith("/") || to.startsWith("//")) return to;
  const hashAt = to.indexOf("#");
  const hash = hashAt >= 0 ? to.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? to.slice(0, hashAt) : to;
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt >= 0 ? beforeHash.slice(queryAt) : "";
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  // Files (/feed.xml, /og-image.png) have no slash form.
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  if (path.endsWith("/") || lastSegment.includes(".")) return to;
  return `${path}/${query}${hash}`;
}
