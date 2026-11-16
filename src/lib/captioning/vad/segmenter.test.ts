import { describe, expect, it } from "vitest";
import type { SpeechInterval } from "../types";
import {
  CUT_SEARCH_FROM_BEFORE_LIMIT_MS,
  CUT_SEARCH_TO_BEFORE_LIMIT_MS,
  DEFAULT_SEGMENTER_OPTIONS,
  SpeechSegmenter,
  resolveSegmenterOptions,
  type SegmenterOptions,
} from "./segmenter";

const F = 32;

/** `n` frames of the same probability. */
const run = (p: number, n: number): number[] => Array.from({ length: n }, () => p);

/** Tiny seeded generator (mulberry32) so a failing fuzz case can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The oracle: the same rules applied to the whole probability array at once, written the plain way
 * (find stretches, drop, pad, merge, clamp, cut) with no streaming state at all.
 */
function reference(probs: number[], origin: number, audioEnd: number, opt: SegmenterOptions): SpeechInterval[] {
  const t = (frame: number) => origin + frame * opt.frameMs;
  const minSilenceFrames = Math.ceil(opt.minSilenceMs / opt.frameMs);

  const stretches: { s: number; e: number }[] = [];
  let open = false;
  let s = 0;
  let last = 0;
  let quiet = 0;
  probs.forEach((p, f) => {
    if (!open) {
      if (p >= opt.startThreshold) {
        open = true;
        s = f;
        last = f;
        quiet = 0;
      }
    } else if (p >= opt.endThreshold) {
      last = f;
      quiet = 0;
    } else if (++quiet >= minSilenceFrames) {
      stretches.push({ s, e: last + 1 });
      open = false;
    }
  });
  if (open) stretches.push({ s, e: last + 1 });

  const padded = stretches
    .filter((x) => t(x.e) - t(x.s) >= opt.minSpeechMs)
    .map((x) => ({ startMs: Math.max(origin, t(x.s) - opt.padMs), endMs: t(x.e) + opt.padMs }));

  const merged: SpeechInterval[] = [];
  for (const cur of padded) {
    const prev = merged[merged.length - 1];
    if (prev && cur.startMs - prev.endMs < opt.mergeGapMs) prev.endMs = Math.max(prev.endMs, cur.endMs);
    else merged.push({ ...cur });
  }

  const result: SpeechInterval[] = [];
  for (const iv of merged) {
    let start = iv.startMs;
    const end = Math.min(iv.endMs, audioEnd);
    while (end - start > opt.maxIntervalMs) {
      const from = Math.ceil((start + opt.maxIntervalMs - CUT_SEARCH_FROM_BEFORE_LIMIT_MS - origin) / opt.frameMs);
      const to = Math.ceil((start + opt.maxIntervalMs - CUT_SEARCH_TO_BEFORE_LIMIT_MS - origin) / opt.frameMs);
      let best = from;
      for (let i = from; i < to; i++) if (probs[i]! < probs[best]!) best = i;
      result.push({ startMs: start, endMs: t(best) });
      start = t(best);
    }
    result.push({ startMs: start, endMs: end });
  }
  return result;
}

function stream(probs: number[], chunkSizes: number[], origin = 0, audioEnd?: number, options: Partial<SegmenterOptions> = {}) {
  const seg = new SpeechSegmenter(options);
  const out: SpeechInterval[] = [];
  const emittedAfterPush: number[] = [];
  let at = 0;
  let k = 0;
  while (at < probs.length) {
    const size = chunkSizes[k++ % chunkSizes.length]!;
    out.push(...seg.push(probs.slice(at, at + size), origin));
    at += size;
    emittedAfterPush.push(out.length);
  }
  out.push(...seg.flush(audioEnd));
  return { out, seg, emittedAfterPush };
}

const batch = (probs: number[], options: Partial<SegmenterOptions> = {}, origin = 0, audioEnd?: number) =>
  stream(probs, [probs.length || 1], origin, audioEnd, options).out;

