import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import { decrypt, encrypt, redactPii } from "../crypto";
import { getDb, schema, type DB } from "../db";
import type { WebhookEventType } from "../db/schema";
import { log } from "../log";
import { BlockedUrlError, safeFetch } from "../net";
import { getAppSecret } from "../settings";
import { DELIVERY_RETENTION_DAYS, DELIVERY_TIMEOUT_MS, RETRY_DELAYS_MS, sampleEvent, SIGNATURE_HEADER } from "./catalog";
import { newEventId, scheduleWebhookDispatch } from "./emit";
import { signatureHeader } from "./signature";

// Outbound webhooks, part 2: sending queued deliveries. Runs in-process: a short timer after new
// events are queued (emit.ts) and the every-minute "webhooks" job (lib/jobs.ts) for retries.
// Rows are claimed with FOR UPDATE SKIP LOCKED plus a lease on next_attempt_at, so several app
// instances (or the timer and the job) never send the same attempt twice.

type Delivery = typeof schema.webhookDeliveries.$inferSelect;
type Endpoint = typeof schema.webhookEndpoints.$inferSelect;

const LEASE_MS = 2 * 60_000;
const BATCH = 25;
const CONCURRENCY = 5;
const RESPONSE_BYTES = 1024;
const USER_AGENT = "AdLedger-Webhooks/1.0 (+https://github.com/ShubhamVankalas/adledger)";

/** Wait before retry number `attempt` (1-based: the delay after the first failed attempt is retryDelayMs(1)). */
export function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt, 1), RETRY_DELAYS_MS.length) - 1];
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, RESPONSE_BYTES).toString("utf8");
}

/** A short, log-safe reason for a failed request (never the URL, which may carry a token). */
function describeError(err: unknown): string {
  if (err instanceof BlockedUrlError) return err.message;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return `Timed out after ${DELIVERY_TIMEOUT_MS / 1000} s`;
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  if (cause?.code === "ENOTFOUND") return "Couldn't resolve the host name";
  if (cause?.code === "ECONNREFUSED") return "Connection refused";
  if (cause?.code) return `Couldn't connect (${cause.code})`;
  return "Couldn't connect";
}

/** Put the raw email/phone back into the event (only for endpoints with include_pii). */
function withPii(payload: Record<string, unknown>, pii: { email: string | null; phone: string | null }): Record<string, unknown> {
  const data = payload.data as Record<string, unknown> | undefined;
  const contact = data?.contact as Record<string, unknown> | null | undefined;
  if (!data || !contact) return payload;
  return { ...payload, data: { ...data, contact: { ...contact, email: pii.email ?? null, phone: pii.phone ?? null } } };
}

/** The exact request body an endpoint receives for a delivery. */
export async function deliveryBody(delivery: Pick<Delivery, "payload" | "piiEnc">, endpoint: Pick<Endpoint, "includePii">, db?: DB): Promise<string> {
  let payload = delivery.payload;
  if (endpoint.includePii && delivery.piiEnc) {
    const pii = JSON.parse(decrypt(delivery.piiEnc, await getAppSecret(db))) as { email: string | null; phone: string | null };
    payload = withPii(payload, pii);
  }
  return JSON.stringify(payload);
}

/** Send one attempt of a (claimed) delivery and record the outcome. Returns the updated row. */
export async function attemptDelivery(db: DB, d: Delivery, now = new Date()): Promise<Delivery> {
  const [ep] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, d.endpointId));
  const attempts = d.attempts + 1;
  if (!ep || !ep.enabled) {
    const [row] = await db
      .update(schema.webhookDeliveries)
      .set({ status: "failed", attempts, lastError: ep ? "The endpoint is disabled" : "The endpoint was deleted", nextAttemptAt: null, lastAttemptAt: now })
      .where(eq(schema.webhookDeliveries.id, d.id))
      .returning();
    return row;
  }
  const secret = decrypt(ep.secretEnc, await getAppSecret(db));
  const body = await deliveryBody(d, ep, db);
  const started = Date.now();
  let code: number | null = null;
  let text: string | null = null;
  let error: string | null = null;
  let permanent = false;
  try {
    const res = await safeFetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        [SIGNATURE_HEADER]: signatureHeader(body, secret, now),
        "AdLedger-Event": d.event,
        "AdLedger-Event-Id": d.eventId,
        "AdLedger-Delivery": d.id,
        "AdLedger-Attempt": String(attempts),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    code = res.status;
    text = (redactPii(await readCapped(res).catch(() => "")) as string) || null;
    if (!res.ok) error = res.status >= 300 && res.status < 400 ? `Redirects aren't followed (HTTP ${res.status})` : `HTTP ${res.status}`;
  } catch (err) {
    error = describeError(err);
    permanent = err instanceof BlockedUrlError;
  }
  const durationMs = Date.now() - started;
  const ok = error === null;
  const giveUp = !ok && (permanent || attempts >= d.maxAttempts);
  const [row] = await db
    .update(schema.webhookDeliveries)
    .set({
      status: ok ? "delivered" : giveUp ? "failed" : "pending",
      attempts,
      responseCode: code,
      responseBody: text,
      lastError: error,
      durationMs,
      lastAttemptAt: now,
      deliveredAt: ok ? now : null,
      nextAttemptAt: ok || giveUp ? null : new Date(now.getTime() + retryDelayMs(attempts)),
    })
    .where(eq(schema.webhookDeliveries.id, d.id))
    .returning();
  return row;
}

