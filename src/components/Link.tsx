import type { MouseEvent } from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  useLocation,
  useNavigate,
  type LinkProps,
  type NavLinkProps,
  type To,
} from "react-router-dom";
import { crossesAdFreeBoundary } from "../lib/ad-free";
import { navigateWithTransition, staysOnPage } from "../lib/motion";
import { canonicalPath } from "../lib/paths";

/**
 * The router's links, pointed at each page's real address (with its trailing
 * slash) so no internal link goes through a redirect. Use these everywhere
 * instead of importing Link from react-router-dom.
 *
 * A link into or out of an ad-free page (the captions tool) reloads the page: that page has its own
 * security headers, and browsers only apply headers on a real page load (see ad-free.ts).
 *
 * In-app navigations run inside a view transition where the browser supports one (see lib/motion.ts).
 */
function useResolved(to: To): { to: To; reloadDocument: boolean } {
  const here = useLocation().pathname;
  const resolved = typeof to === "string" ? canonicalPath(to) : to;
  const target = typeof resolved === "string" ? resolved : (resolved.pathname ?? here);
  return { to: resolved, reloadDocument: crossesAdFreeBoundary(here, target) };
}

type ClickOptions = Pick<LinkProps, "onClick" | "replace" | "state" | "preventScrollReset" | "target"> & { reload: boolean };

function useTransitionClick(to: To, { onClick, replace, state, preventScrollReset, target, reload }: ClickOptions) {
  const navigate = useNavigate();
  const here = useLocation();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      reload ||
      staysOnPage(to, here) ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self")
    ) {
      return;
    }
    const went = navigateWithTransition(() => navigate(to, { replace, state, preventScrollReset }));
    if (went) event.preventDefault();
  };
}

export function Link({ to, reloadDocument, onClick, ...rest }: LinkProps) {
  const resolved = useResolved(to);
  const reload = Boolean(reloadDocument || resolved.reloadDocument);
  const handleClick = useTransitionClick(resolved.to, { ...rest, onClick, reload });
  return <RouterLink {...rest} to={resolved.to} reloadDocument={reload} onClick={handleClick} />;
}

export function NavLink({ to, reloadDocument, onClick, ...rest }: NavLinkProps) {
  const resolved = useResolved(to);
  const reload = Boolean(reloadDocument || resolved.reloadDocument);
  const handleClick = useTransitionClick(resolved.to, { ...rest, onClick, reload });
  return <RouterNavLink {...rest} to={resolved.to} reloadDocument={reload} onClick={handleClick} />;
}
