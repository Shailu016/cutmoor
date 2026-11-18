import { runCompression, type CompressJob } from "./native-compress-core";

export type CompressWorkerMessage =
  | { type: "progress"; value: number }
  | { type: "status"; text: string }
  | { type: "bytes"; value: number }
  | { type: "storage"; name: string }
  | { type: "done"; blob: Blob; storageName: string | null }
  | { type: "failed"; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CompressJob>) => void) | null;
  postMessage: (message: CompressWorkerMessage) => void;
};

scope.onmessage = (event) => {
  const send = scope.postMessage.bind(scope);
  runCompression(event.data, {
    progress: (value) => send({ type: "progress", value }),
    status: (text) => send({ type: "status", text }),
    outputBytes: (value) => send({ type: "bytes", value }),
    storageFile: (name) => send({ type: "storage", name }),
  })
    .then(({ blob, storageName }) => send({ type: "done", blob, storageName }))
    .catch((error: unknown) => send({ type: "failed", message: error instanceof Error ? error.message : String(error) }));
};
