import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTION_STYLES } from "../../lib/captioning/burn-in/styles";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import { PositionControls } from "./PositionControls";

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

function render(over: Partial<CaptionStyle> = {}, safeArea: "tiktok" | null = null) {
  const onChange = vi.fn();
  const onSafeArea = vi.fn();
  act(() => {
    root.render(
      createElement(PositionControls, {
        style: { ...CAPTION_STYLES.clean, ...over },
        onChange,
        safeArea,
        onSafeArea,
      }),
    );
  });
  return { onChange, onSafeArea };
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) => (item.getAttribute("aria-label") ?? item.textContent ?? "").trim().toLowerCase() === label.toLowerCase());
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}

function setRange(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no value setter");
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PositionControls", () => {
  it("shows the preset's effective anchor when the style has none", () => {
    render();
    expect(button("Bottom centre").getAttribute("aria-pressed")).toBe("true");
  });

  it("sets both anchors from a 3x3 cell", () => {
    const { onChange } = render();
    act(() => button("Top right").click());
    expect(onChange).toHaveBeenCalledWith({ anchorX: 1, anchorY: 0 });
  });

  it("sets left, centre and right text alignment", () => {
    const { onChange } = render();
    act(() => button("Right").click());
    expect(onChange).toHaveBeenCalledWith({ align: "right" });
    act(() => button("Left").click());
    expect(onChange).toHaveBeenCalledWith({ align: "left" });
  });

  it("moves the across and height sliders in 1% steps", () => {
    const { onChange } = render({ anchorX: 0.5, anchorY: 0.5 });
    const across = container.querySelector<HTMLInputElement>('input[aria-label="Across"]');
    const height = container.querySelector<HTMLInputElement>('input[aria-label="Height"]');
    if (!across || !height) throw new Error("sliders missing");
    setRange(across, "0.25");
    expect(onChange).toHaveBeenCalledWith({ anchorX: 0.25 });
    setRange(height, "0.75");
    expect(onChange).toHaveBeenCalledWith({ anchorY: 0.75 });
  });

  it("reports the chosen safe-area guide", () => {
    const { onSafeArea } = render();
    act(() => button("TikTok").click());
    expect(onSafeArea).toHaveBeenCalledWith("tiktok");
  });

  it("marks the active safe-area guide and alignment", () => {
    render({ align: "left" }, "tiktok");
    expect(button("TikTok").getAttribute("aria-pressed")).toBe("true");
    expect(button("Left").getAttribute("aria-pressed")).toBe("true");
  });

  it("resets to the preset's position and centred text", () => {
    const { onChange } = render({ position: "middle", anchorX: 0, anchorY: 0, align: "right" });
    const reset = [...container.querySelectorAll("button")].find((item) => /reset/i.test(item.textContent ?? ""));
    if (!reset) throw new Error("no reset button");
    act(() => reset.click());
    expect(onChange).toHaveBeenCalledWith({ anchorX: 0.5, anchorY: 0.5, align: "center" });
  });

  it("has labelled groups for keyboard and screen readers", () => {
    render();
    expect(container.querySelector('[role="group"][aria-label="Caption position"]')).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Text alignment"]')).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Safe area guide"]')).not.toBeNull();
  });
});
