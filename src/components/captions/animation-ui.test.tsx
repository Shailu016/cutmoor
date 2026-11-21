import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import { CAPTION_STYLES } from "../../lib/captioning/burn-in/styles";
import { SAVED_LOOKS_KEY } from "../../lib/captioning/saved-looks";
import { AnimationPicker } from "./AnimationPicker";
import { SavedLooks } from "./SavedLooks";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function stubReducedMotion(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no value setter");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error("element not found");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return [...container.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes(text)) ?? null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  stubReducedMotion(true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("AnimationPicker", () => {
  it("marks the current animation and reports a new one with the current length", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(AnimationPicker, { value: "fade", ms: 300, onChange })));
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain("Fade");
    expect(container.querySelectorAll("button")).toHaveLength(8);

    await click(buttonWithText(container, "Pop"));
    expect(onChange).toHaveBeenLastCalledWith("pop", 300);
  });

  it("passes the slider value through with the chosen animation", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(AnimationPicker, { value: "slide-up", ms: 200, onChange })));
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error("no slider");
    expect(slider.disabled).toBe(false);
    setInput(slider, "650");
    expect(onChange).toHaveBeenLastCalledWith("slide-up", 650);
  });

  it("shows the length in milliseconds and disables it for none", async () => {
    await act(async () => root.render(createElement(AnimationPicker, { value: "none", ms: 200, onChange: () => undefined })));
    expect(container.textContent).toContain("200 ms");
    expect(container.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain("None");
  });

  it("falls back to none for an unknown stored animation", async () => {
    await act(async () => root.render(createElement(AnimationPicker, { value: "sparkle", ms: 200, onChange: () => undefined })));
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain("None");
  });

  it("says the preview is still under reduced motion and that the export still animates", async () => {
    await act(async () => root.render(createElement(AnimationPicker, { value: "fade", ms: 200, onChange: () => undefined })));
    expect(container.textContent).toMatch(/previews stay still/i);
    expect(container.textContent).toMatch(/video you export still uses the animation/i);
  });
});

const current: CaptionStyle = {
  ...CAPTION_STYLES.clean,
  sizeMul: 1.3,
  animation: "bounce",
  animationMs: 400,
};

describe("SavedLooks", () => {
  it("saves the current look in localStorage and shows it as a chip", async () => {
    const onApply = vi.fn();
    await act(async () => root.render(createElement(SavedLooks, { current, onApply })));

    const name = container.querySelector<HTMLInputElement>('input[aria-label="Look name"]');
    if (!name) throw new Error("no name field");
    setInput(name, "Night owl");
    await click(buttonWithText(container, "Save this look"));

    expect(localStorage.getItem(SAVED_LOOKS_KEY)).toContain("Night owl");
    expect(container.textContent).toContain("Night owl");
    expect(container.textContent).toContain("Clean");
    expect(name.value).toBe("");
  });

  it("applies a look on top of its preset", async () => {
    const onApply = vi.fn();
    await act(async () => root.render(createElement(SavedLooks, { current, onApply })));
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Look name"]');
    if (!name) throw new Error("no name field");
    setInput(name, "Night owl");
    await click(buttonWithText(container, "Save this look"));

    await click(container.querySelector('[title="Apply Night owl"]'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as CaptionStyle;
    expect(applied.id).toBe("clean");
    expect(applied.sizeMul).toBe(1.3);
    expect(applied.animation).toBe("bounce");
    expect(applied.animationMs).toBe(400);
  });

  it("renames and deletes a look", async () => {
    await act(async () => root.render(createElement(SavedLooks, { current, onApply: () => undefined })));
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Look name"]');
    if (!name) throw new Error("no name field");
    setInput(name, "Old name");
    await click(buttonWithText(container, "Save this look"));

    await click(container.querySelector('[aria-label="Rename Old name"]'));
    const rename = container.querySelector<HTMLInputElement>('input[aria-label="New name for Old name"]');
    if (!rename) throw new Error("no rename field");
    setInput(rename, "New name");
    await click(container.querySelector('[aria-label="Save name"]'));
    expect(container.textContent).toContain("New name");
    expect(container.textContent).not.toContain("Old name");

    await click(container.querySelector('[aria-label="Delete New name"]'));
    expect(container.textContent).toContain("No saved looks yet.");
    const stored = JSON.parse(localStorage.getItem(SAVED_LOOKS_KEY) ?? "{}") as { looks?: unknown[] };
    expect(stored.looks).toEqual([]);
  });

  it("says looks stay in this browser and offers a name field", async () => {
    await act(async () => root.render(createElement(SavedLooks, { current, onApply: () => undefined })));
    expect(container.textContent).toContain("Looks stay in this browser only. Nothing is uploaded.");
    expect(container.querySelector('input[aria-label="Look name"]')).not.toBeNull();
    expect(buttonWithText(container, "Save this look")).not.toBeNull();
  });

  it("reports blocked storage instead of throwing", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await act(async () => root.render(createElement(SavedLooks, { current, onApply: () => undefined })));
    expect(container.textContent).toMatch(/storage may be blocked/i);
  });
});
