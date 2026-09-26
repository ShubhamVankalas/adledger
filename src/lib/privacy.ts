import { and, eq, inArray, sql } from "drizzle-orm";
import { creditsFor, MODELS } from "./attribution";
import { rows, schema, type DB } from "./db";
import { log } from "./log";
import { currencyExponent } from "./money";
import { listContacts } from "./reports";
import { getConnection, saveConnection, type Workspace } from "./settings";

// Privacy & data ownership: contact CSV export, right-to-erasure, subject-access export,
// full workspace export and raw-event retention. Everything here is workspace-scoped.

// ---------------------------------------------------------------- streaming helpers

const encoder = new TextEncoder();

/** Turn an async generator of text chunks into a byte stream for a Response body. */
export function textStream(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const it = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (err) {
        log.error("export stream failed", err);
        controller.error(err);
      }
    },
    async cancel() {
      await it.return?.(undefined);
    },
  });
}

/** Collect a generator into one string (tests, small payloads). */
export async function collectText(chunks: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const c of chunks) out += c;
  return out;
}

// ---------------------------------------------------------------- contacts CSV

export type ContactFilter = { search?: string; lifecycle?: "lead" | "customer" };

export const CONTACT_CSV_COLUMNS = [
  "id",
  "email",
  "name",
  "lifecycle",
  "first_seen_at",
  "first_lead_at",
  "first_channel",
  "first_campaign",
  "touchpoints",
  "revenue",
  "revenue_minor",
  "currency",
] as const;

/**
 * RFC 4180 cell; values that a spreadsheet would run as a formula are prefixed with a quote.
 * Plain decimal numbers ("-12.50") are left alone so negative amounts stay numeric.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Decimal string for integer minor units (e.g. 12345, 2 → "123.45"), without floating point. */
