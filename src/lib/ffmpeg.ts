import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
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

    const base = `${import.meta.env.BASE_URL}ffmpeg`;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });

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
