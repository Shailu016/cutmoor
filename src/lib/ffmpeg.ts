import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { explainFailure, isUnsupportedDecodeError, unsupportedVideoMessage } from "./ffmpeg-errors";
import { extensionOf, mimeForName } from "./format";
import { EMPTY_INFO, parseMediaInfo, type MediaInfo } from "./media-info";

/**
 * One lazy ffmpeg instance for the whole tab. The core is ~32 MB, so it is
 * fetched only when the visitor actually runs a job. The singleton keeps the
 * second job fast, and subscribers let each tool listen without piling up
 * duplicate event handlers on the instance.
 */

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let jobsSinceLoad = 0;

/**
 * The WebAssembly encoder keeps its memory between jobs and, after many different jobs in one tab, can fail
 * with "memory access out of bounds" on a perfectly good file (seen in the verification runs). Starting a fresh
 * instance every few jobs avoids that; the next job reloads the encoder from the browser cache in a second or two.
 */
export const MAX_JOBS_PER_INSTANCE = 4;

function countJobAndRecycle(): void {
  jobsSinceLoad += 1;
  if (jobsSinceLoad >= MAX_JOBS_PER_INSTANCE) resetFFmpeg();
}

const logListeners = new Set<(message: string) => void>();
const progressListeners = new Set<(progress: number) => void>();

export function onFFmpegLog(listener: (message: string) => void): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