export function minorToDecimal(minor: number, exponent: number): string {
  if (exponent === 0) return String(minor);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

const CSV_PAGE = 1000;

/** Every contact matching the filter (same filter as the Contacts page), as CSV lines. */
export async function* contactsCsv(db: DB, ws: Workspace, filter: ContactFilter): AsyncGenerator<string> {
  const exp = currencyExponent(ws.reportingCurrency);
  yield `${CONTACT_CSV_COLUMNS.join(",")}\r\n`;
  for (let offset = 0; ; offset += CSV_PAGE) {
    const { rows: page } = await listContacts(db, ws, { ...filter, limit: CSV_PAGE, offset });
    if (page.length === 0) return;
    yield page
      .map(
        (c) =>
          [
            c.id,
            c.email,
            c.name,
            c.lifecycle,
            c.firstSeenAt,
            c.firstLeadAt,
            c.firstChannel,
            c.firstCampaign,
            c.touchpoints,
            minorToDecimal(c.revenueMinor, exp),
            c.revenueMinor,
            ws.reportingCurrency,
          ]
            .map(csvCell)
            .join(",") + "\r\n",
      )
      .join("");
    if (page.length < CSV_PAGE) return;
  }
}

// ---------------------------------------------------------------- right to erasure

export type ErasureResult = { leads: number; visitors: number; revenueEvents: number; eventsScrubbed: number; touchpointsScrubbed: number };

const ERASED = "[erased]";
// Plain or URL-encoded email addresses, and the sha256:<hex> tokens redactPii() leaves behind.
const EMAIL_ANYWHERE = /[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/gi;
const HASH_TOKEN = /sha256:[0-9a-f]{64}/gi;

export function scrubText(value: string | null): string | null {
  return value === null ? null : value.replace(EMAIL_ANYWHERE, ERASED).replace(HASH_TOKEN, ERASED);
}

const mayHoldPii = (col: ReturnType<typeof sql>) => sql`(${col} ilike '%@%' or ${col} ilike '%\\%40%' or ${col} like '%sha256:%')`;

/**
 * Erase a contact (GDPR art. 17 / CCPA delete):
 * - deletes the contact row (the only place with a raw email) and its leads (form payloads);
 * - unlinks its visitors, clears the properties of their raw events and any emails or email
 *   hashes in their event/touchpoint URLs, so the remaining browsing data is anonymous;
 * - keeps revenue rows with contact_id = null so revenue totals stay correct;
 * - updates attribution in place: the contact's lead/customer credits go and its revenue moves
 *   to the "unattributed" bucket. That is exactly what a full recompute would produce (other
 *   contacts' credits don't depend on this one) without its cost on large workspaces.
 * Returns null if the contact doesn't exist in this workspace.
 */
export async function eraseContact(db: DB, workspaceId: string, contactId: string): Promise<ErasureResult | null> {
  const result = await db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.id, contactId)));
    if (!contact) return null;

    const visitorIds = (
      await tx
        .select({ id: schema.visitors.id })
        .from(schema.visitors)
        .where(and(eq(schema.visitors.workspaceId, workspaceId), eq(schema.visitors.contactId, contactId)))
    ).map((v) => v.id);

    let eventsScrubbed = 0;
    let touchpointsScrubbed = 0;
    if (visitorIds.length) {
      // Event properties can hold anything a site sent (names, phones, form traits), so they
      // are cleared on every event of these visitors; only type/time/URL survive, anonymized.
      const cleared = await tx
        .update(schema.events)
        .set({ properties: {} })
        .where(and(inArray(schema.events.visitorId, visitorIds), sql`${schema.events.properties} <> '{}'::jsonb`))
        .returning({ id: schema.events.id });
      const suspects = await tx
        .select({ id: schema.events.id, url: schema.events.url, referrer: schema.events.referrer })
        .from(schema.events)
        .where(
          and(
            inArray(schema.events.visitorId, visitorIds),
            sql`(${mayHoldPii(sql`${schema.events.url}`)} or ${mayHoldPii(sql`${schema.events.referrer}`)})`,
          ),
        );
      for (const e of suspects) {
        await tx
          .update(schema.events)
          .set({ url: scrubText(e.url), referrer: scrubText(e.referrer) })
          .where(eq(schema.events.id, e.id));
      }
      eventsScrubbed = new Set([...cleared.map((e) => e.id), ...suspects.map((e) => e.id)]).size;

      const tps = await tx
        .select({ id: schema.touchpoints.id, landingUrl: schema.touchpoints.landingUrl, referrer: schema.touchpoints.referrer })
        .from(schema.touchpoints)
        .where(
          and(
            inArray(schema.touchpoints.visitorId, visitorIds),
            sql`(${mayHoldPii(sql`${schema.touchpoints.landingUrl}`)} or ${mayHoldPii(sql`${schema.touchpoints.referrer}`)})`,
          ),
        );
      for (const t of tps) {
        await tx
          .update(schema.touchpoints)
          .set({ landingUrl: scrubText(t.landingUrl), referrer: scrubText(t.referrer) })
          .where(eq(schema.touchpoints.id, t.id));
      }
      touchpointsScrubbed = tps.length;
    }

    const leads = await tx
      .delete(schema.leads)
      .where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.contactId, contactId)))
      .returning({ id: schema.leads.id });
    const visitors = await tx
      .update(schema.visitors)
      .set({ contactId: null })
      .where(and(eq(schema.visitors.workspaceId, workspaceId), eq(schema.visitors.contactId, contactId)))
      .returning({ id: schema.visitors.id });
    // Serialize with recomputeAttribution(), which rewrites credits under the same lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"attr:" + workspaceId}))`);
    const revenue = await tx
      .update(schema.revenueEvents)
      .set({ contactId: null })
      .where(and(eq(schema.revenueEvents.workspaceId, workspaceId), eq(schema.revenueEvents.contactId, contactId)))
      .returning({
        id: schema.revenueEvents.id,
        occurredAt: schema.revenueEvents.occurredAt,
        amountMinor: schema.revenueEvents.amountMinor,
        currency: schema.revenueEvents.currency,
      });
    await tx
      .delete(schema.attributionCredits)
      .where(and(eq(schema.attributionCredits.workspaceId, workspaceId), eq(schema.attributionCredits.contactId, contactId)));
    const unattributed = revenue.flatMap((r) =>
      MODELS.flatMap((model) =>
        creditsFor(
          workspaceId,
          model,
          { id: r.id, type: "revenue", contactId: null, at: r.occurredAt, anchor: r.occurredAt, amountMinor: r.amountMinor, currency: r.currency },
          [],
        ),
      ),
    );
    for (let i = 0; i < unattributed.length; i += 1000) await tx.insert(schema.attributionCredits).values(unattributed.slice(i, i + 1000));
    await tx.delete(schema.contacts).where(eq(schema.contacts.id, contactId));

    return { leads: leads.length, visitors: visitors.length, revenueEvents: revenue.length, eventsScrubbed, touchpointsScrubbed };
  });
  return result;
}

