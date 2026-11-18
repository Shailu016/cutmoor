import type { EncodedPacket, InputAudioTrack, StreamTargetChunk } from "mediabunny";
import { SparseBlobBuilder } from "./captioning/burn-in/blob-sink";
import { NO_AUDIO_ROUTE_MESSAGE } from "./compress-engine";
import { formatBytes } from "./format";

export interface CompressJob {
  file: File;
  /** Sound already converted by the FFmpeg engine, when the browser cannot decode the original. */
  convertedAudio: Blob | null;
  videoKbps: number;
  audioKbps: number;
  /** Output height, or null to keep the source size. */
  height: number | null;
  audio: "native" | "ffmpeg" | "none";
  audioChannels: number;
  durationSeconds: number;
  expectedBytes: number;
}

export interface CompressEvents {
  progress: (value: number) => void;
  status: (text: string) => void;
  outputBytes: (bytes: number) => void;
  storageFile: (name: string) => void;
}

export interface CompressOutput {
  blob: Blob;
  storageName: string | null;
}

interface OutputSink {
  stream: WritableStream<StreamTargetChunk>;
  storageName: string | null;
  finish: () => Promise<Blob>;
}

const MP4 = "video/mp4";
export const OUTPUT_FILE_PREFIX = "cutmoor-output-";
/** Below this the result is small enough to hold as pieces in the browser's own storage. */
const USE_DISK_FROM_BYTES = 64 * 1024 * 1024;
const WRITE_CHUNK_BYTES = 4 * 1024 * 1024;
const REPORT_EVERY_MS = 500;
const MAX_ENCODER_QUEUE = 6;
const MAX_UNWRITTEN_PACKETS = 24;
const KEYFRAME_SECONDS = 5;
/** Long or low-bitrate videos gain more from clean frames than from extra ones. */
const LONG_VIDEO_SECONDS = 20 * 60;
const FULL_FRAME_RATE_FROM_KBPS = 1500;
/** The audio step is a small part of the job. */
const AUDIO_SHARE = 0.08;
const COPY_AUDIO_MARGIN = 1.1;

type PrivateFolder = FileSystemDirectoryHandle & { keys: () => AsyncIterable<string> };

async function checkFreeSpace(neededBytes: number): Promise<void> {
  const { quota, usage } = await navigator.storage.estimate().catch(() => ({ quota: undefined, usage: undefined }));
  if (quota === undefined || usage === undefined) return;
  if (quota - usage < neededBytes * 1.1) {
    throw new Error(`This job needs about ${formatBytes(neededBytes * 1.1)} of free browser storage, and only ${formatBytes(quota - usage)} is available. Free some space or choose a smaller size.`);
  }
}

/** A closed or crashed tab cannot clean up after itself, so each job clears what earlier ones left behind. */
async function removeLeftovers(folder: PrivateFolder): Promise<void> {
  for await (const name of folder.keys()) {
    if (name.startsWith(OUTPUT_FILE_PREFIX)) await folder.removeEntry(name).catch(() => undefined);
  }
}

async function diskSink(expectedBytes: number, onBytes: (bytes: number) => void, events: CompressEvents): Promise<OutputSink | null> {
  const folder = (await navigator.storage.getDirectory().catch(() => null)) as PrivateFolder | null;
  if (!folder) return null;
  await checkFreeSpace(expectedBytes);
  const name = `${OUTPUT_FILE_PREFIX}${Date.now()}.mp4`;
  const handle = await folder.getFileHandle(name, { create: true });
  if (typeof handle.createWritable !== "function") {
    await folder.removeEntry(name).catch(() => undefined);
    return null;
  }
  events.storageFile(name);
  const writable = await handle.createWritable();
  let closed = false;
  let written = 0;
  const close = async () => {
    if (closed) return;
    closed = true;
    await writable.close();
  };
  return {
    storageName: name,
    stream: new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        await writable.write({ type: "write", position: chunk.position, data: chunk.data as Uint8Array<ArrayBuffer> });
        written = Math.max(written, chunk.position + chunk.data.byteLength);
        onBytes(written);
      },
      close,
    }),
    finish: async () => {
      await close();
      const file = await handle.getFile();
      return file.slice(0, file.size, MP4);
    },
  };
}

