/**
 * Pages that must never load or show ads. The auto-captions page and the two neural-network picture tools (remove
 * background, enlarge) run on a strict Content-Security-Policy that only allows our own model host, and their privacy
 * promise says they load nothing from advertisers.
 * Every place that adds an ad script, an ad meta tag or an ad slot asks this first.
 */
const AD_FREE_PREFIXES = ["/tools/auto-captions", "/tools/remove-background", "/tools/upscale-image"];

export function isAdFreePath(pathname: string): boolean {
  const path = (pathname.split("?")[0].split("#")[0] || "/").replace(/\/+$/, "") || "/";
  return AD_FREE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * True when going from one page to the other crosses into or out of an ad-free page. Those pages are served
 * with their own security headers (a strict Content-Security-Policy, cross-origin isolation), and browsers only
 * apply headers on a real page load. A client-side navigation would keep the old page's rules on the new
 * page, which would break the ads on one side and the isolation on the other. So such links reload the page.
 */
export function crossesAdFreeBoundary(fromPath: string, toPath: string): boolean {
  return isAdFreePath(fromPath) !== isAdFreePath(toPath);
}
