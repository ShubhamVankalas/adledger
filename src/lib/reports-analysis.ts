import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { AttributionModel, Channel, Platform } from "./db/schema";
import { todayIn } from "./period";
import { previousPeriod, type ReportParams } from "./reports";
import { modelComparison, monthsBetween, type JourneyRole } from "./reports-advanced";
import type { Workspace } from "./settings";

// Analysis depth: journeys, time to convert, model disagreement, cohort retention, payback,
// LTV at day marks, funnel and a weekday × hour heatmap. Same conventions as reports.ts:
// every number is computed in SQL (TypeScript only reshapes and divides), money is integer
// minor units of the reporting currency, and day/month/hour boundaries use the workspace
// timezone. Every query is scoped by workspace_id.

type Period = Pick<ReportParams, "start" | "end">;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Local-midnight bounds of [start, end] in the workspace timezone (end inclusive). */
function tsRange(col: SQL, ws: Workspace, p: Period) {
  return sql`${col} >= (${p.start}::date)::timestamp at time zone ${ws.timezone}
    and ${col} < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
}
/** Exclusive upper bound: local midnight after `end`. */
const endBound = (ws: Workspace, end: string) => sql`((${end}::date + 1))::timestamp at time zone ${ws.timezone}`;
/** Exclusive upper bound that never runs past now (for "matured" day-mark maths). */
const asOfBound = (ws: Workspace, end: string) => sql`least(${endBound(ws, end)}, now())`;
const windowInterval = (ws: Workspace) => sql`(${ws.attributionWindowDays}::int * interval '1 day')`;

/** First payment per contact before the end of the period. */
const firstPayments = (ws: Workspace, p: Period) => sql`
  select distinct on (contact_id) contact_id, occurred_at at_
  from revenue_events
  where workspace_id = ${ws.id} and type = 'payment' and contact_id is not null and occurred_at < ${endBound(ws, p.end)}
  order by contact_id, occurred_at, id`;
/** First lead per contact before the end of the period. */
const firstLeads = (ws: Workspace, p: Period) => sql`
  select distinct on (contact_id) contact_id, occurred_at at_
  from leads
  where workspace_id = ${ws.id} and occurred_at < ${endBound(ws, p.end)}
  order by contact_id, occurred_at, id`;
/** Days between two timestamptz expressions, fractional. */
const days = (later: SQL, earlier: SQL) => sql`(extract(epoch from (${later} - ${earlier})) / 86400.0)`;

// ---------------------------------------------------------------- attribution paths

export type PathConversion = "customer" | "lead";

export type PathRow = {
  /** Steps joined with ">"; "" = no tracked touch before converting. */
  key: string;
  /** Platform id for ad touches, otherwise the channel ("organic", "direct", …). Repeats in a row collapse into one step. */
  steps: string[];
  converters: number;
  /** converters ÷ all converters in the period. */
  share: number;
  /** Net revenue to date (up to the period end) of these converters. */
  revenueMinor: number;
  /** Median days from the first touch in the window to converting; null without touches. */
  medianDays: number | null;
  /** Average touchpoints (before collapsing repeats) in the window. */
  avgTouches: number;
};

export type PathsReport = {
  currency: string;
  start: string;
  end: string;
  conversion: PathConversion;
  windowDays: number;
  converters: number;
  revenueMinor: number;
  distinctPaths: number;
  /** Share of converters with exactly one touch in the window (of those with any). */
  singleTouchShare: number | null;
  /** Share of converters with no tracked touch in the window. */
  untrackedShare: number | null;
  /** Average touches per converter that had at least one. */
  avgTouches: number | null;
  rows: PathRow[];
  /** Everything beyond the top `limit` paths. */
  other: { paths: number; converters: number; revenueMinor: number };
};

/**
 * The most common journeys: the ordered channels/platforms each converter touched inside the
 * attribution window before converting (the same touches the attribution models credit).
 * Converters are contacts whose first payment ("customer") or first lead ("lead") falls in the
 * period. With a platform filter, only journeys that include that platform are counted.
 */
export async function attributionPaths(
  db: DB,
  ws: Workspace,
  p: ReportParams,
  opts: { conversion?: PathConversion; limit?: number } = {},
): Promise<PathsReport> {
  const conversion = opts.conversion ?? "customer";
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 100));
  const rc = ws.reportingCurrency;
  const firsts = conversion === "lead" ? firstLeads(ws, p) : firstPayments(ws, p);
  const plat = p.platform ? sql`where ${p.platform} = any(string_to_array(path, '>'))` : sql``;
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with conv as (${firsts}),
      c as (select contact_id, at_ from conv where ${tsRange(sql`at_`, ws, p)}),
      t as (
        select c.contact_id, tp.id, tp.occurred_at, coalesce(tp.platform, tp.channel) step
        from c
        join visitors v on v.contact_id = c.contact_id and v.workspace_id = ${ws.id}
        join touchpoints tp on tp.visitor_id = v.id and tp.workspace_id = ${ws.id}
        where tp.occurred_at <= c.at_ and tp.occurred_at >= c.at_ - ${windowInterval(ws)}
      ), t2 as (
        select t.*, lag(step) over (partition by contact_id order by occurred_at, id) prev from t
      ), j as (
        select contact_id,
          string_agg(step, '>' order by occurred_at, id) filter (where prev is null or prev <> step) path,
          count(*) touches, min(occurred_at) first_at
        from t2 group by 1
      ), rev as (
        select r.contact_id, sum(r.amount_minor) revenue
        from revenue_events r
        where r.workspace_id = ${ws.id} and r.currency = ${rc} and r.occurred_at < ${endBound(ws, p.end)}
          and r.contact_id in (select contact_id from c)
        group by 1
      ), per as (
        select coalesce(j.path, '') path, coalesce(j.touches, 0) touches,
          ${days(sql`c.at_`, sql`j.first_at`)} d, coalesce(rev.revenue, 0) revenue
        from c
        left join j on j.contact_id = c.contact_id
        left join rev on rev.contact_id = c.contact_id
      )
      select path, count(*) converters, sum(revenue) revenue,
        percentile_cont(0.5) within group (order by d) median_days,
        sum(touches) touches, count(*) filter (where touches = 1) single
      from per ${plat}
      group by 1
      order by 2 desc, 3 desc, 1`),
  );

  const converters = result.reduce((a, r) => a + n(r.converters), 0);
  const tracked = result.filter((r) => r.path !== "");
  const trackedConverters = tracked.reduce((a, r) => a + n(r.converters), 0);
  const all: PathRow[] = result.map((r) => ({
    key: r.path ?? "",
    steps: r.path ? r.path.split(">") : [],
    converters: n(r.converters),
    share: converters > 0 ? n(r.converters) / converters : 0,
    revenueMinor: n(r.revenue),
    medianDays: round1(nOrNull(r.median_days)),
    avgTouches: round1(n(r.touches) / Math.max(1, n(r.converters)))!,
  }));
  const top = all.slice(0, limit);
  const rest = all.slice(limit);
  return {
    currency: rc,
    start: p.start,
    end: p.end,
    conversion,
    windowDays: ws.attributionWindowDays,
    converters,
    revenueMinor: all.reduce((a, r) => a + r.revenueMinor, 0),
    distinctPaths: tracked.length,
    singleTouchShare: ratio(
      tracked.reduce((a, r) => a + n(r.single), 0),
      trackedConverters,
    ),
    untrackedShare: ratio(converters - trackedConverters, converters),
    avgTouches: trackedConverters > 0 ? round1(tracked.reduce((a, r) => a + n(r.touches), 0) / trackedConverters) : null,
    rows: top,
    other: {
      paths: rest.length,
      converters: rest.reduce((a, r) => a + r.converters, 0),
      revenueMinor: rest.reduce((a, r) => a + r.revenueMinor, 0),
    },
  };
}

