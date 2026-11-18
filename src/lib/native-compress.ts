import { NO_AUDIO_ROUTE_MESSAGE } from "./compress-engine";
import { onFFmpegProgress, resetFFmpeg, runFFmpeg } from "./ffmpeg";
import type { CompressJob } from "./native-compress-core";
import type { CompressWorkerMessage } from "./native-compress.worker";

export interface NativeCompressOptions {
  file: File;
  videoKbps: number;
  audioKbps: number;
  /** Output height, or null to keep the source size. */
  height: number | null;
  audio: "native" | "ffmpeg" | "none";
  audioChannels: number;
  durationSeconds: number;
  expectedBytes: number;
  signal: AbortSignal;
  onProgress: (value: number) => void;
  onStatus: (text: string) => void;
  onOutputBytes: (bytes: number) => void;
}

export interface NativeCompressResult {
  blob: Blob;
  release: () => Promise<void>;
}

function cancelled(): DOMException {
  return new DOMException("The job was cancelled.", "AbortError");
}

async function removeStored(name: string | null): Promise<void> {
  if (!name) return;
  const folder = await navigator.storage.getDirectory().catch(() => null);
  await folder?.removeEntry(name).catch(() => undefined);
}

/** Sound the browser cannot decode (AC3, DTS and others) goes through the FFmpeg engine, which reads only the audio. */
async function convertAudioWithFFmpeg(options: NativeCompressOptions): Promise<Blob> {
  const stopProgress = onFFmpegProgress((value) => options.onProgress(value * 0.1));
  const stop = () => resetFFmpeg();
  options.signal.addEventListener("abort", stop, { once: true });
  try {
    return await runFFmpeg({
      file: options.file,
      outputName: "cutmoor-audio.m4a",
      args: (input) => ["-i", input, "-map", "0:a:0", "-vn", "-c:a", "aac", "-ac", "2", "-b:a", `${options.audioKbps}k`, "-y", "cutmoor-audio.m4a"],
    });
  } catch {
    if (options.signal.aborted) throw cancelled();
    throw new Error(NO_AUDIO_ROUTE_MESSAGE);
  } finally {
    stopProgress();
    options.signal.removeEventListener("abort", stop);
  }
}

/** Compresses with the browser's own codecs in a worker, so the page stays responsive during long jobs. */
export async function compressNative(options: NativeCompressOptions): Promise<NativeCompressResult> {
  let convertedAudio: Blob | null = null;
  if (options.audio === "ffmpeg") {
    options.onStatus("Converting the sound…");
    convertedAudio = await convertAudioWithFFmpeg(options);
  }
  if (options.signal.aborted) throw cancelled();

  const job: CompressJob = {
    file: options.file,
    convertedAudio,
    videoKbps: options.videoKbps,
    audioKbps: options.audioKbps,
    height: options.height,
    audio: options.audio,
    audioChannels: options.audioChannels,
    durationSeconds: options.durationSeconds,
    expectedBytes: options.expectedBytes,
  };

  const worker = new Worker(new URL("./native-compress.worker.ts", import.meta.url), { type: "module" });
  let storageName: string | null = null;
  try {
    return await new Promise<NativeCompressResult>((resolve, reject) => {
      const stop = () => reject(cancelled());
      options.signal.addEventListener("abort", stop, { once: true });
      worker.onerror = (event) => reject(new Error(event.message || "The video worker stopped unexpectedly."));
      worker.onmessage = (event: MessageEvent<CompressWorkerMessage>) => {
        const message = event.data;
        if (message.type === "progress") options.onProgress(message.value);
        else if (message.type === "status") options.onStatus(message.text);
        else if (message.type === "bytes") options.onOutputBytes(message.value);
        else if (message.type === "storage") storageName = message.name;
        else if (message.type === "failed") reject(new Error(message.message));
        else {
          const stored = message.storageName;
          options.signal.removeEventListener("abort", stop);
          resolve({ blob: message.blob, release: () => removeStored(stored) });
        }
      };
      worker.postMessage(job);
    });
  } catch (error) {
    worker.terminate();
    await removeStored(storageName);
    throw error;
  } finally {
    worker.terminate();
  }
}
