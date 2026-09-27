import { and, eq, gt } from "drizzle-orm";
import { authenticatePrincipal } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { json, rateLimit } from "@/lib/http";
import { cachedLiveSnapshot, subscribeLive, type LiveMessage } from "@/lib/live";
import { log } from "@/lib/log";
import { CURSOR_RE, liveFeed, liveSnapshot, type LiveFeedItem } from "@/lib/reports-live";

// GET /api/v1/live — Server-Sent Events for the Live page (dashboard session only).
//
//   event: feed      id: <cursor>   data: { items: LiveFeedItem[], reset?: true }
//   event: snapshot                 data: LiveSnapshot
//   event: end                      data: { reason: "signed_out" }
//   : ping                          (comment heartbeat every 15s)
//
// Reconnects resume from the `Last-Event-ID` header (sent automatically by EventSource) or
// `?after=<cursor>` (used when the page reopens the stream after the tab was hidden).
// Payloads carry counts, amounts and masked labels only, never raw emails or phones.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;
const SESSION_CHECK_MS = 60_000;
/** Streams are recycled so long-lived tabs re-authenticate; EventSource reconnects on its own. */
const MAX_STREAM_MS = 15 * 60_000;
/** A reconnect after a longer gap gets a fresh feed instead of a catch-up. */
const MAX_CATCH_UP_MS = 10 * 60_000;
const RETRY_MS = 3_000;

export async function GET(req: Request) {
  const principal = await authenticatePrincipal(req);
  if (!principal) return json({ error: "unauthorized" }, 401);
  if (principal.kind !== "session") return json({ error: "forbidden", hint: "The live stream is for the dashboard. Use /api/v1/reports for API access." }, 403);
  const { user } = principal;
  if (!user.can("reports.view")) return json({ error: "forbidden" }, 403);
  // A reconnect every few seconds is normal; hundreds a minute is a bug or abuse.
  if (!rateLimit(`live:${user.id}`, 60)) return json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "30" } });

  const ws = principal.workspace;
  const url = new URL(req.url);
  const resumeFrom = [req.headers.get("last-event-id"), url.searchParams.get("after")].find((v) => v && CURSOR_RE.test(v)) ?? null;
  const db = await getDb();
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const timers: NodeJS.Timeout[] = [];
      let unsubscribe: (() => void) | null = null;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const send = (event: string, data: unknown, id?: string) => write(`event: ${event}\n${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`);

      // Keys this connection already sent, so catch-up and live broadcasts never repeat an item.
      const sent = new Set<string>();
      const fresh = (items: LiveFeedItem[]) => {
        const out = items.filter((i) => !sent.has(i.key));
        for (const i of out) sent.add(i.key);
        if (sent.size > 500) for (const k of [...sent].slice(0, sent.size - 500)) sent.delete(k);
        return out;
      };

      // Subscribe before the catch-up query and hold messages until it is sent, so nothing slips between them.
      let ready = false;
      const pending: LiveMessage[] = [];
      const deliver = (msg: LiveMessage) => {
        if (msg.type === "snapshot") return send("snapshot", msg.snapshot);
        const items = fresh(msg.items);
        if (items.length) send("feed", { items }, msg.cursor);
      };
      unsubscribe = subscribeLive(ws, (msg) => (ready ? deliver(msg) : void pending.push(msg)));
      if (!unsubscribe) {
        send("end", { reason: "busy" });
        return close();
      }

      function close() {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        for (const t of timers) clearInterval(t);
        req.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      }
      cleanup = close;
      req.signal.addEventListener("abort", close);

      write(`retry: ${RETRY_MS}\n\n`);
      try {
        const resumeAge = resumeFrom ? Date.now() - Date.parse(resumeFrom) : Infinity;
        const catchUp =
          resumeFrom && resumeAge < MAX_CATCH_UP_MS
            ? await liveFeed(db, ws, { mode: "since", since: resumeFrom, limit: 100 })
            : await liveFeed(db, ws, { mode: "latest", limit: 40 });
        send("feed", { items: fresh(catchUp.items), ...(resumeFrom && resumeAge < MAX_CATCH_UP_MS ? {} : { reset: true }) }, catchUp.cursor);
        send("snapshot", cachedLiveSnapshot(ws.id) ?? (await liveSnapshot(db, ws)));
      } catch (err) {
        log.error("live stream start failed", err);
        return close();
      }
      ready = true;
      for (const msg of pending.splice(0)) deliver(msg);

      timers.push(
        setInterval(() => write(`: ping\n\n`), HEARTBEAT_MS),
        setInterval(async () => {
          // Signed out or session revoked elsewhere: stop streaming.
          const [s] = await db
            .select({ id: schema.sessions.id })
            .from(schema.sessions)
            .where(and(eq(schema.sessions.id, user.sessionId), gt(schema.sessions.expiresAt, new Date())))
            .catch(() => [{ id: user.sessionId }]);
          if (!s) {
            send("end", { reason: "signed_out" });
            close();
          }
        }, SESSION_CHECK_MS),
        setTimeout(close, MAX_STREAM_MS),
      );
      for (const t of timers) t.unref?.();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression proxies (and Node's compression middleware) from buffering the stream.
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
