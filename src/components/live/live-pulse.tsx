"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { moneyShort, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import styles from "./live.module.css";
import { HIDDEN_AMOUNT, useLivePref } from "./live-prefs";

// The sidebar's live pulse: today's revenue (and visitors now) from GET /api/v1/live/pulse.
// One poller is shared by every mounted pulse (sidebar row, nav badge…): every 30 seconds while
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

/**
 * Sidebar row (BRIEF §2.5): a pulse dot and today's revenue in mono, linking to Live. Streamer
 * mode hides the amount. `initial` is `livePulse(db, ws)` from the layout, so the first paint is right.
 */
export function LivePulse({ initial, className }: { initial?: PulseData | null; className?: string }) {
  const pulse = useLivePulse(initial);
  const [streamer] = useLivePref("streamer");
  const amount = pulse ? (streamer ? HIDDEN_AMOUNT : moneyShort(pulse.revenueMinor, pulse.currency)) : "—";
  return (
    <Link
      href="/live"
      className={cn(
        "flex h-[30px] min-w-0 items-center gap-2 rounded-md px-2 text-ui text-muted-foreground transition-colors duration-100 hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      aria-label={pulse ? `Live: ${streamer ? "revenue hidden" : `${amount} revenue today`}, ${num(pulse.visitorsNow)} on the site now` : "Live"}
    >
      <span aria-hidden className={styles.pulse} data-state={pulse && pulse.visitorsNow > 0 ? "live" : "idle"} />
      <span className="truncate">Today</span>
      <span className="ml-auto font-mono text-mono text-foreground tabular-nums">{amount}</span>
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