describe("SpeechSegmenter: hand-checked cases", () => {
  it("pads a single burst by 200 ms on each side", () => {
    // Speech in frames 20..49 = 640..1600 ms.
    const probs = [...run(0, 20), ...run(0.9, 30), ...run(0, 40)];
    expect(batch(probs)).toEqual([{ startMs: 440, endMs: 1800 }]);
  });

  it("does not start the first interval before the first audio", () => {
    expect(batch([...run(0.9, 20), ...run(0, 30)])).toEqual([{ startMs: 0, endMs: 840 }]);
    expect(batch([...run(0.9, 20), ...run(0, 30)], {}, 5000)).toEqual([{ startMs: 5000, endMs: 5840 }]);
  });

  it("drops a burst shorter than 250 ms and keeps one of exactly 256 ms", () => {
    expect(batch([...run(0, 5), ...run(0.9, 7), ...run(0, 40)])).toEqual([]); // 224 ms
    expect(batch([...run(0, 5), ...run(0.9, 8), ...run(0, 40)])).toEqual([{ startMs: 0, endMs: 616 }]); // 160..416 ms
  });

  it("merges two bursts whose raw gap is under 700 ms and keeps them apart at 704 ms", () => {
    // First burst frames 10..19 (320..640). Gap of g frames, then 10 more speech frames.
    const make = (g: number) => [...run(0, 10), ...run(0.9, 10), ...run(0, g), ...run(0.9, 10), ...run(0, 40)];
    expect(batch(make(21))).toEqual([{ startMs: 120, endMs: 41 * F + 10 * F + 200 }]); // 672 ms gap: one interval
    expect(batch(make(22))).toEqual([
      { startMs: 120, endMs: 840 },
      { startMs: 42 * F - 200, endMs: 52 * F + 200 },
    ]);
  });

  it("uses two thresholds: 0.4 alone never starts speech, but it keeps running speech alive", () => {
    expect(batch([...run(0.4, 60), ...run(0, 40)])).toEqual([]);
    // 0.9 for 10 frames, then 0.4 (between the thresholds) for 30 frames, then silence.
    const probs = [...run(0.9, 10), ...run(0.4, 30), ...run(0, 40)];
    expect(batch(probs)).toEqual([{ startMs: 0, endMs: 40 * F + 200 }]);
    // 0.3 is below the end threshold: speech stops being extended.
    expect(batch([...run(0.9, 10), ...run(0.3, 30), ...run(0, 40)])).toEqual([{ startMs: 0, endMs: 10 * F + 200 }]);
  });

  it("closes only after 300 ms (10 frames) of silence, so a 9-frame pause does not split a stretch", () => {
    const withPause = (g: number) => [...run(0.9, 10), ...run(0, g), ...run(0.9, 10), ...run(0, 40)];
    // g = 9: still one stretch, ending at frame 29.
    expect(batch(withPause(9))).toEqual([{ startMs: 0, endMs: 29 * F + 200 }]);
  });

  it("closes a stretch still open at the end of the audio, clamping the padding to the audio end", () => {
    const probs = run(0.9, 50); // speech right to the last frame
    expect(batch(probs)).toEqual([{ startMs: 0, endMs: 50 * F }]);
    expect(batch(probs, {}, 0, 1500)).toEqual([{ startMs: 0, endMs: 1500 }]);
    // trailing silence shorter than 10 frames: stretch ends at its last speech frame, plus padding, within the audio.
    expect(batch([...run(0.9, 20), ...run(0, 5)])).toEqual([{ startMs: 0, endMs: 25 * F }]);
  });

  it("returns nothing for silence, no frames, and flush before any push", () => {
    expect(batch(run(0, 500))).toEqual([]);
    expect(new SpeechSegmenter().flush()).toEqual([]);
    expect(new SpeechSegmenter().push([])).toEqual([]);
  });

  it("treats NaN and out-of-range numbers as silence rather than speech", () => {
    expect(batch([...run(NaN, 40), ...run(0, 40)])).toEqual([]);
  });

  it("waits for the merge window before handing an interval out, then hands it out without a flush", () => {
    const seg = new SpeechSegmenter();
    expect(seg.push([...run(0, 10), ...run(0.9, 10)])).toEqual([]); // speech 320..640 ms
    // Final once the next frame starts 700 ms after 640 ms: frame 41 starts at 1312, so its successor at 1344 qualifies.
    expect(seg.push(run(0, 21))).toEqual([]); // frames 20..40
    expect(seg.push(run(0, 1))).toEqual([{ startMs: 120, endMs: 840 }]); // frame 41
    expect(seg.flush()).toEqual([]); // nothing left behind, nothing handed out twice
  });
});

