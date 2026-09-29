import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { screenEmail } from "../contact-display";
import { encrypt } from "../crypto";
import { schema, type DB } from "../db";
import type { WebhookEventType } from "../db/schema";
import { log } from "../log";
import { getAppSecret } from "../settings";
import { MAX_ATTEMPTS, WEBHOOK_API_VERSION, type WebhookContact, type WebhookEnvelope, type WebhookEventData, type WebhookStage } from "./catalog";

// Outbound webhooks, part 1: turning things that happen (a lead, a payment, a stage change) into
// rows in webhook_deliveries (the outbox). Emitters run inside the caller's transaction, so an
// event only exists if the change that caused it was committed, and inside a savepoint, so a
// webhook problem can never fail the ingest that triggered it. Delivery is ./deliver.ts.

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

/** Raw personal data for endpoints with "Include personal data" on (stored encrypted, never in `payload`). */
export type EventPii = { email?: string | null; phone?: string | null };

type Pending<T extends WebhookEventType = WebhookEventType> = { type: T; data: WebhookEventData[T]; pii?: EventPii };

// ---------------------------------------------------------------- subscriber cache

type Sub = { id: string; includePii: boolean; events: string[] };

const CACHE_TTL_MS = 10_000;
const g = globalThis as unknown as { __adledgerWebhookSubs?: Map<string, { at: number; subs: Sub[] }>; __adledgerWebhookKick?: NodeJS.Timeout };
const cache = (g.__adledgerWebhookSubs ??= new Map());

/**
 * Enabled endpoints per workspace, cached for a few seconds so the ingest hot paths (pixel,
 * webhooks, imports) cost one indexed query per workspace at most every 10 s. Changes made on
 * this instance clear it immediately; other instances pick them up within the TTL.
 */
export function invalidateWebhookSubscribers(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

function cachedSubs(workspaceId: string): Sub[] | null {
  const hit = cache.get(workspaceId);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.subs : null;
}

async function loadSubs(q: Q, workspaceId: string): Promise<Sub[]> {
  const cached = cachedSubs(workspaceId);
  if (cached) return cached;
  const subs = await q
    .select({ id: schema.webhookEndpoints.id, includePii: schema.webhookEndpoints.includePii, events: schema.webhookEndpoints.events })
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.workspaceId, workspaceId), eq(schema.webhookEndpoints.enabled, true)));
  cache.set(workspaceId, { at: Date.now(), subs });
  return subs;
}

/**
 * Run `fn` only when some endpoint of the workspace listens to `type`: inside a savepoint, with any
 * error logged and swallowed (the business write that triggered the event must still succeed).
 */
