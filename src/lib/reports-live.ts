import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { Channel, Platform } from "./db/schema";
import type { Workspace } from "./settings";

// Live view numbers. Like reports.ts, every number is computed in SQL; this file only
// shapes rows. Everything returned here is safe to stream to the browser: counts, ids,
// amounts and masked labels. Raw emails and phones never leave this module (see maskPerson).
//
// Definitions (all "today" windows run from local midnight in the workspace timezone to now):
// - visitors now      distinct visitors with any pixel event in the last 5 minutes
// - visitors          distinct visitors with any event in the window
// - leads             distinct contacts with a lead in the window (repeat form fills count once)
// - customers         contacts whose first-ever payment falls in the window
// - revenue           payments + refunds (refunds are stored negative) in the reporting currency
// - spend             ad_insights_daily for today's date. Ad platforms report spend per day, so
//                     "same time yesterday" is yesterday's full-day spend scaled by the share of
//                     the day that has passed (flagged as `spendComparison: "prorated"`).

export const LIVE_WINDOW_MINUTES = 5;
/** Top pages and sources look at the last half hour, like "right now" in most analytics tools. */
export const ACTIVE_WINDOW_MINUTES = 30;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export type LiveDay = {
  visitors: number;
  pageviews: number;
  leads: number;
  customers: number;
  orders: number;
  revenueMinor: number;
  refundsMinor: number;
  spendMinor: number;
};

export type LiveHour = {
  hour: number;
  today: { visitors: number; leads: number; revenueMinor: number; revenueCumMinor: number } | null;
  yesterday: { visitors: number; leads: number; revenueMinor: number; revenueCumMinor: number };
};

export type LiveSnapshot = {
  asOf: string;
  currency: string;
  timezone: string;
  windowMinutes: number;
  visitorsNow: number;
  /** Visitors in the 5 minutes before the live window (for a small trend arrow). */
  visitorsPrev: number;
  /** Distinct visitors per minute over the last 30 minutes, oldest first (30 entries; the last is the current minute). */
  visitorsByMinute: number[];
  today: LiveDay;
  sameTimeYesterday: LiveDay;
  yesterdaySpendMinor: number;
  spendComparison: "prorated";
  /** Today's net revenue ÷ today's spend (blended, like the Overview), null without spend. */
  roasToday: number | null;
  /** Share of the local day that has passed (0–1). */
  dayFraction: number;
  /** Local hour now (0–23) in the workspace timezone. */
  currentHour: number;
  hourly: LiveHour[];
  topPages: { path: string; visitors: number }[];
  topSources: { channel: Channel | "direct"; platform: Platform | null; visitors: number }[];
};

/** Bounds of today and yesterday in the workspace timezone, all as timestamptz. */
function bounds(ws: Workspace, now: Date) {
  const at = now.toISOString();
  return sql`
    select
      ${at}::timestamptz as now_ts,
      (date_trunc('day', ${at}::timestamptz at time zone ${ws.timezone}) at time zone ${ws.timezone}) as today_start,
      ((date_trunc('day', ${at}::timestamptz at time zone ${ws.timezone}) + interval '1 day') at time zone ${ws.timezone}) as tomorrow_start,
      ((date_trunc('day', ${at}::timestamptz at time zone ${ws.timezone}) - interval '1 day') at time zone ${ws.timezone}) as yday_start,
      ((${at}::timestamptz at time zone ${ws.timezone} - interval '1 day') at time zone ${ws.timezone}) as yday_now,
      (${at}::timestamptz at time zone ${ws.timezone})::date as today_date,
      extract(hour from ${at}::timestamptz at time zone ${ws.timezone})::int as cur_hour`;
}

