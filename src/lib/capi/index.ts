import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { ConnectionLike } from "../connectors/types";
import { rows, schema, type DB } from "../db";
import type { UploadStatus } from "../db/schema";
import { log } from "../log";
import { forcedMockMode, getConnection } from "../settings";
import { buildGoogleConversion, googleUploadConfig, sendGoogleConversions, type GoogleUploadConfig } from "./google";
import { buildMetaEvent, META_MAX_EVENT_AGE_MS, metaUploadConfig, sendMetaEvents, type MetaUploadConfig } from "./meta";
import type { Built, ConversionContext, FetchLike, SendOutcome, UploadConversionType, UploadPlatform } from "./types";

// Server-side conversion uploads (Meta Conversions API, Google Ads click conversions).
//
// 1. enqueue: every lead / payment inside the platform's look-back window gets one
//    `conversion_uploads` row per platform (unique index -> idempotent, safe to re-run).
// 2. process: due `pending` rows are built into payloads and sent in batches. Each result moves
//    the row through a small state machine (see `nextState`): sent | pending (retry with
//    backoff) | failed (permanent error or out of attempts) | skipped (nothing to match on).
// Mock mode (CONNECTOR_MODE=mock or a mock connection) records rows as sent without any network call.

export type { ConversionContext, SendOutcome } from "./types";

const HOUR = 3_600_000;
export const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 500;
const PROVIDER: Record<UploadPlatform, string> = { meta: "meta", google: "google_ads" };
const LOOKBACK_MS: Record<UploadPlatform, number> = { meta: META_MAX_EVENT_AGE_MS, google: 30 * 24 * HOUR };
const GOOGLE_CLICK_DAYS = 90;

/** Backoff before retry number `attempts` + 1: 15 min, 1 h, 4 h, 16 h (capped at 24 h). */
export function backoffMs(attempts: number): number {
  return Math.min(15 * 60_000 * 4 ** Math.max(0, attempts - 1), 24 * HOUR);
}

type RowState = { status: UploadStatus; attempts: number; error: string | null; nextAttemptAt: Date; sentAt: Date | null; mock: boolean };

/** Pure retry state machine: the row's next state after one send attempt (or a skip). */
export function nextState(prev: { attempts: number }, outcome: SendOutcome | { skip: string }, now: Date): RowState {
  if ("skip" in outcome) {
    return { status: "skipped", attempts: prev.attempts, error: outcome.skip, nextAttemptAt: now, sentAt: null, mock: false };
  }
  const attempts = prev.attempts + 1;
  if (outcome.ok) return { status: "sent", attempts, error: null, nextAttemptAt: now, sentAt: now, mock: Boolean(outcome.mock) };
  if (outcome.retryable && attempts < MAX_ATTEMPTS) {
    return { status: "pending", attempts, error: outcome.error, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), sentAt: null, mock: false };
  }
  return { status: "failed", attempts, error: outcome.error, nextAttemptAt: now, sentAt: null, mock: false };
}

type PlatformSetup =
  | { platform: "meta"; conn: ConnectionLike; mock: boolean; cfg: MetaUploadConfig; types: UploadConversionType[] }
  | { platform: "google"; conn: ConnectionLike; mock: boolean; cfg: GoogleUploadConfig; types: UploadConversionType[] };

/** Which platforms have uploads switched on for this workspace. */
export async function uploadSetups(db: DB, workspaceId: string): Promise<PlatformSetup[]> {
  const out: PlatformSetup[] = [];
  const meta = await getConnection(workspaceId, PROVIDER.meta, db);
  if (meta?.enabled) {
    const cfg = metaUploadConfig(meta);
    if (cfg) out.push({ platform: "meta", conn: meta, mock: forcedMockMode() || meta.mode === "mock", cfg, types: ["lead", "purchase"] });
  }
  const google = await getConnection(workspaceId, PROVIDER.google, db);
  if (google?.enabled) {
    const cfg = googleUploadConfig(google);
    if (cfg) {
      const types = (Object.keys(cfg.actions) as UploadConversionType[]).filter((t) => cfg.actions[t]);
      out.push({ platform: "google", conn: google, mock: forcedMockMode() || google.mode === "mock", cfg, types });
    }
  }
  return out;
}

