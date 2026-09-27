import { getDb } from "./db";
import { log } from "./log";
import { liveCursor, liveFeed, liveSnapshot, type LiveFeedItem, type LiveSnapshot } from "./reports-live";
import type { Workspace } from "./settings";

// Live channel. One in-process hub per workspace, shared by every open Live tab:
// - it polls the database (cheap indexed queries) every POLL_MS while anyone is watching,
//   so it works the same with several app instances behind a load balancer (no pub/sub needed);
// - `nudgeLive(workspaceId)` asks for an immediate poll, so ingest paths (pixel collect, lead and
//   revenue webhooks, sync) can make new rows show up in well under a second;
// - it stops polling when the last subscriber leaves.
// Messages carry counts, ids, amounts and masked labels only (see reports-live.ts).

export const POLL_MS = 2_000;
export const SNAPSHOT_MS = 10_000;
/** New activity refreshes the counters sooner, but never more than once per this interval (busy sites). */
export const SNAPSHOT_MIN_MS = 3_000;
/** Protects a small instance from a runaway number of open tabs. */
export const MAX_SUBSCRIBERS_PER_WORKSPACE = 50;

export type LiveMessage = { type: "feed"; items: LiveFeedItem[]; cursor: string } | { type: "snapshot"; snapshot: LiveSnapshot };
type Listener = (msg: LiveMessage) => void;

type Hub = {
  ws: Workspace;
  listeners: Set<Listener>;
  cursor: string | null;
  /** Keys already broadcast recently (the poll looks back a few seconds for late commits). */
  seen: Map<string, number>;
  timer: NodeJS.Timeout | null;
  polling: boolean;
  again: boolean;
  lastSnapshotAt: number;
  /** New feed items since the last snapshot. */
  dirty: boolean;
  snapshot: LiveSnapshot | null;
};

const g = globalThis as unknown as { __adledgerLive?: Map<string, Hub> };
const hubs = (g.__adledgerLive ??= new Map());

export function liveSubscriberCount(workspaceId: string) {
  return hubs.get(workspaceId)?.listeners.size ?? 0;
}

/** The hub's last snapshot if it is still fresh (saves a query when another tab is already watching). */
export function cachedLiveSnapshot(workspaceId: string): LiveSnapshot | null {
  const hub = hubs.get(workspaceId);
  return hub?.snapshot && Date.now() - hub.lastSnapshotAt < SNAPSHOT_MS ? hub.snapshot : null;
}

/**
 * Subscribe to a workspace's live messages. Returns an unsubscribe function, or null when the
 * workspace already has MAX_SUBSCRIBERS_PER_WORKSPACE open streams.
 */
export function subscribeLive(ws: Workspace, listener: Listener): (() => void) | null {
  let hub = hubs.get(ws.id);
  if (!hub) {
    hub = { ws, listeners: new Set(), cursor: null, seen: new Map(), timer: null, polling: false, again: false, lastSnapshotAt: 0, dirty: false, snapshot: null };
    hubs.set(ws.id, hub);
  }
  if (hub.listeners.size >= MAX_SUBSCRIBERS_PER_WORKSPACE) return null;
  hub.ws = ws; // pick up timezone / currency changes
  hub.listeners.add(listener);
  if (!hub.timer) schedule(hub, 0);
  const h = hub;
  return () => {
    h.listeners.delete(listener);
    if (h.listeners.size === 0) {
      if (h.timer) clearTimeout(h.timer);
      h.timer = null;
      hubs.delete(h.ws.id);
    }
  };
}

/** Ask for a poll now (e.g. right after a pixel hit or a payment webhook). No-op when nobody is watching. */
export function nudgeLive(workspaceId: string) {
  const hub = hubs.get(workspaceId);
  if (!hub) return;
  if (hub.polling) {
    hub.again = true;
    return;
  }
  schedule(hub, 150);
}

function schedule(hub: Hub, delay: number) {
  if (hub.timer) clearTimeout(hub.timer);
  hub.timer = setTimeout(() => void poll(hub), delay);
  hub.timer.unref?.();
}

async function poll(hub: Hub) {
  if (!hubs.has(hub.ws.id) || hub.listeners.size === 0) return;
  hub.polling = true;
  try {
    const db = await getDb();
    if (hub.cursor === null) {
      // First poll: start from "now". Subscribers got their own catch-up when they connected.
      hub.cursor = await liveCursor(db);
    } else {
      const { items, cursor } = await liveFeed(db, hub.ws, { mode: "since", since: hub.cursor, limit: 100 });
      hub.cursor = cursor;
      const now = Date.now();
      for (const [k, t] of hub.seen) if (now - t > 60_000) hub.seen.delete(k);
      const fresh = items.filter((i) => !hub.seen.has(i.key));
      for (const i of fresh) hub.seen.set(i.key, now);
      if (fresh.length) {
        broadcast(hub, { type: "feed", items: fresh, cursor });
        hub.dirty = true; // new activity: refresh the counters soon
      }
    }
    const age = Date.now() - hub.lastSnapshotAt;
    if (age >= SNAPSHOT_MS || (hub.dirty && age >= SNAPSHOT_MIN_MS)) {
      hub.snapshot = await liveSnapshot(db, hub.ws);
      hub.lastSnapshotAt = Date.now();
      hub.dirty = false;
      broadcast(hub, { type: "snapshot", snapshot: hub.snapshot });
    }
  } catch (err) {
    log.error("live poll failed", err);
  } finally {
    hub.polling = false;
    if (hubs.get(hub.ws.id) === hub && hub.listeners.size > 0) {
      schedule(hub, hub.again ? 150 : POLL_MS);
      hub.again = false;
    }
  }
}

function broadcast(hub: Hub, msg: LiveMessage) {
  for (const l of hub.listeners) {
    try {
      l(msg);
    } catch (err) {
      log.error("live listener failed", err);
    }
  }
}
