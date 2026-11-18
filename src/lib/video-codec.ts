const GIVE_UP_AFTER_MS = 8000;

async function readCodec(file: File): Promise<string | null> {
  const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) return null;
    const track = await input.getPrimaryVideoTrack();
    return track ? await track.getCodec() : null;
  } finally {
    input.dispose();
  }
}

/** The video format named in the file's header, read locally. Null when it cannot be told, which never blocks a job. */
export async function readVideoCodec(file: File): Promise<string | null> {
  let timer: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), GIVE_UP_AFTER_MS);
  });
  try {
    return await Promise.race([readCodec(file).catch(() => null), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}