function memorySink(onBytes: (bytes: number) => void): OutputSink {
  const pieces = new SparseBlobBuilder();
  return {
    storageName: null,
    stream: new WritableStream<StreamTargetChunk>({
      write(chunk) {
        pieces.write(chunk.position, chunk.data as Uint8Array<ArrayBuffer>);
        onBytes(pieces.size);
      },
    }),
    finish: async () => pieces.toBlob(MP4),
  };
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

async function pickH264Config(width: number, height: number, kbps: number, framerate: number): Promise<VideoEncoderConfig> {
  const levels = height <= 720 && width <= 1280 ? ["1f", "28", "33"] : height <= 1080 && width <= 1920 ? ["28", "33"] : ["33", "34"];
  // The device's video hardware first, then whatever the browser can offer. A job never fails just because
  // hardware is missing, and hardware encoders differ in quality, so the result is checked rather than assumed.
  for (const hardware of ["prefer-hardware", "no-preference"] as const) {
    for (const profile of ["6400", "4d00", "4200"]) {
      for (const level of levels) {
        const config: VideoEncoderConfig = { codec: `avc1.${profile}${level}`, width, height, bitrate: kbps * 1000, framerate, avc: { format: "avc" }, hardwareAcceleration: hardware };
        const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
        if (support?.supported) return config;
      }
    }
  }
  throw new Error("This browser cannot encode H.264 at this size.");
}

/** Sound that is already small stereo AAC can go into the new file as it is, which is instant and loses nothing. */
async function canCopyAudio(job: CompressJob): Promise<boolean> {
  const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (!audio || (await audio.getCodec()) !== "aac" || audio.numberOfChannels > 2) return false;
    const { averageBitrate } = await audio.computePacketStats(300);
    return averageBitrate > 0 && averageBitrate <= job.audioKbps * 1000 * COPY_AUDIO_MARGIN;
  } catch {
    return false;
  } finally {
    input.dispose();
  }
}

/** Converts the sound on its own first, which also mixes surround down to stereo. */
async function convertAudio(job: CompressJob, onProgress: (value: number) => void): Promise<Blob> {
  const { ALL_FORMATS, BlobSource, Conversion, Input, Mp4OutputFormat, Output, StreamTarget } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
  const sink = memorySink(() => undefined);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(sink.stream, { chunked: true, chunkSize: WRITE_CHUNK_BYTES }) });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
      video: { discard: true },
      audio: { codec: "aac", bitrate: job.audioKbps * 1000, forceTranscode: true, ...(job.audioChannels > 2 ? { numberOfChannels: 2 } : {}) },
    });
    if (!conversion.isValid || !conversion.utilizedTracks.some((track) => track.isAudioTrack())) throw new Error(NO_AUDIO_ROUTE_MESSAGE);
    conversion.onProgress = onProgress;
    await conversion.execute();
    return await sink.finish();
  } finally {
    input.dispose();
  }
}

/**
 * Sends decoded frames straight to the browser's H.264 encoder, which does the scaling itself. Going through a canvas
 * to resize each frame measured about 16 times slower on a 4K video.
 */
