/**
 * Opens a video or audio file and streams its sound as 16 kHz mono chunks of about one second.
 *
 * mediabunny reads the container (MP4, MOV, WebM, MKV, MP3, WAV, ...) straight from the File,
 * range by range, and the browser's WebCodecs `AudioDecoder` decodes it (PCM/WAV is decoded by
 * mediabunny itself). Each decoded block is mixed to mono, resampled and cut into chunks right
 * away, so memory stays at a few seconds of audio however long the file is.
 *
 * Known gap: if the browser has no decoder for the file's audio codec (for example AC-3 or some
 * old AMR files in Chrome), we report "unsupported-file". A software decoder fallback (libav /
 * ffmpeg.wasm) is out of scope here.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import type { AudioSample, InputAudioTrack } from "mediabunny";
import { CaptionError } from "../contracts";
import type { AudioIngest, AudioSource, PcmChunk } from "../contracts";
import { downmixPlanar, MAX_CHANNELS } from "./downmix";
import { PcmStreamBuilder } from "./pcm-stream";

function abortError(): CaptionError {
  return new CaptionError("aborted", "Cancelled.");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Rejects as soon as `signal` aborts, so a stuck decoder cannot keep a cancel waiting. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class MediabunnySource implements AudioSource {
  private closed = false;

  constructor(
    private readonly input: Input,
    private readonly track: InputAudioTrack,
    readonly durationMs: number | null,
  ) {}

  async *chunks(signal?: AbortSignal): AsyncGenerator<PcmChunk, void, undefined> {
    if (this.closed) throw new CaptionError("internal", "This audio source was already closed.");
    throwIfAborted(signal);
    const sink = new AudioSampleSink(this.track);
    const samples = sink.samples();
    let builder: PcmStreamBuilder | null = null;
    let builderRate = 0;
    try {
      for (;;) {
        let step: IteratorResult<AudioSample, void>;
        try {
          step = await raceAbort(samples.next(), signal);
        } catch (error) {
          if (error instanceof CaptionError) throw error;
          if (signal?.aborted || this.closed) throw abortError();
          throw new CaptionError("unsupported-file", `The audio could not be decoded: ${describe(error)}`, { cause: error });
        }
        if (step.done) break;
        const sample = step.value;
        let pending: PcmChunk[];
        try {
          const channels = sample.numberOfChannels;
          if (channels < 1 || channels > MAX_CHANNELS) {
            throw new CaptionError("unsupported-file", `The audio has ${channels} channels; 1 to ${MAX_CHANNELS} are supported.`);
          }
          const planes: Float32Array[] = [];
          for (let c = 0; c < channels; c += 1) {
            const plane = new Float32Array(sample.numberOfFrames);
            sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
            planes.push(plane);
          }
          if (builder === null || builderRate !== sample.sampleRate) {
            // The stream changed rate part-way (rare). Finish the old stream and carry on at the new rate.
            const finished = builder ? builder.flush() : [];
            builder = new PcmStreamBuilder(sample.sampleRate);
            builderRate = sample.sampleRate;
            for (const chunk of finished) yield chunk;
          }
          pending = builder.push(downmixPlanar(planes), sample.timestamp);
        } catch (error) {
          if (error instanceof CaptionError) throw error;
          throw new CaptionError("unsupported-file", `The audio could not be read: ${describe(error)}`, { cause: error });
        } finally {
          sample.close();
        }
        for (const chunk of pending) {
          throwIfAborted(signal);
          yield chunk;
        }
        throwIfAborted(signal);
      }
      if (builder) for (const chunk of builder.flush()) yield chunk;
    } finally {
      // Stop the decoder pipeline; ignore errors from an input that is already disposed.
      void samples.return().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.dispose();
  }
}

export function createAudioIngest(): AudioIngest {
  return {
    async open(file: File, signal?: AbortSignal): Promise<AudioSource> {
      throwIfAborted(signal);
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
      try {
        let track: InputAudioTrack | null;
        try {
          track = await raceAbort(input.getPrimaryAudioTrack(), signal);
        } catch (error) {
          if (error instanceof CaptionError) throw error;
          throw new CaptionError("unsupported-file", `This file could not be read as audio or video: ${describe(error)}`, { cause: error });
        }
        if (!track) throw new CaptionError("no-audio", "This file has no audio track.");

        const codec = await raceAbort(track.getCodec(), signal).catch(() => null);
        const decodable = await raceAbort(track.canDecode(), signal).catch((error: unknown) => {
          if (error instanceof CaptionError) throw error;
          return false;
        });
        if (!decodable) {
          const name = codec ?? "unknown";
          throw new CaptionError(
            "unsupported-file",
            `This browser cannot decode the file's audio format (${name}). Try Chrome or Edge, or convert the audio to AAC or MP3.`,
          );
        }

        let durationMs: number | null = null;
        try {
          const seconds = await raceAbort(track.getDurationFromMetadata(), signal);
          if (seconds !== null && Number.isFinite(seconds) && seconds > 0) durationMs = Math.round(seconds * 1000);
        } catch (error) {
          if (error instanceof CaptionError && error.code === "aborted") throw error;
          // Unknown duration is allowed by the contract.
        }
        return new MediabunnySource(input, track, durationMs);
      } catch (error) {
        input.dispose();
        throw error;
      }
    },
  };
}
