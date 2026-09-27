import { sql, type SQL } from "drizzle-orm";
import { displayEmail, type ContactViewer } from "./contact-display";
import {
  ADDED_RANGES,
  type ContactGroupTotals,
  type CrmAbilities,
  type ContactListRow,
  type ContactQuery,
  type ContactRecord,
  type ContactSort,
  type ContactTotals,
  type ContactView,
  type CrmMember,
  type Lifecycle,
  type NoteRow,
  type TaskRow,
  type TimelineEntry,
} from "./crm-query";
import { rows, type DB } from "./db";
import { fromDecimalString } from "./money";
import { roleCan, type Permission } from "./permissions";
import { journey } from "./reports";
import type { Workspace } from "./settings";

// CRM numbers, all computed in SQL: the contact_stats roll-up, the Contacts table (keyset
// paging, filters, footer totals), the contact record, notes and tasks.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

// ---------------------------------------------------------------- contact_stats roll-up

/**
 * Rebuild contact_stats rows from the ledger (touchpoints, leads, revenue, visits).
 * `contactIds` limits the rebuild; `missingOnly` fills contacts that have no row yet.
 * Idempotent; runs after every attribution recompute and when the Contacts page finds gaps.
 */
export async function refreshContactStats(
  db: DB,
  workspaceId: string,
  opts: { contactIds?: string[]; missingOnly?: boolean } = {},
): Promise<number> {
  if (opts.contactIds && opts.contactIds.length === 0) return 0;
  const [ws] = rows<{ currency: string }>(await db.execute(sql`select reporting_currency currency from workspaces where id = ${workspaceId}`));
  if (!ws) return 0;
  const scope = sql`c.workspace_id = ${workspaceId}
    ${opts.contactIds ? sql`and c.id in (${uuidList(opts.contactIds)})` : sql``}
    ${opts.missingOnly ? sql`and not exists (select 1 from contact_stats s where s.contact_id = c.id)` : sql``}`;
  const result = await db.execute(sql`
    with c as (select c.id, c.first_seen_at from contacts c where ${scope}),
    tp as (
      select v.contact_id, t.id, t.occurred_at, t.channel, t.platform, t.campaign_id
      from touchpoints t join visitors v on v.id = t.visitor_id join c on c.id = v.contact_id
      where t.workspace_id = ${workspaceId}
    ),
    tagg as (
      select contact_id, count(*) touches, min(occurred_at) first_at, max(occurred_at) last_at,
        count(*) filter (where occurred_at > now() - interval '30 days') touches_30d
      from tp group by contact_id
    ),
    ft as (select distinct on (contact_id) contact_id, channel, platform, campaign_id from tp order by contact_id, occurred_at, id),
    lt as (select distinct on (contact_id) contact_id, channel, platform, campaign_id from tp order by contact_id, occurred_at desc, id desc),
    rev as (
      select r.contact_id,
        coalesce(sum(r.amount_minor) filter (where r.currency = ${ws.currency}), 0) revenue,
        coalesce(-sum(r.amount_minor) filter (where r.type = 'refund' and r.currency = ${ws.currency}), 0) refunds,
        count(*) filter (where r.type = 'payment') orders,
        min(r.occurred_at) filter (where r.type = 'payment') converted_at,
        max(r.occurred_at) last_at,
        bool_or(r.type = 'payment' and r.occurred_at > now() - interval '90 days') paid_90d
      from revenue_events r join c on c.id = r.contact_id
      where r.workspace_id = ${workspaceId} group by r.contact_id
    ),
    ld as (
      select l.contact_id, min(l.occurred_at) first_at, max(l.occurred_at) last_at
      from leads l join c on c.id = l.contact_id where l.workspace_id = ${workspaceId} group by l.contact_id
    ),
    vis as (
      -- No workspace predicate: contact ids are already scoped, and with it the planner can pick a
      -- slow BitmapAnd with the (workspace_id, anonymous_id) index per contact.
      select v.contact_id, max(v.last_seen_at) last_seen
      from visitors v join c on c.id = v.contact_id group by v.contact_id
    ),
    ev as (
      select v.contact_id, count(*) events_30d
      from events e join visitors v on v.id = e.visitor_id join c on c.id = v.contact_id
      where e.workspace_id = ${workspaceId} and e.occurred_at > now() - interval '30 days'
      group by v.contact_id
    ),
    j as (
      select c.id, c.first_seen_at, tagg.touches, tagg.first_at, tagg.last_at touch_last, tagg.touches_30d,
        ft.channel ft_channel, ft.platform ft_platform, ft.campaign_id ft_campaign,
        lt.channel lt_channel, lt.platform lt_platform, lt.campaign_id lt_campaign,
        rev.revenue, rev.refunds, rev.orders, rev.converted_at, rev.last_at rev_last, rev.paid_90d,
        ld.first_at lead_first, ld.last_at lead_last, vis.last_seen, ev.events_30d,
        greatest(tagg.last_at, rev.last_at, ld.last_at, vis.last_seen) last_activity
      from c
      left join tagg on tagg.contact_id = c.id left join ft on ft.contact_id = c.id left join lt on lt.contact_id = c.id
      left join rev on rev.contact_id = c.id left join ld on ld.contact_id = c.id
      left join vis on vis.contact_id = c.id left join ev on ev.contact_id = c.id
    )
    insert into contact_stats (contact_id, workspace_id, revenue_minor, refunds_minor, orders, touches,
      first_touch_at, first_touch_channel, first_touch_platform, first_touch_campaign_id,
      last_touch_at, last_touch_channel, last_touch_platform, last_touch_campaign_id,
      first_lead_at, converted_at, days_to_convert, last_seen_at, last_activity_at, engagement, updated_at)
    select id, ${workspaceId}, coalesce(revenue, 0), coalesce(refunds, 0), coalesce(orders, 0), coalesce(touches, 0),
      first_at, ft_channel, ft_platform, ft_campaign,
      touch_last, lt_channel, lt_platform, lt_campaign,
      lead_first, converted_at,
      case when converted_at is not null then
        greatest(0, floor(extract(epoch from converted_at - least(first_seen_at, coalesce(first_at, first_seen_at))) / 86400))::int end,
      coalesce(last_seen, touch_last), last_activity,
      least(100,
        (case when last_activity > now() - interval '1 day' then 40
              when last_activity > now() - interval '7 days' then 30
              when last_activity > now() - interval '30 days' then 15
              when last_activity > now() - interval '90 days' then 5 else 0 end)
        + least(30, coalesce(events_30d, 0) * 2)
        + least(15, coalesce(touches_30d, 0) * 5)
        + (case when lead_last > now() - interval '30 days' then 10 else 0 end)
        + (case when paid_90d then 5 else 0 end))::int,
      now()
    from j
    on conflict (contact_id) do update set
      revenue_minor = excluded.revenue_minor, refunds_minor = excluded.refunds_minor, orders = excluded.orders,
      touches = excluded.touches, first_touch_at = excluded.first_touch_at, first_touch_channel = excluded.first_touch_channel,
      first_touch_platform = excluded.first_touch_platform, first_touch_campaign_id = excluded.first_touch_campaign_id,
      last_touch_at = excluded.last_touch_at, last_touch_channel = excluded.last_touch_channel,
      last_touch_platform = excluded.last_touch_platform, last_touch_campaign_id = excluded.last_touch_campaign_id,
      first_lead_at = excluded.first_lead_at, converted_at = excluded.converted_at, days_to_convert = excluded.days_to_convert,
      last_seen_at = excluded.last_seen_at, last_activity_at = excluded.last_activity_at, engagement = excluded.engagement,
      updated_at = excluded.updated_at`);
  return (result as { rowCount?: number; affectedRows?: number }).rowCount ?? (result as { affectedRows?: number }).affectedRows ?? 0;
}

