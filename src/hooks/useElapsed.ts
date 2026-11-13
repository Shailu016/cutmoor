import { useEffect, useState } from "react";

/**
 * Live elapsed time while a job runs, measured from a real
 * performance.now() timestamp. Returns 0 when nothing is running.
 */
export function useElapsed(startedAt: number | null, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active || startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(performance.now() - startedAt);
    const timer = window.setInterval(() => setElapsed(performance.now() - startedAt), 250);
    return () => window.clearInterval(timer);
  }, [startedAt, active]);

  return elapsed;
}
