export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
}

/**
 * Read duration and dimensions without uploading the file. The browser decodes
 * only the metadata, which is fast even for a large MP4.
 */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve({ duration: 0, width: 0, height: 0, hasVideo: false });
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const finish = (meta: VideoMeta) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(meta);
    };

    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      finish({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        hasVideo: (video.videoWidth || 0) > 0,
      });
    };
    video.onerror = () => finish({ duration: 0, width: 0, height: 0, hasVideo: false });
    video.src = url;

    window.setTimeout(() => finish({ duration: 0, width: 0, height: 0, hasVideo: false }), 8000);
  });
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(file.name);
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
}

export function isSubtitleFile(file: File): boolean {
  return /\.(srt|vtt)$/i.test(file.name);
}
