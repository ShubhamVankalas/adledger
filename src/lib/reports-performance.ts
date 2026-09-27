import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { Platform } from "./db/schema";
import { maskEmail, tsRange, type PerfLevel, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

// Performance v2: the ads table with every column the Display menu offers, totals, period
// comparison, the Scale / Test / Fix / Kill quadrant and the row peek. All numbers come from
// SQL here; the UI only formats them.
//
// Definitions (per campaign, ad set or ad, in the reporting currency, for the chosen model):
//   CTR = clicks ÷ impressions · CPM = spend ÷ impressions × 1,000 · CPC = spend ÷ clicks
//   CVR = credited leads ÷ clicks · lead → customer = credited customers ÷ credited leads
//   purchases = credited payments · AOV = credited gross payments ÷ purchases
//   NC-ROAS = credited revenue of each customer's first payment ÷ spend
//   platform conversions = what the ad platform reported (its own attribution)
//   verified conversions = credited leads + credited new customers (what AdLedger could match)
//   platform gap = (platform − verified) ÷ verified, e.g. +129% when Meta claims 94 and we saw 41

/** An inclusive comparison window (see comparisonRange in period-presets.ts). */
export type ComparisonWindow = { start: string; end: string };

export const PERF_METRIC_KEYS = [
  "spendMinor",
  "impressions",
  "clicks",
  "ctr",
  "cpmMinor",
  "cpcMinor",
  "leads",
  "cplMinor",
  "cvr",
  "customers",
  "cacMinor",
  "leadToCustomer",
  "purchases",
  "revenueMinor",
  "aovMinor",
  "roas",
  "newCustomerRevenueMinor",
  "ncRoas",
  "platformConversions",
  "verifiedConversions",
  "platformGap",
] as const;
export type PerfMetricKey = (typeof PERF_METRIC_KEYS)[number];
export type PerfMetrics = Record<PerfMetricKey, number | null>;
export type PerfDeltas = Partial<Record<PerfMetricKey, number | null>>;
export type Quadrant = "scale" | "test" | "fix" | "kill";

export type PerfRowV2 = PerfMetrics & {
  id: string;
  name: string;
  platform: Platform;
  status: string | null;
  parentId: string | null;
  parentName: string | null;
  /** Change vs the comparison period per metric (ratio, 0.12 = +12%); null when not comparable. */
  delta: PerfDeltas | null;
  quadrant: Quadrant | null;
};

export type PerformanceReport = {
  level: PerfLevel;
  rows: PerfRowV2[];
  totals: PerfMetrics & { count: number };
  totalsDelta: PerfDeltas | null;
  /** The comparison window the deltas were computed against, or null when compare is off. */
  compare: ComparisonWindow | null;
  /** Where the quadrant chart splits: median spend of rows with spend, and the ROAS bar. */
  split: { spendMinor: number; roas: number };
};

export type PerfQuery = ReportParams & {
  level: PerfLevel;
  parentId?: string;
  /** Case-insensitive name filter (entity or parent name). */
  q?: string;
  /** Compare against this window (from the filter bar's ?compare=); omit or null for no deltas. */
  comparison?: ComparisonWindow | null;
  /** ROAS the quadrant splits on (a workspace target when one exists; break-even 1.0 otherwise). */
  roasSplit?: number;
};

const LEVELS = {
  campaign: { table: "campaigns", key: "campaign_id", parent: null, parentTable: null },
  ad_group: { table: "ad_groups", key: "ad_group_id", parent: "campaign_id", parentTable: "campaigns" },
  ad: { table: "ads", key: "ad_id", parent: "ad_group_id", parentTable: "ad_groups" },
} as const;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round2 = (v: number) => Math.round(v * 100) / 100;
const minor = (a: number, b: number) => (b > 0 ? Math.round(a / b) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | null>;

/** Turn summed SQL columns into the full metric set (shared by rows and totals). */
function metricsFrom(r: Raw): PerfMetrics {
  const spend = n(r.spend);
  const imp = n(r.imp);
  const clicks = n(r.clicks);
  const leads = round2(n(r.leads));
  const customers = round2(n(r.customers));
  const revenue = n(r.revenue);
  const purchases = round2(n(r.purchases));
  const gross = n(r.gross);
  const nc = n(r.nc_revenue);
  const platform = round2(n(r.platform_conv));
  const verified = round2(n(r.leads) + n(r.customers));
  return {
    spendMinor: spend,
    impressions: imp,
    clicks,
    ctr: ratio(clicks, imp),
    cpmMinor: imp > 0 ? Math.round((spend * 1000) / imp) : null,
    cpcMinor: minor(spend, clicks),
    leads,
    cplMinor: minor(spend, n(r.leads)),
    cvr: ratio(n(r.leads), clicks),
    customers,
    cacMinor: minor(spend, n(r.customers)),
    leadToCustomer: ratio(n(r.customers), n(r.leads)),
    purchases,
    revenueMinor: revenue,
    aovMinor: minor(gross, n(r.purchases)),
    roas: ratio(revenue, spend),
    newCustomerRevenueMinor: nc,
    ncRoas: ratio(nc, spend),
    platformConversions: platform,
    verifiedConversions: verified,
    // No gap when the platform reports nothing (it may simply not track conversions) or we saw nothing.
    platformGap: platform > 0 && verified > 0 ? (platform - verified) / verified : null,
  };
}

const toRow = (r: Raw, m: PerfMetrics = metricsFrom(r)) => ({
  id: r.id!,
  name: r.name!,
  platform: r.platform as Platform,
  status: r.status,
  parentId: r.parent_id,
  parentName: r.parent_name,
  ...m,
});

type LevelQuery = PerfQuery & {
  /** Only this entity (the peek): filtered inside the CTEs too, so only its rows are summed. */
  id?: string;
};

/** One row per entity with summed inputs; shared by the row and totals queries. */
function baseQuery(ws: Workspace, p: LevelQuery): SQL {
  const rc = ws.reportingCurrency;
  const cfg = LEVELS[p.level];
  const key = sql.raw(cfg.key);
  const parentSel = parentSelFor(cfg);
  const parentJoin = cfg.parentTable ? sql.raw(`left join ${cfg.parentTable} pe on pe.id = e.${cfg.parent}`) : sql``;
  const parentWhere = p.parentId && cfg.parent ? sql`and e.${sql.raw(cfg.parent)} = ${p.parentId}::uuid` : sql``;
  const platformWhere = p.platform ? sql`and e.platform = ${p.platform}` : sql``;
  const idS = p.id ? sql`and ${key} = ${p.id}::uuid` : sql``;
  const idC = p.id ? sql`and ac.${key} = ${p.id}::uuid` : sql``;
  const idE = p.id ? sql`and e.id = ${p.id}::uuid` : sql``;
  const q = p.q?.trim().slice(0, 200);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const nameWhere = like
    ? cfg.parentTable
      ? sql`and (e.name ilike ${like} or pe.name ilike ${like})`
      : sql`and e.name ilike ${like}`
    : sql``;

  return sql`
    with s as (
      select ${key} as id, sum(spend_minor) spend, sum(impressions) imp, sum(clicks) clicks,
        sum(platform_conversions) platform_conv
      from ad_insights_daily
      where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc} ${idS}
      group by 1
    ), fp as (
      -- A customer conversion's id is the contact's first payment, so these are "new customer" payments.
      select distinct conversion_id id from attribution_credits
      where workspace_id = ${ws.id} and model = ${p.model} and conversion_type = 'customer'
        and ${tsRange(sql`conversion_at`, ws, p)}
    ), c as (
      select ac.${key} as id,
        sum(ac.credit) filter (where ac.conversion_type = 'lead') leads,
        sum(ac.credit) filter (where ac.conversion_type = 'customer') customers,
        sum(ac.revenue_minor) filter (where ac.conversion_type = 'revenue' and ac.currency = ${rc}) revenue,
        sum(ac.credit) filter (where ac.conversion_type = 'revenue' and ac.currency = ${rc} and ac.revenue_minor > 0) purchases,
        sum(ac.revenue_minor) filter (where ac.conversion_type = 'revenue' and ac.currency = ${rc} and ac.revenue_minor > 0) gross,
        sum(ac.revenue_minor) filter (where ac.conversion_type = 'revenue' and ac.currency = ${rc} and fp.id is not null) nc_revenue
      from attribution_credits ac
      left join fp on fp.id = ac.conversion_id
      where ac.workspace_id = ${ws.id} and ac.model = ${p.model} and ac.${key} is not null
        and ${tsRange(sql`ac.conversion_at`, ws, p)} ${idC}
      group by 1
    ), base as (
      select e.id, e.name, e.platform, e.status, ${parentSel},
        coalesce(s.spend, 0) spend, coalesce(s.imp, 0) imp, coalesce(s.clicks, 0) clicks,
        coalesce(s.platform_conv, 0) platform_conv,
        coalesce(c.leads, 0) leads, coalesce(c.customers, 0) customers, coalesce(c.revenue, 0) revenue,
        coalesce(c.purchases, 0) purchases, coalesce(c.gross, 0) gross, coalesce(c.nc_revenue, 0) nc_revenue
      from ${sql.raw(cfg.table)} e
      left join s on s.id = e.id
      left join c on c.id = e.id
      ${parentJoin}
      where e.workspace_id = ${ws.id} and (s.id is not null or c.id is not null)
        ${platformWhere} ${parentWhere} ${nameWhere} ${idE}
    )`;
}

async function fetchLevel(db: DB, ws: Workspace, p: LevelQuery) {
  const base = baseQuery(ws, p);
  const [list, [tot]] = await Promise.all([
    db.execute(sql`${base} select * from base order by spend desc, name, id`).then((r) => rows<Raw>(r)),
    db
      .execute(
        sql`${base} select count(*) count, sum(spend) spend, sum(imp) imp, sum(clicks) clicks, sum(platform_conv) platform_conv,
          sum(leads) leads, sum(customers) customers, sum(revenue) revenue, sum(purchases) purchases, sum(gross) gross,
          sum(nc_revenue) nc_revenue from base`,
      )
      .then((r) => rows<Raw>(r)),
  ]);
  return { list, totals: { ...metricsFrom(tot ?? {}), count: n(tot?.count) } };
}

function deltas(cur: PerfMetrics, prev: PerfMetrics | undefined): PerfDeltas {
  const out: PerfDeltas = {};
  for (const k of PERF_METRIC_KEYS) {
    const a = cur[k];
    const b = prev?.[k] ?? null;
    out[k] = a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b);
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Scale (big spend, ROAS at or above the bar), Test (small spend, good ROAS: give it more),
 * Fix (small spend, weak ROAS) or Kill (big spend, weak ROAS). Rows without spend aren't placed.
 */
export function quadrantOf(spendMinor: number, roas: number | null, split: { spendMinor: number; roas: number }): Quadrant | null {
  if (spendMinor <= 0) return null;
  const good = (roas ?? 0) >= split.roas;
  const big = spendMinor >= split.spendMinor;
  return good ? (big ? "scale" : "test") : big ? "kill" : "fix";
}

/** The Performance table: rows, SQL totals, optional comparison and quadrant split. */
export async function performanceReport(db: DB, ws: Workspace, p: PerfQuery): Promise<PerformanceReport> {
  const prevParams = p.comparison ? { ...p, start: p.comparison.start, end: p.comparison.end } : null;
  const [cur, prev] = await Promise.all([fetchLevel(db, ws, p), prevParams ? fetchLevel(db, ws, prevParams) : Promise.resolve(null)]);
  const prevById = new Map(prev?.list.map((r) => [r.id!, metricsFrom(r)]) ?? []);

  const metrics = cur.list.map((r) => ({ r, m: metricsFrom(r) }));
  const split = {
    spendMinor: median(metrics.map(({ m }) => m.spendMinor ?? 0).filter((v) => v > 0)),
    roas: p.roasSplit && p.roasSplit > 0 ? p.roasSplit : 1,
  };
  return {
    level: p.level,
    rows: metrics.map(({ r, m }) => ({
      ...toRow(r, m),
      delta: prev ? deltas(m, prevById.get(r.id!)) : null,
      quadrant: quadrantOf(m.spendMinor ?? 0, m.roas, split),
    })),
    totals: cur.totals,
    totalsDelta: prev ? deltas(cur.totals, prev.totals) : null,
    compare: prevParams ? { start: prevParams.start, end: prevParams.end } : null,
    split,
  };
}

// ---------------------------------------------------------------- peek

export type PeekContact = {
  id: string;
  /** Name, or a masked email when there is no name. Never the raw email. */
  label: string;
  lifecycle: string;
  revenueMinor: number;
  leadCredit: number;
  lastConversionAt: string;
};

export type PerformancePeek = {
  level: PerfLevel;
  /** The entity with its metrics for the period (zeros when it had no activity) and deltas when comparing. */
  row: PerfRowV2;
  trend: { date: string; spendMinor: number; revenueMinor: number }[];
  childLevel: PerfLevel | null;
  /** Top children by spend (at most 8). */
  children: PerfRowV2[];
  /** How many children had activity in the period. */
  childCount: number;
  /** Top contacts by credited revenue (at most 8). */
  contacts: PeekContact[];
  contactCount: number;
};

export const CHILD_LEVEL: Record<PerfLevel, PerfLevel | null> = { campaign: "ad_group", ad_group: "ad", ad: null };

/**
 * Everything the row peek shows for one campaign, ad set or ad: its metrics (and deltas), the
 * daily spend and revenue trend, its top children and the contacts it brought in. Null when the id
 * isn't an entity of this workspace at that level. The platform filter doesn't apply: the peek
 * always describes the whole entity.
 */
export async function performancePeek(
  db: DB,
  ws: Workspace,
  p: ReportParams & { level: PerfLevel; id: string; comparison?: ComparisonWindow | null },
): Promise<PerformancePeek | null> {
  if (!UUID.test(p.id)) return null;
  const cfg = LEVELS[p.level];
  const rc = ws.reportingCurrency;
  const key = sql.raw(cfg.key);
  const childLevel = CHILD_LEVEL[p.level];

  const [entity] = rows<Raw>(
    await db.execute(sql`
      select e.id, e.name, e.platform, e.status, ${parentSelFor(cfg)}
      from ${sql.raw(cfg.table)} e ${cfg.parentTable ? sql.raw(`left join ${cfg.parentTable} pe on pe.id = e.${cfg.parent}`) : sql``}
      where e.workspace_id = ${ws.id} and e.id = ${p.id}::uuid`),
  );
  if (!entity) return null;

  const one: LevelQuery = { ...p, platform: undefined, id: p.id };
  const [cur, prev, trend, contacts, [count], children] = await Promise.all([
    fetchLevel(db, ws, one).then((r) => r.list[0]),
    p.comparison ? fetchLevel(db, ws, { ...one, ...p.comparison }).then((r) => r.list[0]) : Promise.resolve(undefined),
    db
      .execute(
        sql`
        with days as (
          select d::date as day from generate_series(${p.start}::date, ${p.end}::date, interval '1 day') d
        ), s as (
          select date as day, sum(spend_minor) spend from ad_insights_daily
          where workspace_id = ${ws.id} and ${key} = ${p.id}::uuid and currency = ${rc}
            and date between ${p.start}::date and ${p.end}::date
          group by 1
        ), c as (
          select (conversion_at at time zone ${ws.timezone})::date as day, sum(revenue_minor) revenue
          from attribution_credits
          where workspace_id = ${ws.id} and model = ${p.model} and ${key} = ${p.id}::uuid
            and conversion_type = 'revenue' and currency = ${rc} and ${tsRange(sql`conversion_at`, ws, p)}
          group by 1
        )
        select to_char(days.day, 'YYYY-MM-DD') date, coalesce(s.spend, 0) spend, coalesce(c.revenue, 0) revenue
        from days left join s on s.day = days.day left join c on c.day = days.day
        order by days.day`,
      )
      .then((r) => rows<Raw>(r)),
    db
      .execute(
        sql`
        select ct.id, ct.name, ct.email, ct.lifecycle,
          coalesce(sum(ac.revenue_minor) filter (where ac.conversion_type = 'revenue' and ac.currency = ${rc}), 0) revenue,
          coalesce(sum(ac.credit) filter (where ac.conversion_type = 'lead'), 0) lead_credit,
          max(ac.conversion_at) last_at
        from attribution_credits ac
        join contacts ct on ct.id = ac.contact_id and ct.workspace_id = ac.workspace_id
        where ac.workspace_id = ${ws.id} and ac.model = ${p.model} and ac.${key} = ${p.id}::uuid
          and ${tsRange(sql`ac.conversion_at`, ws, p)}
        group by ct.id, ct.name, ct.email, ct.lifecycle
        order by 5 desc, 7 desc, ct.id
        limit 8`,
      )
      .then((r) => rows<Raw>(r)),
    db
      .execute(
        sql`select count(distinct contact_id) n from attribution_credits
          where workspace_id = ${ws.id} and model = ${p.model} and ${key} = ${p.id}::uuid and contact_id is not null
            and ${tsRange(sql`conversion_at`, ws, p)}`,
      )
      .then((r) => rows<Raw>(r)),
    childLevel
      ? fetchLevel(db, ws, { model: p.model, start: p.start, end: p.end, level: childLevel, parentId: p.id }).then((r) => r.list)
      : Promise.resolve([] as Raw[]),
  ]);

  const m = metricsFrom(cur ?? {});
  return {
    level: p.level,
    row: { ...toRow(entity, m), delta: p.comparison ? deltas(m, prev ? metricsFrom(prev) : undefined) : null, quadrant: null },
    trend: trend.map((t) => ({ date: t.date!, spendMinor: n(t.spend), revenueMinor: n(t.revenue) })),
    childLevel,
    children: children.slice(0, 8).map((r) => ({ ...toRow(r), delta: null, quadrant: null })),
    childCount: children.length,
    contacts: contacts.map((c) => ({
      id: c.id!,
      label: c.name?.trim() || maskEmail(c.email) || "Anonymous contact",
      lifecycle: c.lifecycle ?? "lead",
      revenueMinor: n(c.revenue),
      leadCredit: round2(n(c.lead_credit)),
      lastConversionAt: new Date(c.last_at!).toISOString(),
    })),
    contactCount: n(count?.n),
  };
}

function parentSelFor(cfg: (typeof LEVELS)[PerfLevel]): SQL {
  return cfg.parent ? sql.raw(`e.${cfg.parent} as parent_id, pe.name as parent_name`) : sql.raw(`null::uuid as parent_id, null::text as parent_name`);
}