// ---------------------------------------------------------------- time to convert

export const LAG_BUCKETS = [
  { key: "0-1", label: "Same day", short: "<1d" },
  { key: "1-7", label: "1–7 days", short: "1–7d" },
  { key: "7-14", label: "7–14 days", short: "7–14d" },
  { key: "14-30", label: "14–30 days", short: "14–30d" },
  { key: "30+", label: "30+ days", short: "30d+" },
] as const;

export type LagStats = {
  conversions: number;
  medianDays: number | null;
  p80Days: number | null;
  p90Days: number | null;
  /** Counts per LAG_BUCKETS entry: [<1, 1–7, 7–14, 14–30, 30+] days. */
  buckets: number[];
  /** Share that converted within the workspace attribution window. */
  withinWindowShare: number | null;
};

export type CampaignLagRow = {
  id: string;
  name: string;
  platform: Platform;
  /** Customers (first payment in the period) this campaign touched inside the window. */
  customers: number;
  medianDays: number | null;
  p80Days: number | null;
  /** Leads (first lead in the period) this campaign touched inside the window. */
  leads: number;
  leadMedianDays: number | null;
  leadP80Days: number | null;
};

export type TimeToConvert = {
  start: string;
  end: string;
  windowDays: number;
  touchToLead: LagStats;
  leadToPayment: LagStats;
  touchToPayment: LagStats;
  touches: {
    /** Customers in the period (first payment). */
    customers: number;
    /** Customers with at least one touch in the window. */
    tracked: number;
    /** Customers by touches in the window: 1, 2, 3, 4–5, 6+. */
    buckets: number[];
    avg: number | null;
  };
  /** Share of tracked customers whose journey spans two or more browsers/devices. */
  crossDeviceShare: number | null;
  /** Smallest round window that covers 90% of first touch → payment lags; null below MIN_FOR_RECOMMENDATION. */
  recommendedWindowDays: number | null;
  campaigns: CampaignLagRow[];
};

export const TOUCH_BUCKETS = ["1", "2", "3", "4–5", "6+"] as const;
export const MIN_FOR_RECOMMENDATION = 20;
const WINDOW_STEPS = [7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];

/** Round a 90th-percentile lag up to a window people recognise (7, 14, 21, 30, 45, 60, 90…). */
export function recommendWindow(p90Days: number | null, conversions: number): number | null {
  if (p90Days === null || conversions < MIN_FOR_RECOMMENDATION) return null;
  return WINDOW_STEPS.find((w) => w >= Math.ceil(p90Days)) ?? 365;
}

function lagStats(r: Record<string, string | null> | undefined): LagStats {
  if (!r) return { conversions: 0, medianDays: null, p80Days: null, p90Days: null, buckets: [0, 0, 0, 0, 0], withinWindowShare: null };
  const conversions = n(r.n);
  return {
    conversions,
    medianDays: round1(nOrNull(r.p50)),
    p80Days: round1(nOrNull(r.p80)),
    p90Days: round1(nOrNull(r.p90)),
    buckets: [n(r.b0), n(r.b1), n(r.b2), n(r.b3), n(r.b4)],
    withinWindowShare: ratio(n(r.within), conversions),
  };
}