/** One SQL round trip for the counters (visitors now, today vs same time yesterday, spend). */
async function counters(db: DB, ws: Workspace, now: Date) {
  const rc = ws.reportingCurrency;
  const day = (from: SQL, to: SQL, prefix: string) => sql`
    (select count(distinct visitor_id) from events
      where workspace_id = ${ws.id} and occurred_at >= ${from} and occurred_at < ${to}) as ${sql.raw(prefix)}_visitors,
    (select count(*) from events
      where workspace_id = ${ws.id} and type = 'page_view' and occurred_at >= ${from} and occurred_at < ${to}) as ${sql.raw(prefix)}_pageviews,
    (select count(distinct contact_id) from leads
      where workspace_id = ${ws.id} and occurred_at >= ${from} and occurred_at < ${to}) as ${sql.raw(prefix)}_leads,
    (select count(distinct r.contact_id) from revenue_events r
      where r.workspace_id = ${ws.id} and r.type = 'payment' and r.contact_id is not null
        and r.occurred_at >= ${from} and r.occurred_at < ${to}
        and not exists (
          select 1 from revenue_events p
          where p.contact_id = r.contact_id and p.workspace_id = r.workspace_id and p.type = 'payment'
            and (p.occurred_at < r.occurred_at or (p.occurred_at = r.occurred_at and p.id < r.id))
        )) as ${sql.raw(prefix)}_customers,
    (select count(*) from revenue_events
      where workspace_id = ${ws.id} and type = 'payment' and currency = ${rc}
        and occurred_at >= ${from} and occurred_at < ${to}) as ${sql.raw(prefix)}_orders,
    (select coalesce(sum(amount_minor), 0) from revenue_events
      where workspace_id = ${ws.id} and currency = ${rc}
        and occurred_at >= ${from} and occurred_at < ${to}) as ${sql.raw(prefix)}_revenue,
    (select coalesce(sum(amount_minor), 0) from revenue_events
      where workspace_id = ${ws.id} and type = 'refund' and currency = ${rc}
        and occurred_at >= ${from} and occurred_at < ${to}) as ${sql.raw(prefix)}_refunds`;
  // "Now" is inclusive: an event stamped exactly at `now` counts, so windows end at now + 1µs.
  const [r] = rows<Record<string, string | number | null>>(
    await db.execute(sql`
      with b as (${bounds(ws, now)})
      select
        b.cur_hour,
        extract(epoch from b.now_ts - b.today_start) / nullif(extract(epoch from b.tomorrow_start - b.today_start), 0) as day_fraction,
        (select count(distinct visitor_id) from events
          where workspace_id = ${ws.id} and occurred_at > b.now_ts - make_interval(mins => ${LIVE_WINDOW_MINUTES})
            and occurred_at <= b.now_ts) as visitors_now,
        (select count(distinct visitor_id) from events
          where workspace_id = ${ws.id} and occurred_at > b.now_ts - make_interval(mins => ${LIVE_WINDOW_MINUTES * 2})
            and occurred_at <= b.now_ts - make_interval(mins => ${LIVE_WINDOW_MINUTES})) as visitors_prev,
        ${day(sql`b.today_start`, sql`b.now_ts + interval '1 microsecond'`, "t")},
        ${day(sql`b.yday_start`, sql`b.yday_now + interval '1 microsecond'`, "y")},
        (select coalesce(sum(spend_minor), 0) from ad_insights_daily
          where workspace_id = ${ws.id} and date = b.today_date and currency = ${rc}) as t_spend,
        (select coalesce(sum(spend_minor), 0) from ad_insights_daily
          where workspace_id = ${ws.id} and date = b.today_date - 1 and currency = ${rc}) as y_spend_full
      from b`),
  );
  return r;
}

