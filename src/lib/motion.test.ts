import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateWithTransition, staysOnPage, takeTransitionFlag } from "./motion";

describe("staysOnPage", () => {
  const here = { pathname: "/tools/crop-image/", search: "" };

  it("treats a #hash link and a link to this very page as a jump, not a page change", () => {
    expect(staysOnPage("#step-2", here)).toBe(true);
    expect(staysOnPage("/tools/crop-image/#step-2", here)).toBe(true);
    expect(staysOnPage("/tools/crop-image/", here)).toBe(true);
  });

  it("treats a link to another page as a page change", () => {
    expect(staysOnPage("/tools/blur-image/", here)).toBe(false);
    expect(staysOnPage("/guides/", here)).toBe(false);
  });

  it("sees a different query string (the tools search) as a different page", () => {
    expect(staysOnPage("/tools/crop-image/?q=blur", here)).toBe(false);
    expect(staysOnPage("/tools/?q=blur", { pathname: "/tools/", search: "?q=blur" })).toBe(true);
  });

  it("understands the object form of a link target", () => {
    expect(staysOnPage({ hash: "#x" }, here)).toBe(true);
    expect(staysOnPage({ pathname: "/guides/" }, here)).toBe(false);
  });
});

describe("navigateWithTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (document as unknown as Record<string, unknown>).startViewTransition;
  });

  it("does nothing, and says so, when the browser has no view transitions", () => {
    const go = vi.fn();
    expect(navigateWithTransition(go)).toBe(false);
    expect(go).not.toHaveBeenCalled();
    expect(takeTransitionFlag()).toBe(false);
  });

  it("does nothing when the visitor asked for reduced motion", () => {
    (document as unknown as Record<string, unknown>).startViewTransition = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(navigateWithTransition(vi.fn())).toBe(false);
  });

  it("runs the navigation inside the transition, and the flag is handed out once", () => {
    const start = vi.fn((update: () => void) => update());
    (document as unknown as Record<string, unknown>).startViewTransition = start;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const go = vi.fn();
    expect(navigateWithTransition(go)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(takeTransitionFlag()).toBe(true);
    expect(takeTransitionFlag()).toBe(false);
  });

  it("lets the flag expire, so a navigation that never happened cannot swallow a later page animation", () => {
    vi.useFakeTimers();
    (document as unknown as Record<string, unknown>).startViewTransition = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    navigateWithTransition(vi.fn());
    vi.advanceTimersByTime(2000);
    expect(takeTransitionFlag()).toBe(false);
  });
});
