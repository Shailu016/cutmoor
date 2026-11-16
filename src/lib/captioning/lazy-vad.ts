import type { VoiceDetector } from "./contracts";
import type { PcmChunk } from "./contracts";
import type { SpeechInterval } from "./types";

/**
 * A voice detector that builds the real one only when the first audio arrives. The Silero model is a
 * separate download, and a file with no audio track or an unsupported format should fail before any
 * model is downloaded.
 *
 * `reset()` keeps the built detector, so the next file reuses the same model. `release()` frees it, and a
 * later call builds a new one.
 */
export function createLazyVoiceDetector(build: () => Promise<VoiceDetector>): VoiceDetector {
  let inner: VoiceDetector | null = null;
  let building: Promise<VoiceDetector> | null = null;

  const get = (): Promise<VoiceDetector> => {
    if (inner) return Promise.resolve(inner);
    building ??= build().then(
      (built) => {
        inner = built;
        return built;
      },
      (error: unknown) => {
        building = null; // let the next call try again instead of caching the failure
        throw error;
      },
    );
    return building;
  };

  return {
    async push(chunk: PcmChunk, signal?: AbortSignal): Promise<SpeechInterval[]> {
      return (await get()).push(chunk, signal);
    },
    async flush(): Promise<SpeechInterval[]> {
      return inner ? inner.flush() : [];
    },
    reset(): void {
      inner?.reset();
    },
    async release(): Promise<void> {
      const pending = building;
      const built = inner;
      inner = null;
      building = null;
      // A detector still being built is released as soon as it exists.
      const target = built ?? (pending ? await pending.catch(() => null) : null);
      await target?.release();
    },
  };
}