/** Create pending upload rows for recent leads/payments. Idempotent (on conflict do nothing). */
export async function enqueueConversions(
  db: DB,
  workspaceId: string,
  platform: UploadPlatform,
  types: UploadConversionType[],
  now = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - LOOKBACK_MS[platform]).toISOString();
  const until = now.toISOString();
  let created = 0;
  if (types.includes("lead")) {
    created += rows(
      await db.execute(sql`
        insert into conversion_uploads (workspace_id, platform, conversion_type, conversion_id, conversion_at, next_attempt_at)
        select l.workspace_id, ${platform}, 'lead', l.id, l.occurred_at, ${until}::timestamptz
        from leads l
        where l.workspace_id = ${workspaceId} and l.occurred_at >= ${since}::timestamptz and l.occurred_at <= ${until}::timestamptz
        on conflict do nothing
        returning id`),
    ).length;
  }
  if (types.includes("purchase")) {
    created += rows(
      await db.execute(sql`
        insert into conversion_uploads (workspace_id, platform, conversion_type, conversion_id, conversion_at, next_attempt_at)
        select r.workspace_id, ${platform}, 'purchase', r.id, r.occurred_at, ${until}::timestamptz
        from revenue_events r
        where r.workspace_id = ${workspaceId} and r.type = 'payment' and r.amount_minor > 0
          and r.occurred_at >= ${since}::timestamptz and r.occurred_at <= ${until}::timestamptz
        on conflict do nothing
        returning id`),
    ).length;
  }
  return created;
}

type ContextRow = {
  id: string;
  type: UploadConversionType;
  occurred_at: string | Date;
  amount_minor: string | number | null;
  currency: string | null;
  contact_id: string | null;
  email: string | null;
  email_hash: string | null;
  phone_hash: string | null;
  ip_trunc: string | null;
  user_agent: string | null;
  url: string | null;
  fbc: string | null;
  fbp: string | null;
  g_type: "gclid" | "gbraid" | "wbraid" | null;
  g_id: string | null;
};

const idList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/**
 * Load everything the payload builders need for a set of conversions: the contact's hashed
 * identifiers, the latest browser context (IP, user agent, page) and the latest Meta / Google
 * click identifiers seen before the conversion.
 */
export async function loadConversionContexts(
  db: DB,
  workspaceId: string,
  refs: { type: UploadConversionType; id: string }[],
): Promise<Map<string, ConversionContext>> {
  const leadIds = refs.filter((r) => r.type === "lead").map((r) => r.id);
  const payIds = refs.filter((r) => r.type === "purchase").map((r) => r.id);
  const parts = [];
  if (leadIds.length) {
    parts.push(sql`select l.id, 'lead' as type, l.contact_id, l.occurred_at, null::bigint as amount_minor, null::text as currency
      from leads l where l.workspace_id = ${workspaceId} and l.id in (${idList(leadIds)})`);
  }
  if (payIds.length) {
    parts.push(sql`select r.id, 'purchase' as type, r.contact_id, r.occurred_at, r.amount_minor, r.currency
      from revenue_events r where r.workspace_id = ${workspaceId} and r.id in (${idList(payIds)})`);
  }
  const out = new Map<string, ConversionContext>();
  if (!parts.length) return out;
  const result = rows<ContextRow>(
    await db.execute(sql`
      with conv as (${sql.join(parts, sql` union all `)})
      select conv.id, conv.type, conv.occurred_at, conv.amount_minor, conv.currency, conv.contact_id,
        c.email, c.email_hash, c.phone_hash,
        ev.ip_trunc, ev.user_agent, ev.url,
        fb.fbc, fb.fbp,
        g.click_id_type as g_type, g.click_id as g_id
      from conv
      left join contacts c on c.id = conv.contact_id and c.workspace_id = ${workspaceId}
      left join lateral (
        select e.ip_trunc, e.user_agent, e.url from events e join visitors v on v.id = e.visitor_id
        where v.contact_id = conv.contact_id and e.user_agent is not null and e.occurred_at <= conv.occurred_at + interval '1 hour'
        order by e.occurred_at desc limit 1
      ) ev on true
      left join lateral (
        select t.fbc, t.fbp from touchpoints t join visitors v on v.id = t.visitor_id
        where v.contact_id = conv.contact_id and (t.fbc is not null or t.fbp is not null) and t.occurred_at <= conv.occurred_at
        order by t.occurred_at desc limit 1
      ) fb on true
      left join lateral (
        select t.click_id_type, t.click_id from touchpoints t join visitors v on v.id = t.visitor_id
        where v.contact_id = conv.contact_id and t.click_id_type in ('gclid', 'gbraid', 'wbraid') and t.click_id is not null
          and t.occurred_at <= conv.occurred_at and t.occurred_at >= conv.occurred_at - make_interval(days => ${GOOGLE_CLICK_DAYS})
        order by t.occurred_at desc limit 1
      ) g on true`),
  );
  for (const r of result) {
    out.set(`${r.type}:${r.id}`, {
      id: r.id,
      type: r.type,
      occurredAt: new Date(r.occurred_at),
      amountMinor: r.amount_minor == null ? null : Number(r.amount_minor),
      currency: r.currency,
      contactId: r.contact_id,
      email: r.email,
      emailHash: r.email_hash,
      phoneHash: r.phone_hash,
      ip: r.ip_trunc,
      userAgent: r.user_agent,
      sourceUrl: r.url,
      fbc: r.fbc,
      fbp: r.fbp,
      googleClick: r.g_type && r.g_id ? { type: r.g_type, id: r.g_id } : null,
    });
  }
  return out;
}

