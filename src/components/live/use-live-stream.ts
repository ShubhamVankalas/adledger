"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveFeedItem, LiveSnapshot } from "@/lib/reports-live";

export type LiveStatus = "connecting" | "live" | "paused" | "reconnecting" | "ended";

const MAX_ITEMS = 60;
/** Close the stream when the tab has been hidden this long (brief tab switches keep it open). */
const HIDDEN_GRACE_MS = 20_000;

type Options = {
  initialSnapshot: LiveSnapshot;
  initialItems: LiveFeedItem[];
  initialCursor: string;
  /** Called with items that arrived live (not the catch-up on connect), oldest first. */
  onArrive?: (items: LiveFeedItem[]) => void;
};

/**
 * Subscribes to GET /api/v1/live (Server-Sent Events). The browser's EventSource reconnects on
 * its own and resumes with Last-Event-ID; when the tab is hidden the stream is closed and reopened
 * with `?after=<cursor>` once the tab is visible again, so nothing is missed and no work is done
 * for a tab nobody is looking at.
 */
export function useLiveStream({ initialSnapshot, initialItems, initialCursor, onArrive }: Options) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [items, setItems] = useState(initialItems);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  /** Keys that arrived live, for the slide-in; cleared by the row after it animates. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const cursor = useRef(initialCursor);
  const [initialKeys] = useState(() => new Set(initialItems.map((i) => i.key)));
  const known = useRef(initialKeys);
  const arrive = useRef(onArrive);
  useEffect(() => {
    arrive.current = onArrive;
  }, [onArrive]);

  useEffect(() => {
    let es: EventSource | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let first = true;

    const open = () => {
      if (es) return;
      setStatus((s) => (s === "paused" ? "connecting" : s));
      es = new EventSource(`/api/v1/live?after=${encodeURIComponent(cursor.current)}`);
      es.onopen = () => setStatus("live");
      es.onerror = () => {
        // CLOSED = the server refused (signed out, rate limited): EventSource won't retry on its own.
        if (es?.readyState === EventSource.CLOSED) {
          es = null;
          setStatus("reconnecting");
          setTimeout(() => document.visibilityState === "visible" && open(), 5_000);
        } else setStatus("reconnecting");
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
          setItems(data.items.slice(0, MAX_ITEMS));
          return;
        }
        const add = data.items.filter((i) => !known.current.has(i.key));
        if (!add.length) return;
        for (const i of add) known.current.add(i.key);
        if (known.current.size > 1000) known.current = new Set([...known.current].slice(-MAX_ITEMS * 2));
        setItems((prev) => [...add, ...prev].slice(0, MAX_ITEMS));
        if (!catchUp) {
          setFresh((prev) => new Set([...prev, ...add.map((i) => i.key)]));
          arrive.current?.([...add].reverse());
        }
      });
      es.addEventListener("snapshot", (e) => {
        setSnapshot(JSON.parse((e as MessageEvent<string>).data) as LiveSnapshot);
      });
      es.addEventListener("end", (e) => {
        const { reason } = JSON.parse((e as MessageEvent<string>).data) as { reason: string };
        es?.close();
        es = null;
        setStatus("ended");
        if (reason === "signed_out") window.location.assign("/login");
      });
    };

    const close = () => {
      es?.close();
      es = null;
      setStatus("paused");
    };

    const onVisibility = () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === "hidden") hiddenTimer = setTimeout(close, HIDDEN_GRACE_MS);
      else {
        first = true;
        open();
      }
    };

    if (document.visibilityState === "visible") open();
    else setStatus("paused");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(hiddenTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      es?.close();
      es = null;
    };
  }, []);

  const settle = (key: string) =>
    setFresh((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  return { snapshot, items, status, fresh, settle };
}
