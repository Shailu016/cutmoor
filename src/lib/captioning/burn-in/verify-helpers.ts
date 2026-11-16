import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from "mediabunny";
import type { FrameTime } from "./timeline";

/**
 * Browser-side measuring tools for scripts/verify/burn-in.mjs. Not imported by the app, so the
 * bundler leaves it out of the site. It lives here (not in scripts/) so the puppeteer page can load
 * it through the dev server together with mediabunny and so tsc checks it.
 */

export interface FileProbe {
  durationSeconds: number;
  video: {
    codec: string | null;
    width: number;
    height: number;
    /** Packet times in presentation order. */
    frames: FrameTime[];
  } | null;
  audio: { codec: string | null; packets: number; sampleRate: number; channels: number } | null;
  /** Frames the browser actually decoded (full decode, so this proves the file plays). */
  decodedFrames: number;
}

export async function probeFile(file: Blob): Promise<FileProbe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const durationSeconds = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    let video: FileProbe["video"] = null;
    let decodedFrames = 0;
    if (videoTrack) {
      const frames: FrameTime[] = [];
      for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
        frames.push({ timestamp: packet.timestamp, duration: packet.duration });
      }
      frames.sort((a, b) => a.timestamp - b.timestamp);
      video = {
        codec: await videoTrack.getCodec(),
        width: await videoTrack.getDisplayWidth(),
        height: await videoTrack.getDisplayHeight(),
        frames,
      };
      for await (const sample of new VideoSampleSink(videoTrack).samples()) {
        decodedFrames++;
        sample.close();
      }
    }
    let audio: FileProbe["audio"] = null;
    if (audioTrack) {
      let packets = 0;
      for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
        void packet;
        packets++;
      }
      audio = {
        codec: await audioTrack.getCodec(),
        packets,
        sampleRate: await audioTrack.getSampleRate(),
        channels: await audioTrack.getNumberOfChannels(),
      };
    }
    return { durationSeconds, video, audio, decodedFrames };
  } finally {
    input.dispose();
  }
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The decoded frame at `seconds`, as RGBA pixels of the whole frame plus its size. */
export async function frameAt(file: Blob, seconds: number): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const wrapped = await new CanvasSink(track).getCanvas(seconds);
    if (!wrapped) return null;
    const canvas = wrapped.canvas;
    const ctx = (canvas as OffscreenCanvas).getContext("2d") as OffscreenCanvasRenderingContext2D;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: image.data };
  } finally {
    input.dispose();
  }
}

/** Mean absolute difference of the RGB values inside `region` between two same-sized frames (0 to 255). */
export function meanAbsDiff(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
  region: Region,
): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Frames differ in size.");
  let sum = 0;
  let count = 0;
  const x1 = Math.min(a.width, region.x + region.width);
  const y1 = Math.min(a.height, region.y + region.height);
  for (let y = Math.max(0, region.y); y < y1; y++) {
    for (let x = Math.max(0, region.x); x < x1; x++) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      count += 3;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** A PNG of one frame, as base64, so the script can save it for a human to look at. */
export async function framePng(width: number, height: number, data: Uint8ClampedArray): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * A video-only copy of `file` whose every video packet is `offsetSeconds` later (no re-encode), so its
 * first presentation timestamp is `offsetSeconds`. Stands in for an edit-list style MP4 that does not start at 0.
 */
export async function buildShiftedVideoOnly(file: Blob, offsetSeconds: number): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("No video track to copy.");
    const codec = await track.getCodec();
    const decoderConfig = await track.getDecoderConfig();
    if (!codec || !decoderConfig) throw new Error("Cannot read the video codec.");
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const source = new EncodedVideoPacketSource(codec);
    output.addVideoTrack(source);
    await output.start();
    for await (const packet of new EncodedPacketSink(track).packets()) {
      await source.add(packet.clone({ timestamp: packet.timestamp + offsetSeconds }), { decoderConfig });
    }
    source.close();
    await output.finalize();
    return new Blob([target.buffer as ArrayBuffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

/** The first presentation timestamp of the file's video track, in seconds. */
export async function firstVideoTimestamp(file: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    return await input.getFirstTimestamp();
  } finally {
    input.dispose();
  }
}
