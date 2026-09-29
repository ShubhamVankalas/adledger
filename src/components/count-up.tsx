"use client";

import { useLayoutEffect, useRef } from "react";
import { formatCount, parseCountable } from "@/lib/count-up";

/**
 * A KPI number that counts up the first time it appears (and between values when it changes).
 *
 * `value` is the final, already formatted text ("$41,294"). The server renders exactly that, so the
 * HTML and the hydrated markup always match and the final text is correct without JavaScript. Once
 * mounted, the digits are animated straight in the DOM (no re-render per frame) when the number is
 * on screen, easing out over ~0.8s, and the last frame writes the original text back verbatim.
 *
 * Assistive technology reads a visually hidden copy of the final value; the animated text is
 * aria-hidden, so nobody hears intermediate numbers. Reduced motion, and values that are not a plain
 * number ("—", "12:30"), skip the animation.
 */
export function CountUp({ value, duration = 800, className }: { value: string; duration?: number; className?: string }) {
  const parts = parseCountable(value);
  const ref = useRef<HTMLSpanElement>(null);
  // The number currently on screen; null until the first animation starts.
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const p = parseCountable(value);
    if (!el || !p) return;
    const from = shown.current ?? 0;
    if (from === p.value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = p.value;
      el.textContent = value;
      return;
    }

    let raf = 0;
    el.textContent = formatCount(p, from);

    const run = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        const n = from + (p.value - from) * eased;
        shown.current = n;
        el.textContent = t < 1 ? formatCount(p, n) : value;
        if (t < 1) raf = requestAnimationFrame(step);
        else shown.current = p.value;
      };
      raf = requestAnimationFrame(step);
    };

    // Count when the number scrolls into view, so tiles below the fold don't finish unseen.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        run();
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  if (!parts) return <span className={className}>{value}</span>;
  return (
    <span className={className}>
      <span ref={ref} aria-hidden>
        {value}
      </span>
      <span className="sr-only select-none">{value}</span>
    </span>
  );
}