/**
 * How long people take to convert. Stage lags use each contact's first-ever touch, first lead
 * and first payment (not limited to the attribution window, so the window recommendation can
 * see journeys the window misses). Touch counts, cross-device share and per-campaign lags use
 * the touches inside the window, like attribution. Per campaign, the lag runs from that
 * campaign's first touch in the window to the conversion. The platform filter applies to the
 * campaign table only.
 */
export async function timeToConvert(db: DB, ws: Workspace, p: ReportParams): Promise<TimeToConvert> {
  const win = ws.attributionWindowDays;
  const stageRows = rows<Record<string, string | null>>(
    await db.execute(sql`
      with fl as (${firstLeads(ws, p)}), fp as (${firstPayments(ws, p)}),
      ft as (
        select v.contact_id, min(tp.occurred_at) at_
        from touchpoints tp join visitors v on v.id = tp.visitor_id
        where tp.workspace_id = ${ws.id} and v.contact_id is not null and tp.occurred_at < ${endBound(ws, p.end)}
        group by 1
      ), lags as (
        select 'touch_lead' stage, ${days(sql`fl.at_`, sql`ft.at_`)} d
        from fl join ft on ft.contact_id = fl.contact_id
        where ${tsRange(sql`fl.at_`, ws, p)} and ft.at_ <= fl.at_
        union all
        select 'lead_payment', ${days(sql`fp.at_`, sql`fl.at_`)}
        from fp join fl on fl.contact_id = fp.contact_id
        where ${tsRange(sql`fp.at_`, ws, p)} and fl.at_ <= fp.at_
        union all
        select 'touch_payment', ${days(sql`fp.at_`, sql`ft.at_`)}
        from fp join ft on ft.contact_id = fp.contact_id
        where ${tsRange(sql`fp.at_`, ws, p)} and ft.at_ <= fp.at_
      )
      select stage, count(*) n,
        percentile_cont(0.5) within group (order by d) p50,
        percentile_cont(0.8) within group (order by d) p80,
        percentile_cont(0.9) within group (order by d) p90,
        count(*) filter (where d < 1) b0,
        count(*) filter (where d >= 1 and d < 7) b1,
        count(*) filter (where d >= 7 and d < 14) b2,
        count(*) filter (where d >= 14 and d < 30) b3,
        count(*) filter (where d >= 30) b4,
        count(*) filter (where d <= ${win}) within
      from lags group by 1`),
  );
  const byStage = new Map(stageRows.map((r) => [r.stage, r]));

  const [touchRow] = rows<Record<string, string | null>>(
    await db.execute(sql`
      with fp as (${firstPayments(ws, p)}),
      c as (select contact_id, at_ from fp where ${tsRange(sql`at_`, ws, p)}),
      t as (
        select c.contact_id, count(*) touches, count(distinct tp.visitor_id) devices
        from c
        join visitors v on v.contact_id = c.contact_id and v.workspace_id = ${ws.id}
        join touchpoints tp on tp.visitor_id = v.id and tp.workspace_id = ${ws.id}
        where tp.occurred_at <= c.at_ and tp.occurred_at >= c.at_ - ${windowInterval(ws)}
        group by 1
      )
      select count(*) customers, count(t.contact_id) tracked,
        count(*) filter (where t.touches = 1) t1,
        count(*) filter (where t.touches = 2) t2,
        count(*) filter (where t.touches = 3) t3,
        count(*) filter (where t.touches between 4 and 5) t4,
        count(*) filter (where t.touches >= 6) t6,
        avg(t.touches) avg_touches,
        count(*) filter (where t.devices > 1) multi
      from c left join t on t.contact_id = c.contact_id`),
  );

  const plat = p.platform ? sql`and e.platform = ${p.platform}` : sql``;
  const campRows = rows<Record<string, string | null>>(
    await db.execute(sql`
      with fl as (${firstLeads(ws, p)}), fp as (${firstPayments(ws, p)}),
      conv as (
        select 'payment' kind, contact_id, at_ from fp where ${tsRange(sql`at_`, ws, p)}
        union all
        select 'lead', contact_id, at_ from fl where ${tsRange(sql`at_`, ws, p)}
      ), ct as (
        -- each campaign's first touch inside the window before the conversion
        select conv.kind, conv.contact_id, tp.campaign_id, ${days(sql`conv.at_`, sql`min(tp.occurred_at)`)} d
        from conv
        join visitors v on v.contact_id = conv.contact_id and v.workspace_id = ${ws.id}
        join touchpoints tp on tp.visitor_id = v.id and tp.workspace_id = ${ws.id}
        where tp.campaign_id is not null and tp.occurred_at <= conv.at_ and tp.occurred_at >= conv.at_ - ${windowInterval(ws)}
        group by conv.kind, conv.contact_id, conv.at_, tp.campaign_id
      ), agg as (
        select campaign_id,
          count(*) filter (where kind = 'payment') customers,
          percentile_cont(0.5) within group (order by d) filter (where kind = 'payment') p50,
          percentile_cont(0.8) within group (order by d) filter (where kind = 'payment') p80,
          count(*) filter (where kind = 'lead') leads,
          percentile_cont(0.5) within group (order by d) filter (where kind = 'lead') l50,
          percentile_cont(0.8) within group (order by d) filter (where kind = 'lead') l80
        from ct group by 1
      )
      select e.id, e.name, e.platform, agg.customers, agg.p50, agg.p80, agg.leads, agg.l50, agg.l80
      from agg join campaigns e on e.id = agg.campaign_id and e.workspace_id = ${ws.id}
      where true ${plat}
      order by agg.customers desc, agg.leads desc, e.name`),
  );

  const touchToPayment = lagStats(byStage.get("touch_payment"));
  const tracked = n(touchRow?.tracked);
  return {
    start: p.start,
    end: p.end,
    windowDays: win,
    touchToLead: lagStats(byStage.get("touch_lead")),
    leadToPayment: lagStats(byStage.get("lead_payment")),
    touchToPayment,
    touches: {
      customers: n(touchRow?.customers),
      tracked,
      buckets: [n(touchRow?.t1), n(touchRow?.t2), n(touchRow?.t3), n(touchRow?.t4), n(touchRow?.t6)],
      avg: round1(nOrNull(touchRow?.avg_touches)),
    },
    crossDeviceShare: ratio(n(touchRow?.multi), tracked),
    recommendedWindowDays: recommendWindow(touchToPayment.p90Days, touchToPayment.conversions),
    campaigns: campRows.map((r) => ({
      id: r.id!,
      name: r.name!,
      platform: r.platform as Platform,
      customers: n(r.customers),
      medianDays: round1(nOrNull(r.p50)),
      p80Days: round1(nOrNull(r.p80)),
      leads: n(r.leads),
      leadMedianDays: round1(nOrNull(r.l50)),
      leadP80Days: round1(nOrNull(r.l80)),
    })),
  };
}

