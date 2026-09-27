"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveFeedItem, LiveSnapshot } from "@/lib/reports-live";

export type LiveStatus = "connecting" | "live" | "paused" | "reconnecting" | "busy";

const MAX_ITEMS = 60;
/** Close the stream when the tab has been hidden this long (brief tab switches keep it open). */
const HIDDEN_GRACE_MS = 20_000;
/** Retry delays after the server refused or dropped the stream (EventSource gives up on non-200s). */
const BACKOFF_MS = [3_000, 6_000, 15_000, 30_000, 60_000];

type Options = {
  initialSnapshot: LiveSnapshot;
  initialItems: LiveFeedItem[];
  initialCursor: string;
  /** Called with items that arrived live (not the catch-up on connect), oldest first. */
  onArrive?: (items: LiveFeedItem[]) => void;
  /** Keep at most this many feed items (default 60). */
  maxItems?: number;
};

/**
 * Subscribes to GET /api/v1/live (Server-Sent Events). The browser's EventSource reconnects on
 * its own after a dropped connection (a server restart, a proxy timeout) and resumes with
 * Last-Event-ID. When the tab is hidden the stream is closed after a grace period and reopened
 * with `?after=<cursor>` once the tab is visible again, so nothing is missed and no work is done
 * for a tab nobody is looking at.
 */
export function useLiveStream({ initialSnapshot, initialItems, initialCursor, onArrive, maxItems = MAX_ITEMS }: Options) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [items, setItems] = useState(initialItems);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  /** Keys that arrived live, for the slide-in; each row clears its key after it animates. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const cursor = useRef(initialCursor);
  const [initialKeys] = useState(() => new Set(initialItems.map((i) => i.key)));
  const known = useRef(initialKeys);
  const arrive = useRef(onArrive);
  const nav = useRef(router);
  useEffect(() => {
    arrive.current = onArrive;
    nav.current = router;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let first = true;
    let disposed = false;

    const retry = (next: LiveStatus) => {
      es?.close();
      es = null;
      setStatus(next);
      clearTimeout(retryTimer);
      const delay = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
      retryTimer = setTimeout(() => {
        if (!disposed && document.visibilityState === "visible") open();
      }, delay);
    };

    const open = () => {
      if (es || disposed) return;
      first = true;
      es = new EventSource(`/api/v1/live?after=${encodeURIComponent(cursor.current)}`);
      es.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      es.onerror = () => {
        // CLOSED: the server refused (signed out, rate limited, restarting): EventSource won't retry on its own.
        if (es?.readyState === EventSource.CLOSED) retry("reconnecting");
        else setStatus("reconnecting");
      };
      es.addEventListener("feed", (e) => {
        const ev = e as MessageEvent<string>;
        if (ev.lastEventId) cursor.current = ev.lastEventId;
        const data = JSON.parse(ev.data) as { items: LiveFeedItem[]; reset?: boolean };
        const catchUp = first;
        first = false;
        setStatus("live");
        if (data.reset) {
          known.current = new Set(data.items.map((i) => i.key));
          setItems(data.items.slice(0, maxItems));
          return;
        }
        const add = data.items.filter((i) => !known.current.has(i.key));
        if (!add.length) return;
        for (const i of add) known.current.add(i.key);
        if (known.current.size > 1000) known.current = new Set([...known.current].slice(-maxItems * 2));
        setItems((prev) => [...add, ...prev].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, maxItems));
        setFresh((prev) => new Set([...prev, ...add.map((i) => i.key)]));
        if (!catchUp) arrive.current?.([...add].reverse());
      });
      es.addEventListener("snapshot", (e) => {
        setSnapshot(JSON.parse((e as MessageEvent<string>).data) as LiveSnapshot);
      });
      es.addEventListener("end", (e) => {
        const { reason } = JSON.parse((e as MessageEvent<string>).data) as { reason: string };
        if (reason === "signed_out") {
          es?.close();
          es = null;
          nav.current.push("/login");
          return;
        }
        // "busy": too many open Live tabs on this workspace; try again in a while.
        retry(reason === "busy" ? "busy" : "reconnecting");
      });
    };

    const pause = () => {
      es?.close();
      es = null;
      clearTimeout(retryTimer);
      setStatus("paused");
    };

    const onVisibility = () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === "hidden") hiddenTimer = setTimeout(pause, HIDDEN_GRACE_MS);
      else if (!es) {
        attempt = 0;
        setStatus("connecting");
        open();
      }
    };

    open();
    // Opened in a background tab: keep the stream only for the grace period.
    if (document.visibilityState === "hidden") hiddenTimer = setTimeout(pause, HIDDEN_GRACE_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      clearTimeout(hiddenTimer);
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      es?.close();
      es = null;
    };
  }, [maxItems]);

  const settle = useCallback(
    (key: string) =>
      setFresh((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      }),
    [],
  );

  return { snapshot, items, status, fresh, settle };
}
