import { describe, expect, it } from "vitest";
import { SAMPLE_RATE } from "../contracts";
import type { PcmChunk } from "../contracts";
import type { SpeechInterval } from "../types";
import { rng } from "./test-kit";
import { createVocalActivityDetector } from "./vocal-activity";
import type { VocalActivityDetector } from "./vocal-activity";

/**
 * Synthetic audio whose answer we know. Every test below is built from these pieces, so a failure means the
 * detector's rule changed, not that a fixture drifted.
 */
type Part =
  | { ms: number; kind: "voice"; freq?: number; amp?: number }
  | { ms: number; kind: "silence" }
  | { ms: number; kind: "bass"; amp?: number }
  | { ms: number; kind: "hiss"; amp?: number }
  | { ms: number; kind: "noise"; amp?: number }
  | { ms: number; kind: "quietNoise"; amp?: number };

const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
const TWO_PI = 2 * Math.PI;

/**
 * Renders the parts end to end.
 *  - voice: 220 Hz by default, with two decaying overtones and a small noise floor, like a sung vowel.
 *  - bass: 60 Hz sine, the lowest common denominator of a musical bed.
 *  - hiss: white noise ring-modulated at 3 kHz, i.e. a noise burst with no pitch.
 *  - noise: white noise, flat across the whole spectrum.
 */
function render(parts: readonly Part[], seed = 3): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.ms, 0) * SAMPLES_PER_MS;
  const samples = new Float32Array(total);
  const random = rng(seed);
  let at = 0;
  for (const part of parts) {
    const count = part.ms * SAMPLES_PER_MS;
    for (let i = 0; i < count; i += 1) {
      const t = (at + i) / SAMPLE_RATE;
      const white = random() * 2 - 1;
      switch (part.kind) {
        case "voice": {
          const freq = part.freq ?? 220;
          const amp = part.amp ?? 0.2;
          samples[at + i] = amp * (Math.sin(TWO_PI * freq * t) + 0.5 * Math.sin(2 * TWO_PI * freq * t) + 0.25 * Math.sin(3 * TWO_PI * freq * t)) + 0.015 * white;
          break;
        }
        case "bass":
          samples[at + i] = (part.amp ?? 0.5) * Math.sin(TWO_PI * 60 * t);
          break;
        case "hiss":
          samples[at + i] = (part.amp ?? 0.5) * white * Math.sin(TWO_PI * 3000 * t);
          break;
        case "noise":
          samples[at + i] = (part.amp ?? 0.3) * white;
          break;
        case "quietNoise":
          samples[at + i] = (part.amp ?? 0.01) * white;
          break;
        case "silence":
          samples[at + i] = 0;
          break;
      }
    }
    at += count;
  }
  return samples;
}

function chunks(samples: Float32Array, chunkMs = 100): PcmChunk[] {
  const size = chunkMs * SAMPLES_PER_MS;
  const out: PcmChunk[] = [];
  for (let start = 0; start < samples.length; start += size) {
    out.push({ startMs: start / SAMPLES_PER_MS, samples: samples.subarray(start, Math.min(start + size, samples.length)) });
  }
  return out;
}

/** Feeds the whole clip the way the pipeline does, then flushes, and returns everything the detector decided. */
async function drain(detector: VocalActivityDetector, samples: Float32Array, chunkMs = 100) {
  const closed: SpeechInterval[] = [];
  for (const chunk of chunks(samples, chunkMs)) closed.push(...(await detector.push(chunk)));
  const tail = await detector.flush();
  return { vocal: [...closed, ...tail], instrumental: detector.instrumentalSpans() };
}

const totalMs = (spans: readonly SpeechInterval[]) => spans.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
const covers = (spans: readonly SpeechInterval[], middleMs: number) => spans.some((span) => middleMs >= span.startMs && middleMs <= span.endMs);

describe("createVocalActivityDetector: the conservative rule", () => {
  it("keeps a 220 Hz voiced tone in noise", async () => {
    // The protective case: a quiet, voiced stretch must always be kept, or spoken words get lost.
    const { vocal, instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 3000, kind: "voice" }]));
    expect(instrumental).toEqual([]);
    expect(vocal).toHaveLength(1);
    expect(vocal[0]).toMatchObject({ startMs: 0, endMs: 3000 });
  });

  it("excludes a loud 60 Hz bass plus a 3 kHz noise burst, which has no voicing", async () => {
    const { instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 3000, kind: "bass" }, { ms: 3000, kind: "hiss" }]));
    expect(totalMs(instrumental)).toBeGreaterThan(5600);
    expect(covers(instrumental, 1500)).toBe(true);
    expect(covers(instrumental, 4500)).toBe(true);
  });

  it("excludes a loud bass-only note, which has almost no energy in the voice band", async () => {
    const { instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 3000, kind: "bass" }]));
    expect(instrumental).toHaveLength(1);
    expect(instrumental[0].endMs - instrumental[0].startMs).toBeGreaterThan(2500);
  });

  it("keeps a low male voice with harmonics over a loud bass, because the harmonics are in the voice band", async () => {
    // The protective case a reviewer probed: a low fundamental must not be mistaken for a bass note. A real voice has
    // overtones in 200-4000 Hz; a pure sine at the same pitch does not, and may still be excluded.
    const bass = render([{ ms: 3000, kind: "bass", amp: 0.5 }]);
    const voice = render([{ ms: 3000, kind: "voice", freq: 110, amp: 0.2 }], 7);
    const mixed = new Float32Array(Math.max(bass.length, voice.length));
    for (let i = 0; i < mixed.length; i += 1) mixed[i] = (bass[i] ?? 0) + (voice[i] ?? 0);
    const { vocal } = await drain(createVocalActivityDetector(), mixed);
    expect(covers(vocal, 1500)).toBe(true);
  });

  it("excludes digital silence, as the detector it replaces did", async () => {
    const { vocal, instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 2000, kind: "silence" }]));
    expect(vocal).toEqual([]);
    expect(instrumental).toEqual([{ startMs: 0, endMs: 2000 }]);
  });

  it("keeps a quiet unvoiced fricative, because it is not loud", async () => {
    // A hiss that is too quiet to be music is still speech until proven otherwise: keep it.
    const { vocal, instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 2000, kind: "quietNoise" }]));
    expect(instrumental).toEqual([]);
    expect(vocal).toHaveLength(1);
    expect(totalMs(vocal)).toBeGreaterThan(1900);
  });
});

