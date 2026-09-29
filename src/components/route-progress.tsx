"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

type Controller = { start: () => void; done: () => void };

/** An internal link click that will change the page (not a new tab, download or same-page hash). */
function navigatesAway(e: MouseEvent): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return false;
  return url.pathname !== location.pathname || url.search !== location.search;
}

/**
 * A slim brand-gradient bar along the top edge of the window while a page navigation is in flight.
 *
 * It starts on an internal link click (or back/forward), trickles towards ~92% and completes when
 * the pathname or query string changes. The bar only appears after 120ms, so instant navigations
 * never flash it, and a 15s safety stop covers clicks that never navigate. The bar is driven straight
 * through the DOM (no React state), so it costs nothing per tick. Decorative: aria-hidden.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const bar = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let active = false;
    let visible = false;
    let progress = 0;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    let safety: ReturnType<typeof setTimeout> | undefined;
    let reset: ReturnType<typeof setTimeout> | undefined;

    const paint = (scale: number, opacity: number) => {
      el.style.transform = `scaleX(${scale})`;
      el.style.opacity = String(opacity);
    };
    const stopTimers = () => {
      clearTimeout(showTimer);
      clearInterval(tick);
      clearTimeout(safety);
    };

    const start = () => {
      if (active) return;
      active = true;
      clearTimeout(reset);
      progress = 0.1;
      el.style.transition = "none";
      paint(0, 0);
      showTimer = setTimeout(() => {
        visible = true;
        el.style.transition = "transform 320ms cubic-bezier(0.23, 1, 0.32, 1), opacity 120ms linear";
        paint(progress, 1);
        tick = setInterval(() => {
          progress += (0.92 - progress) * 0.1;
          paint(progress, 1);
        }, 240);
      }, 120);
      safety = setTimeout(() => controller.current?.done(), 15_000);
    };

    const done = () => {
      if (!active) return;
      active = false;
      stopTimers();
      if (!visible) return;
      visible = false;
      // Fill the last stretch, then fade out and rewind for next time.
      el.style.transition = "transform 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 300ms ease 220ms";
      paint(1, 0);
      reset = setTimeout(() => {
        el.style.transition = "none";
        paint(0, 0);
      }, 560);
    };

    controller.current = { start, done };
    const onClick = (e: MouseEvent) => {
      if (navigatesAway(e)) start();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", start);
      stopTimers();
      clearTimeout(reset);
      controller.current = null;
    };
  }, []);

  // The route (or its query string) changed: that navigation has landed.
  useEffect(() => {
    controller.current?.done();
  }, [pathname, search]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-90 h-0.5">
      <div ref={bar} className="route-progress-bar h-full w-full bg-brand-gradient" />
    </div>
  );
}