/** Fill contact_stats for contacts that have no row yet (new since the last recompute, or after upgrading). */
export async function ensureContactStats(db: DB, workspaceId: string): Promise<void> {
  const [gap] = rows<{ missing: boolean }>(
    await db.execute(sql`select exists (
      select 1 from contacts c where c.workspace_id = ${workspaceId}
        and not exists (select 1 from contact_stats s where s.contact_id = c.id)) missing`),
  );
  if (gap?.missing) await refreshContactStats(db, workspaceId, { missingOnly: true });
}

// ---------------------------------------------------------------- filters

/** Revenue at the 90th percentile of paying contacts, rounded down to two significant digits. */
export async function highValueThreshold(db: DB, ws: Workspace): Promise<number | null> {
  const [r] = rows<{ p90: string | null }>(
    await db.execute(sql`select percentile_disc(0.9) within group (order by revenue_minor) p90
      from contact_stats where workspace_id = ${ws.id} and revenue_minor > 0`),
  );
  const p90 = nn(r?.p90);
  if (!p90 || p90 <= 0) return null;
  const magnitude = 10 ** Math.max(0, String(Math.trunc(p90)).length - 2);
  return Math.floor(p90 / magnitude) * magnitude;
}

export type ResolvedQuery = ContactQuery & { viewerId: string; highValueMinor?: number | null };