async function hourly(db: DB, ws: Workspace, now: Date): Promise<LiveHour[]> {
  const rc = ws.reportingCurrency;
  const result = rows<Record<string, string | number | null>>(
    await db.execute(sql`
      with b as (${bounds(ws, now)}),
      hours as (select generate_series(0, 23) as h),
      v as (
        select (occurred_at >= b.today_start) as is_today,
          extract(hour from occurred_at at time zone ${ws.timezone})::int as h,
          count(distinct visitor_id) as visitors
        from events, b
        where workspace_id = ${ws.id} and occurred_at >= b.yday_start and occurred_at <= b.now_ts
        group by 1, 2
      ),
      l as (
        select (occurred_at >= b.today_start) as is_today,
          extract(hour from occurred_at at time zone ${ws.timezone})::int as h,
          count(distinct contact_id) as leads
        from leads, b
        where workspace_id = ${ws.id} and occurred_at >= b.yday_start and occurred_at <= b.now_ts
        group by 1, 2
      ),
      r as (
        select (occurred_at >= b.today_start) as is_today,
          extract(hour from occurred_at at time zone ${ws.timezone})::int as h,
          sum(amount_minor) as revenue
        from revenue_events, b
        where workspace_id = ${ws.id} and currency = ${rc} and occurred_at >= b.yday_start and occurred_at <= b.now_ts
        group by 1, 2
      ),
      grid as (
        select hours.h,
          coalesce(vt.visitors, 0) t_visitors, coalesce(lt.leads, 0) t_leads, coalesce(rt.revenue, 0) t_revenue,
          coalesce(vy.visitors, 0) y_visitors, coalesce(ly.leads, 0) y_leads, coalesce(ry.revenue, 0) y_revenue
        from hours
        left join v vt on vt.h = hours.h and vt.is_today
        left join v vy on vy.h = hours.h and not vy.is_today
        left join l lt on lt.h = hours.h and lt.is_today
        left join l ly on ly.h = hours.h and not ly.is_today
        left join r rt on rt.h = hours.h and rt.is_today
        left join r ry on ry.h = hours.h and not ry.is_today
      )
      select grid.*, b.cur_hour,
        sum(t_revenue) over (order by grid.h) as t_revenue_cum,
        sum(y_revenue) over (order by grid.h) as y_revenue_cum
      from grid, b
      order by grid.h`),
  );
  return result.map((r) => ({
    hour: n(r.h),
    today:
      n(r.h) <= n(r.cur_hour)
        ? { visitors: n(r.t_visitors), leads: n(r.t_leads), revenueMinor: n(r.t_revenue), revenueCumMinor: n(r.t_revenue_cum) }
        : null,
    yesterday: { visitors: n(r.y_visitors), leads: n(r.y_leads), revenueMinor: n(r.y_revenue), revenueCumMinor: n(r.y_revenue_cum) },
  }));
}

/** Distinct visitors in each of the last 30 minutes (index 29 = the minute ending now). */
async function visitorsByMinute(db: DB, ws: Workspace, now: Date): Promise<number[]> {
  const at = now.toISOString();
  const result = rows<{ i: string | number; visitors: string | number }>(
    await db.execute(sql`
      select ${ACTIVE_WINDOW_MINUTES - 1} - floor(extract(epoch from ${at}::timestamptz - occurred_at) / 60)::int as i,
        count(distinct visitor_id) as visitors
      from events
      where workspace_id = ${ws.id}
        and occurred_at > ${at}::timestamptz - make_interval(mins => ${ACTIVE_WINDOW_MINUTES})
        and occurred_at <= ${at}::timestamptz
      group by 1`),
  );
  const out = Array.from({ length: ACTIVE_WINDOW_MINUTES }, () => 0);
  for (const r of result) {
    const i = n(r.i);
    if (i >= 0 && i < ACTIVE_WINDOW_MINUTES) out[i] = n(r.visitors);
  }
  return out;
}