export function onFFmpegProgress(listener: (progress: number) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/**
 * Same origin by default. VITE_FFMPEG_BASE_URL moves the core to R2 or a CDN
 * for hosts with a per-file limit. Only the encoder is fetched from there;
 * the visitor's files still never leave the browser.
 */
export function ffmpegBaseUrl(): string {
  const configured = String(import.meta.env.VITE_FFMPEG_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return configured || `${import.meta.env.BASE_URL}ffmpeg`;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Fetch a core file and refuse to run it unless its SHA-256 matches the hash
 * pinned at build time. This keeps a CDN copy from being swapped underneath us.
 *
 * Fails closed: when the encoder comes from another origin, a missing pin or a
 * browser that cannot compute SHA-256 stops the load instead of skipping the
 * check. A same-origin copy is part of this deploy, so it needs no pin.
 */
export async function verifiedBlobURL(
  url: string,
  type: string,
  expected: string | undefined,
  { required }: { required: boolean },
): Promise<string> {
  if (required && !expected) {
    throw new Error("The video engine could not be verified, so it was not loaded. This is a problem with the site's build, not your file.");
  }
  if (required && !globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify the video engine before running it, so it was not loaded. Update your browser and try again.");
  }
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`The video engine could not be downloaded (${response.status}). Check your connection and try again.`);
  const buffer = await response.arrayBuffer();
  if (expected && globalThis.crypto?.subtle) {
    const actual = toBase64(await crypto.subtle.digest("SHA-256", buffer));
    if (actual !== expected) throw new Error("The video engine failed its integrity check and was not loaded.");
  }
  return URL.createObjectURL(new Blob([buffer], { type }));
}

/** True when the encoder is fetched from a different origin than the page (a CDN or R2). */
export function isRemoteBase(base: string, pageOrigin: string): boolean {
  try {
    return new URL(base, pageOrigin).origin !== pageOrigin;
  } catch {
    return true;
  }
}

async function load(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      for (const listener of logListeners) listener(message);
    });
    ffmpeg.on("progress", ({ progress }) => {
      const value = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      for (const listener of progressListeners) listener(value);
    });

    const base = ffmpegBaseUrl();
    const required = isRemoteBase(base, window.location.origin);
    const [coreURL, wasmURL] = await Promise.all([
      verifiedBlobURL(`${base}/ffmpeg-core.js`, "text/javascript", __FFMPEG_CORE_SHA256__?.js, { required }),
      verifiedBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm", __FFMPEG_CORE_SHA256__?.wasm, { required }),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });

    instance = ffmpeg;
    jobsSinceLoad = 0;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Real timings for one job, from performance.now(). */
export interface RunTimings {
  /** Time spent fetching and starting the encoder. Near zero once it is cached and running. */
  engineLoadMs: number;
  /** Time from handing the file to the encoder until the output is read back. */
  processMs: number;
}

export interface RunOptions {
  file: File;
  outputName: string;
  args: (inputName: string) => string[];
  onTimings?: (timings: RunTimings) => void;
}

/** Runs a command, but gives up at the first sign that the video cannot be decoded at all. */
async function execUnlessUndecodable(ffmpeg: FFmpeg, command: string[], recentLog: string[]): Promise<number> {
  let giveUp: (reason: Error) => void = () => undefined;
  const undecodable = new Promise<never>((_, reject) => {
    giveUp = reject;
  });
  const stopWatching = onFFmpegLog((message) => {
    if (!isUnsupportedDecodeError(message)) return;
    // In this order: stopping the worker also fails the running command, and this message must be the one reported.
    giveUp(new Error(unsupportedVideoMessage(recentLog)));
    resetFFmpeg();
  });
  try {
    return await Promise.race([ffmpeg.exec(command), undecodable]);
  } finally {
    stopWatching();
  }
}

export async function runFFmpeg({ file, outputName, args, onTimings }: RunOptions): Promise<Blob> {
  const loadStarted = performance.now();
  const ffmpeg = await load();
  const engineLoadMs = performance.now() - loadStarted;
  const inputName = `input.${extensionOf(file.name)}`;
  const command = args(inputName);
  const processStarted = performance.now();
  // Keep the encoder's last log lines so a failure can be explained in plain words.
  const recentLog: string[] = [];
  const stopCapture = onFFmpegLog((message) => {
    recentLog.push(message);
    if (recentLog.length > 40) recentLog.shift();
  });

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await execUnlessUndecodable(ffmpeg, command, recentLog);
    if (exitCode !== 0) {
      throw new Error(
        explainFailure(recentLog) ??
          `The encoder exited with code ${exitCode}. Try a different input file or a lower resolution.`,
      );
    }
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === "string") throw new Error("The encoder returned text instead of a media file.");
    onTimings?.({ engineLoadMs, processMs: performance.now() - processStarted });
    return new Blob([data as unknown as BlobPart], { type: mimeForName(outputName) });
  } finally {
    stopCapture();
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
    countJobAndRecycle();
  }
}

export interface JobInputs {
  /** Names the files were written under (`in0.mp4`, `in1.png`, ...), in the order given. */
  names: string[];
  /** What the encoder reports about each file. All empty unless `probe` was asked for. */
  infos: MediaInfo[];
}

export interface RunJobOptions {
  /** Every input file. The first is the main one; the rest are a second clip, a logo, an audio track, and so on. */
  inputs: Array<File | Blob>;
  /** File names to give each input. Defaults to `in<N>.<extension>`. Only the extension matters to the encoder. */
  inputNames?: string[];
  outputName: string;
  /** Read the streams of each input first (audio or not, length, frame rate) so the command can be built to match. */
  probe?: boolean;
  build: (inputs: JobInputs) => string[];
  onTimings?: (timings: RunTimings) => void;
}

/**
 * Like runFFmpeg, for tools with more than one input. All files are written to the encoder's in-memory
 * folder, optionally probed, then the command is built from the real stream information and run.
 */
export async function runFFmpegJob({ inputs, inputNames, outputName, probe = false, build, onTimings }: RunJobOptions): Promise<Blob> {
  const loadStarted = performance.now();
  const ffmpeg = await load();
  const engineLoadMs = performance.now() - loadStarted;
  const names = inputs.map((input, index) => inputNames?.[index] ?? `in${index}.${extensionOf(input instanceof File ? input.name : "x.bin")}`);
  const processStarted = performance.now();
  const recentLog: string[] = [];
  const stopCapture = onFFmpegLog((message) => {
    recentLog.push(message);
    if (recentLog.length > 60) recentLog.shift();
  });

  try {
    for (let index = 0; index < inputs.length; index += 1) await ffmpeg.writeFile(names[index], await fetchFile(inputs[index]));
    const infos: MediaInfo[] = [];
    for (const name of names) {
      if (!probe) {
        infos.push({ ...EMPTY_INFO });
        continue;
      }
      const lines: string[] = [];
      const stopProbe = onFFmpegLog((message) => lines.push(message));
      // With no output FFmpeg exits non-zero after printing the stream list; that is the normal result here.
      await ffmpeg.exec(["-hide_banner", "-i", name]);
      stopProbe();
      infos.push(parseMediaInfo(lines));
    }
    recentLog.length = 0;
    const command = build({ names, infos });
    const exitCode = await execUnlessUndecodable(ffmpeg, command, recentLog);
    if (exitCode !== 0) {
      throw new Error(
        explainFailure(recentLog) ?? `The encoder exited with code ${exitCode}. Try a different input file or a smaller one.`,
      );
    }
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === "string") throw new Error("The encoder returned text instead of a media file.");
    onTimings?.({ engineLoadMs, processMs: performance.now() - processStarted });
    return new Blob([data as unknown as BlobPart], { type: mimeForName(outputName) });
  } finally {
    stopCapture();
    for (const name of names) await ffmpeg.deleteFile(name).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
    countJobAndRecycle();
  }
}

/** Terminate the worker after a cancel or a fatal error so the next job starts clean. */
export function resetFFmpeg(): void {
  if (instance) {
    try {
      instance.terminate();
    } catch {
      // The worker may already be gone.
    }
  }
  instance = null;
  loading = null;
}