// ---------------------------------------------------------------- subject-access export

/** Everything stored about one contact (GDPR art. 15 / CCPA access request), or null. */
export async function exportContact(db: DB, ws: Workspace, contactId: string) {
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.id, contactId)));
  if (!contact) return null;
  const visitors = await db
    .select()
    .from(schema.visitors)
    .where(and(eq(schema.visitors.workspaceId, ws.id), eq(schema.visitors.contactId, contactId)));
  const visitorIds = visitors.map((v) => v.id);
  const byVisitor = <T extends { visitorId: string }>(list: T[]) =>
    list.map(({ visitorId, ...rest }) => ({ ...rest, anonymousId: visitors.find((v) => v.id === visitorId)?.anonymousId ?? null }));
  const events = visitorIds.length
    ? await db
        .select({
          visitorId: schema.events.visitorId,
          type: schema.events.type,
          name: schema.events.name,
          occurredAt: schema.events.occurredAt,
          url: schema.events.url,
          referrer: schema.events.referrer,
          properties: schema.events.properties,
          ipTrunc: schema.events.ipTrunc,
          userAgent: schema.events.userAgent,
        })
        .from(schema.events)
        .where(inArray(schema.events.visitorId, visitorIds))
        .orderBy(schema.events.occurredAt)
    : [];
  const touchpoints = visitorIds.length
    ? await db
        .select({
          visitorId: schema.touchpoints.visitorId,
          occurredAt: schema.touchpoints.occurredAt,
          channel: schema.touchpoints.channel,
          platform: schema.touchpoints.platform,
          utmSource: schema.touchpoints.utmSource,
          utmMedium: schema.touchpoints.utmMedium,
          utmCampaign: schema.touchpoints.utmCampaign,
          utmContent: schema.touchpoints.utmContent,
          utmTerm: schema.touchpoints.utmTerm,
          clickIdType: schema.touchpoints.clickIdType,
          clickId: schema.touchpoints.clickId,
          fbp: schema.touchpoints.fbp,
          fbc: schema.touchpoints.fbc,
          landingUrl: schema.touchpoints.landingUrl,
          referrer: schema.touchpoints.referrer,
        })
        .from(schema.touchpoints)
        .where(inArray(schema.touchpoints.visitorId, visitorIds))
        .orderBy(schema.touchpoints.occurredAt)
    : [];
  const leads = await db
    .select({ source: schema.leads.source, formName: schema.leads.formName, occurredAt: schema.leads.occurredAt, raw: schema.leads.raw })
    .from(schema.leads)
    .where(eq(schema.leads.contactId, contactId))
    .orderBy(schema.leads.occurredAt);
  const payments = await db
    .select({
      source: schema.revenueEvents.source,
      externalId: schema.revenueEvents.externalId,
      type: schema.revenueEvents.type,
      amountMinor: schema.revenueEvents.amountMinor,
      currency: schema.revenueEvents.currency,
      occurredAt: schema.revenueEvents.occurredAt,
    })
    .from(schema.revenueEvents)
    .where(eq(schema.revenueEvents.contactId, contactId))
    .orderBy(schema.revenueEvents.occurredAt);
  const attribution = rows<Record<string, unknown>>(
    await db.execute(sql`
      select ac.model, ac.conversion_type, ac.conversion_at, ac.channel, ac.platform, c.name campaign, ac.credit::text credit,
        ac.revenue_minor, ac.currency
      from attribution_credits ac left join campaigns c on c.id = ac.campaign_id
      where ac.workspace_id = ${ws.id} and ac.contact_id = ${contactId}::uuid
      order by ac.conversion_at, ac.model`),
  );

  return {
    format: "adledger-subject-access",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { id: ws.id, name: ws.name },
    notes: "Money is in integer minor units (e.g. cents). Timestamps are UTC. IP addresses are stored truncated.",
    contact: {
      id: contact.id,
      email: contact.email,
      name: contact.name,
      emailHash: contact.emailHash,
      phoneHash: contact.phoneHash,
      lifecycle: contact.lifecycle,
      externalIds: contact.externalIds,
      firstSeenAt: contact.firstSeenAt,
      createdAt: contact.createdAt,
    },
    devices: visitors.map((v) => ({ anonymousId: v.anonymousId, firstSeenAt: v.firstSeenAt, lastSeenAt: v.lastSeenAt })),
    events: byVisitor(events),
    touchpoints: byVisitor(touchpoints),
    leads,
    payments,
    attribution: attribution.map((a) => ({ ...a, revenue_minor: Number(a.revenue_minor) })),
  };
}

