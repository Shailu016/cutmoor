/**
 * DEVELOPMENT ONLY. A fake captioning engine so the tool screen can be tried and tested without
 * any model. It makes up sample sentences and spreads them over the file's length: the text has
 * nothing to do with what is said in the file.
 *
 * It is only reachable through `?captions-test` on a development server (see useCaptionJob), and
 * that branch is removed from production builds, so this file cannot ship by accident.
 *
 * Modes (comma separated after `?captions-test=`): `no-audio`, `no-speech`, `fail` (the model
 * fails half way), `download-fail`, `cached` (the model counts as already downloaded), `fast`
 * (no pauses), `no-burn` (no MP4 export in this build), `long` (pretends the file is 40 minutes long, to try a big transcript),
 * `english` / `hindi` / `hinglish` (write the sample words in that language, whatever the tool's setting is).
 */
import {
  CaptionError,
  type BurnInExporter,
  type CaptionLanguage,
  type CaptionPipeline,
  type CaptionResult,
  type PipelineOptions,
  type PipelineStage,
} from "../../lib/captioning/contracts";
import { layoutCaptions } from "../../lib/captioning/layout";
import { storeKey, type ModelFile, type ModelManifest, type ModelStore } from "../../lib/captioning/model-loader";
import type { SpeechInterval, Word } from "../../lib/captioning/types";
import { readVideoMeta } from "../../lib/media";
import type { CaptionRuntime, CaptionRuntimeFactory } from "./runtime-types";

const PHRASES: Record<CaptionLanguage, string[]> = {
  hinglish: [
    "Namaste dosto, aaj hum seekhenge video mein captions kaise lagate hain.",
    "Sabse pehle apna video chuniye, phir bhasha select kijiye.",
    "Kuch hi der mein aapke captions taiyaar ho jayenge.",
    "Har shabd ko aap edit kar sakte hain.",
    "Shukriya dekhne ke liye, milte hain agle video mein.",
  ],
  hindi: [
    "नमस्ते दोस्तों, आज हम सीखेंगे वीडियो में कैप्शन कैसे लगाते हैं।",
    "सबसे पहले अपना वीडियो चुनिए, फिर भाषा चुनिए।",
    "कुछ ही देर में आपके कैप्शन तैयार हो जाएंगे।",
    "हर शब्द को आप एडिट कर सकते हैं।",
  ],
  english: [
    "Hello everyone, today we will add captions to a video.",
    "First pick your video, then choose the language.",
    "In a moment your captions will be ready.",
    "You can edit every single word.",
    "Thanks for watching, see you in the next one.",
  ],
};

const FILE_BYTES = 24 * 1024 * 1024;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CaptionError("aborted", "Cancelled."));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CaptionError("aborted", "Cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Deterministic made-up words laid across `durationMs`, with one stretch left uncovered. */
export function makeSampleWords(durationMs: number, language: CaptionLanguage): { words: Word[]; uncovered: SpeechInterval[] } {
  const phrases = PHRASES[language];
  const gapStart = Math.round(durationMs * 0.55);
  const gapEnd = gapStart + Math.min(1200, Math.round(durationMs * 0.15));
  const words: Word[] = [];
  let t = 300;
  let phrase = 0;
  let n = 0;
  while (t < durationMs - 400) {
    for (const text of phrases[phrase % phrases.length].split(" ")) {
      const length = 260 + ((n * 97) % 260);
      if (t + length > durationMs - 200) break;
      const inGap = gapEnd > gapStart && t >= gapStart && t < gapEnd;
      if (!inGap) {
        words.push({ text, startMs: t, endMs: t + length, confidence: n % 7 === 3 ? 0.45 : 0.92, index: words.length, windowIndex: Math.floor(t / 30_000) });
      }
      t += length + 40;
      n += 1;
    }
    t += 500 + ((phrase * 131) % 400);
    phrase += 1;
  }
  return { words, uncovered: gapEnd > gapStart && words.length > 0 ? [{ startMs: gapStart, endMs: gapEnd }] : [] };
}

function createStore(): ModelStore {
  const data = new Map<string, Uint8Array>();
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, bytes) => void data.set(key, bytes),
    delete: async (key) => data.delete(key),
  };
}