/** Pages with the most distinct visitors in the last 30 minutes. Paths only: no query string or fragment. */
async function topPages(db: DB, ws: Workspace, now: Date, limit = 8) {
  const result = rows<{ path: string; visitors: string | number }>(
    await db.execute(sql`
      select path, count(distinct visitor_id) as visitors from (
        select visitor_id,
          coalesce(nullif(regexp_replace(regexp_replace(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*', ''), '[?#].*$', ''), ''), '/') as path
        from events
        where workspace_id = ${ws.id} and type = 'page_view' and url is not null
          and occurred_at > ${now.toISOString()}::timestamptz - make_interval(mins => ${ACTIVE_WINDOW_MINUTES})
          and occurred_at <= ${now.toISOString()}::timestamptz
      ) p
      group by path
      order by visitors desc, path
      limit ${limit}`),
  );
  return result.map((r) => ({ path: safePath(r.path) ?? "/", visitors: n(r.visitors) }));
}

/** Where the visitors of the last 30 minutes came from (their latest touchpoint in the prior 24 hours). */
async function topSources(db: DB, ws: Workspace, now: Date, limit = 6) {
  const at = now.toISOString();
  const result = rows<{ channel: string | null; platform: Platform | null; visitors: string | number }>(
    await db.execute(sql`
      with active as (
        select distinct visitor_id from events
        where workspace_id = ${ws.id}
          and occurred_at > ${at}::timestamptz - make_interval(mins => ${ACTIVE_WINDOW_MINUTES})
          and occurred_at <= ${at}::timestamptz
      )
      select coalesce(tp.channel, 'direct') as channel, tp.platform, count(*) as visitors
      from active a
      left join lateral (
        select t.channel, t.platform from touchpoints t
        where t.visitor_id = a.visitor_id and t.workspace_id = ${ws.id}
          and t.occurred_at <= ${at}::timestamptz and t.occurred_at > ${at}::timestamptz - interval '1 day'
        order by t.occurred_at desc limit 1
      ) tp on true
      group by 1, 2
      order by visitors desc, 1, 2
      limit ${limit}`),
  );
  return result.map((r) => ({ channel: (r.channel ?? "direct") as Channel | "direct", platform: r.platform, visitors: n(r.visitors) }));
}

export async function liveSnapshot(db: DB, ws: Workspace, now = new Date()): Promise<LiveSnapshot> {
  // Independent queries: parallel on a Postgres pool (PGlite serialises them, which is fine).
  const [c, h, perMinute, pages, sources] = await Promise.all([
    counters(db, ws, now),
    hourly(db, ws, now),
    visitorsByMinute(db, ws, now),
    topPages(db, ws, now),
    topSources(db, ws, now),
  ]);
  const day = (p: "t" | "y", spendMinor: number): LiveDay => ({
    visitors: n(c[`${p}_visitors`]),
    pageviews: n(c[`${p}_pageviews`]),
    leads: n(c[`${p}_leads`]),
    customers: n(c[`${p}_customers`]),
    orders: n(c[`${p}_orders`]),
    revenueMinor: n(c[`${p}_revenue`]),
    refundsMinor: n(c[`${p}_refunds`]),
    spendMinor,
  });
  const fraction = Math.min(1, Math.max(0, n(c.day_fraction)));
  const yesterdaySpend = n(c.y_spend_full);
  const todaySpend = n(c.t_spend);
  return {
    asOf: now.toISOString(),
    currency: ws.reportingCurrency,
    timezone: ws.timezone,
    windowMinutes: LIVE_WINDOW_MINUTES,
    visitorsNow: n(c.visitors_now),
    visitorsPrev: n(c.visitors_prev),
    visitorsByMinute: perMinute,
    today: day("t", todaySpend),
    // Integer minor units: the prorated figure is rounded to the nearest minor unit.
    sameTimeYesterday: day("y", Math.round(yesterdaySpend * fraction)),
    yesterdaySpendMinor: yesterdaySpend,
    spendComparison: "prorated",
    roasToday: todaySpend > 0 ? n(c.t_revenue) / todaySpend : null,
    dayFraction: fraction,
    currentHour: n(c.cur_hour),
    hourly: h,
    topPages: pages,
    topSources: sources,
  };
}

