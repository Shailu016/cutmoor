import type { VideoInspection } from "./video-inspect";

export type CompressRoute =
  | { engine: "native"; audio: "native" | "copy" | "ffmpeg" | "none" }
  | { engine: "ffmpeg" }
  | { engine: "blocked"; reason: string };

/** Above this, converting the sound to a smaller one is worth the time, when the browser can do it. */
const COPY_AAC_UP_TO_KBPS = 192;

export const NO_AUDIO_ROUTE_MESSAGE =
  "The sound in this video could not be converted, so the job was stopped rather than making a silent video.";

/**
 * Picks how to compress a video. The browser's own codecs come first: they read the file in pieces, can use the
 * device's video hardware, and can decode AV1. The FFmpeg engine covers what the browser cannot do.
 */
export function chooseCompressEngine(video: VideoInspection | null): CompressRoute {
  if (!video?.hasVideo) return { engine: "ffmpeg" };

  const canUseBrowser = video.canDecodeVideo && video.encodableHeights.length > 0 && !video.hdr;
  if (canUseBrowser) {
    if (!video.hasAudio) return { engine: "native", audio: "none" };
    // AAC stereo goes into the new file as it is. That needs no sound decoder or encoder, which some phones lack.
    if (video.audioCodec === "aac" && video.audioChannels <= 2 && (video.audioKbps === undefined || video.audioKbps <= COPY_AAC_UP_TO_KBPS || !video.canEncodeAudio)) {
      return { engine: "native", audio: "copy" };
    }
    return { engine: "native", audio: video.canDecodeAudio && video.canEncodeAudio ? "native" : "ffmpeg" };
  }

  // The FFmpeg build has no AV1 decoder, so the browser is the only way to read these files.
  if (video.videoCodec === "av1") {
    return {
      engine: "blocked",
      reason: video.hdr
        ? "This is an HDR video in AV1 format, which Cutmoor cannot compress without changing its colours. Try an SDR copy in H.264 MP4."
        : "This browser cannot decode AV1 video or encode the result. Try a recent version of Chrome or Edge, or a copy of the video in H.264 MP4.",
    };
  }
  return { engine: "ffmpeg" };
}
