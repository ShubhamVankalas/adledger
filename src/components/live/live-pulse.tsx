"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, use, useSyncExternalStore } from "react";
import { moneyShort, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import styles from "./live.module.css";
import { HIDDEN_AMOUNT, useLivePref } from "./live-prefs";

// The live pulse: today's revenue (and visitors now) from GET /api/v1/live/pulse.
// One poller is shared by every mounted pulse (header pill, nav badge…): every 30 seconds while
// the tab is visible, straight away when it becomes visible again, never while it is hidden.

export type PulseData = { revenueMinor: number; visitorsNow: number; currency: string };

const POLL_MS = 30_000;
let current: PulseData | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
const listeners = new Set<() => void>();

async function refresh() {
  clearTimeout(timer);
  if (stopped || !listeners.size || document.visibilityState !== "visible") return;
  try {
    const res = await fetch("/api/v1/live/pulse", { cache: "no-store", headers: { accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      stopped = true; // signed out or not allowed: stop asking until the next page load
      return;
    }
    if (res.ok) {
      const body = (await res.json()) as PulseData;
      current = { revenueMinor: body.revenueMinor, visitorsNow: body.visitorsNow, currency: body.currency };
      for (const l of listeners) l();
    }
  } catch {
    /* offline or restarting: keep the last value */
  }
  if (listeners.size) timer = setTimeout(refresh, POLL_MS);
}

const onVisibility = () => {
  if (document.visibilityState === "visible") void refresh();
  else clearTimeout(timer);
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibility);
    // The first value comes from the server render (`initial`); poll from then on.
    timer = setTimeout(refresh, current ? POLL_MS : 0);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

/** The latest pulse, falling back to the server-rendered value until the first poll lands. */
export function useLivePulse(initial?: PulseData | null): PulseData | null {
  const live = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return live ?? initial ?? null;
}

/** The layout's server-rendered pulse (null without reports.view), shared with the header pill. */
const InitialPulse = createContext<PulseData | null>(null);

export function LivePulseProvider({ initial, children }: { initial: PulseData | null; children: React.ReactNode }) {
  return <InitialPulse value={initial}>{children}</InitialPulse>;
}

/**
 * The live pill at the top right of every page header: a pulsing dot, "Live", visitors on the site
 * now and today's revenue in mono, linking to Live. It collapses to the dot and the visitor count on
 * phones and (1280–1535px) where the report filter bar fills the header, and renders nothing without
 * reports.view. Streamer mode hides the amount. The first paint
 * comes from `livePulse(db, ws)` in the layout (via LivePulseProvider); the shared poller takes over.
 */
export function HeaderLive({ className }: { className?: string }) {
  const pathname = usePathname();
  const pulse = useLivePulse(use(InitialPulse));
  const [streamer] = useLivePref("streamer");
  if (!pulse) return null;
  const amount = streamer ? HIDDEN_AMOUNT : moneyShort(pulse.revenueMinor, pulse.currency);
  const visitors = num(pulse.visitorsNow);
  return (
    <Link
      href="/live"
      data-slot="live-pill"
      aria-current={pathname === "/live" ? "page" : undefined}
      aria-label={`Live: ${visitors} on the site now, ${streamer ? "revenue hidden" : `${amount} revenue today`}`}
      className={cn(
        "ml-0.5 inline-flex h-8 shrink-0 items-center gap-2 rounded-full border bg-surface pr-2.5 pl-2.5 text-ui sm:h-9 sm:gap-2.5 shadow-xs transition-colors duration-100 outline-none",
        "hover:border-border-strong hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-fill sm:pr-3.5 sm:pl-3",
        className,
      )}
    >
      <span aria-hidden className={styles.pulse} data-state={pulse.visitorsNow > 0 ? "live" : "idle"} />
      <span aria-hidden className="hidden font-medium text-foreground sm:max-xl:inline 2xl:inline">
        Live
      </span>
      <span aria-hidden className="text-foreground tabular-nums">
        <span className="num font-medium">{visitors}</span>
        <span className="hidden text-muted-foreground sm:max-xl:inline 2xl:inline"> visitors</span>
      </span>
      <span aria-hidden className="hidden h-4 w-px bg-border lg:max-xl:block 2xl:block" />
      <span aria-hidden className="hidden items-baseline gap-1.5 lg:max-xl:inline-flex 2xl:inline-flex">
        <span className="font-mono text-mono font-medium text-foreground tabular-nums">{amount}</span>
        <span className="text-caption text-muted-foreground">today</span>
      </span>
    </Link>
  );
}

/** "● 3": pulse dot and visitors on the site now, for the Live nav item. Hidden at zero visitors. */
export function LiveNavBadge({ initial, className }: { initial?: PulseData | null; className?: string }) {
  const pulse = useLivePulse(initial);
  if (!pulse || pulse.visitorsNow === 0) return null;
  return (
    <span className={cn("ml-auto inline-flex items-center gap-1.5", className)} title={`${num(pulse.visitorsNow)} on the site now`}>
      <span aria-hidden className={styles.pulse} data-state="live" />
      <span className="rounded-full bg-fill px-1.5 text-micro text-muted-foreground tabular-nums">{num(pulse.visitorsNow)}</span>
      <span className="sr-only"> on the site now</span>
    </span>
  );
}