/** Just the sidebar pulse: today's net revenue and visitors now (cheap enough for every page load). */
export async function livePulse(db: DB, ws: Workspace, now = new Date()) {
  const [r] = rows<{ revenue: string | number; visitors_now: string | number }>(
    await db.execute(sql`
      with b as (${bounds(ws, now)})
      select
        (select coalesce(sum(amount_minor), 0) from revenue_events
          where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency}
            and occurred_at >= b.today_start and occurred_at <= b.now_ts) as revenue,
        (select count(distinct visitor_id) from events
          where workspace_id = ${ws.id} and occurred_at > b.now_ts - make_interval(mins => ${LIVE_WINDOW_MINUTES})
            and occurred_at <= b.now_ts) as visitors_now
      from b`),
  );
  return { revenueMinor: n(r?.revenue), visitorsNow: n(r?.visitors_now), currency: ws.reportingCurrency };
}

// ---------------------------------------------------------------- feed

export type LiveFeedKind = "ad_click" | "visit" | "lead" | "payment" | "refund";

export type LiveFeedItem = {
  /** Stable key, e.g. `lead:<uuid>`. */
  key: string;
  kind: LiveFeedKind;
  /** When it happened (ISO). */
  at: string;
  platform: Platform | null;
  channel: Channel | null;
  /** Campaign name, or the utm_campaign when the campaign isn't synced. */
  campaign: string | null;
  /** Landing path for visits (no query string), sanitised. */
  path: string | null;
  /** Masked person label, e.g. "P. S." or "p•••@gmail.com". Never a raw email, phone or full name. */
  who: string | null;
  /** One or two letters for an avatar. */
  initials: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** Revenue source ("stripe", "shopify"…) or lead source ("pixel", "webhook"…). */
  provider: string | null;
  /** Lead form name, sanitised. */
  form: string | null;
};

type FeedRow = {
  key: string;
  kind: LiveFeedKind;
  at_ts: string | Date;
  platform: Platform | null;
  channel: Channel | null;
  campaign: string | null;
  url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  amount_minor: string | number | null;
  currency: string | null;
  provider: string | null;
  form: string | null;
};

export type FeedWindow =
  /** The most recent items (page load / reset). */
  | { mode: "latest"; limit?: number }
  /** Items that arrived (created_at) after `since`, for the live poll and reconnects. */
  | { mode: "since"; since: string; limit?: number };

/** Cursor format: an ISO timestamp with microseconds, taken from the database clock. */
export const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
/** Rows commit a little after their created_at (transaction start); poll this far back and de-duplicate by key. */
export const CURSOR_LOOKBACK_SECONDS = 10;

/**
 * Live feed: ad clicks and visits (session starts from the pixel), leads, payments and refunds.
 * Returns items newest first, plus the cursor to resume from (the database clock at query time).
 */
