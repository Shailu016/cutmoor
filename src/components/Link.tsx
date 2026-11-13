import { Link as RouterLink, NavLink as RouterNavLink, type LinkProps, type NavLinkProps } from "react-router-dom";
import { canonicalPath } from "../lib/paths";

/**
 * The router's links, pointed at each page's real address (with its trailing
 * slash) so no internal link goes through a redirect. Use these everywhere
 * instead of importing Link from react-router-dom.
 */
export function Link({ to, ...rest }: LinkProps) {
  return <RouterLink to={typeof to === "string" ? canonicalPath(to) : to} {...rest} />;
}

export function NavLink({ to, ...rest }: NavLinkProps) {
  return <RouterNavLink to={typeof to === "string" ? canonicalPath(to) : to} {...rest} />;
}