async function whenSubscribed(q: Q, workspaceId: string, type: WebhookEventType, fn: (sp: Q) => Promise<number>): Promise<number> {
  const cached = cachedSubs(workspaceId);
  if (cached && !cached.some((s) => s.events.includes(type))) return 0;
  try {
    return await q.transaction(async (sp) => {
      const subs = await loadSubs(sp, workspaceId);
      if (!subs.some((s) => s.events.includes(type))) return 0;
      return fn(sp);
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "error";
    log.warn(`webhook event ${type} was not queued (${code})`);
    return 0;
  }
}

// ---------------------------------------------------------------- outbox

export const newEventId = () => `evt_${randomUUID().replace(/-/g, "")}`;

/** Write one delivery per subscribed endpoint per event. Returns the number of deliveries queued. */
async function enqueue(q: Q, workspaceId: string, events: Pending[], now = new Date()): Promise<number> {
  const subs = await loadSubs(q, workspaceId);
  let secret: string | null = null;
  const rows: (typeof schema.webhookDeliveries.$inferInsert)[] = [];
  for (const e of events) {
    const targets = subs.filter((s) => s.events.includes(e.type));
    if (!targets.length) continue;
    const eventId = newEventId();
    const payload: WebhookEnvelope = { id: eventId, type: e.type, api_version: WEBHOOK_API_VERSION, created_at: now.toISOString(), workspace_id: workspaceId, test: false, data: e.data };
    const pii = e.pii && (e.pii.email || e.pii.phone) ? JSON.stringify({ email: e.pii.email ?? null, phone: e.pii.phone ?? null }) : null;
    for (const t of targets) {
      let piiEnc: string | null = null;
      if (pii && t.includePii) piiEnc = encrypt(pii, (secret ??= await getAppSecret(q as DB)));
      rows.push({ workspaceId, endpointId: t.id, eventId, event: e.type, payload: payload as unknown as Record<string, unknown>, piiEnc, maxAttempts: MAX_ATTEMPTS, nextAttemptAt: now });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await q.insert(schema.webhookDeliveries).values(rows.slice(i, i + 500));
  if (rows.length) scheduleWebhookDispatch();
  return rows.length;
}

/**
 * Deliver soon (after the surrounding transaction has most likely committed). Anything this timer
 * misses (a slow commit, a restart) is picked up by the every-minute webhooks job. Tests call
 * dispatchDueWebhooks() themselves.
 */
export function scheduleWebhookDispatch(delayMs = 1_500) {
  if (process.env.ADLEDGER_SYNC_JOBS === "1" || g.__adledgerWebhookKick) return;
  const t = setTimeout(() => {
    g.__adledgerWebhookKick = undefined;
    import("./deliver")
      .then((m) => m.dispatchDueWebhooks())
      .catch((err) => log.error("webhook dispatch failed", err));
  }, delayMs);
  t.unref?.();
  g.__adledgerWebhookKick = t;
}

// ---------------------------------------------------------------- contact snapshots

type Snapshot = { contact: WebhookContact; email: string | null };

const contactUrl = (id: string) => (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, "")}/contacts/${id}` : null);

/** Contacts as events carry them (PII-free; the raw email is returned separately for the outbox). */
export async function contactSnapshots(q: Q, workspaceId: string, ids: string[]): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const c = schema.contacts;
  const s = schema.pipelineStages;
  const found = await q
    .select({
      id: c.id,
      name: c.name,
      email: c.email,
      emailHash: c.emailHash,
      phoneHash: c.phoneHash,
      lifecycle: c.lifecycle,
      firstSeenAt: c.firstSeenAt,
      stageId: s.id,
      stageName: s.name,
      stageKind: s.kind,
    })
    .from(c)
    .leftJoin(s, eq(s.id, c.stageId))
    .where(and(eq(c.workspaceId, workspaceId), inArray(c.id, unique)));
  // Contacts without a stage sit in the first open stage (see lib/pipeline.ts).
  let fallback: WebhookStage | null | undefined;
  if (found.some((r) => !r.stageId)) {
    const stages = await q.select({ id: s.id, name: s.name, kind: s.kind }).from(s).where(eq(s.workspaceId, workspaceId)).orderBy(asc(s.position), asc(s.createdAt));
    fallback = stages.find((x) => x.kind === "open") ?? stages[0] ?? null;
  }
  for (const r of found) {
    out.set(r.id, {
      email: r.email,
      contact: {
        id: r.id,
        name: r.name,
        email: null,
        email_masked: screenEmail(r.email),
        email_sha256: r.emailHash,
        phone: null,
        phone_sha256: r.phoneHash,
        lifecycle: r.lifecycle,
        stage: r.stageId ? { id: r.stageId, name: r.stageName!, kind: r.stageKind! } : (fallback ?? null),
        first_seen_at: r.firstSeenAt.toISOString(),
        url: contactUrl(r.id),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------- emitters

/** lead.created — called by recordLead() for every lead source except bulk CSV imports. */
export function emitLeadCreated(q: Q, lead: typeof schema.leads.$inferSelect, phone?: string | null) {
  return whenSubscribed(q, lead.workspaceId, "lead.created", async (sp) => {
    const snap = (await contactSnapshots(sp, lead.workspaceId, [lead.contactId])).get(lead.contactId);
    if (!snap) return 0;
    const data = { lead: { id: lead.id, source: lead.source, form_name: lead.formName, occurred_at: lead.occurredAt.toISOString() }, contact: snap.contact };
    return enqueue(sp, lead.workspaceId, [{ type: "lead.created", data, pii: { email: snap.email, phone } }]);
  });
}

/** contact.created — called by upsertContact() when it inserted a new row. */
export function emitContactCreated(q: Q, workspaceId: string, contactId: string, phone?: string | null) {
  return whenSubscribed(q, workspaceId, "contact.created", async (sp) => {
    const snap = (await contactSnapshots(sp, workspaceId, [contactId])).get(contactId);
    if (!snap) return 0;
    return enqueue(sp, workspaceId, [{ type: "contact.created", data: { contact: snap.contact }, pii: { email: snap.email, phone } }]);
  });
}

export type StageChange = { contactId: string; from: WebhookStage | null; to: WebhookStage; source: "manual" | "payment" | "system" | "undo" };

const asStage = (s: { id: string; name: string; kind: WebhookStage["kind"] }): WebhookStage => ({ id: s.id, name: s.name, kind: s.kind });
export { asStage as webhookStage };

/** contact.updated — one event per contact whose pipeline stage changed. */
export function emitStageChanges(q: Q, workspaceId: string, changes: StageChange[]) {
  if (!changes.length) return Promise.resolve(0);
  return whenSubscribed(q, workspaceId, "contact.updated", async (sp) => {
    const snaps = await contactSnapshots(sp, workspaceId, changes.map((c) => c.contactId));
    const events: Pending<"contact.updated">[] = [];
    for (const ch of changes) {
      const snap = snaps.get(ch.contactId);
      if (!snap) continue;
      events.push({ type: "contact.updated", data: { contact: snap.contact, changes: { stage: { from: ch.from, to: ch.to, source: ch.source } } }, pii: { email: snap.email } });
    }
    return enqueue(sp, workspaceId, events as Pending[]);
  });
}

/** payment.succeeded / payment.refunded — called by ingestRevenue() for newly stored rows only. */
export function emitRevenueEvent(q: Q, row: typeof schema.revenueEvents.$inferSelect, phone?: string | null) {
  const type = row.type === "refund" ? "payment.refunded" : "payment.succeeded";
  return whenSubscribed(q, row.workspaceId, type, async (sp) => {
    const snap = row.contactId ? (await contactSnapshots(sp, row.workspaceId, [row.contactId])).get(row.contactId) : undefined;
    const money = { id: row.id, source: row.source, external_id: row.externalId, amount_minor: Math.abs(row.amountMinor), currency: row.currency, occurred_at: row.occurredAt.toISOString() };
    const pii = { email: snap?.email ?? null, phone: snap ? phone : null };
    const event: Pending =
      type === "payment.refunded"
        ? { type, data: { refund: { ...money, related_external_id: row.relatedExternalId }, contact: snap?.contact ?? null }, pii }
        : { type, data: { payment: money, contact: snap?.contact ?? null }, pii };
    return enqueue(sp, row.workspaceId, [event]);
  });
}
