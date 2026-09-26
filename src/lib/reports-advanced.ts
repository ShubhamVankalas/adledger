import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { AttributionModel, Channel, Platform } from "./db/schema";
import { todayIn } from "./period";
import type { ReportParams } from "./reports";
import type { Workspace } from "./settings";

// Advanced reports: attribution model comparison and customer LTV. Same conventions as
// reports.ts — numbers computed in SQL, money in integer minor units of the reporting
// currency, day/month boundaries in the workspace timezone.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Local-midnight bounds of [start, end] in the workspace timezone (end inclusive). */
function tsRange(col: SQL, ws: Workspace, p: Pick<ReportParams, "start" | "end">) {
  return sql`${col} >= (${p.start}::date)::timestamp at time zone ${ws.timezone}
    and ${col} < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
}
/** Exclusive upper bound: local midnight after `end`. */
const endBound = (ws: Workspace, end: string) => sql`((${end}::date + 1))::timestamp at time zone ${ws.timezone}`;

// ---------------------------------------------------------------- model comparison

export type ModelResult = { revenueMinor: number; customers: number; roas: number | null };

/**
 * "starter"  — earns clearly more under first-touch than last-touch (opens journeys)
 * "closer"   — earns clearly more under last-touch than first-touch (finishes journeys)
 * "balanced" — within ±20% of the larger of the two
 */
export type JourneyRole = "starter" | "closer" | "balanced";

export type ModelComparisonRow = {
  id: string;
  name: string;
  platform: Platform;
  status: string | null;
  spendMinor: number;
  firstTouch: ModelResult;
  lastTouch: ModelResult;
  linear: ModelResult;
  /** first-touch revenue minus last-touch revenue (positive = starts journeys). */
  deltaMinor: number;
  /** deltaMinor ÷ the larger of the two revenues (-1 … 1), null when both are 0. */
  deltaShare: number | null;
  role: JourneyRole;
};

export type ModelComparison = {
  currency: string;
  start: string;
  end: string;
  rows: ModelComparisonRow[];
  totals: { spendMinor: number; firstTouch: ModelResult; lastTouch: ModelResult; linear: ModelResult };
};

export const ROLE_THRESHOLD = 0.2;

export function journeyRole(firstMinor: number, lastMinor: number): { deltaMinor: number; deltaShare: number | null; role: JourneyRole } {
  const deltaMinor = firstMinor - lastMinor;
  const base = Math.max(Math.abs(firstMinor), Math.abs(lastMinor));
  const deltaShare = base > 0 ? deltaMinor / base : null;
  const role: JourneyRole = deltaShare === null || Math.abs(deltaShare) < ROLE_THRESHOLD ? "balanced" : deltaShare > 0 ? "starter" : "closer";
  return { deltaMinor, deltaShare, role };
}

/** Revenue, customers and ROAS per campaign under all three attribution models side by side. */
export async function modelComparison(db: DB, ws: Workspace, p: Omit<ReportParams, "model"> & { model?: AttributionModel }): Promise<ModelComparison> {
  const rc = ws.reportingCurrency;
  const plat = p.platform ? sql`and e.platform = ${p.platform}` : sql``;
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with s as (
        select campaign_id as id, sum(spend_minor) spend
        from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
        group by 1
      ), c as (
        select campaign_id as id,
          sum(revenue_minor) filter (where model = 'first_touch' and conversion_type = 'revenue' and currency = ${rc}) ft_rev,
          sum(revenue_minor) filter (where model = 'last_touch' and conversion_type = 'revenue' and currency = ${rc}) lt_rev,
          sum(revenue_minor) filter (where model = 'linear' and conversion_type = 'revenue' and currency = ${rc}) li_rev,
          sum(credit) filter (where model = 'first_touch' and conversion_type = 'customer') ft_cust,
          sum(credit) filter (where model = 'last_touch' and conversion_type = 'customer') lt_cust,
          sum(credit) filter (where model = 'linear' and conversion_type = 'customer') li_cust
        from attribution_credits
        where workspace_id = ${ws.id} and model in ('first_touch', 'last_touch', 'linear')
          and conversion_type in ('revenue', 'customer') and campaign_id is not null
          and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1
      )
      select e.id, e.name, e.platform, e.status, coalesce(s.spend, 0) spend,
        coalesce(c.ft_rev, 0) ft_rev, coalesce(c.lt_rev, 0) lt_rev, coalesce(c.li_rev, 0) li_rev,
        coalesce(c.ft_cust, 0) ft_cust, coalesce(c.lt_cust, 0) lt_cust, coalesce(c.li_cust, 0) li_cust
      from campaigns e
      left join s on s.id = e.id
      left join c on c.id = e.id
      where e.workspace_id = ${ws.id} and (s.id is not null or c.id is not null) ${plat}
      order by coalesce(s.spend, 0) desc, e.name`),
  );

  const result2 = (rev: unknown, cust: unknown, spend: number): ModelResult => ({
    revenueMinor: n(rev),
    customers: round2(n(cust)),
    roas: ratio(n(rev), spend),
  });
  const out: ModelComparisonRow[] = result.map((r) => {
    const spendMinor = n(r.spend);
    const firstTouch = result2(r.ft_rev, r.ft_cust, spendMinor);
    const lastTouch = result2(r.lt_rev, r.lt_cust, spendMinor);
    return {
      id: r.id!,
      name: r.name!,
      platform: r.platform as Platform,
      status: r.status,
      spendMinor,
      firstTouch,
      lastTouch,
      linear: result2(r.li_rev, r.li_cust, spendMinor),
      ...journeyRole(firstTouch.revenueMinor, lastTouch.revenueMinor),
    };
  });

  // Totals from the unrounded SQL values (per-row customer counts are rounded to 2 dp).
  const spendMinor = out.reduce((a, r) => a + r.spendMinor, 0);
  const total = (prefix: "ft" | "lt" | "li") =>
    result2(
      result.reduce((a, r) => a + n(r[`${prefix}_rev`]), 0),
      result.reduce((a, r) => a + n(r[`${prefix}_cust`]), 0),
      spendMinor,
    );
  return {
    currency: rc,
    start: p.start,
    end: p.end,
    rows: out,
    totals: { spendMinor, firstTouch: total("ft"), lastTouch: total("lt"), linear: total("li") },
  };
}