async function encodeVideo(job: CompressJob, audioBlob: Blob | null, sink: OutputSink, firstProgress: number, events: CompressEvents): Promise<void> {
  const { ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, StreamTarget, VideoSampleSink } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.file) });
  const audioInput = audioBlob ? new Input({ formats: ALL_FORMATS, source: new BlobSource(audioBlob) }) : null;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(sink.stream, { chunked: true, chunkSize: WRITE_CHUNK_BYTES }) });
  let encoder: VideoEncoder | null = null;
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("This file has no video track.");
    const audioTrack: InputAudioTrack | null = audioInput ? await audioInput.getPrimaryAudioTrack() : null;
    if (audioInput && !audioTrack) throw new Error(NO_AUDIO_ROUTE_MESSAGE);

    const [displayWidth, displayHeight, rotation, stats, videoStart, audioStart] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getRotation(),
      video.computePacketStats(120),
      video.getFirstTimestamp(),
      audioTrack ? audioTrack.getFirstTimestamp() : Promise.resolve(Number.POSITIVE_INFINITY),
    ]);
    const outputHeight = even(job.height ?? displayHeight);
    const outputWidth = even((displayWidth * outputHeight) / displayHeight);
    const sideways = rotation === 90 || rotation === 270;
    const sourceRate = stats.averagePacketRate > 0 ? stats.averagePacketRate : 30;
    const limitRate = job.durationSeconds >= LONG_VIDEO_SECONDS || job.videoKbps < FULL_FRAME_RATE_FROM_KBPS;
    const frameRate = Math.min(sourceRate, limitRate ? 30 : 60);
    const frameGap = frameRate < sourceRate - 0.5 ? 1 / frameRate : 0;
    const config = await pickH264Config(sideways ? outputHeight : outputWidth, sideways ? outputWidth : outputHeight, job.videoKbps, frameRate);

    const videoSource = new EncodedVideoPacketSource("avc");
    output.addVideoTrack(videoSource, { rotation, frameRate });
    const audioSource = audioTrack ? new EncodedAudioPacketSource("aac") : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    const start = Math.min(videoStart, audioStart);
    const audioPackets = audioTrack ? new EncodedPacketSink(audioTrack) : null;
    const audioConfig = audioTrack ? await audioTrack.getDecoderConfig() : null;
    let nextAudio: EncodedPacket | null = audioPackets ? await audioPackets.getFirstPacket() : null;
    let firstAudio = true;
    const audioOffset = Number.isFinite(audioStart) ? -start : 0;
    const addAudioUntil = async (time: number) => {
      while (nextAudio && audioSource && audioPackets && nextAudio.timestamp + audioOffset <= time) {
        await audioSource.add(nextAudio.clone({ timestamp: Math.max(0, nextAudio.timestamp + audioOffset) }), firstAudio && audioConfig ? { decoderConfig: audioConfig as AudioDecoderConfig } : undefined);
        firstAudio = false;
        nextAudio = await audioPackets.getNextPacket(nextAudio);
      }
    };

    let failure: Error | null = null;
    let writing: Promise<void> = Promise.resolve();
    let unwritten = 0;
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const packet = EncodedPacket.fromEncodedChunk(chunk);
        unwritten += 1;
        writing = writing
          .then(async () => {
            if (failure) return;
            await addAudioUntil(packet.timestamp);
            await videoSource.add(packet, metadata);
          })
          .catch((error: unknown) => {
            failure ??= error instanceof Error ? error : new Error(String(error));
          })
          .finally(() => {
            unwritten -= 1;
          });
      },
      error: (error) => {
        failure ??= error;
      },
    });
    encoder.configure(config);

    const room = () => new Promise((resolve) => setTimeout(resolve, 2));
    const duration = job.durationSeconds > 0 ? job.durationSeconds : 0;
    const keyframeEvery = Math.max(1, Math.round(frameRate * KEYFRAME_SECONDS));
    let sent = 0;
    let nextTime = 0;
    let lastProgress = 0;
    for await (const sample of new VideoSampleSink(video).samples()) {
      try {
        if (failure) throw failure;
        const time = Math.max(0, sample.timestamp - start);
        if (frameGap && time + 0.001 < nextTime) continue;
        nextTime = Math.max(nextTime + frameGap, time);
        const decoded = sample.toVideoFrame();
        const frame = new VideoFrame(decoded, { timestamp: Math.round(time * 1e6), duration: Math.round((frameGap || sample.duration || 1 / frameRate) * 1e6) });
        decoded.close();
        while (encoder.encodeQueueSize > MAX_ENCODER_QUEUE || unwritten > MAX_UNWRITTEN_PACKETS) await room();
        encoder.encode(frame, { keyFrame: sent % keyframeEvery === 0 });
        frame.close();
        sent += 1;
        const progress = duration > 0 ? firstProgress + (1 - firstProgress) * Math.min(0.99, time / duration) : 0;
        if (progress - lastProgress >= 0.001) {
          lastProgress = progress;
          events.progress(progress);
        }
      } finally {
        sample.close();
      }
    }
    await encoder.flush();
    await writing;
    if (failure) throw failure;
    await addAudioUntil(Number.POSITIVE_INFINITY);
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (encoder && encoder.state !== "closed") encoder.close();
    input.dispose();
    audioInput?.dispose();
  }
}

export async function runCompression(job: CompressJob, events: CompressEvents): Promise<CompressOutput> {
  let lastReport = 0;
  const reportBytes = (bytes: number) => {
    const now = performance.now();
    if (now - lastReport < REPORT_EVERY_MS) return;
    lastReport = now;
    events.outputBytes(bytes);
  };

  const folder = (await navigator.storage.getDirectory().catch(() => null)) as PrivateFolder | null;
  if (folder) await removeLeftovers(folder).catch(() => undefined);

  let audioBlob = job.convertedAudio;
  let firstProgress = job.audio === "ffmpeg" ? 0.1 : 0;
  if (job.audio === "native") {
    events.status("Preparing the sound…");
    if (await canCopyAudio(job)) {
      audioBlob = job.file;
    } else {
      audioBlob = await convertAudio(job, (value) => events.progress(value * AUDIO_SHARE));
      firstProgress = AUDIO_SHARE;
    }
  }

  const sink = (job.expectedBytes >= USE_DISK_FROM_BYTES ? await diskSink(job.expectedBytes, reportBytes, events) : null) ?? memorySink(reportBytes);
  events.status("Compressing…");
  await encodeVideo(job, job.audio === "none" ? null : audioBlob, sink, firstProgress, events);
  const blob = await sink.finish();
  events.outputBytes(blob.size);
  return { blob, storageName: sink.storageName };
}