describe("SpeechSegmenter: the length cap", () => {
  it("cuts continuous speech at the quietest frame in the window just before 30 s, repeatedly", () => {
    // 100 s of speech with one low dip in each cut window. Piece 1 starts at 0; its window is [29000, 29750) ms.
    const n = Math.round(100_000 / F);
    const probs = run(0.9, n);
    probs[920] = 0.1; // 29440 ms, inside [29000, 29750)
    probs[900] = 0.05; // 28800 ms, deeper dip but BEFORE the window: must be ignored
    probs[1840] = 0.1; // second piece starts at 29440, window [58440, 59190): 58880 ms
    const intervals = batch([...probs, ...run(0, 40)]);
    expect(intervals[0]).toEqual({ startMs: 0, endMs: 29440 });
    expect(intervals[1]).toEqual({ startMs: 29440, endMs: 58880 });
    for (const iv of intervals) expect(iv.endMs - iv.startMs).toBeLessThanOrEqual(30_000);
    // pieces touch with no gap and no overlap
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]!.startMs).toBe(intervals[i - 1]!.endMs);
    expect(intervals[intervals.length - 1]!.endMs).toBe(n * F + 200);
  });

  it("takes the earliest of equally quiet frames", () => {
    const probs = run(0.9, 1500);
    probs[915] = 0.2;
    probs[925] = 0.2;
    expect(batch([...probs, ...run(0, 40)])[0]).toEqual({ startMs: 0, endMs: 915 * F });
  });

  it("does not cut an interval of exactly the limit, but cuts one a millisecond longer", () => {
    // A stretch of N frames from frame 0 plus 200 ms of end padding: length = N * 32 + 200 (start clamps to 0).
    const opt = { maxIntervalMs: 5200 };
    // 5200 = 5000 + 200 pad: 156.25 frames; use 156 frames (4992 ms): interval 4992 + 200 = 5192 <= 5200: not cut.
    expect(batch([...run(0.9, 156), ...run(0, 40)], opt)).toEqual([{ startMs: 0, endMs: 5192 }]);
    // 157 frames: 5024 + 200 = 5224 > 5200: cut.
    expect(batch([...run(0.9, 157), ...run(0, 40)], opt).length).toBe(2);
  });

  it("hands out the first pieces of non-stop speech while it is still going, and keeps memory bounded", () => {
    const n = 20_000; // 640 s
    const probs = run(0.9, n);
    for (let i = 900; i < n; i += 900) probs[i] = 0.1;
    const { out, seg, emittedAfterPush } = stream([...probs, ...run(0, 40)], [37, 512, 3, 1000, 81]);
    // Some pieces came out long before the final silence.
    expect(emittedAfterPush[emittedAfterPush.length - 1]).toBeGreaterThan(15); // before flush
    expect(out.length).toBeGreaterThan(20);
    // Memory: during the whole run the history never grew past about two limits' worth of frames.
    const probe = new SpeechSegmenter();
    let peak = 0;
    for (let i = 0; i < n; i += 100) {
      probe.push(probs.slice(i, i + 100));
      peak = Math.max(peak, probe.retainedFrames);
    }
    expect(peak).toBeLessThan((2 * 30_000) / F);
    expect(seg.retainedFrames).toBe(0); // flush reset everything
  });
});