// ---------------------------------------------------------------- model disagreement

export type DisagreementRow = {
  id: string;
  name: string;
  platform: Platform;
  spendMinor: number;
  firstMinor: number;
  lastMinor: number;
  linearMinor: number;
  minMinor: number;
  maxMinor: number;
  /** maxMinor − minMinor: revenue that depends on the model choice. */
  spreadMinor: number;
  role: JourneyRole;
};

export type ModelDisagreement = {
  currency: string;
  start: string;
  end: string;
  /** Campaigns sorted by spread, largest first. */
  rows: DisagreementRow[];
  /** Σ spread over campaigns. */
  movableMinor: number;
  /** movableMinor ÷ Σ of each campaign's largest credit. */
  movableShare: number | null;
  starters: number;
  closers: number;
  /** Average credited touches per tracked customer (linear model rows). */
  avgTouches: number | null;
  /** Share of tracked customers with more than one touch in the window. */
  multiTouchShare: number | null;
};

/** Dumbbell data: each campaign's revenue under first touch, last touch and linear. */
export async function modelDisagreement(db: DB, ws: Workspace, p: ReportParams): Promise<ModelDisagreement> {
  const mc = await modelComparison(db, ws, p);
  const [t] = rows<Record<string, string | null>>(
    await db.execute(sql`
      with per as (
        select conversion_id, count(*) touches
        from attribution_credits
        where workspace_id = ${ws.id} and model = 'linear' and conversion_type = 'customer'
          and touchpoint_id is not null and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1
      )
      select count(*) tracked, avg(touches) avg_touches, count(*) filter (where touches > 1) multi from per`),
  );
  const out: DisagreementRow[] = mc.rows
    .map((r) => {
      const vals = [r.firstTouch.revenueMinor, r.lastTouch.revenueMinor, r.linear.revenueMinor];
      const minMinor = Math.min(...vals);
      const maxMinor = Math.max(...vals);
      return {
        id: r.id,
        name: r.name,
        platform: r.platform,
        spendMinor: r.spendMinor,
        firstMinor: vals[0],
        lastMinor: vals[1],
        linearMinor: vals[2],
        minMinor,
        maxMinor,
        spreadMinor: maxMinor - minMinor,
        role: r.role,
      };
    })
    .sort((a, b) => b.spreadMinor - a.spreadMinor || b.maxMinor - a.maxMinor || a.name.localeCompare(b.name));
  const movableMinor = out.reduce((a, r) => a + r.spreadMinor, 0);
  const tracked = n(t?.tracked);
  return {
    currency: mc.currency,
    start: p.start,
    end: p.end,
    rows: out,
    movableMinor,
    movableShare: ratio(movableMinor, out.reduce((a, r) => a + r.maxMinor, 0)),
    starters: out.filter((r) => r.role === "starter").length,
    closers: out.filter((r) => r.role === "closer").length,
    avgTouches: round1(nOrNull(t?.avg_touches)),
    multiTouchShare: ratio(n(t?.multi), tracked),
  };
}

// ---------------------------------------------------------------- cohort retention

export type RetentionCohort = {
  /** First-payment month, YYYY-MM (workspace timezone). */
  cohort: string;
  customers: number;
  /** All ad spend in the cohort month (within the period) ÷ customers: blended CAC. */
  spendMinor: number;
  cacMinor: number | null;
  /**
   * Share of the cohort with at least one payment in month k after the first (k = 0 is always
   * 1). null = month k has not happened yet.
   */
  retention: (number | null)[];
  payers: number[];
  /** Net revenue (payments − refunds) in month k. */
  revenueMinor: number[];
  /** Cumulative net revenue per customer at the end of month k. */
  cumulativeLtvMinor: number[];
  /** First month k where cumulative revenue per customer reaches CAC; null if not (yet). */
  paybackMonth: number | null;
};

