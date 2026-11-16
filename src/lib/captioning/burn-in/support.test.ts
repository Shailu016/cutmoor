// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CaptionError } from "../contracts";
import type { CaptionEvent } from "../types";
import { SparseBlobBuilder } from "./blob-sink";
import { DEVANAGARI_FALLBACKS, buildFontStack, cssFont, fontWeightFor } from "./font-stack";
import { loadCaptionFonts } from "./fonts";
import type { FontEnv, FontFaceLike } from "./fonts";
import { capLongSide, evenSize, planOutput } from "./plan";
import { compareTimelines, createEventLookup, secondsToMs } from "./timeline";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("SparseBlobBuilder", () => {
  const bytes = (...v: number[]) => new Uint8Array(v);

  it("joins sequential writes", async () => {
    const b = new SparseBlobBuilder();
    b.write(0, bytes(1, 2, 3));
    b.write(3, bytes(4, 5));
    expect(b.size).toBe(5);
    expect(Array.from(new Uint8Array(await b.toBlob("video/mp4").arrayBuffer()))).toEqual([1, 2, 3, 4, 5]);
    expect(b.toBlob("video/mp4").type).toBe("video/mp4");
  });

  it("patches earlier bytes, as the MP4 writer does for the media box size", async () => {
    const b = new SparseBlobBuilder();
    b.write(0, bytes(0, 0, 0, 0, 9, 9, 9, 9));
    b.write(0, bytes(7, 7));
    b.write(3, bytes(8, 8, 8));
    expect(Array.from(new Uint8Array(await b.toBlob("x").arrayBuffer()))).toEqual([7, 7, 0, 8, 8, 8, 9, 9]);
  });

  it("refuses a file with a hole instead of producing a corrupt video", () => {
    const b = new SparseBlobBuilder();
    b.write(0, bytes(1));
    b.write(5, bytes(2));
    expect(() => b.toBlob("x")).toThrow(CaptionError);
  });

  it("rejects negative or fractional positions", () => {
    const b = new SparseBlobBuilder();
    expect(() => b.write(-1, bytes(1))).toThrow(CaptionError);
    expect(() => b.write(1.5, bytes(1))).toThrow(CaptionError);
  });

  it("matches a flat byte array after thousands of random overlapping writes (oracle fuzz)", async () => {
    const random = rng(7);
    for (let run = 0; run < 40; run++) {
      const size = 1 + Math.floor(random() * 300);
      const oracle = new Uint8Array(size);
      const b = new SparseBlobBuilder();
      // Cover the file first so there is no hole, then overwrite at random.
      let pos = 0;
      while (pos < size) {
        const len = Math.min(size - pos, 1 + Math.floor(random() * 40));
        const chunk = new Uint8Array(len).map(() => Math.floor(random() * 256));
        oracle.set(chunk, pos);
        b.write(pos, chunk);
        pos += len;
      }
      for (let w = 0; w < 60; w++) {
        const start = Math.floor(random() * size);
        const len = 1 + Math.floor(random() * Math.min(80, size - start));
        const chunk = new Uint8Array(len).map(() => Math.floor(random() * 256));
        oracle.set(chunk, start);
        b.write(start, chunk);
      }
      expect(b.size).toBe(size);
      expect(Array.from(new Uint8Array(await b.toBlob("x").arrayBuffer())), `run ${run}`).toEqual(Array.from(oracle));
    }
  });
});