export async function liveFeed(db: DB, ws: Workspace, window: FeedWindow, now = new Date()): Promise<{ items: LiveFeedItem[]; cursor: string }> {
  const at = now.toISOString();
  const limit = Math.min(Math.max(window.limit ?? 40, 1), 200);
  const since = window.mode === "since" ? window.since : null;
  // Pixel traffic arrives in real time (collect clamps timestamps to now), so the high-volume
  // events branch only ever looks at a short occurred_at range and stays on the (workspace_id, occurred_at) index.
  const eventsFrom = since ? sql`${at}::timestamptz - interval '15 minutes'` : sql`${at}::timestamptz - interval '2 hours'`;
  const otherFrom = sql`${at}::timestamptz - interval '1 day'`;
  const arrived = (col: string) =>
    since ? sql`and ${sql.raw(col)} > ${since}::timestamptz - make_interval(secs => ${CURSOR_LOOKBACK_SECONDS})` : sql``;
  const order = since ? sql`order by created_at desc` : sql`order by at_ts desc`;

  const result = rows<FeedRow & { created_at: string | Date }>(
    await db.execute(sql`
      with visits as (
        select 'visit:' || e.id::text as key,
          (case when tp.platform is not null or tp.click_id is not null then 'ad_click' else 'visit' end) as kind,
          e.occurred_at as at_ts, e.created_at,
          tp.platform, tp.channel, coalesce(c.name, tp.utm_campaign) as campaign, e.url,
          null::text as contact_name, null::text as contact_email, null::bigint as amount_minor, null::text as currency,
          null::text as provider, null::text as form
        from events e
        left join lateral (
          select t.platform, t.channel, t.click_id, t.utm_campaign, t.campaign_id from touchpoints t
          where t.visitor_id = e.visitor_id and t.occurred_at = e.occurred_at
          order by t.created_at desc limit 1
        ) tp on true
        left join campaigns c on c.id = tp.campaign_id
        where e.workspace_id = ${ws.id} and e.type = 'page_view'
          and e.occurred_at >= ${eventsFrom} and e.occurred_at <= ${at}::timestamptz ${arrived("e.created_at")}
          -- a visit = a session start (no page view in the previous 30 minutes) or a fresh ad/UTM touch
          and (tp.channel is not null or not exists (
            select 1 from events p
            where p.visitor_id = e.visitor_id and p.type = 'page_view'
              and p.occurred_at < e.occurred_at and p.occurred_at >= e.occurred_at - interval '30 minutes'
          ))
        order by ${since ? sql`e.created_at` : sql`e.occurred_at`} desc
        limit ${limit}
      ),
      lead_rows as (
        select 'lead:' || l.id::text as key, 'lead' as kind, l.occurred_at as at_ts, l.created_at,
          tp.platform, tp.channel, coalesce(c.name, tp.utm_campaign) as campaign, null::text as url,
          ct.name as contact_name, ct.email as contact_email, null::bigint as amount_minor, null::text as currency,
          l.source as provider, l.form_name as form
        from leads l
        join contacts ct on ct.id = l.contact_id
        left join lateral (
          select t.platform, t.channel, t.utm_campaign, t.campaign_id from touchpoints t
          join visitors v on v.id = t.visitor_id
          where v.contact_id = l.contact_id and v.workspace_id = ${ws.id} and t.occurred_at <= l.occurred_at
          order by t.occurred_at desc limit 1
        ) tp on true
        left join campaigns c on c.id = tp.campaign_id
        where l.workspace_id = ${ws.id} and l.occurred_at >= ${otherFrom} and l.occurred_at <= ${at}::timestamptz ${arrived("l.created_at")}
        order by ${since ? sql`l.created_at` : sql`l.occurred_at`} desc
        limit ${limit}
      ),
      money_rows as (
        select r.type || ':' || r.id::text as key, r.type as kind, r.occurred_at as at_ts, r.created_at,
          tp.platform, tp.channel, coalesce(c.name, tp.utm_campaign) as campaign, null::text as url,
          ct.name as contact_name, ct.email as contact_email, r.amount_minor, r.currency,
          r.source as provider, null::text as form
        from revenue_events r
        left join contacts ct on ct.id = r.contact_id
        -- first touch: the journey that brought this customer in
        left join lateral (
          select t.platform, t.channel, t.utm_campaign, t.campaign_id from touchpoints t
          join visitors v on v.id = t.visitor_id
          where r.contact_id is not null and v.contact_id = r.contact_id and v.workspace_id = ${ws.id}
            and t.occurred_at <= r.occurred_at
          order by t.occurred_at asc limit 1
        ) tp on true
        left join campaigns c on c.id = tp.campaign_id
        where r.workspace_id = ${ws.id} and r.occurred_at >= ${otherFrom} and r.occurred_at <= ${at}::timestamptz ${arrived("r.created_at")}
        order by ${since ? sql`r.created_at` : sql`r.occurred_at`} desc
        limit ${limit}
      )
      select * from (
        select * from visits union all select * from lead_rows union all select * from money_rows
      ) feed
      ${order}, key
      limit ${limit}`),
  );
  const cursor = await liveCursor(db);
  const items = result.map(toFeedItem);
  if (since) items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items, cursor };
}

