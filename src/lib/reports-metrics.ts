import { sql } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { AttributionModel, Platform } from "./db/schema";
import { METRIC_KEYS, type MetricKey } from "./metrics";
import { maskEmail, pickWastedSpend, platformFilter, platforms, previousPeriod, tsRange, type PerfRow, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

// SQL behind the Overview widgets. Every number is computed here (or in reports.ts); the
// widgets only format. Ratios follow the exact rules of `overview()` so both always agree.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Raw period sums, as returned by SQL. */
export type KpiRaw = {
  spendMinor: number;
  revenueMinor: number;
  attributedRevenueMinor: number;
  unattributedRevenueMinor: number;
  leads: number;
  /** Credited leads on paid touchpoints (fractional under linear attribution). */
  paidLeads: number;
  customers: number;
  paidCustomers: number;
};
export type MetricValues = Record<MetricKey, number | null>;
export type KpiPoint = { date: string; values: MetricValues };
export type KpiSeries = { start: string; end: string; totals: MetricValues; raw: KpiRaw; days: KpiPoint[] };

/** Registry metrics from raw sums. Same formulas as `overview()` in reports.ts. */
export function metricValues(r: KpiRaw): MetricValues {
  return {
    revenue: r.revenueMinor,
    attributedRevenue: r.attributedRevenueMinor,
    spend: r.spendMinor,
    roas: ratio(r.attributedRevenueMinor, r.spendMinor),
    mer: ratio(r.revenueMinor, r.spendMinor),
    leads: r.leads,
    cpl: r.paidLeads > 0 ? Math.round(r.spendMinor / r.paidLeads) : null,
    customers: r.customers,
    cac: r.paidCustomers > 0 ? Math.round(r.spendMinor / r.paidCustomers) : null,
    unattributedShare: ratio(r.unattributedRevenueMinor, r.revenueMinor),
  };
}

/**
 * Every KPI metric per day plus the period total, in one query (`group by rollup`): the tiles'
 * values, their sparklines and the Metric explorer all come from here. The total row is computed
 * by SQL, not by summing days in JavaScript.
 */
export async function kpiSeries(db: DB, ws: Workspace, p: ReportParams): Promise<KpiSeries> {
  const rc = ws.reportingCurrency;
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with days as (
        select d::date as day from generate_series(${p.start}::date, ${p.end}::date, interval '1 day') d
      ), s as (
        select date as day, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
          ${platformFilter("platform", p)}
        group by 1
      ), c as (
        select (conversion_at at time zone ${ws.timezone})::date as day,
          count(distinct conversion_id) filter (where conversion_type = 'lead') leads,
          coalesce(sum(credit) filter (where conversion_type = 'lead' and campaign_id is not null ${platformFilter("platform", p)}), 0) paid_leads,
          count(distinct conversion_id) filter (where conversion_type = 'customer') customers,
          coalesce(sum(credit) filter (where conversion_type = 'customer' and campaign_id is not null ${platformFilter("platform", p)}), 0) paid_customers,
          coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc}), 0) revenue,
          coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc} and campaign_id is not null ${platformFilter("platform", p)}), 0) attributed,
          coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc} and touchpoint_id is null), 0) unattributed
        from attribution_credits
        where workspace_id = ${ws.id} and model = ${p.model} and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1
      )
      select to_char(days.day, 'YYYY-MM-DD') as date,
        coalesce(sum(s.spend), 0) spend, coalesce(sum(c.revenue), 0) revenue, coalesce(sum(c.attributed), 0) attributed,
        coalesce(sum(c.unattributed), 0) unattributed, coalesce(sum(c.leads), 0) leads, coalesce(sum(c.paid_leads), 0) paid_leads,
        coalesce(sum(c.customers), 0) customers, coalesce(sum(c.paid_customers), 0) paid_customers
      from days left join s on s.day = days.day left join c on c.day = days.day
      group by rollup (days.day)
      order by days.day nulls last`),
  );
  const toRaw = (r: Record<string, string | null>): KpiRaw => ({
    spendMinor: n(r.spend),
    revenueMinor: n(r.revenue),
    attributedRevenueMinor: n(r.attributed),
    unattributedRevenueMinor: n(r.unattributed),
    leads: n(r.leads),
    paidLeads: n(r.paid_leads),
    customers: n(r.customers),
    paidCustomers: n(r.paid_customers),
  });
  const totalRow = result.find((r) => r.date === null);
  const raw = totalRow ? toRaw(totalRow) : toRaw({});
  return {
    start: p.start,
    end: p.end,
    raw,
    totals: metricValues(raw),
    days: result.filter((r) => r.date !== null).map((r) => ({ date: r.date!, values: metricValues(toRaw(r)) })),
  };
}

/** One metric's daily values (for sparklines and charts). */
export const seriesOf = (s: KpiSeries, key: MetricKey) => s.days.map((d) => d.values[key]);

export const emptyMetricValues = (): MetricValues => Object.fromEntries(METRIC_KEYS.map((k) => [k, null])) as MetricValues;

// ---------------------------------------------------------------- wasted spend maturity

/**
 * Median days from a customer's first tracked touch to their first payment, across the
 * workspace (first-touch credits). Null with fewer than 5 converted customers.
 */
export async function medianDaysToConvert(db: DB, ws: Workspace): Promise<number | null> {
  const [r] = rows<{ median_days: string | null; n: string }>(
    await db.execute(sql`
      with cust as (
        select contact_id, min(conversion_at) converted_at from attribution_credits
        where workspace_id = ${ws.id} and model = 'first_touch' and conversion_type = 'customer' and contact_id is not null
        group by 1
      ), ft as (
        select v.contact_id, min(t.occurred_at) first_at
        from touchpoints t join visitors v on v.id = t.visitor_id
        where t.workspace_id = ${ws.id} and v.contact_id is not null
        group by 1
      )
      select percentile_cont(0.5) within group (order by extract(epoch from (cust.converted_at - ft.first_at)) / 86400.0) median_days,
        count(*) n
      from cust join ft on ft.contact_id = cust.contact_id
      where cust.converted_at >= ft.first_at`),
  );
  if (!r || n(r.n) < 5 || r.median_days === null) return null;
  return Math.round(n(r.median_days) * 10) / 10;
}

export type WastedRow = PerfRow & {
  /** Days from the campaign's first recorded spend to the end of the period (inclusive). */
  ageDays: number | null;
  /** Younger than the median time to convert: too early to call it waste. */
  tooEarly: boolean;
};

/**
 * Wasted spend (≥ 2% of spend, ROAS < 0.5) from campaign rows already fetched, each flagged
 * "too early to judge" when the campaign is younger than the workspace's median time to convert.
 */
export async function wastedSpendWithMaturity(
  db: DB,
  ws: Workspace,
  p: ReportParams,
  campaigns: PerfRow[],
): Promise<{ rows: WastedRow[]; medianDays: number | null; totalMinor: number }> {
  const picked = pickWastedSpend(campaigns);
  if (picked.length === 0) return { rows: [], medianDays: null, totalMinor: 0 };
  const ids = sql.join(
    picked.map((r) => sql`${r.id}::uuid`),
    sql`, `,
  );
  const [firsts, medianDays] = await Promise.all([
    db.execute(sql`
      select campaign_id id, (${p.end}::date - min(date)) + 1 age_days
      from ad_insights_daily
      where workspace_id = ${ws.id} and campaign_id in (${ids}) and date <= ${p.end}::date
      group by 1`),
    medianDaysToConvert(db, ws),
  ]);
  const age = new Map(rows<{ id: string; age_days: string | number }>(firsts).map((r) => [r.id, n(r.age_days)]));
  const out = picked.map((r) => {
    const ageDays = age.get(r.id) ?? null;
    return { ...r, ageDays, tooEarly: medianDays !== null && ageDays !== null && ageDays < medianDays };
  });
  return { rows: out, medianDays, totalMinor: out.filter((r) => !r.tooEarly).reduce((s, r) => s + r.spendMinor, 0) };
}

// ---------------------------------------------------------------- platform scorecard

export type ScorecardRow = {
  platform: Platform;
  spendMinor: number;
  revenueMinor: number;
  roas: number | null;
  prevRoas: number | null;
  /** Share of total ad spend in the period (0..1). */
  spendShare: number | null;
};

/** Spend, credited revenue and ROAS per ad platform, with the previous period's ROAS. */
export async function platformScorecard(db: DB, ws: Workspace, p: ReportParams): Promise<ScorecardRow[]> {
  const [cur, prev] = await Promise.all([platforms(db, ws, p), platforms(db, ws, previousPeriod(p))]);
  const prevBy = new Map(prev.map((r) => [r.platform, r.roas]));
  const total = cur.reduce((s, r) => s + r.spendMinor, 0);
  return cur.map((r) => ({
    platform: r.platform,
    spendMinor: r.spendMinor,
    revenueMinor: r.revenueMinor,
    roas: r.roas,
    prevRoas: prevBy.get(r.platform) ?? null,
    spendShare: ratio(r.spendMinor, total),
  }));
}

// ---------------------------------------------------------------- recent leads & customers

export type ActivityRow = {
  kind: "lead" | "payment";
  id: string;
  contactId: string;
  at: string;
  /** Payment amount (payments only). */
  amountMinor: number | null;
  currency: string | null;
  /** The contact's name, or null. Raw emails never leave this function. */
  name: string | null;
  maskedEmail: string | null;
  lifecycle: "lead" | "customer";
  /** First-touch source of the conversion (ad platform + campaign, or channel). */
  platform: Platform | null;
  channel: string | null;
  campaign: string | null;
};

/**
 * The newest leads and payments up to the end of the period, with the ad that first brought each
 * person in. Emails are masked here so the raw value never reaches a client component.
 */
export async function recentActivity(db: DB, ws: Workspace, p: Pick<ReportParams, "end">, limit = 6): Promise<ActivityRow[]> {
  const until = sql`((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with e as (
        (select 'lead'::text kind, l.id, l.contact_id, l.occurred_at, null::bigint amount_minor, null::text currency
         from leads l
         where l.workspace_id = ${ws.id} and l.occurred_at < ${until}
         order by l.occurred_at desc limit ${limit})
        union all
        (select 'payment'::text, r.id, r.contact_id, r.occurred_at, r.amount_minor, r.currency
         from revenue_events r
         where r.workspace_id = ${ws.id} and r.type = 'payment' and r.contact_id is not null and r.occurred_at < ${until}
         order by r.occurred_at desc limit ${limit})
      )
      select e.kind, e.id, e.contact_id, e.occurred_at, e.amount_minor, e.currency,
        c.name, c.email, c.lifecycle, src.platform, src.channel, src.campaign_name
      from e
      join contacts c on c.id = e.contact_id and c.workspace_id = ${ws.id}
      left join lateral (
        select ac.platform, ac.channel, cp.name campaign_name
        from attribution_credits ac left join campaigns cp on cp.id = ac.campaign_id
        where ac.conversion_id = e.id and ac.workspace_id = ${ws.id} and ac.model = ${"first_touch" satisfies AttributionModel}
        order by ac.credit desc
        limit 1
      ) src on true
      order by e.occurred_at desc
      limit ${limit}`),
  );
  return result.map((r) => ({
    kind: r.kind === "payment" ? "payment" : "lead",
    id: r.id!,
    contactId: r.contact_id!,
    at: new Date(r.occurred_at!).toISOString(),
    amountMinor: r.amount_minor === null ? null : n(r.amount_minor),
    currency: r.currency,
    name: r.name?.trim() || null,
    maskedEmail: maskEmail(r.email),
    lifecycle: r.lifecycle === "customer" ? "customer" : "lead",
    platform: (r.platform as Platform | null) ?? null,
    channel: r.channel,
    campaign: r.campaign_name,
  }));
}