describe("font stack", () => {
  it("puts the style family first, then Devanagari fallbacks, then sans-serif", () => {
    const stack = buildFontStack("Geist Variable");
    const parts = stack.split(", ");
    expect(parts[0]).toBe('"Geist Variable"');
    expect(parts.slice(1, 1 + DEVANAGARI_FALLBACKS.length)).toEqual([...DEVANAGARI_FALLBACKS]);
    expect(parts[parts.length - 1]).toBe("sans-serif");
  });

  it("accepts a whole stack with quotes and commas inside names, without duplicating entries", () => {
    const stack = buildFontStack("\"My, Font\", 'Nirmala UI', serif");
    expect(stack.startsWith('"My, Font", \'Nirmala UI\', serif, ')).toBe(true);
    expect(stack.match(/Nirmala UI/g)).toHaveLength(1);
    expect(stack.match(/sans-serif/g)).toHaveLength(1);
  });

  it("cannot be broken out of by quotes in a family name", () => {
    expect(buildFontStack('evil"; color: red; "x')).not.toMatch(/evil"/);
  });

  it("falls back to the defaults for an empty family", () => {
    expect(buildFontStack("")).toBe([...DEVANAGARI_FALLBACKS, "sans-serif"].join(", "));
  });

  it("weights grow with the preset's punch", () => {
    expect(fontWeightFor({ id: "clean" })).toBeLessThan(fontWeightFor({ id: "shorts" }));
    expect(fontWeightFor({ id: "shorts" })).toBeLessThan(fontWeightFor({ id: "bold" }));
    expect(cssFont({ id: "bold", fontFamily: "X" }, 40)).toMatch(/^800 40px "X", /);
  });
});

describe("loadCaptionFonts", () => {
  const faceSet = (declared: string[], log: string[] = []) => ({
    add: (f: FontFaceLike) => log.push(`add ${f.family}`),
    load: async (font: string) => {
      log.push(`load ${font.split(" ")[0]}`);
      return declared.some((d) => font.includes(`"${d}"`)) ? [{}] : [];
    },
    ready: Promise.resolve(),
  });

  it("reports a declared font as loaded", async () => {
    const report = await loadCaptionFonts({ env: { fonts: faceSet(["Geist Variable"]) } });
    expect(report).toEqual({ loaded: ["Geist Variable"], failed: [] });
  });

  it("falls back without throwing when the page does not declare the font", async () => {
    const report = await loadCaptionFonts({ env: { fonts: faceSet([]) } });
    expect(report.loaded).toEqual([]);
    expect(report.failed).toEqual([{ family: "Geist Variable", reason: "The page does not declare this font." }]);
  });

  it("falls back when loading rejects", async () => {
    const env: FontEnv = {
      fonts: { add: () => undefined, load: () => Promise.reject(new Error("network down")), ready: Promise.resolve() },
    };
    const report = await loadCaptionFonts({ env });
    expect(report.failed[0]).toEqual({ family: "Geist Variable", reason: "network down" });
  });

  it("does not hang forever when a font never finishes loading", async () => {
    const env: FontEnv = { fonts: { add: () => undefined, load: () => new Promise(() => undefined), ready: new Promise(() => undefined) } };
    const started = Date.now();
    const report = await loadCaptionFonts({ env, timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(report.failed[0].reason).toBe("Timed out while loading.");
  });

  it("reports cleanly when the environment has no font API", async () => {
    const report = await loadCaptionFonts({ env: null });
    expect(report.loaded).toEqual([]);
    expect(report.failed).toHaveLength(1);
  });

  it("adds extra faces (for workers) and survives one that fails to load", async () => {
    const log: string[] = [];
    class Good implements FontFaceLike {
      constructor(readonly family: string) {}
      load = async () => this;
    }
    class Bad implements FontFaceLike {
      constructor(readonly family: string) {}
      load = async () => {
        throw new Error("404");
      };
    }
    const good = await loadCaptionFonts({
      env: { fonts: faceSet(["Extra"], log), FontFace: Good },
      families: ["Extra"],
      extraFaces: [{ family: "Extra", source: "/f.woff2" }],
    });
    expect(good.loaded).toEqual(["Extra"]);
    expect(log).toContain("add Extra");
    const bad = await loadCaptionFonts({
      env: { fonts: faceSet([], []), FontFace: Bad },
      families: [],
      extraFaces: [{ family: "Extra", source: "/f.woff2" }],
    });
    expect(bad.failed).toEqual([{ family: "Extra", reason: "404" }]);
  });
});

describe("output planning", () => {
  it("rounds to even and never below 2", () => {
    expect(evenSize(1081)).toBe(1082);
    expect(evenSize(1080)).toBe(1080);
    expect(evenSize(1)).toBe(2);
    expect(evenSize(0)).toBe(2);
  });

  it("caps the long side keeping the aspect ratio, and leaves smaller sizes alone", () => {
    expect(capLongSide(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(capLongSide(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
    expect(capLongSide(640, 360, 1920)).toEqual({ width: 640, height: 360 });
  });

  it("prefers H.264 at the source size", async () => {
    const plan = await planOutput(1280, 720, async () => true);
    expect(plan).toEqual({ width: 1280, height: 720, codec: "avc", scaledDown: false });
  });

  it("uses the next codec when H.264 is missing", async () => {
    const plan = await planOutput(1280, 720, async (c) => c !== "avc");
    expect(plan?.codec).toBe("vp9");
  });

  it("scales down when the encoder cannot do the full size", async () => {
    const tried: string[] = [];
    const plan = await planOutput(3840, 2160, async (c, w, h) => {
      tried.push(`${c}${w}x${h}`);
      return w <= 1920;
    });
    expect(plan).toEqual({ width: 1920, height: 1080, codec: "avc", scaledDown: true });
    expect(tried.slice(0, 3)).toEqual(["avc3840x2160", "vp93840x2160", "av13840x2160"]);
  });

  it("makes odd source sizes even without calling it a downscale", async () => {
    const plan = await planOutput(1081, 607, async () => true);
    expect(plan).toEqual({ width: 1082, height: 608, codec: "avc", scaledDown: false });
  });

  it("returns null when nothing can be encoded", async () => {
    expect(await planOutput(1280, 720, async () => false)).toBeNull();
  });
});

describe("timeline", () => {
  const ev = (index: number, startMs: number, endMs: number): CaptionEvent => ({ index, startMs, endMs, lines: [] });

  it("converts seconds to fractional ms", () => {
    expect(secondsToMs(1.2345)).toBeCloseTo(1234.5, 9);
  });

  it("matches a brute-force scan on random event sets, including overlaps (oracle fuzz)", () => {
    const random = rng(99);
    for (let run = 0; run < 200; run++) {
      const events = Array.from({ length: 1 + Math.floor(random() * 12) }, (_, i) => {
        const start = Math.floor(random() * 5000);
        return ev(i, start, start + 1 + Math.floor(random() * 1500));
      });
      const lookup = createEventLookup(events);
      for (let t = -10; t < 6600; t += 37.3) {
        const active = events.filter((e) => e.startMs <= t && t < e.endMs);
        const got = lookup.at(t);
        if (active.length === 0) expect(got).toBeNull();
        else {
          expect(got, `run ${run} t ${t}`).not.toBeNull();
          // When several overlap, the one that started last wins (ties: the earlier in the list).
          const latest = Math.max(...active.map((e) => e.startMs));
          expect(got?.startMs).toBe(latest);
          expect(active).toContain(got);
        }
      }
    }
  });

  it("ignores events with bad times", () => {
    const lookup = createEventLookup([ev(0, NaN, 5), ev(1, 10, 10), ev(2, 20, 15), ev(3, 0, 100)]);
    expect(lookup.at(50)?.index).toBe(3);
  });

  it("reports differing frame counts and the worst timing drift", () => {
    const a = [
      { timestamp: 0, duration: 0.04 },
      { timestamp: 0.04, duration: 0.04 },
      { timestamp: 0.1, duration: 0.05 },
    ];
    const b = [
      { timestamp: 0, duration: 0.04 },
      { timestamp: 0.04, duration: 0.04 },
      { timestamp: 0.103, duration: 0.05 },
    ];
    expect(compareTimelines(a, b)).toMatchObject({ sameCount: true, countA: 3, countB: 3 });
    expect(compareTimelines(a, b).maxTimestampDiffSeconds).toBeCloseTo(0.003, 9);
    expect(compareTimelines(a, b.slice(0, 2)).sameCount).toBe(false);
  });
});