export type UploadRunResult = { enqueued: number; sent: number; retrying: number; failed: number; skipped: number };

type Opts = { now?: Date; fetch?: FetchLike; googleAccessToken?: (c: ConnectionLike) => Promise<string> };

/** Send due pending uploads for one platform. */
async function processPlatform(db: DB, workspaceId: string, setup: PlatformSetup, opts: Opts, result: UploadRunResult) {
  const now = opts.now ?? new Date();
  const due = await db
    .select()
    .from(schema.conversionUploads)
    .where(
      and(
        eq(schema.conversionUploads.workspaceId, workspaceId),
        eq(schema.conversionUploads.platform, setup.platform),
        eq(schema.conversionUploads.status, "pending"),
        lte(schema.conversionUploads.nextAttemptAt, now),
      ),
    )
    .orderBy(schema.conversionUploads.conversionAt)
    .limit(BATCH_LIMIT);
  if (!due.length) return;

  const contexts = await loadConversionContexts(db, workspaceId, due.map((d) => ({ type: d.conversionType, id: d.conversionId })));
  const outcomes = new Map<string, SendOutcome | { skip: string }>();
  const toSend: { rowId: string; payload: unknown }[] = [];
  for (const row of due) {
    const ctx = contexts.get(`${row.conversionType}:${row.conversionId}`);
    const built: Built<unknown> = !ctx
      ? { skip: "Conversion no longer exists" }
      : setup.platform === "meta"
        ? buildMetaEvent(ctx, now)
        : buildGoogleConversion(ctx, setup.cfg);
    if ("skip" in built) outcomes.set(row.id, built);
    else toSend.push({ rowId: row.id, payload: built.payload });
  }

  if (toSend.length) {
    let sent: SendOutcome[];
    if (setup.mock) sent = toSend.map(() => ({ ok: true, mock: true }));
    else if (setup.platform === "meta") sent = await sendMetaEvents(setup.cfg, toSend.map((s) => s.payload) as Parameters<typeof sendMetaEvents>[1], opts.fetch);
    else sent = await sendGoogleConversions(setup.conn, setup.cfg, toSend.map((s) => s.payload) as Parameters<typeof sendGoogleConversions>[2], opts.fetch, opts.googleAccessToken);
    toSend.forEach((s, i) => outcomes.set(s.rowId, sent[i]));
  }

  for (const row of due) {
    const outcome = outcomes.get(row.id)!;
    const next = nextState(row, outcome, now);
    await db.update(schema.conversionUploads).set(next).where(eq(schema.conversionUploads.id, row.id));
    if (next.status === "sent") result.sent++;
    else if (next.status === "pending") result.retrying++;
    else if (next.status === "failed") result.failed++;
    else result.skipped++;
  }
}

/** Enqueue and send conversions for every platform with uploads switched on. Never throws per platform. */
export async function runConversionUploads(db: DB, workspaceId: string, opts: Opts = {}): Promise<UploadRunResult> {
  const result: UploadRunResult = { enqueued: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  for (const setup of await uploadSetups(db, workspaceId)) {
    try {
      result.enqueued += await enqueueConversions(db, workspaceId, setup.platform, setup.types, opts.now);
      await processPlatform(db, workspaceId, setup, opts, result);
    } catch (err) {
      log.error(`conversion upload (${setup.platform}) failed`, err);
    }
  }
  if (result.sent || result.failed || result.retrying) {
    log.info(`conversion uploads: ${result.sent} sent, ${result.retrying} retrying, ${result.failed} failed, ${result.skipped} skipped`);
  }
  return result;
}

export type UploadStats = { sent: number; failed: number; pending: number; skipped: number };

/** Upload counts per platform for conversions created in the last `days` days (UI). */
export async function uploadStats(db: DB, workspaceId: string, days = 7, now = new Date()): Promise<Record<UploadPlatform, UploadStats>> {
  const empty = (): UploadStats => ({ sent: 0, failed: 0, pending: 0, skipped: 0 });
  const out: Record<UploadPlatform, UploadStats> = { meta: empty(), google: empty() };
  const counts = await db
    .select({ platform: schema.conversionUploads.platform, status: schema.conversionUploads.status, n: sql<number>`count(*)::int` })
    .from(schema.conversionUploads)
    .where(
      and(
        eq(schema.conversionUploads.workspaceId, workspaceId),
        gte(schema.conversionUploads.createdAt, new Date(now.getTime() - days * 24 * HOUR)),
        inArray(schema.conversionUploads.platform, ["meta", "google"]),
      ),
    )
    .groupBy(schema.conversionUploads.platform, schema.conversionUploads.status);
  for (const c of counts) out[c.platform][c.status] = Number(c.n);
  return out;
}
