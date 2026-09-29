"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AudioWaveformIcon,
  BarChart3Icon,
  Building2Icon,
  CableIcon,
  CalendarRangeIcon,
  CheckIcon,
  CircleCheckBigIcon,
  EllipsisIcon,
  FileTextIcon,
  GaugeIcon,
  GitForkIcon,
  PiggyBankIcon,
  SearchIcon,
  SparklesIcon,
  TargetIcon,
  UserIcon,
  UserCogIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ResolvedTourStep } from "@/lib/tour";
import { cn } from "@/lib/utils";
import { CARD_MARGIN, inflate, placeCard, scrollDelta, type Box } from "./place-card";

// The spotlight tour: a dimmed backdrop with a cut-out around the current target, a floating card
// next to it (a sheet docked to the top or bottom edge on phones), and the keyboard and
// screen-reader plumbing around them. Steps come from lib/tour.ts; this file knows nothing about
// which pages exist. The target is found by its data-tour name, polled for a moment (the page may
// still be loading or navigating) and skipped when it never shows up.

export type TourOutcome = "finished" | "skipped";

const ICONS: Record<string, LucideIcon> = {
  workspace: Building2Icon,
  filters: CalendarRangeIcon,
  kpis: GaugeIcon,
  live: AudioWaveformIcon,
  performance: BarChart3Icon,
  attribution: GitForkIcon,
  money: PiggyBankIcon,
  crm: UsersIcon,
  more: EllipsisIcon,
  insights: SparklesIcon,
  reports: FileTextIcon,
  search: SearchIcon,
  integrations: CableIcon,
  goals: TargetIcon,
  team: UserCogIcon,
  profile: UserIcon,
  finish: CircleCheckBigIcon,
};

/** Breathing room between the target and the edge of its spotlight. */
const PAD = 6;
const CARD_WIDTH = 344;
/** How long a target may take to appear before its step is dropped (longer after a page change). */
const WAIT_SAME_PAGE_MS = 1600;
const WAIT_NEW_PAGE_MS = 7000;
/** Room kept clear at the top (sticky header) and, on phones, at the bottom (the docked card). */
const SCROLL_TOP = 76;
const SCROLL_BOTTOM_COMPACT = 290;

// ---------------------------------------------------------------- step state

type State = { i: number; dir: 1 | -1; skipped: string[]; done: TourOutcome | null };
type Action = { type: "go"; dir: 1 | -1 } | { type: "skip-missing" } | { type: "exit" };

/** Index of the next step in `dir` that hasn't been dropped, or -1 / steps.length when there is none. */
function nextLive(steps: ResolvedTourStep[], from: number, dir: 1 | -1, skipped: string[]) {
  let j = from + dir;
  while (j >= 0 && j < steps.length && skipped.includes(steps[j].id)) j += dir;
  return j;
}

function reduce(steps: ResolvedTourStep[], s: State, a: Action): State {
  if (s.done) return s;
  switch (a.type) {
    case "go": {
      const j = nextLive(steps, s.i, a.dir, s.skipped);
      if (j >= steps.length) return { ...s, done: "finished" };
      if (j < 0) return s;
      return { ...s, i: j, dir: a.dir };
    }
    case "skip-missing": {
      const skipped = [...s.skipped, steps[s.i].id];
      let j = nextLive(steps, s.i, s.dir, skipped);
      if (j >= steps.length) return { ...s, skipped, done: "finished" };
      if (j < 0) {
        // Dropped while going back past the first step: carry on forward instead.
        j = nextLive(steps, -1, 1, skipped);
        return { ...s, skipped, i: j, dir: 1 };
      }
      return { ...s, skipped, i: j };
    }
    case "exit":
      return { ...s, done: "skipped" };
  }
}

// ---------------------------------------------------------------- DOM helpers

const isShown = (el: Element) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
};