export type CohortReport = {
  currency: string;
  start: string;
  end: string;
  /** Longest cohort row length (month columns to draw). */
  months: number;
  cohorts: RetentionCohort[];
  customers: number;
  /** Customers with two or more payments to date ÷ customers. */
  repeatRate: number | null;
  /** Customer-weighted month-1 retention over cohorts that reached month 1. */
  month1Retention: number | null;
  ltvMinor: number | null;
};

/**
 * Monthly acquisition cohorts (first payment in the period) and the share of each cohort that
 * pays again in month 1, 2, 3… Months in the period with no new customers still get a row.
 */
export async function cohortRetention(db: DB, ws: Workspace, p: Period): Promise<CohortReport> {
  const rc = ws.reportingCurrency;
  const tz = ws.timezone;
  const endB = endBound(ws, p.end);
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with firsts as (${firstPayments(ws, p)}),
      cohort as (
        select contact_id, date_trunc('month', at_ at time zone ${tz}) cm
        from firsts where ${tsRange(sql`at_`, ws, p)}
      ), sizes as (
        select cm, count(*) customers from cohort group by 1
      ), act as (
        select c.cm,
          -- greatest(0, …): a refund dated before the first payment lands in month 0
          greatest(0, ((extract(year from r.occurred_at at time zone ${tz}) - extract(year from c.cm)) * 12
            + extract(month from r.occurred_at at time zone ${tz}) - extract(month from c.cm))::int) k,
          count(distinct r.contact_id) filter (where r.type = 'payment') payers,
          coalesce(sum(r.amount_minor) filter (where r.currency = ${rc}), 0) revenue
        from cohort c
        join revenue_events r on r.contact_id = c.contact_id and r.workspace_id = ${ws.id}
        where r.occurred_at < ${endB}
        group by 1, 2
      ), months as (
        select generate_series(date_trunc('month', ${p.start}::date::timestamp), date_trunc('month', ${p.end}::date::timestamp), interval '1 month') cm
      ), spend as (
        select date_trunc('month', date::timestamp) cm, sum(spend_minor) spend
        from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
        group by 1
      )
      select to_char(m.cm, 'YYYY-MM') cohort, coalesce(sizes.customers, 0) customers, coalesce(spend.spend, 0) spend,
        act.k, act.payers, act.revenue
      from months m
      left join sizes on sizes.cm = m.cm
      left join spend on spend.cm = m.cm
      left join act on act.cm = m.cm
      order by 1, 4`),
  );
  const [rep] = rows<Record<string, string | null>>(
    await db.execute(sql`
      with firsts as (${firstPayments(ws, p)}),
      cohort as (select contact_id from firsts where ${tsRange(sql`at_`, ws, p)}),
      pays as (
        select c.contact_id, count(r.id) payments
        from cohort c join revenue_events r on r.contact_id = c.contact_id and r.workspace_id = ${ws.id}
        where r.type = 'payment' and r.occurred_at < ${endB}
        group by 1
      )
      select count(*) customers, count(*) filter (where payments >= 2) repeaters from pays`),
  );

  // Months after today have not happened: they are null (unknown), not 0.
  const lastMonth = [p.end.slice(0, 7), todayIn(tz).slice(0, 7)].sort()[0];
  const byCohort = new Map<string, { customers: number; spend: number; act: Map<number, { payers: number; revenue: number }> }>();
  for (const r of result) {
    const c = byCohort.get(r.cohort!) ?? { customers: n(r.customers), spend: n(r.spend), act: new Map() };
    if (r.k !== null) c.act.set(n(r.k), { payers: n(r.payers), revenue: n(r.revenue) });
    byCohort.set(r.cohort!, c);
  }
  const cohorts: RetentionCohort[] = [...byCohort].map(([cohort, c]) => {
    const reached = Math.max(0, monthsBetween(cohort, lastMonth));
    const length = c.customers > 0 ? Math.max(reached, ...c.act.keys()) + 1 : 0;
    const payers = Array.from({ length }, (_, k) => c.act.get(k)?.payers ?? 0);
    const revenueMinor = Array.from({ length }, (_, k) => c.act.get(k)?.revenue ?? 0);
    let acc = 0;
    const cumulativeLtvMinor = revenueMinor.map((v) => {
      acc += v;
      return Math.round(acc / c.customers);
    });
    const cacMinor = c.customers > 0 && c.spend > 0 ? Math.round(c.spend / c.customers) : null;
    const pb = cacMinor === null ? -1 : cumulativeLtvMinor.findIndex((v) => v >= cacMinor);
    return {
      cohort,
      customers: c.customers,
      spendMinor: c.spend,
      cacMinor,
      retention: payers.map((v, k) => (k > reached && !c.act.has(k) ? null : k === 0 ? 1 : v / c.customers)),
      payers,
      revenueMinor,
      cumulativeLtvMinor,
      paybackMonth: pb >= 0 ? pb : null,
    };
  });
  const customers = cohorts.reduce((a, c) => a + c.customers, 0);
  const revenue = cohorts.reduce((a, c) => a + c.revenueMinor.reduce((x, y) => x + y, 0), 0);
  const m1 = cohorts.filter((c) => c.retention[1] !== null && c.retention[1] !== undefined);
  const m1Customers = m1.reduce((a, c) => a + c.customers, 0);
  return {
    currency: rc,
    start: p.start,
    end: p.end,
    months: Math.max(0, ...cohorts.map((c) => c.retention.length)),
    cohorts,
    customers,
    repeatRate: ratio(n(rep?.repeaters), n(rep?.customers)),
    month1Retention: ratio(m1.reduce((a, c) => a + c.payers[1], 0), m1Customers),
    ltvMinor: customers > 0 ? Math.round(revenue / customers) : null,
  };
}

// ---------------------------------------------------------------- payback & LTV by channel

export const LTV_MARKS = [30, 60, 90, 180] as const;
export type LtvMark = (typeof LTV_MARKS)[number];
/** Day offsets the LTV curve is evaluated at (days since each customer's first payment). */
export const CURVE_MARKS = [0, 7, 14, 30, 45, 60, 90, 120, 180, 270, 365] as const;

export type PaybackStatus = "paid_back" | "not_yet" | "no_spend" | "no_customers";

export type CurvePoint = {
  day: number;
  /** Cumulative net revenue per customer by this day, over customers at least this old; null if none are. */
  ltvMinor: number | null;
  /** Customers (credit-weighted) old enough to count at this day. */
  customers: number;
};

export type PaybackRow = {
  /** platform id for ad-acquired customers, else the channel, else "unattributed". */
  key: string;
  channel: Channel | "unattributed" | null;
  platform: Platform | null;
  customers: number;
  spendMinor: number;
  cacMinor: number | null;
  revenueMinor: number;
  ltvToDateMinor: number | null;
  ltvAt: Record<LtvMark, number | null>;
  curve: CurvePoint[];
  /** Days after the first payment until revenue per customer covers CAC (interpolated between curve marks). */
  paybackDays: number | null;
  status: PaybackStatus;
  repeatRate: number | null;
  /** Refunded ÷ gross payments. */
  refundRate: number | null;
};

export type PaybackReport = {
  currency: string;
  model: AttributionModel;
  start: string;
  end: string;
  rows: PaybackRow[];
  /** All ad platforms with spend combined. */
  paid: Omit<PaybackRow, "key" | "channel" | "platform">;
};

/** Interpolated day at which a curve reaches `target`; null when it never does. */
export function paybackDay(curve: CurvePoint[], target: number): number | null {
  let prev: { day: number; v: number } | null = null;
  for (const pt of curve) {
    if (pt.ltvMinor === null) break;
    if (pt.ltvMinor >= target) {
      if (!prev || pt.ltvMinor === prev.v) return pt.day;
      return Math.ceil(prev.day + ((target - prev.v) / (pt.ltvMinor - prev.v)) * (pt.day - prev.day));
    }
    prev = { day: pt.day, v: pt.ltvMinor };
  }
  return null;
}

type Raw = { customers: number; spend: number; revenue: number; gross: number; refunds: number; repeaters: number; marks: Map<number, { w: number; rev: number }> };

function toPaybackRow(r: Raw): Omit<PaybackRow, "key" | "channel" | "platform"> {
  const customers = round2(r.customers);
  const curve: CurvePoint[] = CURVE_MARKS.map((day) => {
    const m = r.marks.get(day);
    return { day, customers: round2(m?.w ?? 0), ltvMinor: m && m.w > 0 ? Math.round(m.rev / m.w) : null };
  });
  const cacMinor = r.customers > 0 && r.spend > 0 ? Math.round(r.spend / r.customers) : null;
  const paybackDays = cacMinor === null ? null : paybackDay(curve, cacMinor);
  const ltvAt = Object.fromEntries(LTV_MARKS.map((d) => [d, curve.find((c) => c.day === d)?.ltvMinor ?? null])) as Record<LtvMark, number | null>;
  return {
    customers,
    spendMinor: r.spend,
    cacMinor,
    revenueMinor: Math.round(r.revenue),
    ltvToDateMinor: r.customers > 0 ? Math.round(r.revenue / r.customers) : null,
    ltvAt,
    curve,
    paybackDays,
    status: r.customers <= 0 ? "no_customers" : cacMinor === null ? "no_spend" : paybackDays === null ? "not_yet" : "paid_back",
    repeatRate: ratio(r.repeaters, r.customers),
    refundRate: ratio(r.refunds, r.gross),
  };
}

/**
 * CAC payback and LTV at day 30/60/90/180 by acquiring platform/channel. Customers are those
 * credited with a customer conversion in the period under the selected model (fractional under
 * linear); their revenue is weighted by that credit. The value at day d only counts customers
 * whose first payment is at least d days before the period end (or today), so young customers
 * don't drag the curve down. CAC = the platform's ad spend in the period ÷ customers.
 */
export async function paybackByChannel(db: DB, ws: Workspace, p: ReportParams): Promise<PaybackReport> {
  const rc = ws.reportingCurrency;
  const asOf = asOfBound(ws, p.end);
  const marks = sql.raw(`array[${CURVE_MARKS.join(",")}]::int[]`);
  const base = sql`
    acq as (
      select contact_id, coalesce(platform, channel, 'unattributed') k, min(channel) channel, min(platform) platform, sum(credit)::float8 w
      from attribution_credits
      where workspace_id = ${ws.id} and model = ${p.model} and conversion_type = 'customer'
        and ${tsRange(sql`conversion_at`, ws, p)}
      group by 1, 2
    ), fp as (
      select distinct on (contact_id) contact_id, occurred_at first_at
      from revenue_events
      where workspace_id = ${ws.id} and type = 'payment' and contact_id in (select contact_id from acq)
      order by contact_id, occurred_at, id
    ), rev as (
      select r.contact_id, r.type, r.amount_minor, greatest(0, ${days(sql`r.occurred_at`, sql`fp.first_at`)}) off
      from revenue_events r join fp on fp.contact_id = r.contact_id
      where r.workspace_id = ${ws.id} and r.currency = ${rc} and r.occurred_at < ${asOf}
    )`;

  const curveRows = rows<Record<string, string | null>>(
    await db.execute(sql`
      with ${base},
      cm as (
        select a.contact_id, a.k, a.w, m.d
        from acq a
        join fp on fp.contact_id = a.contact_id
        cross join unnest(${marks}) m(d)
        where ${days(asOf, sql`fp.first_at`)} >= m.d
      ), mw as (
        select k, d, sum(w) w from cm group by 1, 2
      ), rw as (
        select cm.k, cm.d, sum(cm.w * r.amount_minor) rev
        from cm join rev r on r.contact_id = cm.contact_id and r.off <= cm.d
        group by 1, 2
      )
      select mw.k, mw.d, mw.w, coalesce(rw.rev, 0) rev
      from mw left join rw on rw.k = mw.k and rw.d = mw.d`),
  );

  const aggRows = rows<Record<string, string | null>>(
    await db.execute(sql`
      with ${base},
      per as (
        select contact_id,
          sum(amount_minor) net,
          sum(amount_minor) filter (where type = 'payment') gross,
          -sum(amount_minor) filter (where type = 'refund') refunds,
          count(*) filter (where type = 'payment') payments
        from rev group by 1
      ), cust as (
        select a.k, min(a.channel) channel, min(a.platform) platform, sum(a.w) customers,
          sum(a.w * coalesce(per.net, 0)) revenue,
          sum(a.w * coalesce(per.gross, 0)) gross,
          sum(a.w * coalesce(per.refunds, 0)) refunds,
          coalesce(sum(a.w) filter (where per.payments >= 2), 0) repeaters
        from acq a left join per on per.contact_id = a.contact_id
        group by 1
      ), s as (
        select platform k, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
          ${p.platform ? sql`and platform = ${p.platform}` : sql``}
        group by 1 having sum(spend_minor) > 0
      ), keys as (select k from cust union select k from s)
      select keys.k, cust.channel, coalesce(cust.platform, s.k) platform,
        coalesce(cust.customers, 0) customers, coalesce(cust.revenue, 0) revenue, coalesce(cust.gross, 0) gross,
        coalesce(cust.refunds, 0) refunds, coalesce(cust.repeaters, 0) repeaters, coalesce(s.spend, 0) spend
      from keys left join cust on cust.k = keys.k left join s on s.k = keys.k
      ${p.platform ? sql`where keys.k = ${p.platform}` : sql``}
      order by 4 desc, 9 desc, 1`),
  );

  const marksByKey = new Map<string, Map<number, { w: number; rev: number }>>();
  for (const r of curveRows) {
    const m = marksByKey.get(r.k!) ?? new Map();
    m.set(n(r.d), { w: n(r.w), rev: n(r.rev) });
    marksByKey.set(r.k!, m);
  }
  const raws: (Raw & { key: string; channel: string | null; platform: string | null })[] = aggRows.map((r) => ({
    key: r.k!,
    channel: r.channel,
    platform: r.platform,
    customers: n(r.customers),
    spend: n(r.spend),
    revenue: n(r.revenue),
    gross: n(r.gross),
    refunds: n(r.refunds),
    repeaters: n(r.repeaters),
    marks: marksByKey.get(r.k!) ?? new Map(),
  }));

  // Paid = every platform that spent: sums of the raw (unrounded) SQL values.
  const paidRaws = raws.filter((r) => r.spend > 0);
  const paidMarks = new Map<number, { w: number; rev: number }>();
  for (const r of paidRaws) {
    for (const [d, v] of r.marks) {
      const cur = paidMarks.get(d) ?? { w: 0, rev: 0 };
      paidMarks.set(d, { w: cur.w + v.w, rev: cur.rev + v.rev });
    }
  }
  const sum = (k: keyof Omit<Raw, "marks">) => paidRaws.reduce((a, r) => a + r[k], 0);
  return {
    currency: rc,
    model: p.model,
    start: p.start,
    end: p.end,
    rows: raws.map((r) => ({
      key: r.key,
      channel: (r.channel ?? (r.key === "unattributed" ? "unattributed" : null)) as PaybackRow["channel"],
      platform: r.platform as Platform | null,
      ...toPaybackRow(r),
    })),
    paid: toPaybackRow({
      customers: sum("customers"),
      spend: sum("spend"),
      revenue: sum("revenue"),
      gross: sum("gross"),
      refunds: sum("refunds"),
      repeaters: sum("repeaters"),
      marks: paidMarks,
    }),
  };
}

// ---------------------------------------------------------------- funnel

export type FunnelCounts = {
  start: string;
  end: string;
  /** Distinct visitors with any tracked event (with a platform filter: with a touch from it). */
  visitors: number;
  /** Contacts whose first lead is in the period (credit-weighted with a platform filter). */
  leads: number;
  /** Contacts whose first payment is in the period (credit-weighted with a platform filter). */
  customers: number;
  /** Net revenue in the period from those new customers. */
  revenueMinor: number;
  /** leads ÷ visitors */
  leadRate: number | null;
  /** customers ÷ leads */
  closeRate: number | null;
  /** customers ÷ visitors */
  visitorRate: number | null;
  revenuePerVisitorMinor: number | null;
};

export type FunnelReport = FunnelCounts & { currency: string; model: AttributionModel; previous: FunnelCounts | null };

async function funnelCounts(db: DB, ws: Workspace, p: ReportParams): Promise<FunnelCounts> {
  const rc = ws.reportingCurrency;
  const q = p.platform
    ? sql`
      with fp as (${firstPayments(ws, p)}),
      nc as (select contact_id from fp where ${tsRange(sql`at_`, ws, p)})
      select
        (select count(distinct visitor_id) from touchpoints
          where workspace_id = ${ws.id} and platform = ${p.platform} and ${tsRange(sql`occurred_at`, ws, p)}) visitors,
        (select coalesce(sum(credit), 0) from attribution_credits
          where workspace_id = ${ws.id} and model = ${p.model} and conversion_type = 'lead' and platform = ${p.platform}
            and ${tsRange(sql`conversion_at`, ws, p)}) leads,
        (select coalesce(sum(credit), 0) from attribution_credits
          where workspace_id = ${ws.id} and model = ${p.model} and conversion_type = 'customer' and platform = ${p.platform}
            and ${tsRange(sql`conversion_at`, ws, p)}) customers,
        (select coalesce(sum(revenue_minor), 0) from attribution_credits
          where workspace_id = ${ws.id} and model = ${p.model} and conversion_type = 'revenue' and platform = ${p.platform}
            and currency = ${rc} and contact_id in (select contact_id from nc)
            and ${tsRange(sql`conversion_at`, ws, p)}) revenue`
    : sql`
      with fp as (${firstPayments(ws, p)}), fl as (${firstLeads(ws, p)}),
      nc as (select contact_id from fp where ${tsRange(sql`at_`, ws, p)})
      select
        (select count(distinct visitor_id) from events
          where workspace_id = ${ws.id} and ${tsRange(sql`occurred_at`, ws, p)}) visitors,
        (select count(*) from fl where ${tsRange(sql`at_`, ws, p)}) leads,
        (select count(*) from nc) customers,
        (select coalesce(sum(r.amount_minor), 0) from revenue_events r
          where r.workspace_id = ${ws.id} and r.currency = ${rc} and r.contact_id in (select contact_id from nc)
            and ${tsRange(sql`r.occurred_at`, ws, p)}) revenue`;
  const [r] = rows<Record<string, string | null>>(await db.execute(q));
  const visitors = n(r?.visitors);
  const leads = round2(n(r?.leads));
  const customers = round2(n(r?.customers));
  const revenueMinor = n(r?.revenue);
  return {
    start: p.start,
    end: p.end,
    visitors,
    leads,
    customers,
    revenueMinor,
    leadRate: ratio(leads, visitors),
    closeRate: ratio(customers, leads),
    visitorRate: ratio(customers, visitors),
    revenuePerVisitorMinor: visitors > 0 ? Math.round(revenueMinor / visitors) : null,
  };
}

/**
 * Visitors → leads → customers → revenue for the period, with the previous period of the same
 * length for comparison ghost bars. Counts are "happened in this period" (a customer who became
 * a lead last month still counts here), so step rates are period rates, not a cohort funnel.
 */
export async function funnel(db: DB, ws: Workspace, p: ReportParams, opts: { compare?: boolean } = {}): Promise<FunnelReport> {
  const [cur, previous] = await Promise.all([
    funnelCounts(db, ws, p),
    opts.compare === false ? Promise.resolve(null) : funnelCounts(db, ws, previousPeriod(p)),
  ]);
  return { ...cur, currency: ws.reportingCurrency, model: p.model, previous };
}

// ---------------------------------------------------------------- conversions heatmap

export type HeatmapCell = {
  /** 0 = Monday … 6 = Sunday, in the workspace timezone. */
  dow: number;
  /** 0–23, in the workspace timezone. */
  hour: number;
  leads: number;
  payments: number;
};

export type ConversionsHeatmap = {
  timezone: string;
  start: string;
  end: string;
  /** Always 168 cells, Monday 00:00 first. */
  cells: HeatmapCell[];
  totals: { leads: number; payments: number };
  max: { leads: number; payments: number };
};

/** Leads (every submission) and payments by weekday × hour of day in the workspace timezone. */
export async function conversionsHeatmap(db: DB, ws: Workspace, p: Period): Promise<ConversionsHeatmap> {
  const tz = ws.timezone;
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with x as (
        select occurred_at at_, 'lead' kind from leads
        where workspace_id = ${ws.id} and ${tsRange(sql`occurred_at`, ws, p)}
        union all
        select occurred_at, 'payment' from revenue_events
        where workspace_id = ${ws.id} and type = 'payment' and ${tsRange(sql`occurred_at`, ws, p)}
      )
      select extract(isodow from at_ at time zone ${tz})::int - 1 dow, extract(hour from at_ at time zone ${tz})::int h,
        count(*) filter (where kind = 'lead') leads, count(*) filter (where kind = 'payment') payments
      from x group by 1, 2`),
  );
  const cells: HeatmapCell[] = Array.from({ length: 168 }, (_, i) => ({ dow: Math.floor(i / 24), hour: i % 24, leads: 0, payments: 0 }));
  for (const r of result) {
    const cell = cells[n(r.dow) * 24 + n(r.h)];
    if (!cell) continue;
    cell.leads = n(r.leads);
    cell.payments = n(r.payments);
  }
  return {
    timezone: tz,
    start: p.start,
    end: p.end,
    cells,
    totals: { leads: cells.reduce((a, c) => a + c.leads, 0), payments: cells.reduce((a, c) => a + c.payments, 0) },
    max: { leads: Math.max(0, ...cells.map((c) => c.leads)), payments: Math.max(0, ...cells.map((c) => c.payments)) },
  };
}
