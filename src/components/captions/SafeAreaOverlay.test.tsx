import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAFE_AREA_PRESETS, SafeAreaOverlay, findSafeArea } from "./SafeAreaOverlay";

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

const picture = { x: 12, y: 34, width: 400, height: 700 };

function render(safeArea: Parameters<typeof SafeAreaOverlay>[0]["safeArea"]) {
  act(() => root.render(createElement(SafeAreaOverlay, { safeArea, picture })));
}

describe("safe-area presets", () => {
  it("offers the four platforms, all marked approximate", () => {
    expect(SAFE_AREA_PRESETS.map((preset) => preset.key)).toEqual(["instagram-stories", "instagram-reels", "youtube-shorts", "tiktok"]);
    for (const preset of SAFE_AREA_PRESETS) {
      expect(preset.top).toBeGreaterThan(0);
      expect(preset.bottom).toBeGreaterThan(0);
      expect(preset.top).toBeLessThan(0.5);
      expect(preset.bottom).toBeLessThan(0.5);
      expect(preset.side).toBeGreaterThan(0);
      expect(preset.detail.length).toBeGreaterThan(20);
    }
    expect(findSafeArea("tiktok").name).toBe("TikTok");
  });
});

describe("SafeAreaOverlay", () => {
  it("draws nothing without a guide", () => {
    render(null);
    expect(container.querySelector("[data-safe-area]")).toBeNull();
  });

  it("fills the picture box and outlines the safe rectangle", () => {
    render("tiktok");
    const overlay = container.querySelector<HTMLElement>('[data-safe-area="tiktok"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.style.left).toBe("12px");
    expect(overlay?.style.top).toBe("34px");
    expect(overlay?.style.width).toBe("400px");
    expect(overlay?.style.height).toBe("700px");
    expect(overlay?.style.pointerEvents).toBe("none");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.textContent).toContain("TikTok · approximate");
    expect(overlay?.querySelector('[data-safe-area-box="true"]')).not.toBeNull();
  });

  it("shades four strips and positions the safe box from the preset fractions", () => {
    render("youtube-shorts");
    const overlay = container.querySelector<HTMLElement>('[data-safe-area="youtube-shorts"]');
    if (!overlay) throw new Error("overlay missing");
    // Four strips plus the outline box and its label.
    expect(overlay.children).toHaveLength(6);
    const preset = findSafeArea("youtube-shorts");
    const box = overlay.querySelector<HTMLElement>('[data-safe-area-box="true"]');
    expect(box?.style.top).toBe(`${preset.top * 100}%`);
    expect(box?.style.bottom).toBe(`${preset.bottom * 100}%`);
    expect(box?.style.left).toBe(`${preset.side * 100}%`);
  });

  it("does not draw over an empty picture", () => {
    act(() => root.render(createElement(SafeAreaOverlay, { safeArea: "tiktok", picture: { x: 0, y: 0, width: 0, height: 100 } })));
    expect(container.querySelector("[data-safe-area]")).toBeNull();
  });
});
