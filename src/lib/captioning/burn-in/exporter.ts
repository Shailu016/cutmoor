import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeVideo,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { StreamTargetChunk, VideoSample } from "mediabunny";
import { CaptionError } from "../contracts";
import type { BurnInExporter, BurnInOptions } from "../contracts";
import { SparseBlobBuilder } from "./blob-sink";
import { loadCaptionFonts } from "./fonts";
import { CODEC_PREFERENCE, planOutput } from "./plan";
import { createCaptionRenderer } from "./renderer";
import { secondsToMs } from "./timeline";

/**
 * Burns captions into a video, entirely in the browser.
 *
 * The heavy lifting (decode, re-encode, audio copy, timestamps, backpressure) is mediabunny's
 * `Conversion`. We only hand it one hook, `process`, that draws the caption onto each decoded frame.
 * That gives the guarantees this tool needs without us re-implementing them:
 *  - Frame timestamps and durations go through untouched (the hook never changes them), so
 *    variable-frame-rate clips keep their exact timing. We never compute `index / fps`.
 *  - Audio is copied packet-for-packet when MP4 can hold the codec, and re-encoded only when it cannot.
 *  - Frames are pulled, drawn, encoded and written one at a time with the encoder's backpressure,
 *    so memory stays flat however long the clip is. The output is assembled as Blob pieces
 *    (see blob-sink.ts), not one growing ArrayBuffer.
 */

const MP4_MIME = "video/mp4";

/** What the browser needs for burn-in. Checked synchronously first (cheap), then the encoder is probed. */
function hasWebCodecs(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  );
}

async function isSupported(): Promise<boolean> {
  if (!hasWebCodecs()) return false;
  try {
    return (await getFirstEncodableVideoCodec([...CODEC_PREFERENCE], { width: 1280, height: 720 })) !== null;
  } catch {
    return false;
  }
}

function aborted(): CaptionError {
  return new CaptionError("aborted", "The export was cancelled.");
}

function exportError(message: string, cause?: unknown): CaptionError {
  return new CaptionError("export", message, cause === undefined ? undefined : { cause });
}