export function createUiTestRuntimeFactory(mode: string): CaptionRuntimeFactory {
  const flags = new Set(mode.split(",").map((item) => item.trim()).filter(Boolean));
  const fast = flags.has("fast");
  const pause = (ms: number, signal?: AbortSignal) => sleep(fast ? 5 : ms, signal);

  const file: ModelFile = {
    name: "ui-test-model",
    url: "https://models.cutmoor.com/m/0000000000000000.bin",
    bytes: FILE_BYTES,
    sha256: "0".repeat(64),
  };
  const manifest: ModelManifest = { id: "ui-test-double", version: "0", files: [file] };
  const store = createStore();

  return () => {
    // Nothing is fetched. A "download" here is only a timer that moves a progress bar.
    const preload = flags.has("cached") ? store.put(storeKey(file), new Uint8Array(FILE_BYTES)) : Promise.resolve();

    const pipeline: CaptionPipeline = {
      async run(input: File, options: PipelineOptions): Promise<CaptionResult> {
        const { signal } = options;
        const started = performance.now();
        let fraction = 0;
        const report = (stage: PipelineStage, to: number, message: string, download?: { loaded: number }) => {
          fraction = Math.max(fraction, to);
          options.onProgress?.({
            stage,
            fraction,
            message,
            download: download ? { file: file.name, loadedBytes: download.loaded, totalBytes: FILE_BYTES } : undefined,
          });
        };

        report("reading-audio", 0.02, "Reading the sound");
        const meta = await readVideoMeta(input);
        await pause(400, signal);
        if (flags.has("no-audio")) throw new CaptionError("no-audio", "no audio track");
        report("reading-audio", 0.12, "Reading the sound");
        await pause(300, signal);
        report("finding-speech", 0.2, "Finding where people speak");
        await pause(400, signal);
        if (flags.has("no-speech")) throw new CaptionError("no-speech", "no speech");

        const cached = (await store.get(storeKey(file))) !== null;
        if (!cached) {
          for (let step = 1; step <= 10; step += 1) {
            report("loading-model", 0.2 + 0.2 * (step / 10), "Loading the model", { loaded: (FILE_BYTES * step) / 10 });
            await pause(150, signal);
            if (flags.has("download-fail") && step === 4) throw new CaptionError("model-download", "network");
          }
          await store.put(storeKey(file), new Uint8Array(FILE_BYTES));
        } else {
          report("loading-model", 0.4, "Starting the model");
          await pause(200, signal);
        }

        const durationMs = flags.has("long") ? 40 * 60_000 : Math.max(4000, Math.round((meta.duration || 10) * 1000));
        const forced = (["english", "hindi", "hinglish"] as const).find((language) => flags.has(language));
        const { words, uncovered } = makeSampleWords(durationMs, forced ?? options.language);
        const windows = Math.max(3, Math.ceil(durationMs / 30_000));
        for (let k = 1; k <= windows; k += 1) {
          if (flags.has("fail") && k === 2) throw new CaptionError("inference", "model failed");
          report("transcribing", 0.4 + 0.45 * (k / windows), `Transcribing ${k} of ${windows}`);
          const sofar = words.filter((word) => word.startMs < (durationMs * k) / windows);
          options.onPartial?.(layoutCaptions(sofar), sofar);
          await pause(600, signal);
        }
        report("aligning", 0.92, "Timing every word");
        await pause(300, signal);
        report("finishing", 0.98, "Finishing");
        await pause(150, signal);

        return {
          words,
          events: layoutCaptions(words),
          uncoveredSpeech: uncovered,
          stats: {
            audioSeconds: durationMs / 1000,
            speechSeconds: Math.round(durationMs * 0.8) / 1000,
            windows,
            flaggedWindows: 0,
            droppedWords: 0,
            stageMs: { transcribing: Math.round(performance.now() - started) },
            engineId: "ui-test-double",
            alignerId: "ui-test-double",
          },
        };
      },
      async dispose() {},
    };

    const burnIn: BurnInExporter | null = flags.has("no-burn")
      ? null
      : {
          isSupported: async () => true,
          async export(options) {
            for (let step = 1; step <= 5; step += 1) {
              await pause(200, options.signal);
              options.onProgress?.(step / 5);
            }
            // Not a real captioned video: the first bytes of the source, so the download button can be tried.
            return new Blob([options.file.slice(0, 64 * 1024)], { type: "video/mp4" });
          },
        };

    const runtime: CaptionRuntime = {
      pipeline,
      manifest,
      store,
      burnIn,
      label: "UI test double (made-up sample text)",
      isTestDouble: true,
    };
    return preload.then(() => runtime);
  };
}