// ---------------------------------------------------------------- full workspace export

/**
 * Tables in a workspace export, with columns that are credentials (never exported).
 * Sessions, users and memberships are identity/access data, not workspace data.
 */
export const EXPORT_TABLES: { table: string; omit?: string[] }[] = [
  { table: "pixel_sites" },
  { table: "lead_webhooks", omit: ["token"] },
  { table: "connections", omit: ["secrets_enc"] },
  { table: "api_keys", omit: ["key_hash"] },
  { table: "notification_rules" },
  { table: "ad_accounts" },
  { table: "campaigns" },
  { table: "ad_groups" },
  { table: "ads" },
  { table: "ad_insights_daily" },
  { table: "sync_runs" },
  { table: "visitors" },
  { table: "events" },
  { table: "touchpoints" },
  { table: "contacts" },
  { table: "leads" },
  { table: "revenue_events" },
  { table: "attribution_credits" },
  { table: "ai_reports" },
  { table: "audit_log" },
];

const EXPORT_PAGE = 2000;
const MIN_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * One JSON document with every row of every workspace table, generated page by page
 * (keyset on id) so memory stays flat for large workspaces. Rows are Postgres' own
 * `to_jsonb` text, so bigint money values are emitted exactly.
 */
export async function* workspaceExportJson(db: DB, ws: Workspace): AsyncGenerator<string> {
  const { id, name, slug, reportingCurrency, timezone, attributionWindowDays, isDemo, createdAt } = ws;
  yield `{"format":"adledger-workspace-export","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},`;
  yield `"notes":"Money is in integer minor units (e.g. cents) with an ISO currency code. Timestamps are UTC. Credentials are omitted.",`;
  yield `"workspace":${JSON.stringify({ id, name, slug, reportingCurrency, timezone, attributionWindowDays, isDemo, createdAt })},"tables":{`;
  for (const [i, { table, omit }] of EXPORT_TABLES.entries()) {
    yield `${i ? "," : ""}${JSON.stringify(table)}:[`;
    const minus = omit?.length ? sql` - ${sql.raw(`array[${omit.map((c) => `'${c}'`).join(",")}]::text[]`)}` : sql``;
    let after = MIN_UUID;
    let first = true;
    for (;;) {
      const page = rows<{ id: string; r: string }>(
        await db.execute(sql`
          select t.id, (to_jsonb(t)${minus})::text as r from ${sql.raw(table)} t
          where t.workspace_id = ${ws.id} and t.id > ${after}::uuid
          order by t.id limit ${EXPORT_PAGE}`),
      );
      if (page.length === 0) break;
      yield (first ? "" : ",") + page.map((p) => p.r).join(",");
      first = false;
      after = page[page.length - 1].id;
      if (page.length < EXPORT_PAGE) break;
    }
    yield "]";
  }
  yield "}}";
}