/** The database clock as a feed cursor (microsecond ISO string). */
export async function liveCursor(db: DB): Promise<string> {
  const [clock] = rows<{ cursor: string }>(
    await db.execute(sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor`),
  );
  return clock.cursor;
}

function toFeedItem(r: FeedRow): LiveFeedItem {
  const person = r.kind === "lead" || r.kind === "payment" || r.kind === "refund" ? maskPerson({ name: r.contact_name, email: r.contact_email }) : null;
  return {
    key: r.key,
    kind: r.kind,
    at: new Date(r.at_ts).toISOString(),
    platform: r.platform,
    channel: r.channel,
    campaign: safeLabel(r.campaign),
    path: r.url ? safePath(r.url) : null,
    who: person?.label ?? null,
    initials: person?.initials ?? null,
    amountMinor: r.amount_minor === null ? null : n(r.amount_minor),
    currency: r.currency,
    provider: r.provider?.slice(0, 40) ?? null,
    form: safeLabel(r.form),
  };
}

// ---------------------------------------------------------------- PII masking

const EMAIL_RE = /[^\s@/?#&=]+@[^\s@/?#&=]+\.[^\s@/?#&=]+/g;
// 7+ digits with optional separators: phone numbers, order numbers and the like.
const LONG_DIGITS_RE = /\+?\d[\d\s().-]{5,}\d/g;
const WEBMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com",
  "proton.me", "protonmail.com", "aol.com", "gmx.com", "zoho.com", "yandex.com", "mail.com", "rediffmail.com",
]);

/** Remove anything that looks like an email address or phone number from free text. */
export function scrubText(s: string): string {
  return s.replace(EMAIL_RE, "•••").replace(LONG_DIGITS_RE, (m) => (m.replace(/\D/g, "").length >= 7 ? "•••" : m));
}

/** Campaign and form names: drop email addresses (digits stay: "Sale 2026-27" is not a phone number). */
function safeLabel(s: string | null): string | null {
  if (!s) return null;
  const out = s.replace(EMAIL_RE, "•••").trim().slice(0, 120);
  return out || null;
}

/** Path of a URL (no scheme, host, query or fragment), scrubbed and capped. */
export function safePath(url: string): string | null {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").replace(/[?#].*$/, "");
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the encoded form */
  }
  path = scrubText(path || "/");
  return path.length > 80 ? `${path.slice(0, 79)}…` : path;
}

/**
 * A label that lets you tell people apart in the feed without exposing who they are:
 * initials from the name ("Priya Shah" → "P. S."), else a masked email ("p•••@gmail.com";
 * company domains are masked too, "p•••@•••"). Never returns a raw email, phone or full name.
 */
export function maskPerson(p: { name?: string | null; email?: string | null }): { label: string; initials: string } | null {
  const name = (p.name ?? "").replace(EMAIL_RE, "").replace(/[^\p{L}\s'-]/gu, " ").trim();
  if (name) {
    const parts = name
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}]+/u, ""))
      .filter(Boolean);
    const letters = [parts[0], parts.length > 1 ? parts.at(-1) : undefined]
      .filter((x): x is string => !!x)
      .map((w) => w[0]!.toLocaleUpperCase());
    if (letters.length) return { label: letters.map((l) => `${l}.`).join(" "), initials: letters.join("") };
  }
  const email = (p.email ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at > 0) {
    const first = email[0]!;
    const domain = email.slice(at + 1);
    return { label: `${first}•••@${WEBMAIL.has(domain) ? domain : "•••"}`, initials: first.toLocaleUpperCase() };
  }
  return null;
}