describe("createVocalActivityDetector: hysteresis and gaps", () => {
  it("does not split a phrase on a short dip (a breath, a consonant)", async () => {
    const { vocal, instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 2000, kind: "voice" }, { ms: 250, kind: "silence" }, { ms: 2000, kind: "voice" }]));
    expect(instrumental).toEqual([]);
    expect(vocal).toHaveLength(1);
    expect(vocal[0]).toMatchObject({ startMs: 0, endMs: 4250 });
  });

  it("joins two phrases separated by less than the bridge, keeping the gap", async () => {
    const { vocal, instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 2000, kind: "voice" }, { ms: 500, kind: "silence" }, { ms: 2000, kind: "voice" }]));
    expect(instrumental).toEqual([]);
    expect(vocal).toHaveLength(1);
    expect(vocal[0]).toMatchObject({ startMs: 0, endMs: 4500 });
  });

  it("splits a phrase at a gap longer than the bridge, and reports the gap as instrumental", async () => {
    const { vocal, instrumental } = await drain(createVocalActivityDetector(), render([{ ms: 2000, kind: "voice" }, { ms: 2000, kind: "silence" }, { ms: 2000, kind: "voice" }]));
    expect(vocal).toHaveLength(2);
    expect(Math.abs(vocal[0].endMs - 2000)).toBeLessThanOrEqual(40);
    expect(Math.abs(vocal[1].startMs - 4000)).toBeLessThanOrEqual(40);
    expect(instrumental).toHaveLength(1);
    expect(Math.abs(instrumental[0].startMs - vocal[0].endMs)).toBeLessThanOrEqual(2);
    expect(Math.abs(instrumental[0].endMs - vocal[1].startMs)).toBeLessThanOrEqual(2);
  });

  it("tiles the file exactly: every millisecond is either vocal or instrumental", async () => {
    const { vocal, instrumental } = await drain(
      createVocalActivityDetector(),
      render([{ ms: 1000, kind: "voice" }, { ms: 2000, kind: "bass" }, { ms: 1000, kind: "voice" }, { ms: 1000, kind: "silence" }]),
    );
    const decided = [...vocal.map((span) => ({ ...span, kind: "vocal" })), ...instrumental.map((span) => ({ ...span, kind: "instrumental" }))].sort((a, b) => a.startMs - b.startMs);
    expect(decided[0].startMs).toBe(0);
    expect(decided[decided.length - 1].endMs).toBe(5000);
    for (let i = 1; i < decided.length; i += 1) expect(decided[i].startMs, `span ${i}`).toBe(decided[i - 1].endMs);
    expect(decided.map((span) => span.kind)).toEqual(["vocal", "instrumental", "vocal", "instrumental"]);
  });
});

describe("createVocalActivityDetector: the VoiceDetector contract", () => {
  it("returns nothing until an interval is certain, then everything from flush", async () => {
    const detector = createVocalActivityDetector();
    const closed: SpeechInterval[] = [];
    for (const chunk of chunks(render([{ ms: 1000, kind: "voice" }]))) closed.push(...(await detector.push(chunk)));
    expect(closed).toEqual([]); // still open: the file might continue
    expect(await detector.flush()).toEqual([{ startMs: 0, endMs: 1000 }]);
  });

  it("rounds to whole milliseconds and ignores an empty chunk", async () => {
    const detector = createVocalActivityDetector();
    expect(await detector.push({ startMs: 0, samples: new Float32Array(0) })).toEqual([]);
    await detector.push({ startMs: 10.4, samples: render([{ ms: 500, kind: "voice" }]) });
    const closed = await detector.flush();
    expect(closed).toHaveLength(1);
    expect(Number.isInteger(closed[0].startMs) && Number.isInteger(closed[0].endMs)).toBe(true);
  });

  it("starts a new file from scratch after reset", async () => {
    const detector = createVocalActivityDetector();
    await drain(detector, render([{ ms: 2000, kind: "bass" }]));
    expect(detector.instrumentalSpans()).toHaveLength(1);
    detector.reset();
    await drain(detector, render([{ ms: 2000, kind: "voice" }]));
    expect(detector.instrumentalSpans()).toEqual([]);
  });

  it("rejects promptly when the caller has already cancelled", async () => {
    const detector = createVocalActivityDetector();
    const controller = new AbortController();
    controller.abort();
    await expect(detector.push(chunks(render([{ ms: 100, kind: "voice" }]))[0], controller.signal)).rejects.toMatchObject({ code: "aborted" });
  });

  it("works the same whatever the chunk size", async () => {
    const samples = render([{ ms: 1200, kind: "voice" }, { ms: 1500, kind: "bass" }, { ms: 1200, kind: "voice" }]);
    const small = await drain(createVocalActivityDetector(), samples, 40);
    const large = await drain(createVocalActivityDetector(), samples, 700);
    expect(large.vocal).toEqual(small.vocal);
    expect(large.instrumental).toEqual(small.instrumental);
  });
});
