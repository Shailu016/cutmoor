import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordsControls, type WordsControlsProps } from "./WordsControls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function controls(props: Partial<WordsControlsProps> = {}) {
  return createElement(WordsControls, {
    wordsPerCaption: undefined,
    onWordsPerCaption: () => undefined,
    script: "original",
    onScript: () => undefined,
    hasDevanagari: false,
    ...props,
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}

describe("WordsControls", () => {
  it("offers Auto and the five word counts, with the current choice pressed", async () => {
    await act(async () => root.render(controls({ wordsPerCaption: 3 })));
    expect([...container.querySelectorAll("button")].map((item) => item.textContent?.trim())).toEqual(["Auto", "1", "2", "3", "4", "5"]);
    expect(button("Auto").getAttribute("aria-pressed")).toBe("false");
    expect(button("3").getAttribute("aria-pressed")).toBe("true");
    expect(button("3").className).toContain("active");
  });

  it("reports a count and returns to automatic", async () => {
    const onWordsPerCaption = vi.fn();
    await act(async () => root.render(controls({ onWordsPerCaption })));
    await act(async () => button("4").click());
    expect(onWordsPerCaption).toHaveBeenLastCalledWith(4);
    await act(async () => button("Auto").click());
    expect(onWordsPerCaption).toHaveBeenLastCalledWith(undefined);
  });

  it("hides the script choice when the text has no Devanagari", async () => {
    await act(async () => root.render(controls({ hasDevanagari: false })));
    expect(container.querySelector('[aria-label="Caption script"]')).toBeNull();
    expect(container.textContent).not.toContain("Hinglish");
  });

  it("offers Original and Hinglish only when Devanagari is present", async () => {
    const onScript = vi.fn();
    await act(async () => root.render(controls({ hasDevanagari: true, onScript })));
    expect(container.textContent).toContain("Original");
    expect(container.textContent).toContain("Hinglish");
    expect(button("Original").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Hinglish").click());
    expect(onScript).toHaveBeenCalledWith("roman");
    await act(async () => root.render(controls({ hasDevanagari: true, onScript, script: "roman" })));
    expect(button("Hinglish").getAttribute("aria-pressed")).toBe("true");
  });

  it("uses real buttons, so the controls work from the keyboard", async () => {
    await act(async () => root.render(controls()));
    for (const item of container.querySelectorAll("button")) {
      expect(item.getAttribute("type")).toBe("button");
      expect(item.getAttribute("aria-pressed")).not.toBeNull();
    }
  });
});
