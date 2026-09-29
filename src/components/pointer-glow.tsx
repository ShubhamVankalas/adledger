"use client";

import { useEffect } from "react";

/**
 * One delegated, rAF-throttled pointermove listener for the whole app. Cards that opt in with
 * `data-glow` get their --mx / --my custom properties set to the cursor position (px, relative to the
 * card); the glow itself is pure CSS (see "Pointer-reactive glow" in globals.css). Renders nothing.
 *
 * Nothing runs on touch screens (no hover) or when the user prefers reduced motion: the card then
 * keeps a static wash at its default anchor instead of following the cursor.
 */
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    let target: EventTarget | null = null;

    const paint = () => {
      frame = 0;
      const el = target instanceof Element ? target.closest<HTMLElement>("[data-glow]") : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${(x - r.left).toFixed(1)}px`);
      el.style.setProperty("--my", `${(y - r.top).toFixed(1)}px`);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      x = e.clientX;
      y = e.clientY;
      target = e.target;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
