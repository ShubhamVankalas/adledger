import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { Platform } from "./db/schema";
import { maskEmail, previousPeriod, type PerfLevel, type ReportParams } from "./reports";
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
//   AdLedger conversions = credited leads + credited new customers (what we could verify)
//   platform gap = (platform − AdLedger) ÷ AdLedger, e.g. +129% when Meta claims 94 and we saw 41

export type CompareMode = "previous" | "year" | "none";

export const METRIC_KEYS = [
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
export type MetricKey = (typeof METRIC_KEYS)[number];
export type PerfMetrics = Record<MetricKey, number | null>;
export type Quadrant = "scale" | "test" | "fix" | "kill";

export type PerfRowV2 = PerfMetrics & {
  id: string;
  name: string;
  platform: Platform;
  status: string | null;
  parentId: string | null;
  parentName: string | null;
  /** Change vs the comparison period per metric (ratio, 0.12 = +12%); null when not comparable. */
  delta: Partial<Record<MetricKey, number | null>> | null;
  quadrant: Quadrant | null;
};

export type PerformanceReport = {
  level: PerfLevel;
  rows: PerfRowV2[];
  totals: PerfMetrics & { count: number };
  totalsDelta: Partial<Record<MetricKey, number | null>> | null;
  compare: { mode: Exclude<CompareMode, "none">; start: string; end: string } | null;
  /** Where the quadrant chart splits: median spend of rows with spend, and the ROAS bar. */
  split: { spendMinor: number; roas: number };
};

export type PerfQuery = ReportParams & {
  level: PerfLevel;
  parentId?: string;
  /** Case-insensitive name filter (entity or parent name). */
  q?: string;
  compare?: CompareMode;
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

function tsRange(col: SQL, ws: Workspace, p: ReportParams) {
  return sql`${col} >= (${p.start}::date)::timestamp at time zone ${ws.timezone}
    and ${col} < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
}

/** The period the table compares against. */
export function comparePeriod(p: ReportParams, mode: CompareMode): ReportParams | null {
  if (mode === "none") return null;
  if (mode === "previous") return previousPeriod(p);
  const shift = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCFullYear(t.getUTCFullYear() - 1);
    return t.toISOString().slice(0, 10);
  };
  return { ...p, start: shift(p.start), end: shift(p.end) };
}

export function parseCompare(v: unknown): CompareMode {
  return v === "none" || v === "year" ? v : "previous";
}

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

/** One row per entity with summed inputs; shared by the row and totals queries. */
function baseQuery(ws: Workspace, p: PerfQuery): SQL {
  const rc = ws.reportingCurrency;
  const cfg = LEVELS[p.level];
  const key = sql.raw(cfg.key);
  const parentSel = cfg.parent
    ? sql.raw(`e.${cfg.parent} as parent_id, pe.name as parent_name`)
    : sql.raw(`null::uuid as parent_id, null::text as parent_name`);
  const parentJoin = cfg.parentTable ? sql.raw(`left join ${cfg.parentTable} pe on pe.id = e.${cfg.parent}`) : sql``;
  const parentWhere = p.parentId && cfg.parent ? sql`and e.${sql.raw(cfg.parent)} = ${p.parentId}::uuid` : sql``;
  const platformWhere = p.platform ? sql`and e.platform = ${p.platform}` : sql``;
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
      where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
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
        and ${tsRange(sql`ac.conversion_at`, ws, p)}
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
        ${platformWhere} ${parentWhere} ${nameWhere}
    )`;
}

async function fetchLevel(db: DB, ws: Workspace, p: PerfQuery) {
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

function deltas(cur: PerfMetrics, prev: PerfMetrics | undefined): Partial<Record<MetricKey, number | null>> {
  const out: Partial<Record<MetricKey, number | null>> = {};
  for (const k of METRIC_KEYS) {
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

export function quadrantOf(spendMinor: number, roas: number | null, split: { spendMinor: number; roas: number }): Quadrant | null {
  if (spendMinor <= 0) return null;
  const good = (roas ?? 0) >= split.roas;
  const big = spendMinor >= split.spendMinor;
  return good ? (big ? "scale" : "test") : big ? "kill" : "fix";
}

/** The Performance table: rows, SQL totals, optional comparison and quadrant split. */
export async function performanceReport(db: DB, ws: Workspace, p: PerfQuery): Promise<PerformanceReport> {
  const mode = p.compare ?? "none";
  const prevParams = comparePeriod(p, mode);
  const [cur, prev] = await Promise.all([
    fetchLevel(db, ws, p),
    prevParams ? fetchLevel(db, ws, { ...p, ...prevParams }) : Promise.resolve(null),
  ]);
  const prevById = new Map(prev?.list.map((r) => [r.id!, metricsFrom(r)]) ?? []);

  const metrics = cur.list.map((r) => ({ r, m: metricsFrom(r) }));
  const split = {
    spendMinor: median(metrics.map(({ m }) => m.spendMinor ?? 0).filter((v) => v > 0)),
    roas: p.roasSplit && p.roasSplit > 0 ? p.roasSplit : 1,
  };
  const out: PerfRowV2[] = metrics.map(({ r, m }) => ({
    id: r.id!,
    name: r.name!,
    platform: r.platform as Platform,
    status: r.status,
    parentId: r.parent_id,
    parentName: r.parent_name,
    ...m,
    delta: prev ? deltas(m, prevById.get(r.id!)) : null,
    quadrant: quadrantOf(m.spendMinor ?? 0, m.roas, split),
  }));
  return {
    level: p.level,
    rows: out,
    totals: cur.totals,
    totalsDelta: prev ? deltas(cur.totals, prev.totals) : null,
    compare: prevParams && mode !== "none" ? { mode, start: prevParams.start, end: prevParams.end } : null,
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
  trend: { date: string; spendMinor: number; revenueMinor: number }[];
  children: PerfRowV2[];
  childLevel: PerfLevel | null;
  contacts: PeekContact[];
  contactCount: number;
};

const CHILD: Record<PerfLevel, PerfLevel | null> = { campaign: "ad_group", ad_group: "ad", ad: null };

/** Daily trend, child rows and the contacts one campaign, ad set or ad brought in. */
export async function performancePeek(
  db: DB,
  ws: Workspace,
  p: ReportParams & { level: PerfLevel; id: string },
): Promise<PerformancePeek> {
  const rc = ws.reportingCurrency;
  const key = sql.raw(LEVELS[p.level].key);
  const childLevel = CHILD[p.level];

  const [trend, contacts, [count], children] = await Promise.all([
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
        order by 5 desc, 7 desc
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
    childLevel ? fetchLevel(db, ws, { ...p, level: childLevel, parentId: p.id }).then((r) => r.list) : Promise.resolve([]),
  ]);

  return {
    trend: trend.map((t) => ({ date: t.date!, spendMinor: n(t.spend), revenueMinor: n(t.revenue) })),
    childLevel,
    children: children.slice(0, 8).map((r) => ({
      id: r.id!,
      name: r.name!,
      platform: r.platform as Platform,
      status: r.status,
      parentId: r.parent_id,
      parentName: r.parent_name,
      ...metricsFrom(r),
      delta: null,
      quadrant: null,
    })),
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