/**
 * Send every delivery that is due (new events and retries), a batch at a time. Returns counts for
 * logs and tests. Safe to run concurrently on several instances.
 */
export async function dispatchDueWebhooks(opts: { db?: DB; now?: Date; limit?: number } = {}) {
  const db = opts.db ?? (await getDb());
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? BATCH;
  const d = schema.webhookDeliveries;
  const due = db
    .select({ id: d.id })
    .from(d)
    .where(and(eq(d.status, "pending"), lte(d.nextAttemptAt, now)))
    .orderBy(asc(d.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(d)
    .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(inArray(d.id, due))
    .returning();
  const result = { attempted: claimed.length, delivered: 0, failed: 0, retrying: 0 };
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const done = await Promise.all(
      claimed.slice(i, i + CONCURRENCY).map((row) =>
        attemptDelivery(db, row, now).catch((err) => {
          log.error("webhook delivery crashed", err);
          return null;
        }),
      ),
    );
    for (const r of done) {
      if (r?.status === "delivered") result.delivered++;
      else if (r?.status === "failed") result.failed++;
      else if (r) result.retrying++;
    }
  }
  // A full batch means more may be waiting: keep going soon rather than a minute from now.
  if (claimed.length === limit) scheduleWebhookDispatch(250);
  return result;
}

/** Drop delivery logs older than the retention window. */
export async function pruneWebhookDeliveries(db: DB, now = new Date()) {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000);
  const gone = await db.delete(schema.webhookDeliveries).where(lt(schema.webhookDeliveries.createdAt, cutoff)).returning({ id: schema.webhookDeliveries.id });
  return gone.length;
}

// ---------------------------------------------------------------- manual sends (dashboard)

/**
 * "Send test event": a sample event (test: true) delivered right away, once. Endpoints with
 * include_pii get the sample's fake email and phone, so the receiver sees the real shape.
 */
export async function sendTestEvent(db: DB, endpoint: Endpoint, type: WebhookEventType, now = new Date()): Promise<Delivery> {
  const payload = sampleEvent(type, { workspaceId: endpoint.workspaceId, id: newEventId().replace("evt_", "evt_test_"), now, test: true });
  const piiEnc = endpoint.includePii ? encrypt(JSON.stringify({ email: "priya@example.com", phone: "+1 415 555 0142" }), await getAppSecret(db)) : null;
  const [row] = await db
    .insert(schema.webhookDeliveries)
    .values({ workspaceId: endpoint.workspaceId, endpointId: endpoint.id, eventId: payload.id, event: type, payload: payload as unknown as Record<string, unknown>, piiEnc, maxAttempts: 1, nextAttemptAt: null })
    .returning();
  return attemptDelivery(db, row, now);
}

/** Send an earlier event again (same event id, so receivers can dedupe), once, right now. */
export async function redeliver(db: DB, original: Delivery, now = new Date()): Promise<Delivery> {
  const [row] = await db
    .insert(schema.webhookDeliveries)
    .values({
      workspaceId: original.workspaceId,
      endpointId: original.endpointId,
      eventId: original.eventId,
      event: original.event,
      payload: original.payload,
      piiEnc: original.piiEnc,
      maxAttempts: 1,
      nextAttemptAt: null,
    })
    .returning();
  return attemptDelivery(db, row, now);
}
