import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import { CAPTION_STYLES } from "./styles";
import { LookControls } from "./LookControls";

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

const style = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...CAPTION_STYLES.clean, ...over });

async function render(value: CaptionStyle, onChange = vi.fn()) {
  await act(async () => {
    root.render(createElement(LookControls, { style: value, onChange }));
  });
  return onChange;
}

/** The control whose visible label says `label` (every control has one). */
function labelled(label: string): HTMLInputElement | HTMLSelectElement {
  const target = [...container.querySelectorAll("label")].find((element) => element.textContent?.trim() === label);
  if (!target || !target.htmlFor) throw new Error(`no labelled control "${label}"`);
  const control = document.getElementById(target.htmlFor);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) throw new Error(`bad control "${label}"`);
  return control;
}

function setValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("no value setter");
  act(() => {
    setter.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("LookControls", () => {
  it("lists the bundled fonts plus the preset option", async () => {
    await render(style());
    const select = labelled("Font") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Preset font",
      "Geist",
      "Inter",
      "Montserrat",
      "Noto Sans Devanagari",
      "Poppins",
      "Bebas Neue",
    ]);
    expect(select.value).toBe("");
  });

  it("sends a font key when a font is picked", async () => {
    const onChange = await render(style());
    setValue(labelled("Font"), "poppins");
    expect(onChange).toHaveBeenCalledWith({ fontKey: "poppins" });
  });

  it("sends the size as a 0.5-2 multiplier", async () => {
    const onChange = await render(style());
    expect(labelled("Text size").getAttribute("aria-valuetext")).toBe("100%");
    setValue(labelled("Text size"), "150");
    expect(onChange).toHaveBeenCalledWith({ sizeMul: 1.5 });
  });

  it("switches the preset outline off and back on", async () => {
    const onChange = await render(style({ background: "outline" }));
    const toggle = labelled("Outline") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    act(() => toggle.click());
    expect(onChange).toHaveBeenLastCalledWith({ outlineWidth: 0 });
  });

  it("turns a shadow on with a usable strength", async () => {
    const onChange = await render(style());
    const toggle = labelled("Shadow") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => toggle.click());
    expect(onChange).toHaveBeenLastCalledWith({ shadow: 0.5 });
  });

  it("turns a box on and colours it", async () => {
    const onChange = await render(style());
    const toggle = labelled("Box behind text") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => toggle.click());
    expect(onChange).toHaveBeenLastCalledWith({ boxOpacity: 0.66 });
    setValue(labelled("Box colour"), "#123456");
    expect(onChange).toHaveBeenLastCalledWith({ boxColor: "#123456", boxOpacity: 0.66 });
  });

  it("toggles all capitals", async () => {
    const onChange = await render(style());
    const toggle = labelled("All capitals") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => toggle.click());
    expect(onChange).toHaveBeenLastCalledWith({ uppercase: true });
  });

  it("resets every custom field to the preset", async () => {
    const onChange = await render(style({ fontKey: "inter", sizeMul: 1.5, boxOpacity: 0.5 }));
    const reset = [...container.querySelectorAll("button")].find((button) => button.textContent === "Reset look");
    act(() => reset?.click());
    expect(onChange).toHaveBeenCalledWith({
      fontKey: undefined,
      sizeMul: undefined,
      outlineWidth: undefined,
      outlineColor: undefined,
      shadow: undefined,
      shadowColor: undefined,
      boxOpacity: undefined,
      boxColor: undefined,
      textColor: undefined,
      activeColor: undefined,
      uppercase: undefined,
    });
  });

  it("keeps the thickness, strength and opacity sliders usable: they stop above zero and the checkbox turns the effect off", async () => {
    // Dragging one of these to 0 used to switch its effect off, which disabled the slider mid-drag.
    await render(style({ outlineWidth: 0.2, shadow: 0.4, boxOpacity: 0.5 }));
    for (const label of ["Outline thickness", "Shadow strength", "Box opacity"]) {
      const slider = labelled(label) as HTMLInputElement;
      expect(Number(slider.min), label).toBeGreaterThan(0);
      expect(slider.disabled, label).toBe(false);
    }
  });

  it("never sends a zero from a slider, only from its checkbox", async () => {
    const onChange = await render(style({ outlineWidth: 0.2, shadow: 0.4, boxOpacity: 0.5 }));
    setValue(labelled("Outline thickness"), "0");
    setValue(labelled("Shadow strength"), "0");
    setValue(labelled("Box opacity"), "0");
    // A browser clamps a range input to its min, so the lowest a drag can send is the slider's own minimum.
    const sent = onChange.mock.calls.flatMap(([patch]) => Object.values(patch as Record<string, number>));
    expect(sent.every((value) => value > 0)).toBe(true);
  });

  it("gives every control an accessible label", async () => {
    await render(style());
    const controls = [...container.querySelectorAll("input, select")];
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      const id = control.id;
      const label = [...container.querySelectorAll("label")].find((element) => element.htmlFor === id);
      expect(label, id).toBeTruthy();
    }
  });
});
