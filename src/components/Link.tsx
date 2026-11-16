import { Link as RouterLink, NavLink as RouterNavLink, useLocation, type LinkProps, type NavLinkProps, type To } from "react-router-dom";
import { crossesAdFreeBoundary } from "../lib/ad-free";
import { canonicalPath } from "../lib/paths";

/**
 * The router's links, pointed at each page's real address (with its trailing
 * slash) so no internal link goes through a redirect. Use these everywhere
 * instead of importing Link from react-router-dom.
 *
 * A link into or out of an ad-free page (the captions tool) reloads the page: that page has its own
 * security headers, and browsers only apply headers on a real page load (see ad-free.ts).
 */
function useResolved(to: To): { to: To; reloadDocument: boolean } {
  const here = useLocation().pathname;
  const resolved = typeof to === "string" ? canonicalPath(to) : to;
  const target = typeof resolved === "string" ? resolved : (resolved.pathname ?? here);
  return { to: resolved, reloadDocument: crossesAdFreeBoundary(here, target) };
}

export function Link({ to, reloadDocument, ...rest }: LinkProps) {
  const resolved = useResolved(to);
  return <RouterLink {...rest} to={resolved.to} reloadDocument={reloadDocument || resolved.reloadDocument} />;
}

export function NavLink({ to, reloadDocument, ...rest }: NavLinkProps) {
  const resolved = useResolved(to);
  return <RouterNavLink {...rest} to={resolved.to} reloadDocument={reloadDocument || resolved.reloadDocument} />;
}