const minor = (v: string | null, currency: string) => {
  if (!v) return null;
  try {
    return fromDecimalString(v, currency);
  } catch {
    return null;
  }
};

/** WHERE clause over `contacts c left join contact_stats s`. */
function whereSql(ws: Workspace, q: ResolvedQuery): SQL {
  const parts: SQL[] = [sql`c.workspace_id = ${ws.id}`];
  // Starter views imply a filter.
  if (q.view === "customers") parts.push(sql`c.lifecycle = 'customer'`);
  if (q.view === "leads") parts.push(sql`c.lifecycle = 'lead'`);
  if (q.view === "high") parts.push(q.highValueMinor ? sql`s.revenue_minor >= ${q.highValueMinor}` : sql`false`);
  const search = q.q.trim().toLowerCase();
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    parts.push(sql`(lower(c.email) like ${like} or lower(c.name) like ${like})`);
  }
  if (q.lc) parts.push(sql`c.lifecycle = ${q.lc}`);
  if (q.platform.length) {
    const direct = q.platform.filter((p) => p !== "none");
    parts.push(
      sql`(${direct.length ? sql`s.first_touch_platform in (${sql.join(direct.map((p) => sql`${p}`), sql`, `)})` : sql`false`}
        ${q.platform.includes("none") ? sql`or s.first_touch_platform is null` : sql``})`,
    );
  }
  if (q.campaign) parts.push(sql`s.first_touch_campaign_id = ${q.campaign}::uuid`);
  const lo = minor(q.revMin, ws.reportingCurrency);
  const hi = minor(q.revMax, ws.reportingCurrency);
  if (lo !== null) parts.push(sql`coalesce(s.revenue_minor, 0) >= ${lo}`);
  if (hi !== null) parts.push(sql`coalesce(s.revenue_minor, 0) <= ${hi}`);
  if (q.tag.length) {
    parts.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = c.id
      and ct.tag in (${sql.join(q.tag.map((t) => sql`${t}`), sql`, `)}))`);
  }
  if (q.owner === "none") parts.push(sql`c.owner_user_id is null`);
  else if (q.owner === "me") parts.push(sql`c.owner_user_id = ${q.viewerId}::uuid`);
  else if (q.owner) parts.push(sql`c.owner_user_id = ${q.owner}::uuid`);
  if (q.added) parts.push(sql`c.first_seen_at >= now() - make_interval(days => ${ADDED_RANGES[q.added]})`);
  return sql.join(parts, sql` and `);
}

// ---------------------------------------------------------------- list (keyset)

const SORT_SQL: Record<ContactSort, { expr: SQL; cast: SQL; kind: "ts" | "num" | "text" }> = {
  first_seen: { expr: sql`c.first_seen_at`, cast: sql`timestamptz`, kind: "ts" },
  last_activity: { expr: sql`coalesce(s.last_activity_at, c.first_seen_at)`, cast: sql`timestamptz`, kind: "ts" },
  revenue: { expr: sql`coalesce(s.revenue_minor, 0)`, cast: sql`bigint`, kind: "num" },
  orders: { expr: sql`coalesce(s.orders, 0)`, cast: sql`bigint`, kind: "num" },
  touches: { expr: sql`coalesce(s.touches, 0)`, cast: sql`bigint`, kind: "num" },
  engagement: { expr: sql`coalesce(s.engagement, 0)`, cast: sql`bigint`, kind: "num" },
  name: { expr: sql`lower(coalesce(nullif(c.name, ''), c.email, ''))`, cast: sql`text`, kind: "text" },
};

type Cursor = { v: string | number; id: string; g?: string };
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function decodeCursor(token: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Cursor;
    if (typeof c?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(c.id)) return null;
    if (typeof c.v !== "string" && typeof c.v !== "number") return null;
    if (c.g !== undefined && c.g !== "lead" && c.g !== "customer") return null;
    return c;
  } catch {
    return null;
  }
}

export type ContactPage = { rows: ContactListRow[]; nextCursor: string | null; prevCursor: string | null };

export async function listContactsPage(db: DB, ws: Workspace, q: ResolvedQuery, viewer: ContactViewer, limit = 50): Promise<ContactPage> {
  const sort = SORT_SQL[q.sort];
  const before = q.cursor?.startsWith("b.") ?? false;
  const cursor = q.cursor ? decodeCursor(q.cursor.slice(2)) : null;
  // Walking backwards flips every direction, then the page is reversed.
  const desc = (q.dir === "desc") !== before;
  const groupAsc = !before;
  const cmp = desc ? sql`<` : sql`>`;
  let seek = sql``;
  if (cursor) {
    const tuple = sql`(${sort.expr}, c.id) ${cmp} (${cursor.v}::${sort.cast}, ${cursor.id}::uuid)`;
    seek =
      q.group && cursor.g
        ? sql`and (c.lifecycle ${groupAsc ? sql`>` : sql`<`} ${cursor.g} or (c.lifecycle = ${cursor.g} and ${tuple}))`
        : sql`and ${tuple}`;
  }
  const dir = desc ? sql`desc` : sql`asc`;
  const order = sql`${q.group ? sql`c.lifecycle ${groupAsc ? sql`asc` : sql`desc`},` : sql``} ${sort.expr} ${dir}, c.id ${dir}`;
  const result = rows<Record<string, string | number | null>>(
    await db.execute(sql`
      select c.id, c.name, c.email, c.lifecycle, c.first_seen_at, c.owner_user_id,
        ${sort.kind === "ts" ? sql`(${sort.expr})::text` : sort.expr} sort_value,
        s.revenue_minor, s.orders, s.touches, s.engagement, s.days_to_convert, s.last_activity_at,
        s.first_touch_platform, s.first_touch_channel, fc.name first_campaign,
        s.last_touch_platform, s.last_touch_channel, lc.name last_campaign
      from contacts c
      left join contact_stats s on s.contact_id = c.id
      left join campaigns fc on fc.id = s.first_touch_campaign_id
      left join campaigns lc on lc.id = s.last_touch_campaign_id
      where ${whereSql(ws, q)} ${seek}
      order by ${order}
      limit ${limit + 1}`),
  );
  const more = result.length > limit;
  const page = result.slice(0, limit);
  if (before) page.reverse();

  const ids = page.map((r) => String(r.id));
  const tagRows = ids.length
    ? rows<{ contact_id: string; tag: string }>(
        await db.execute(sql`select contact_id, tag from contact_tags where workspace_id = ${ws.id} and contact_id in (${uuidList(ids)}) order by tag`),
      )
    : [];
  const tags = new Map<string, string[]>();
  for (const t of tagRows) tags.set(t.contact_id, [...(tags.get(t.contact_id) ?? []), t.tag]);

  const cursorOf = (r: Record<string, string | number | null>) =>
    encodeCursor({
      // Timestamps travel as Postgres text, keeping microseconds (a JS Date rounds to ms and would skip rows).
      v: sort.kind === "num" ? Number(r.sort_value) : String(r.sort_value ?? ""),
      id: String(r.id),
      g: q.group ? String(r.lifecycle) : undefined,
    });
  const first = page[0];
  const last = page.at(-1);
  const touch = (platform: unknown, channel: unknown, campaign: unknown) =>
    platform || channel ? { platform: (platform as string) ?? null, channel: (channel as string) ?? null, campaign: (campaign as string) ?? null } : null;
  return {
    rows: page.map((r) => ({
      id: String(r.id),
      name: (r.name as string) ?? null,
      email: displayEmail(r.email as string | null, viewer),
      lifecycle: r.lifecycle as Lifecycle,
      firstSeenAt: iso(r.first_seen_at)!,
      ownerUserId: (r.owner_user_id as string) ?? null,
      tags: tags.get(String(r.id)) ?? [],
      revenueMinor: n(r.revenue_minor),
      orders: n(r.orders),
      touches: n(r.touches),
      engagement: n(r.engagement),
      daysToConvert: nn(r.days_to_convert),
      lastActivityAt: iso(r.last_activity_at),
      firstTouch: touch(r.first_touch_platform, r.first_touch_channel, r.first_campaign),
      lastTouch: touch(r.last_touch_platform, r.last_touch_channel, r.last_campaign),
    })),
    nextCursor: last && (before ? true : more) ? `a.${cursorOf(last)}` : null,
    prevCursor: first && (before ? more : Boolean(cursor)) ? `b.${cursorOf(first)}` : null,
  };
}

// ---------------------------------------------------------------- totals and counts

const totalsSelect = sql`count(*) cnt,
  count(*) filter (where c.lifecycle = 'customer') customers,
  coalesce(sum(s.revenue_minor), 0) revenue,
  count(*) filter (where s.revenue_minor > 0) paying,
  coalesce(sum(s.revenue_minor) filter (where s.revenue_minor > 0), 0) paying_revenue,
  percentile_cont(0.5) within group (order by s.days_to_convert) median_days`;

function toTotals(r: Record<string, string | number | null> | undefined): ContactTotals {
  const paying = n(r?.paying);
  return {
    count: n(r?.cnt),
    customers: n(r?.customers),
    revenueMinor: n(r?.revenue),
    avgLtvMinor: paying ? Math.round(n(r?.paying_revenue) / paying) : null,
    medianDaysToConvert: r?.median_days === null || r?.median_days === undefined ? null : Math.round(Number(r.median_days) * 10) / 10,
  };
}

/** Footer totals for every contact matching the filters (not just the page). */
export async function contactTotals(db: DB, ws: Workspace, q: ResolvedQuery): Promise<ContactTotals> {
  const [r] = rows<Record<string, string | number | null>>(
    await db.execute(sql`select ${totalsSelect} from contacts c left join contact_stats s on s.contact_id = c.id where ${whereSql(ws, q)}`),
  );
  return toTotals(r);
}

/** Subtotals per lifecycle group (for group-by). */
export async function contactGroupTotals(db: DB, ws: Workspace, q: ResolvedQuery): Promise<ContactGroupTotals> {
  const result = rows<Record<string, string | number | null>>(
    await db.execute(sql`select c.lifecycle, ${totalsSelect} from contacts c left join contact_stats s on s.contact_id = c.id
      where ${whereSql(ws, q)} group by c.lifecycle`),
  );
  const by = new Map(result.map((r) => [r.lifecycle, r]));
  return { customer: toTotals(by.get("customer")), lead: toTotals(by.get("lead")) };
}

/** Counts for the starter view tabs. */
export async function starterViewCounts(db: DB, ws: Workspace, highValueMinor: number | null) {
  const [r] = rows<Record<string, string>>(
    await db.execute(sql`select count(*) total,
      count(*) filter (where c.lifecycle = 'customer') customers,
      count(*) filter (where c.lifecycle = 'lead') leads,
      count(*) filter (where ${highValueMinor ? sql`s.revenue_minor >= ${highValueMinor}` : sql`false`}) high
      from contacts c left join contact_stats s on s.contact_id = c.id where c.workspace_id = ${ws.id}`),
  );
  return { all: n(r?.total), customers: n(r?.customers), leads: n(r?.leads), high: n(r?.high) };
}

// ---------------------------------------------------------------- filter options

export async function filterOptions(db: DB, ws: Workspace) {
  const [platforms, campaigns, tags] = await Promise.all([
    db.execute(sql`select first_touch_platform platform, count(*) cnt from contact_stats
      where workspace_id = ${ws.id} and first_touch_platform is not null group by 1 order by 2 desc`),
    db.execute(sql`select cp.id, cp.name, cp.platform, count(*) cnt from contact_stats s join campaigns cp on cp.id = s.first_touch_campaign_id
      where s.workspace_id = ${ws.id} group by 1, 2, 3 order by 4 desc limit 200`),
    db.execute(sql`select tag, count(*) cnt from contact_tags where workspace_id = ${ws.id} group by 1 order by 2 desc, 1 limit 200`),
  ]);
  return {
    platforms: rows<{ platform: string; cnt: string }>(platforms).map((r) => ({ id: r.platform, count: n(r.cnt) })),
    campaigns: rows<{ id: string; name: string; platform: string; cnt: string }>(campaigns).map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      count: n(r.cnt),
    })),
    tags: rows<{ tag: string; cnt: string }>(tags).map((r) => ({ tag: r.tag, count: n(r.cnt) })),
  };
}

/** Team members who can open this workspace (owner and assignee pickers). */
export async function crmMembers(db: DB, ws: Workspace): Promise<CrmMember[]> {
  const result = rows<{ id: string; name: string | null; email: string; role: string }>(
    await db.execute(sql`select u.id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
      where m.organization_id = ${ws.organizationId}
        and (m.workspace_ids is null or m.workspace_ids @> ${JSON.stringify([ws.id])}::jsonb)
      order by lower(coalesce(u.name, u.email))`),
  );
  return result.map((m) => ({ ...m, canEdit: roleCan(m.role as never, "contacts.edit") }));
}

export async function isEditingMember(db: DB, ws: Workspace, userId: string): Promise<boolean> {
  return (await crmMembers(db, ws)).some((m) => m.id === userId && m.canEdit);
}

// ---------------------------------------------------------------- notes and tasks

export async function contactNotes(db: DB, ws: Workspace, contactId: string): Promise<NoteRow[]> {
  return rows<Record<string, string | boolean | null>>(
    await db.execute(sql`select n.id, n.body, n.pinned, n.created_at, n.updated_at, n.author_user_id, coalesce(u.name, u.email) author
      from contact_notes n left join users u on u.id = n.author_user_id
      where n.workspace_id = ${ws.id} and n.contact_id = ${contactId}::uuid
      order by n.pinned desc, n.created_at desc`),
  ).map((r) => ({
    id: String(r.id),
    body: String(r.body),
    pinned: Boolean(r.pinned),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    authorUserId: (r.author_user_id as string) ?? null,
    authorName: (r.author as string) ?? null,
  }));
}

function toTask(r: Record<string, string | null>, viewer: ContactViewer): TaskRow {
  return {
    id: r.id!,
    title: r.title!,
    dueAt: iso(r.due_at),
    doneAt: iso(r.done_at),
    createdAt: iso(r.created_at)!,
    assigneeUserId: r.assignee_user_id,
    contact: r.contact_id ? { id: r.contact_id, name: r.contact_name, email: displayEmail(r.contact_email, viewer) } : null,
  };
}

const taskSelect = sql`select t.id, t.title, t.due_at, t.done_at, t.created_at, t.assignee_user_id,
  t.contact_id, c.name contact_name, c.email contact_email
  from tasks t left join contacts c on c.id = t.contact_id`;

export async function contactTasks(db: DB, ws: Workspace, contactId: string, viewer: ContactViewer): Promise<TaskRow[]> {
  return rows<Record<string, string | null>>(
    await db.execute(sql`${taskSelect} where t.workspace_id = ${ws.id} and t.contact_id = ${contactId}::uuid
      order by t.done_at is not null, t.due_at nulls last, t.created_at desc`),
  ).map((r) => toTask(r, viewer));
}

/** Open tasks assigned to the user plus the ones they finished in the last 14 days. */
export async function myTasks(db: DB, ws: Workspace, userId: string, viewer: ContactViewer): Promise<TaskRow[]> {
  return rows<Record<string, string | null>>(
    await db.execute(sql`${taskSelect} where t.workspace_id = ${ws.id} and t.assignee_user_id = ${userId}::uuid
      and (t.done_at is null or t.done_at > now() - interval '14 days')
      order by t.done_at is not null, t.due_at nulls last, t.created_at desc limit 500`),
  ).map((r) => toTask(r, viewer));
}

/** Open tasks assigned to the user that are past due (the sidebar badge). */
export async function overdueTaskCount(db: DB, ws: Workspace, userId: string): Promise<number> {
  const [r] = rows<{ cnt: string }>(
    await db.execute(sql`select count(*) cnt from tasks where workspace_id = ${ws.id} and assignee_user_id = ${userId}::uuid
      and done_at is null and due_at < now()`),
  );
  return n(r?.cnt);
}

// ---------------------------------------------------------------- record

const PAGE_VIEW_CAP = 300;

export async function contactRecord(
  db: DB,
  ws: Workspace,
  contactId: string,
  viewer: ContactViewer,
  opts: { withNotes: boolean },
): Promise<ContactRecord | null> {
  const j = await journey(db, ws, contactId);
  if (!j) return null;
  const [base] = rows<{ owner_user_id: string | null }>(
    await db.execute(sql`select owner_user_id from contacts where workspace_id = ${ws.id} and id = ${contactId}::uuid`),
  );
  const rc = ws.reportingCurrency;
  const [tagRows, statRows, viewRows, notes, tasks] = await Promise.all([
    db.execute(sql`select tag from contact_tags where workspace_id = ${ws.id} and contact_id = ${contactId}::uuid order by tag`),
    // Highlights straight from the ledger (not the roll-up), so they are exact right after a change.
    db.execute(sql`
      with rev as (
        select coalesce(sum(amount_minor) filter (where currency = ${rc}), 0) net,
          coalesce(-sum(amount_minor) filter (where type = 'refund' and currency = ${rc}), 0) refunds,
          count(*) filter (where type = 'payment') orders,
          min(occurred_at) filter (where type = 'payment') converted_at,
          max(occurred_at) last_at
        from revenue_events where workspace_id = ${ws.id} and contact_id = ${contactId}::uuid
      ), tp as (
        select count(*) touches, min(t.occurred_at) first_at, max(t.occurred_at) last_at
        from touchpoints t join visitors v on v.id = t.visitor_id
        where t.workspace_id = ${ws.id} and v.contact_id = ${contactId}::uuid
      ), vis as (
        select max(last_seen_at) last_seen from visitors where workspace_id = ${ws.id} and contact_id = ${contactId}::uuid
      ), ld as (
        select max(occurred_at) last_at from leads where workspace_id = ${ws.id} and contact_id = ${contactId}::uuid
      )
      select rev.net, rev.refunds, rev.orders, tp.touches, s.engagement,
        greatest(vis.last_seen, tp.last_at, rev.last_at, ld.last_at) last_seen_at,
        case when rev.converted_at is not null then greatest(0, floor(extract(epoch from rev.converted_at
          - least(c.first_seen_at, coalesce(tp.first_at, c.first_seen_at))) / 86400))::int end days_to_convert
      from contacts c cross join rev cross join tp cross join vis cross join ld
      left join contact_stats s on s.contact_id = c.id
      where c.workspace_id = ${ws.id} and c.id = ${contactId}::uuid`),
    db.execute(sql`select e.type, e.name, e.url, e.occurred_at from events e join visitors v on v.id = e.visitor_id
      where v.contact_id = ${contactId}::uuid and e.workspace_id = ${ws.id} and e.type in ('page_view', 'custom')
      order by e.occurred_at desc limit ${PAGE_VIEW_CAP + 1}`),
    opts.withNotes ? contactNotes(db, ws, contactId) : Promise.resolve(null),
    opts.withNotes ? contactTasks(db, ws, contactId, viewer) : Promise.resolve(null),
  ]);
  const stat = rows<Record<string, string | number | null>>(statRows)[0];
  const views = rows<{ type: string; name: string | null; url: string | null; occurred_at: string }>(viewRows);
  const capped = views.length > PAGE_VIEW_CAP;

  const pathOf = (url: string | null) => {
    if (!url) return { path: "/", host: null };
    try {
      const u = new URL(url);
      return { path: decodeURIComponent(u.pathname) || "/", host: u.host.replace(/^www\./, "") };
    } catch {
      return { path: url.slice(0, 200), host: null };
    }
  };
  const timeline: TimelineEntry[] = [
    ...j.items,
    ...views.slice(0, PAGE_VIEW_CAP).map((e): TimelineEntry =>
      e.type === "page_view" ? { kind: "page_view", at: iso(e.occurred_at)!, ...pathOf(e.url) } : { kind: "event", at: iso(e.occurred_at)!, name: e.name ?? "Custom event" },
    ),
    ...(notes ?? []).map((note): TimelineEntry => ({ kind: "note", at: note.createdAt, note })),
    ...(tasks ?? []).map((task): TimelineEntry => ({ kind: "task", at: task.doneAt ?? task.createdAt, task })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const first = j.items.find((i) => i.kind === "touchpoint");
  const firstLead = j.items.find((i) => i.kind === "lead");
  const firstPayment = j.items.find((i) => i.kind === "payment");
  return {
    contact: {
      id: j.contact.id,
      name: j.contact.name,
      email: displayEmail(j.contact.email, viewer),
      lifecycle: j.contact.lifecycle as Lifecycle,
      firstSeenAt: j.contact.firstSeenAt,
      ownerUserId: base?.owner_user_id ?? null,
      devices: j.contact.devices,
    },
    tags: rows<{ tag: string }>(tagRows).map((t) => t.tag),
    highlights: {
      revenueMinor: n(stat?.net),
      refundsMinor: n(stat?.refunds),
      orders: n(stat?.orders),
      touches: n(stat?.touches),
      daysToConvert: nn(stat?.days_to_convert),
      lastSeenAt: iso(stat?.last_seen_at),
      engagement: nn(stat?.engagement),
      firstTouch:
        first?.kind === "touchpoint"
          ? { platform: first.platform, channel: first.channel, campaign: first.campaign, landingPath: first.landingUrl ? pathOf(first.landingUrl).path : null }
          : null,
      firstLeadAt: firstLead?.at ?? null,
      convertedAt: firstPayment?.at ?? null,
    },
    timeline,
    pageViewsCapped: capped,
    notes,
    tasks,
    credits: j.credits,
    currency: rc,
    timezone: ws.timezone,
  };
}

/** What the signed-in viewer may do on CRM surfaces. */
export function crmAbilities(user: { role: string; can: (p: Permission) => boolean }): CrmAbilities {
  return {
    edit: user.can("contacts.edit"),
    notes: user.can("contacts.notes"),
    moderate: user.role === "owner" || user.role === "admin",
    // TODO(integration): switch to the security slice's `contacts.export` permission once merged.
    export: user.can("reports.export"),
    delete: user.can("workspace.data"),
  };
}

/** The viewer's saved views on the Contacts table, oldest first (tab order). */
export async function listContactViews(db: DB, ws: Workspace, userId: string): Promise<ContactView[]> {
  return rows<{ id: string; name: string; filters: Record<string, string> }>(
    await db.execute(sql`select id, name, filters from contact_views where workspace_id = ${ws.id} and user_id = ${userId}::uuid order by created_at, id`),
  ).map((v) => ({ id: v.id, name: v.name, filters: v.filters ?? {} }));
}

/** Tags in use in the workspace, most used first (tag pickers). */
export async function workspaceTags(db: DB, ws: Workspace): Promise<{ tag: string; count: number }[]> {
  return rows<{ tag: string; cnt: string }>(
    await db.execute(sql`select tag, count(*) cnt from contact_tags where workspace_id = ${ws.id} group by 1 order by 2 desc, 1 limit 200`),
  ).map((r) => ({ tag: r.tag, count: n(r.cnt) }));
}

/** Contacts (by id) that exist in the workspace. Guards every write against cross-tenant ids. */
export async function ownedContactIds(db: DB, ws: Workspace, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  return rows<{ id: string }>(
    await db.execute(sql`select id from contacts where workspace_id = ${ws.id} and id in (${uuidList(ids)})`),
  ).map((r) => r.id);
}