// ---------------------------------------------------------------- LTV

export type LtvCohort = {
  /** First-payment month, YYYY-MM (workspace timezone). */
  cohort: string;
  customers: number;
  /** Net revenue (payments − refunds) in month 0, 1, 2… after the first payment, up to the report end. */
  revenueMinor: number[];
  /** Cumulative revenue per customer at the end of month 0, 1, 2… */
  cumulativeLtvMinor: number[];
  totalRevenueMinor: number;
  ltvMinor: number | null;
};

export type LtvChannelRow = {
  /** platform id when the acquiring touch came from an ad platform, else the channel, else "unattributed". */
  key: string;
  channel: Channel | "unattributed" | null;
  platform: Platform | null;
  customers: number;
  revenueMinor: number;
  spendMinor: number;
  ltvMinor: number | null;
  cacMinor: number | null;
  ltvCac: number | null;
};

export type LtvReport = {
  currency: string;
  model: AttributionModel;
  start: string;
  end: string;
  customers: number;
  revenueMinor: number;
  ltvMinor: number | null;
  cohorts: LtvCohort[];
  channels: LtvChannelRow[];
};

/** Whole calendar months from YYYY-MM `a` to YYYY-MM `b`. */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/**
 * Customer lifetime value. Cohorts = customers whose first payment falls in [start, end];
 * revenue is every payment/refund of those customers up to `end` (reporting currency).
 * LTV:CAC groups the same customers by the platform/channel that acquired them (credited
 * with the selected model, like the customer and revenue conversions in the ledger) and
 * divides by that platform's ad spend in [start, end].
 */