/** The first element carrying one of the data-tour names that is actually on screen. */
function findTarget(names: string[] | undefined): HTMLElement | null {
  for (const n of names ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour~="${n}"]`)) if (isShown(el)) return el;
  }
  return null;
}

/** The sidebar, page header and tab bar don't move when the page scrolls. */
function inFixedLayer(el: Element) {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}

function bringIntoView(el: HTMLElement, compact: boolean, reduced: boolean) {
  if (inFixedLayer(el)) return;
  // Horizontal scrollers first (the pill strip on the settings pages).
  el.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const band = { top: SCROLL_TOP, bottom: window.innerHeight - (compact ? SCROLL_BOTTOM_COMPACT : 24) };
  const dy = scrollDelta(r, band);
  if (dy) window.scrollBy({ top: dy, behavior: reduced ? "auto" : "smooth" });
}

const cornerRadius = (el: Element) => {
  const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(raw) ? Math.min(Math.max(raw + PAD / 2, 8), 20) : 10;
};

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

/** Body copy with `{mod}` shown as a key cap. */
function Body({ text, mod }: { text: string; mod: string }) {
  const parts = text.split("{mod}");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <kbd translate="no" className="kbd mx-0.5 align-[0.0625rem]">
              {mod}
            </kbd>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- component

export function TourRunner({ steps, mod, onClose }: { steps: ResolvedTourStep[]; mod: string; onClose: (outcome: TourOutcome) => void }) {
  const router = useRouter();
  const titleId = useId();
  const bodyId = useId();
  const [state, dispatch] = useReducer((s: State, a: Action) => reduce(steps, s, a), { i: 0, dir: 1, skipped: [], done: null });
  // The step whose target has been found (the card keeps showing it until the next one is ready).
  const [shown, setShown] = useState<{ i: number; el: HTMLElement | null } | null>(null);
  // A page change is taking a while: dim everything and hide the card until the target appears.
  const [busy, setBusy] = useState(false);
  const [rect, setRect] = useState<Box | null>(null);
  const [radius, setRadius] = useState(10);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [card, setCard] = useState({ w: CARD_WIDTH, h: 230 });

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const currentStep = useRef(state.i);

  // ---- find the target of the current step (navigating first if it lives on another page)
  useEffect(() => {
    currentStep.current = state.i;
    const step = steps[state.i];
    const compact = window.innerWidth < 640;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline = performance.now() + WAIT_SAME_PAGE_MS;
    let navigated = false;

    const busyTimer = setTimeout(() => !cancelled && setBusy(true), 320);

    const tick = () => {
      if (cancelled) return;
      if (!step.target) {
        clearTimeout(busyTimer);
        setShown({ i: state.i, el: null });
        setBusy(false);
        return;
      }
      const el = findTarget(step.target);
      if (el) {
        clearTimeout(busyTimer);
        bringIntoView(el, compact, reduced);
        setShown({ i: state.i, el });
        setBusy(false);
        return;
      }
      // Not here (yet): go to the page the step belongs to, once, and give it time to load.
      if (!navigated && step.href) {
        navigated = true;
        deadline = performance.now() + WAIT_NEW_PAGE_MS;
        router.push(step.href);
      }
      if (performance.now() > deadline) {
        dispatch({ type: "skip-missing" });
        return;
      }
      timer = setTimeout(tick, 90);
    };
    // Glide the spotlight and card to the new position (they follow scrolling without easing).
    if (rootRef.current) rootRef.current.dataset.glide = "on";
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(busyTimer);
    };
  }, [state.i, steps, router]);

  // Glide only briefly after a step change; while the page scrolls or resizes the spotlight tracks exactly.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => {
      if (rootRef.current) rootRef.current.dataset.glide = "off";
    }, 380);
    return () => clearTimeout(t);
  }, [shown]);

  // ---- follow the target every frame (scroll, resize, layout shifts, sidebar animations)
  useEffect(() => {
    if (!shown) return;
    const names = steps[shown.i].target;
    let el = shown.el;
    let frame = 0;
    let missingSince = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const w = window.innerWidth;
      const h = window.innerHeight;
      setVp((v) => (v.w === w && v.h === h ? v : { w, h }));
      if (!names) return;
      if (!el || !el.isConnected || !isShown(el)) {
        el = findTarget(names);
        if (!el) {
          missingSince ||= now;
          // The page changed under the tour and the target is gone for good.
          if (now - missingSince > 1800 && currentStep.current === shown.i) dispatch({ type: "skip-missing" });
          return;
        }
        setRadius(cornerRadius(el));
      }
      missingSince = 0;
      const r = el.getBoundingClientRect();
      const next: Box = { x: r.left, y: r.top, w: r.width, h: r.height };
      setRect((prev) => (sameBox(prev, next) ? prev : next));
    };
    if (names) setRadius(cornerRadius(el ?? document.body));
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [shown, steps]);

  // The card's own size decides where it fits.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCard((c) => (Math.abs(c.w - r.width) < 0.5 && Math.abs(c.h - r.height) < 0.5 ? c : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- keyboard: Esc skips, arrows move, Tab stays inside the card, nothing reaches the page behind
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      const onButton = e.target instanceof HTMLElement && e.target.closest("button, a") !== null;
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch({ type: "exit" });
      } else if (plain && e.key === "ArrowRight") {
        e.preventDefault();
        dispatch({ type: "go", dir: 1 });
      } else if (plain && e.key === "ArrowLeft") {
        e.preventDefault();
        dispatch({ type: "go", dir: -1 });
      } else if (e.key === "Tab") {
        const focusable = Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? []);
        if (focusable.length === 0) {
          e.preventDefault();
        } else {
          const at = focusable.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : at === -1 || at === focusable.length - 1 ? 0 : at + 1;
          e.preventDefault();
          focusable[next].focus({ preventScroll: true });
        }
      } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key) || (e.key === " " && !onButton)) {
        e.preventDefault(); // the page stays where the spotlight is
      }
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The page behind doesn't scroll by wheel or touch; the tour scrolls it itself.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (e: Event) => e.preventDefault();
    root.addEventListener("wheel", stop, { passive: false });
    root.addEventListener("touchmove", stop, { passive: false });
    return () => {
      root.removeEventListener("wheel", stop);
      root.removeEventListener("touchmove", stop);
    };
  }, []);

  // ---- focus: move into the card, put it back afterwards
  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const o = opener.current;
      if (o instanceof HTMLElement && o.isConnected) o.focus({ preventScroll: true });
    };
  }, []);
  const ready = shown !== null && !busy;
  const shownIndex = shown?.i ?? null;
  useEffect(() => {
    if (shownIndex !== null) primaryRef.current?.focus({ preventScroll: true });
  }, [shownIndex]);

  // ---- finished or skipped
  useEffect(() => {
    if (state.done) onClose(state.done);
  }, [state.done, onClose]);

  // ---- render
  const step = steps[shown?.i ?? state.i];
  const live = steps.filter((s) => !state.skipped.includes(s.id));
  const pos = Math.max(0, live.findIndex((s) => s.id === step.id));
  const isFirst = pos === 0;
  const isLast = pos === live.length - 1;
  const Icon = ICONS[step.id] ?? SparklesIcon;

  const spotBox = ready && step.target && rect ? inflate(rect, PAD) : null;
  const placement = placeCard({ spot: spotBox, card, vw: vp.w, vh: vp.h, prefer: step.place });
  const spot = spotBox ?? { x: vp.w / 2, y: vp.h / 2, w: 0, h: 0 };

  const cardStyle: React.CSSProperties =
    placement.kind === "dock"
      ? { left: CARD_MARGIN, right: CARD_MARGIN, [placement.edge]: `calc(${CARD_MARGIN}px + env(safe-area-inset-${placement.edge}))`, marginInline: "auto", maxWidth: 440 }
      : { left: 0, top: 0, width: CARD_WIDTH, transform: `translate3d(${Math.round(placement.x)}px, ${Math.round(placement.y)}px, 0)` };

  return createPortal(
    <div ref={rootRef} data-tour-root data-glide="on" className="group/tour fixed inset-0 z-[80] touch-none [--tour-dim:oklch(0.16_0.012_165/0.6)] dark:[--tour-dim:oklch(0.05_0.005_165/0.7)]">
      {/* Catches pointer input so the page behind can't be clicked while the tour runs. */}
      <div aria-hidden className="absolute inset-0" />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed transition-[opacity] duration-200 group-data-[glide=on]/tour:transition-[left,top,width,height,border-radius,opacity] group-data-[glide=on]/tour:duration-300 group-data-[glide=on]/tour:ease-(--ease-out) motion-reduce:!transition-none",
        )}
        style={{
          left: spot.x,
          top: spot.y,
          width: spot.w,
          height: spot.h,
          borderRadius: spotBox ? radius : 0,
          boxShadow: spotBox
            ? "0 0 0 2px color-mix(in oklab, var(--brand) 80%, transparent), 0 0 0 100vmax var(--tour-dim)"
            : "0 0 0 100vmax var(--tour-dim)",
        }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cn(
          "fixed rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none",
          "shadow-[0_8px_16px_-4px_oklch(0.2_0.02_165/0.12),0_24px_48px_-8px_oklch(0.2_0.02_165/0.3)] dark:shadow-[0_16px_48px_oklch(0_0_0/0.6)]",
          "transition-opacity duration-150 group-data-[glide=on]/tour:transition-[opacity,transform] group-data-[glide=on]/tour:duration-300 group-data-[glide=on]/tour:ease-(--ease-out) motion-reduce:!transition-none",
          ready ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={cardStyle}
      >
        <div key={step.id} className="grid gap-3 p-4 max-sm:p-4 max-sm:pb-[calc(1rem)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-foreground">
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="num text-caption font-medium text-muted-foreground">
              {pos + 1} of {live.length}
            </span>
            <button
              type="button"
              onClick={() => dispatch({ type: "exit" })}
              aria-label="Skip tour"
              className="-mr-1 ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring max-sm:size-9"
            >
              <XIcon aria-hidden className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          <div className="grid gap-1">
            <h2 id={titleId} className="text-title-sm text-balance">
              {step.title}
            </h2>
            <p id={bodyId} className="text-ui text-pretty text-muted-foreground">
              <Body text={step.body} mod={mod} />
            </p>
          </div>

          <div aria-hidden className="flex flex-wrap items-center gap-1 pt-0.5">
            {live.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none",
                  i === pos ? "w-4 bg-brand-gradient" : i < pos ? "w-1.5 bg-brand/45" : "w-1.5 bg-border-strong",
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            {isLast ? (
              <span />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "exit" })} className="-ml-2 text-muted-foreground max-sm:h-10">
                Skip tour
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              {!isFirst ? (
                <Button variant="outline" size="sm" onClick={() => dispatch({ type: "go", dir: -1 })} className="max-sm:h-10">
                  <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                  Back
                </Button>
              ) : null}
              <Button ref={primaryRef} size="sm" onClick={() => dispatch({ type: "go", dir: 1 })} className="max-sm:h-10">
                {isLast ? (
                  <>
                    <CheckIcon aria-hidden data-icon="inline-start" />
                    Finish
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRightIcon aria-hidden data-icon="inline-end" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {/* Screen readers hear each step as it appears (focus moves to the Next button, which only says "Next"). */}
      <div role="status" aria-live="polite" className="sr-only">
        {ready ? `Step ${pos + 1} of ${live.length}: ${step.title}. ${step.body.replaceAll("{mod}", mod)}` : ""}
      </div>
    </div>,
    document.body,
  );
}
