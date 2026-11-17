import { useEffect, useRef, useState } from "react";

/**
 * True once the element has come within `margin` of the screen, and it stays true. Below-the-fold pieces that are
 * expensive to build (the card pictures, the looping demo) render an empty box of the right size first and fill it in
 * only when the visitor scrolls close. That keeps them out of the first load's script and layout work. The box keeps
 * its size, so nothing jumps. Without IntersectionObserver (old browsers, tests) it is true straight away.
 */
export function useNearScreen<T extends HTMLElement>(margin = "400px"): [boolean, React.RefObject<T | null>] {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);

  return [near, ref];
}
