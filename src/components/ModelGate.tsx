import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { formatBytes } from "../lib/format";
import type { ModelManifest } from "../lib/captioning/model-loader";
import { openModel, planDownload, type ModelSession } from "../lib/modeltools/session";

export interface ModelPlan {
  totalBytes: number;
  hosts: string[];
  cached: boolean;
}

/**
 * Looks after one neural network for a tool page: whether it is already saved in this browser (so the page can say what a
 * run will download, before it downloads anything), and the running session, which is kept between runs and released when
 * the page is left. Nothing is requested until `open` is called, and the page calls that only after the visitor pressed
 * the button that names the download.
 */
export function useModel(model: ModelManifest, file: string) {
  const [plan, setPlan] = useState<ModelPlan | null>(null);
  const session = useRef<Promise<ModelSession> | null>(null);

  const refresh = useCallback(async () => {
    setPlan(await planDownload(model));
  }, [model]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      const open = session.current;
      session.current = null;
      void open?.then((s) => s.release()).catch(() => undefined);
    },
    [],
  );

  const open = useCallback(
    (onProgress: (fraction: number) => void, signal?: AbortSignal) => {
      session.current ??= openModel(model, {
        file,
        signal,
        onProgress: (progress) => onProgress(progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0),
      }).catch((error: unknown) => {
        session.current = null; // a failed start is not remembered: the next run tries again
        throw error;
      });
      return session.current.then(async (opened) => {
        await refresh();
        return opened;
      });
    },
    [file, model, refresh],
  );

  return { plan, open };
}

/** What a run downloads, shown before the visitor presses the button, so pressing it is an informed yes. */
export function ModelNotice({ plan, what }: { plan: ModelPlan | null; what: string }) {
  if (!plan) return null;
  if (plan.cached) {
    return (
      <p className="settings-note">
        <ShieldCheck size={14} /> {what} is saved in this browser, so this runs with no download.
      </p>
    );
  }
  return (
    <div className="info-callout">
      <Download size={17} />
      <p>
        The first run downloads <strong>{formatBytes(plan.totalBytes)}</strong> from <strong>{plan.hosts.join(", ").replace("https://", "")}</strong>: {what} and the engine that runs
        it. Each file is checked against a fingerprint shipped with the site, then saved in your browser so it is a one-time download. Your picture is never sent.
      </p>
    </div>
  );
}