export async function ltv(db: DB, ws: Workspace, p: ReportParams): Promise<LtvReport> {
  const rc = ws.reportingCurrency;
  const tz = ws.timezone;
  const cohortRows = rows<{ cohort: string; month_idx: string | null; customers: string; revenue: string | null }>(
    await db.execute(sql`
      with firsts as (
        select distinct on (contact_id) contact_id, occurred_at first_at
        from revenue_events
        where workspace_id = ${ws.id} and type = 'payment' and contact_id is not null
          and occurred_at < ${endBound(ws, p.end)}
        order by contact_id, occurred_at, id
      ), cohort as (
        select contact_id, date_trunc('month', first_at at time zone ${tz}) cm
        from firsts where ${tsRange(sql`first_at`, ws, p)}
      ), sizes as (
        select cm, count(*) customers from cohort group by 1
      ), rev as (
        select c.cm,
          -- greatest(0, …): a refund dated before the first payment (bad source data) lands in month 0
          greatest(0, ((extract(year from r.occurred_at at time zone ${tz}) - extract(year from c.cm)) * 12
            + extract(month from r.occurred_at at time zone ${tz}) - extract(month from c.cm))::int) month_idx,
          sum(r.amount_minor) revenue
        from cohort c
        join revenue_events r on r.contact_id = c.contact_id and r.workspace_id = ${ws.id}
        where r.currency = ${rc} and r.occurred_at < ${endBound(ws, p.end)}
        group by 1, 2
      )
      select to_char(sizes.cm, 'YYYY-MM') cohort, rev.month_idx, sizes.customers, rev.revenue
      from sizes left join rev on rev.cm = sizes.cm
      order by 1, 2`),
  );

  // Months after today carry no revenue: stop there (unless future-dated revenue exists), so
  // an absurd ?end=9999-12-31 can't allocate a multi-thousand-month array per cohort.
  const endMonth = [p.end.slice(0, 7), todayIn(tz).slice(0, 7)].sort()[0];
  const byCohort = new Map<string, { customers: number; rev: Map<number, number> }>();
  for (const r of cohortRows) {
    const c = byCohort.get(r.cohort) ?? { customers: n(r.customers), rev: new Map<number, number>() };
    if (r.month_idx !== null) c.rev.set(n(r.month_idx), n(r.revenue));
    byCohort.set(r.cohort, c);
  }
  const cohorts: LtvCohort[] = [...byCohort].map(([cohort, c]) => {
    const months = Math.max(0, monthsBetween(cohort, endMonth), ...c.rev.keys()) + 1;
    const revenueMinor = Array.from({ length: months }, (_, i) => c.rev.get(i) ?? 0);
    let acc = 0;
    const cumulativeLtvMinor = revenueMinor.map((v) => {
      acc += v;
      return Math.round(acc / c.customers);
    });
    return { cohort, customers: c.customers, revenueMinor, cumulativeLtvMinor, totalRevenueMinor: acc, ltvMinor: c.customers > 0 ? Math.round(acc / c.customers) : null };
  });

  // LTV:CAC by acquiring platform/channel. Customer credits in the period identify the
  // cohort; revenue credits for the same contacts carry LTV (repeat payments inherit the
  // acquisition journey in the attribution ledger).
  const chRows = rows<Record<string, string | null>>(
    await db.execute(sql`
      with acq as (
        select contact_id, coalesce(platform, channel, 'unattributed') k, min(channel) channel, min(platform) platform, sum(credit) customers
        from attribution_credits
        where workspace_id = ${ws.id} and model = ${p.model} and conversion_type = 'customer'
          and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1, 2
      ), cust as (
        select k, min(channel) channel, min(platform) platform, sum(customers) customers from acq group by 1
      ), rev as (
        select coalesce(ac.platform, ac.channel, 'unattributed') k, sum(ac.revenue_minor) revenue
        from attribution_credits ac
        where ac.workspace_id = ${ws.id} and ac.model = ${p.model} and ac.conversion_type = 'revenue'
          and ac.currency = ${rc} and ac.conversion_at < ${endBound(ws, p.end)}
          and ac.contact_id in (select contact_id from acq)
        group by 1
      ), s as (
        select platform k, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
        group by 1 having sum(spend_minor) > 0
      ), keys as (
        -- Platforms that spent but acquired nobody still belong in LTV:CAC (their spend counts).
        select k from cust union select k from rev union select k from s
      )
      select keys.k, cust.channel, coalesce(cust.platform, s.k) platform, coalesce(cust.customers, 0) customers,
        coalesce(rev.revenue, 0) revenue, coalesce(s.spend, 0) spend
      from keys
      left join cust on cust.k = keys.k
      left join rev on rev.k = keys.k
      left join s on s.k = keys.k
      order by 5 desc, 6 desc, 1`),
  );
  const channels: LtvChannelRow[] = chRows.map((r) => {
    const customers = round2(n(r.customers));
    const revenueMinor = n(r.revenue);
    const spendMinor = n(r.spend);
    const ltvMinor = customers > 0 ? Math.round(revenueMinor / customers) : null;
    const cacMinor = customers > 0 && spendMinor > 0 ? Math.round(spendMinor / customers) : null;
    return {
      key: r.k!,
      channel: (r.channel ?? (r.k === "unattributed" ? "unattributed" : null)) as LtvChannelRow["channel"],
      platform: r.platform as Platform | null,
      customers,
      revenueMinor,
      spendMinor,
      ltvMinor,
      cacMinor,
      // (revenue ÷ customers) ÷ (spend ÷ customers), without rounding in between.
      ltvCac: customers > 0 ? ratio(revenueMinor, spendMinor) : null,
    };
  });

  const customers = cohorts.reduce((a, c) => a + c.customers, 0);
  const revenueMinor = cohorts.reduce((a, c) => a + c.totalRevenueMinor, 0);
  return { currency: rc, model: p.model, start: p.start, end: p.end, customers, revenueMinor, ltvMinor: customers > 0 ? Math.round(revenueMinor / customers) : null, cohorts, channels };
}