/** Turns anything thrown during an export into a CaptionError the UI can show. */
function toCaptionError(error: unknown, signal: AbortSignal | undefined): CaptionError {
  if (signal?.aborted || error instanceof ConversionCanceledError) return aborted();
  if (error instanceof CaptionError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return exportError(`Could not add the captions to this video (${detail}).`, error);
}

export function createBurnInExporter(): BurnInExporter {
  return {
    isSupported,
    async export(options: BurnInOptions): Promise<Blob> {
      const { file, events, style, signal, onProgress } = options;
      if (signal?.aborted) throw aborted();
      if (!hasWebCodecs()) {
        throw exportError("This browser cannot encode video, so it cannot burn captions in. Try Chrome, Edge or Safari on a recent device, or download the SRT file instead.");
      }

      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      let conversion: Conversion | null = null;
      // Rejects the moment the signal fires, so every setup step below (probing, planning, font loading)
      // can be raced against it and a cancel is never stuck behind a slow await.
      let rejectAbort: (error: CaptionError) => void = () => {};
      const abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = reject;
      });
      abortPromise.catch(() => undefined); // never an unhandled rejection if nothing is racing it right now
      const onAbort = () => {
        rejectAbort(aborted());
        void conversion?.cancel();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const guard = <T,>(promise: Promise<T>): Promise<T> => (signal ? Promise.race([promise, abortPromise]) : promise);

      try {
        if (!(await guard(input.canRead()))) {
          throw new CaptionError("unsupported-file", "This file is not a video the browser can read.");
        }
        const video = await guard(input.getPrimaryVideoTrack());
        if (!video) throw exportError("This file has no video track, so there is nothing to burn captions into.");
        if (signal?.aborted) throw aborted();

        const codec = await guard(video.getCodec());
        if (!(await guard(video.canDecode()))) {
          const name = codec === "hevc" ? "HEVC (H.265)" : (codec ?? "this video format").toUpperCase();
          throw exportError(
            `This browser cannot decode ${name} video. Open the page in a browser that can play the file (Safari and recent Edge or Chrome on supported hardware handle HEVC), or convert the video to H.264 first. The SRT and VTT downloads still work.`,
          );
        }
        if (await guard(video.hasHighDynamicRange())) {
          // The canvas works in SDR. Drawing an HDR (PQ/HLG) frame onto it would wash the colours out,
          // and a tone-mapping fallback is out of scope, so refuse instead of shipping a wrong picture.
          throw exportError(
            "This video is HDR (10-bit). Burning captions in would change its colours, so it is not supported yet. Export the video as SDR first, or use the SRT or VTT download.",
          );
        }

        const displayWidth = await guard(video.getDisplayWidth());
        const displayHeight = await guard(video.getDisplayHeight());
        const plan = await guard(planOutput(displayWidth, displayHeight, (c, w, h) => canEncodeVideo(c, { width: w, height: h })));
        if (!plan) {
          throw exportError(
            `This browser cannot encode ${displayWidth} by ${displayHeight} video. Try another browser or device, or use the SRT or VTT download.`,
          );
        }

        await guard(loadCaptionFonts());
        if (signal?.aborted) throw aborted();

        const canvas = new OffscreenCanvas(plan.width, plan.height);
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw exportError("Could not create a drawing surface for the captions.");
        const renderer = createCaptionRenderer({ ctx, width: plan.width, height: plan.height, events, style });

        const writer = new SparseBlobBuilder();
        const target = new StreamTarget(
          new WritableStream<StreamTargetChunk>({
            write(chunk) {
              writer.write(chunk.position, chunk.data);
            },
          }),
          { chunked: true, chunkSize: 4 * 1024 * 1024 },
        );
        // fastStart false keeps the writer streaming (the index goes at the end), so nothing is held back in memory.
        const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });

        // Conversion shifts every frame so the file starts at 0, but caption events are on the source's own
        // timeline (the audio reader keeps source timestamps). Add the shift back before comparing.
        const sourceStartSeconds = Math.max(await guard(input.getFirstTimestamp()), 0);

        conversion = await guard(Conversion.init({
          input,
          output,
          showWarnings: false,
          video: {
            width: plan.width,
            height: plan.height,
            fit: "fill",
            codec: plan.codec,
            // A plain copy would skip the hook, and the captions must be drawn on every frame.
            forceTranscode: true,
            processedWidth: plan.width,
            processedHeight: plan.height,
            process: (sample: VideoSample) => {
              if (signal?.aborted) throw aborted();
              sample.draw(ctx, 0, 0, plan.width, plan.height);
              renderer.draw(secondsToMs(sample.timestamp + sourceStartSeconds));
              // Returning the canvas keeps the sample's own timestamp and duration (mediabunny copies them).
              return canvas;
            },
          },
        }));

        const lostAudio = conversion.discardedTracks.find((d) => d.track.isAudioTrack() && d.reason !== "discarded_by_user");
        if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
          throw exportError("This browser could not set up the video export. Try another browser, or use the SRT or VTT download.");
        }
        // Only an export that ends up with NO audio while the source had some is refused. A spare track the
        // browser cannot handle (commentary, a second language) must not fail a file whose main audio is fine.
        if (lostAudio && !conversion.utilizedTracks.some((t) => t.isAudioTrack())) {
          // Shipping a silent video without saying so would be a worse failure than stopping.
          throw exportError(
            "This video's audio cannot be copied or re-encoded in this browser, so the captioned video would be silent. Try another browser, or use the SRT or VTT download.",
          );
        }

        let lastProgress = 0;
        conversion.onProgress = (fraction) => {
          lastProgress = Math.max(lastProgress, Math.min(1, Math.max(0, fraction)));
          onProgress?.(lastProgress);
        };
        if (signal?.aborted) throw aborted();
        await conversion.execute();
        if (signal?.aborted) throw aborted();
        onProgress?.(1);
        return writer.toBlob(MP4_MIME);
      } catch (error) {
        try {
          await conversion?.cancel();
        } catch {
          /* already finished or cancelled */
        }
        throw toCaptionError(error, signal);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        input.dispose();
      }
    },
  };
}

/** The shared instance. The exporter holds no state between calls. */
export const burnInExporter: BurnInExporter = createBurnInExporter();
