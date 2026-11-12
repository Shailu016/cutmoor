import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { extensionOf, mimeForName } from "./format";

/**
 * One lazy ffmpeg instance for the whole tab. The core is ~32 MB, so it is
 * fetched only when the visitor actually runs a job. The singleton keeps the
 * second job fast, and subscribers let each tool listen without piling up
 * duplicate event handlers on the instance.
 */

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

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
 */
async function verifiedBlobURL(url: string, type: string, expected: string | undefined): Promise<string> {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`The video engine could not be downloaded (${response.status}). Check your connection and try again.`);
  const buffer = await response.arrayBuffer();
  if (expected && globalThis.crypto?.subtle) {
    const actual = toBase64(await crypto.subtle.digest("SHA-256", buffer));
    if (actual !== expected) throw new Error("The video engine failed its integrity check and was not loaded.");
  }
  return URL.createObjectURL(new Blob([buffer], { type }));
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
    const [coreURL, wasmURL] = await Promise.all([
      verifiedBlobURL(`${base}/ffmpeg-core.js`, "text/javascript", __FFMPEG_CORE_SHA256__?.js),
      verifiedBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm", __FFMPEG_CORE_SHA256__?.wasm),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });

    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

export interface RunOptions {
  file: File;
  outputName: string;
  args: (inputName: string) => string[];
}

export async function runFFmpeg({ file, outputName, args }: RunOptions): Promise<Blob> {
  const ffmpeg = await load();
  const inputName = `input.${extensionOf(file.name)}`;
  const command = args(inputName);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await ffmpeg.exec(command);
    if (exitCode !== 0) {
      throw new Error(`The encoder exited with code ${exitCode}. Try a different input file or a lower resolution.`);
    }
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === "string") throw new Error("The encoder returned text instead of a media file.");
    return new Blob([data as unknown as BlobPart], { type: mimeForName(outputName) });
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
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
