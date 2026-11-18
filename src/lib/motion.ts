import { flushSync } from "react-dom";

/**
 * Small, script-side half of the motion system (the rest is CSS in motion.css).
 * Kept tiny on purpose: one passive pointer listener and one wrapper around the
 * browser's View Transitions API. Neither runs work on page load.
 */

/** True when the link only changes the #hash (or points at the page we are on): a jump, not a page change. */
export function staysOnPage(to: string | { pathname?: string; search?: string; hash?: string }, here: { pathname: string; search: string }): boolean {
  if (typeof to === "string") {
    const [path, rest = ""] = to.split("#")[0].split("?");
    return (path === "" || path === here.pathname) && (rest === "" ? true : `?${rest}` === here.search);
  }
  return (to.pathname === undefined || to.pathname === here.pathname) && (to.search === undefined || to.search === here.search);
}

let lastNavWasTransition = false;

/** True once, right after a navigation that ran inside a view transition (the page entrance animation is skipped then). */
export function takeTransitionFlag(): boolean {
  const value = lastNavWasTransition;
  lastNavWasTransition = false;
  return value;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type StartViewTransition = (update: () => void) => unknown;

/**
 * Runs a client-side navigation inside a view transition when the browser has one:
 * the old page fades out, the new one settles in, the header stays still.
 * Returns false when it did nothing, so the caller lets the link work normally.
 */
export function navigateWithTransition(go: () => void): boolean {
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== "function" || reducedMotion()) return false;
  lastNavWasTransition = true;
  // If the navigation ends up not changing the page (same address, or it was refused), do not let the flag linger and
  // swallow the entrance animation of the next, unrelated navigation.
  window.setTimeout(() => {
    lastNavWasTransition = false;
  }, 1500);
  start.call(document, () => {
    flushSync(go);
  });
  return true;
}

/** A soft light that follows the pointer across cards (drawn in CSS from --mx / --my). */
export function installSpotlight(): void {
  if (typeof window.matchMedia !== "function" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  let frame = 0;
  let pending: { el: HTMLElement; x: number; y: number } | null = null;
  document.addEventListener(
    "pointermove",
    (event) => {
      const el = (event.target as Element | null)?.closest?.<HTMLElement>(".tool-card, .guide-card");
      if (!el) return;
      pending = { el, x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        const rect = pending.el.getBoundingClientRect();
        pending.el.style.setProperty("--mx", `${pending.x - rect.left}px`);
        pending.el.style.setProperty("--my", `${pending.y - rect.top}px`);
        pending = null;
      });
    },
    { passive: true },
  );
}
