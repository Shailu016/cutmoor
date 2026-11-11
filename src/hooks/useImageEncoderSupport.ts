import { useEffect, useState } from "react";
import { getEncoderSupport, type EncoderSupport } from "../lib/image";

/**
 * Canvas encoder support is a runtime feature test, not a user-agent guess.
 * The initial value keeps the UI stable during the first paint; the probe
 * resolves in a few milliseconds.
 */
export function useImageEncoderSupport(): EncoderSupport {
  const [support, setSupport] = useState<EncoderSupport>({ jpeg: true, png: true, webp: true });

  useEffect(() => {
    let active = true;
    getEncoderSupport().then((next) => {
      if (active) setSupport(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return support;
}
