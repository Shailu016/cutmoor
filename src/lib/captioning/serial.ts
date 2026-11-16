/**
 * Runs jobs strictly one after another, in the order they were asked for. A job that fails does not stop the ones behind it.
 * Used so that only one onnxruntime-web session is created at a time.
 */
export function serialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
