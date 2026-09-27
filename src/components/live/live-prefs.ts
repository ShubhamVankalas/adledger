"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-browser Live preferences (streamer mode, sale alerts). Stored in localStorage and shared
// by every component that reads them (the Live page, the sidebar pulse, the Overview widget),
// across tabs too. Server render and the first client render use the defaults, so hydration
// always matches; the stored value applies right after.

export type LivePrefs = {
  /** Streamer mode: hide money (revenue, spend, payment amounts) so the screen can be shared. */
  streamer: boolean;
  /** Pop a toast when a payment arrives while the Live page is open. */
  saleAlerts: boolean;
};

const KEY = "adledger.live.v1";
const DEFAULTS: LivePrefs = { streamer: false, saleAlerts: true };
const listeners = new Set<() => void>();
let cache: LivePrefs | null = null;

function read(): LivePrefs {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<LivePrefs>) : {};
    cache = {
      streamer: typeof parsed.streamer === "boolean" ? parsed.streamer : DEFAULTS.streamer,
      saleAlerts: typeof parsed.saleAlerts === "boolean" ? parsed.saleAlerts : DEFAULTS.saleAlerts,
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setLivePref<K extends keyof LivePrefs>(key: K, value: LivePrefs[K]) {
  cache = { ...read(), [key]: value };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode or storage full: the setting still holds for this page */
  }
  emit();
}

/** One preference, with a setter. Defaults on the server and during hydration. */
export function useLivePref<K extends keyof LivePrefs>(key: K): [LivePrefs[K], (value: LivePrefs[K]) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read()[key],
    () => DEFAULTS[key],
  );
  const set = useCallback((v: LivePrefs[K]) => setLivePref(key, v), [key]);
  return [value, set];
}

/** What streamer mode shows instead of an amount. */
export const HIDDEN_AMOUNT = "•••";