// ---------------------------------------------------------------- data retention

/**
 * The retention policy lives in `connections` as provider "retention" (config.eventsDays),
 * not in a new column: connections is already the per-workspace, unique-per-provider settings
 * store (config jsonb + enabled + last_synced_at for "last run"), so no migration is needed.
 * `workspaces.onboarding` is typed and rewritten for onboarding progress only.
 */
export const RETENTION_PROVIDER = "retention";
export const RETENTION_MIN_DAYS = 7;
export const RETENTION_MAX_DAYS = 3650;

export type Retention = { eventsDays: number | null; lastRunAt: string | null; lastDeleted: number | null };

export async function getRetention(db: DB, workspaceId: string): Promise<Retention> {
  const conn = await getConnection(workspaceId, RETENTION_PROVIDER, db);
  const days = Number(conn?.config.eventsDays);
  return {
    eventsDays: conn?.enabled && Number.isInteger(days) && days > 0 ? days : null,
    lastRunAt: conn?.lastSyncedAt?.toISOString() ?? null,
    lastDeleted: conn?.config.lastDeleted ? Number(conn.config.lastDeleted) : null,
  };
}

/** null turns retention off (raw events are kept forever). */
export async function setRetention(db: DB, workspaceId: string, eventsDays: number | null) {
  if (eventsDays !== null && (!Number.isInteger(eventsDays) || eventsDays < RETENTION_MIN_DAYS || eventsDays > RETENTION_MAX_DAYS)) {
    throw new Error(`Retention must be between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS} days.`);
  }
  await saveConnection(
    workspaceId,
    RETENTION_PROVIDER,
    { mode: "live", enabled: eventsDays !== null, config: eventsDays !== null ? { eventsDays: String(eventsDays) } : {} },
    db,
  );
}

/**
 * Delete raw pixel events older than the workspace's retention period. Touchpoints, visitors,
 * contacts and revenue are kept, so attribution and reports are unaffected.
 * Returns the number of deleted events, or null when retention is off.
 */
export async function applyRetention(db: DB, workspaceId: string, now = new Date()): Promise<number | null> {
  const { eventsDays } = await getRetention(db, workspaceId);
  if (!eventsDays) return null;
  const cutoff = new Date(now.getTime() - eventsDays * 86_400_000);
  const [r] = rows<{ n: string | number }>(
    await db.execute(sql`with d as (
      delete from events where workspace_id = ${workspaceId} and occurred_at < ${cutoff.toISOString()}::timestamptz returning 1
    ) select count(*) n from d`),
  );
  const deleted = Number(r?.n ?? 0);
  await db
    .update(schema.connections)
    .set({ lastSyncedAt: now, lastError: null, config: sql`${schema.connections.config} || ${JSON.stringify({ lastDeleted: String(deleted) })}::jsonb` })
    .where(and(eq(schema.connections.workspaceId, workspaceId), eq(schema.connections.provider, RETENTION_PROVIDER)));
  return deleted;
}

/** Daily job: apply every workspace's retention policy. */
export async function applyRetentionAll(db: DB, now = new Date()) {
  const targets = await db
    .select({ workspaceId: schema.connections.workspaceId })
    .from(schema.connections)
    .where(and(eq(schema.connections.provider, RETENTION_PROVIDER), eq(schema.connections.enabled, true)));
  let total = 0;
  for (const t of targets) {
    try {
      total += (await applyRetention(db, t.workspaceId, now)) ?? 0;
    } catch (err) {
      log.error("data retention failed for a workspace", err);
      await db
        .update(schema.connections)
        .set({ lastError: err instanceof Error ? err.message.slice(0, 500) : "failed" })
        .where(and(eq(schema.connections.workspaceId, t.workspaceId), eq(schema.connections.provider, RETENTION_PROVIDER)));
    }
  }
  return total;
}