describe("SpeechSegmenter: streaming equals batch", () => {
  const profiles: { name: string; opt: Partial<SegmenterOptions>; maxLen: number }[] = [
    { name: "defaults", opt: {}, maxLen: 6000 },
    { name: "short cap (5 s) so cutting is exercised constantly", opt: { maxIntervalMs: 5000 }, maxLen: 1500 },
    { name: "no padding, short pause", opt: { padMs: 0, minSilenceMs: 64, mergeGapMs: 100 }, maxLen: 1500 },
    { name: "wide merge gap", opt: { mergeGapMs: 2000, maxIntervalMs: 8000 }, maxLen: 2500 },
  ];

  for (const profile of profiles) {
    it(`matches the plain batch version for random audio and random chunking: ${profile.name}`, () => {
      const opt = resolveSegmenterOptions(profile.opt);
      const rand = rng(0xc0ffee ^ profile.maxLen);
      for (let trial = 0; trial < 150; trial++) {
        // Build probabilities from runs: silence, speech, near-threshold noise, and single-frame dips.
        const probs: number[] = [];
        const target = 1 + Math.floor(rand() * profile.maxLen);
        while (probs.length < target) {
          const kind = rand();
          const len = 1 + Math.floor(rand() ** 2 * (kind < 0.5 ? 120 : 400));
          for (let i = 0; i < len; i++) {
            if (kind < 0.3) probs.push(rand() * 0.3); // silence
            else if (kind < 0.7) probs.push(0.5 + rand() * 0.5); // speech
            else if (kind < 0.85) probs.push(0.3 + rand() * 0.25); // hovering around both thresholds
            else probs.push(rand() < 0.1 ? rand() * 0.34 : 0.5 + rand() * 0.5); // speech with sporadic dips
          }
        }
        const origin = Math.floor(rand() * 100_000);
        const audioEnd = origin + probs.length * F - Math.floor(rand() * F);
        const chunkSizes = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => 1 + Math.floor(rand() * 400));
        const expected = reference(probs, origin, audioEnd, opt);
        const { out } = stream(probs, chunkSizes, origin, audioEnd, profile.opt);
        // Include the seed and trial in the message so a failure can be replayed.
        expect({ trial, out }).toEqual({ trial, out: expected });
        // Output is ordered, non-empty, and non-overlapping.
        for (let i = 0; i < out.length; i++) {
          expect(out[i]!.endMs).toBeGreaterThan(out[i]!.startMs);
          if (i > 0) expect(out[i]!.startMs).toBeGreaterThanOrEqual(out[i - 1]!.endMs);
          expect(out[i]!.endMs - out[i]!.startMs).toBeLessThanOrEqual(opt.maxIntervalMs);
        }
      }
    });
  }

  it("gives the same answer one frame at a time as in one call", () => {
    const rand = rng(7);
    const probs = Array.from({ length: 3000 }, (_, i) => (Math.sin(i / 40) > 0.2 ? 0.6 + rand() * 0.4 : rand() * 0.4));
    expect(stream(probs, [1]).out).toEqual(stream(probs, [probs.length]).out);
  });
});

describe("SpeechSegmenter: lifecycle and options", () => {
  it("is reusable after flush and after reset", () => {
    const probs = [...run(0, 10), ...run(0.9, 20), ...run(0, 40)];
    const seg = new SpeechSegmenter();
    seg.push(probs);
    const first = seg.flush();
    seg.push(probs, 10_000);
    const second = seg.flush();
    expect(second.map((i) => ({ startMs: i.startMs - 10_000, endMs: i.endMs - 10_000 }))).toEqual(first);
    seg.push(run(0.9, 10));
    seg.reset();
    expect(seg.flush()).toEqual([]);
  });

  it("rejects nonsense options", () => {
    expect(() => new SpeechSegmenter({ frameMs: 0 })).toThrow();
    expect(() => new SpeechSegmenter({ startThreshold: 0.3, endThreshold: 0.5 })).toThrow();
    expect(() => new SpeechSegmenter({ padMs: -1 })).toThrow();
    expect(() => new SpeechSegmenter({ maxIntervalMs: 1000 })).toThrow();
    expect(() => new SpeechSegmenter({ minSpeechMs: NaN })).toThrow();
    expect(DEFAULT_SEGMENTER_OPTIONS.frameMs).toBe(32);
  });
});
