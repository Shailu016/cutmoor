export interface VideoInspection {
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** As displayed, after any rotation in the file. */
  width: number;
  height: number;
  durationSeconds: number;
  hdr: boolean;
  audioChannels: number;
  audioSampleRate: number;
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
  canEncodeAudio: boolean;
  /** Output heights this browser can encode as H.264, largest first. */
  encodableHeights: number[];
}

const GIVE_UP_AFTER_MS = 10_000;
const COMMON_HEIGHTS = [1080, 720, 480];

async function inspect(file: File): Promise<VideoInspection | null> {
  const { ALL_FORMATS, BlobSource, Input, canEncodeAudio, canEncodeVideo } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const yes = (check: Promise<boolean>) => check.catch(() => false);
  try {
    if (!(await input.canRead())) return null;
    const [format, video, audio] = await Promise.all([input.getFormat(), input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const width = video ? await video.getDisplayWidth() : 0;
    const height = video ? await video.getDisplayHeight() : 0;
    const metadataDuration = await input.getDurationFromMetadata().catch(() => null);
    const durationSeconds = metadataDuration ?? (await input.computeDuration().catch(() => 0));
    const audioChannels = audio?.numberOfChannels ?? 0;
    const audioSampleRate = audio?.sampleRate ?? 0;

    const heights = [...new Set([height, ...COMMON_HEIGHTS.filter((value) => value < height)])].filter((value) => value > 0);
    const encodableHeights: number[] = [];
    for (const value of heights) {
      const scaledWidth = Math.max(2, Math.round((width * value) / height / 2) * 2);
      if (await yes(canEncodeVideo("avc", { width: scaledWidth, height: value, bitrate: 1_000_000 }))) encodableHeights.push(value);
    }

    return {
      container: format.name,
      videoCodec: video ? await video.getCodec() : null,
      audioCodec: audio ? await audio.getCodec() : null,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
      width,
      height,
      durationSeconds,
      hdr: video ? await yes(video.hasHighDynamicRange()) : false,
      audioChannels,
      audioSampleRate,
      canDecodeVideo: video ? await yes(video.canDecode()) : false,
      canDecodeAudio: audio ? await yes(audio.canDecode()) : false,
      canEncodeAudio: audio
        ? await yes(canEncodeAudio("aac", { numberOfChannels: Math.min(2, audioChannels || 2), sampleRate: audioSampleRate || 48_000, bitrate: 128_000 }))
        : false,
      encodableHeights,
    };
  } finally {
    input.dispose();
  }
}

/** Reads what is inside a video from its headers, on this device. Null when that cannot be told, which never blocks a job. */
export async function inspectVideo(file: File): Promise<VideoInspection | null> {
  let timer: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), GIVE_UP_AFTER_MS);
  });
  try {
    return await Promise.race([inspect(file).catch(() => null), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}
