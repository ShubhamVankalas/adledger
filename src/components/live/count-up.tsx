"use client";

import { memo, useEffect, useRef, useState } from "react";

const DURATION_MS = 500;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts from its previous value to the new one (about 500ms, ease-out) when it
 * changes. The first render shows the final value, so a page load never counts up from zero.
 * Intermediate values are whole units, so money never shows fake fractions. Under reduced motion
 * (or in a hidden tab) the value simply changes. Memoised: only this span re-renders per frame.
 */
export const CountUp = memo(function CountUp({
  value,
  format,
  className,
  title,
}: {
  value: number;
  /** Formats a (possibly intermediate) value; must be pure. */
  format: (v: number) => string;
  className?: string;
  title?: string;
}) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden") {
      current.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / DURATION_MS);
      const v = k >= 1 ? value : Math.round(from + (value - from) * easeOut(k));
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Interrupted by a newer value: the next run continues from wherever the count got to.
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className} title={title}>
      {format(shown)}
    </span>
  );
});
