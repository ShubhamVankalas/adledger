import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { AttributionModel, Channel, Platform } from "./db/schema";
import { allocate } from "./money";
import { todayIn } from "./period";
import { csvCell } from "./privacy";
import { maskEmail, type ReportParams } from "./reports";
import { getConnection, saveConnection, type Workspace } from "./settings";

// Money truth: Ad Receipts, the Profit Ledger and Time-to-Money guardrails. Same conventions as
// reports.ts: every number comes from SQL (or from money.ts allocate() over SQL rows, so parts
// always add up), money is integer minor units of the reporting currency, days are workspace-local.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round2 = (v: number) => Math.round(v * 100) / 100;
const DAY_MS = 86_400_000;

function tsRange(col: SQL, ws: Workspace, p: Pick<ReportParams, "start" | "end">) {
  return sql`${col} >= (${p.start}::date)::timestamp at time zone ${ws.timezone}
    and ${col} < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
}
const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// ================================================================ unit economics

/**
 * Stored like the retention policy: a `connections` row (provider "unit_economics") so no
 * migration is needed. Config values are decimal strings, parsed here into basis points and
 * minor units so the maths stays in integers: { grossMarginPct, feePct, feeFixedMinor, shippingPerOrderMinor }.
 */
export const UNIT_ECONOMICS_PROVIDER = "unit_economics";

export type UnitEconomics = {
  configured: boolean;
  /** Gross margin in basis points (10000 = 100%). COGS share = 10000 − grossMarginBps. */
  grossMarginBps: number;
  /** Payment processing fee in basis points of gross payments. */
  feeBps: number;
  /** Fixed fee per payment, minor units. */
  feeFixedMinor: number;
  /** Shipping and fulfilment cost per order, minor units. */
  shippingPerOrderMinor: number;
  updatedAt: string | null;
};

export const NO_UNIT_ECONOMICS: UnitEconomics = {
  configured: false,
  grossMarginBps: 10_000,
  feeBps: 0,
  feeFixedMinor: 0,
  shippingPerOrderMinor: 0,
  updatedAt: null,
};

/** "35.5" → 3550 basis points. Accepts 0–100 with up to two decimals; anything else is null. */
export function parsePercent(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** 3550 → "35.5", 290 → "2.9", 0 → "0". */
export function bpsToPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export async function getUnitEconomics(db: DB, workspaceId: string): Promise<UnitEconomics> {
  const conn = await getConnection(workspaceId, UNIT_ECONOMICS_PROVIDER, db);
  if (!conn || !conn.enabled) return NO_UNIT_ECONOMICS;
  const c = conn.config;
  const int = (v: string | undefined) => {
    const x = Number(v);
    return Number.isSafeInteger(x) && x >= 0 ? x : 0;
  };
  return {
    configured: true,
    grossMarginBps: parsePercent(c.grossMarginPct ?? "") ?? 10_000,
    feeBps: parsePercent(c.feePct ?? "") ?? 0,
    feeFixedMinor: int(c.feeFixedMinor),
    shippingPerOrderMinor: int(c.shippingPerOrderMinor),
    updatedAt: c.updatedAt ?? null,
  };
}

export async function saveUnitEconomics(
  db: DB,
  workspaceId: string,
  ue: Pick<UnitEconomics, "grossMarginBps" | "feeBps" | "feeFixedMinor" | "shippingPerOrderMinor">,
) {
  for (const [k, v] of Object.entries(ue)) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${k} must be a whole number of 0 or more`);
  }
  if (ue.grossMarginBps > 10_000 || ue.feeBps > 10_000) throw new Error("Percentages must be between 0 and 100");
  await saveConnection(
    workspaceId,
    UNIT_ECONOMICS_PROVIDER,
    {
      mode: "live",
      enabled: true,
      config: {
        grossMarginPct: bpsToPercent(ue.grossMarginBps),
        feePct: bpsToPercent(ue.feeBps),
        feeFixedMinor: String(ue.feeFixedMinor),
        shippingPerOrderMinor: String(ue.shippingPerOrderMinor),
        updatedAt: new Date().toISOString(),
      },
    },
    db,
  );
}

export async function clearUnitEconomics(db: DB, workspaceId: string) {
  await saveConnection(workspaceId, UNIT_ECONOMICS_PROVIDER, { mode: "live", enabled: false, config: {} }, db);
}

/**
 * SQL for the cost lines of a revenue amount: `net`, `gross` and `orders` are SQL expressions.
 * contribution = net − COGS (net × (1 − margin)) − fees (gross × fee% + orders × fixed fee) − orders × shipping.
 * Each line is rounded half away from zero to whole minor units.
 */
function costLines(ue: UnitEconomics, net: SQL, gross: SQL, orders: SQL) {
  const cogsBps = 10_000 - ue.grossMarginBps;
  return sql`round(${net} * ${cogsBps}::numeric / 10000) as cogs,
    round(${gross} * ${ue.feeBps}::numeric / 10000) + round(${orders} * ${ue.feeFixedMinor}::numeric) as fees,
    round(${orders} * ${ue.shippingPerOrderMinor}::numeric) as shipping`;
}

// ================================================================ profit ledger (P&L)

export type ProfitLedger = {
  currency: string;
  start: string;
  end: string;
  unitEconomics: UnitEconomics;
  grossSalesMinor: number;
  /** Refunds in the period (negative). */
  refundsMinor: number;
  netRevenueMinor: number;
  orders: number;
  cogsMinor: number;
  feesMinor: number;
  shippingMinor: number;
  contributionMinor: number;
  spendMinor: number;
  profitAfterAdsMinor: number;
  /** Net revenue ÷ ad spend (a.k.a. blended ROAS). */
  mer: number | null;
  /** Contribution ÷ ad spend. 1.0 = ads paid for themselves after costs. */
  poas: number | null;
  /** ROAS needed to break even on gross margin: 1 ÷ margin. null without a margin. */
  breakEvenRoas: number | null;
};

/** Whole-business P&L for the period: every payment and refund in the reporting currency, all ad spend. */
export async function profitLedger(db: DB, ws: Workspace, p: Pick<ReportParams, "start" | "end" | "platform">, ue?: UnitEconomics): Promise<ProfitLedger> {
  const u = ue ?? (await getUnitEconomics(db, ws.id));
  const rc = ws.reportingCurrency;
  const [r] = rows<Record<string, string>>(
    await db.execute(sql`
      with rev as (
        select coalesce(sum(amount_minor) filter (where type = 'payment'), 0) gross,
          coalesce(sum(amount_minor) filter (where type = 'refund'), 0) refunds,
          coalesce(sum(amount_minor), 0) net,
          count(*) filter (where type = 'payment') orders
        from revenue_events
        where workspace_id = ${ws.id} and currency = ${rc} and ${tsRange(sql`occurred_at`, ws, p)}
      ), s as (
        select coalesce(sum(spend_minor), 0) spend from ad_insights_daily
        where workspace_id = ${ws.id} and currency = ${rc} and date between ${p.start}::date and ${p.end}::date
          ${p.platform ? sql`and platform = ${p.platform}` : sql``}
      ), x as (
        select rev.*, s.spend, ${costLines(u, sql`rev.net`, sql`rev.gross`, sql`rev.orders`)} from rev, s
      )
      select *, net - cogs - fees - shipping as contribution, net - cogs - fees - shipping - spend as profit from x`),
  );
  const spendMinor = n(r.spend);
  const contributionMinor = n(r.contribution);
  const netRevenueMinor = n(r.net);
  return {
    currency: rc,
    start: p.start,
    end: p.end,
    unitEconomics: u,
    grossSalesMinor: n(r.gross),
    refundsMinor: n(r.refunds),
    netRevenueMinor,
    orders: n(r.orders),
    cogsMinor: n(r.cogs),
    feesMinor: n(r.fees),
    shippingMinor: n(r.shipping),
    contributionMinor,
    spendMinor,
    profitAfterAdsMinor: n(r.profit),
    mer: ratio(netRevenueMinor, spendMinor),
    poas: ratio(contributionMinor, spendMinor),
    breakEvenRoas: u.grossMarginBps > 0 ? 10_000 / u.grossMarginBps : null,
  };
}

export type ProfitLevel = "platform" | "campaign" | "ad";

export type ProfitRow = {
  id: string;
  name: string;
  platform: Platform;
  status: string | null;
  externalId: string | null;
  parentName: string | null;
  spendMinor: number;
  /** Credited net revenue (payments + refunds) under the selected model. */
  revenueMinor: number;
  grossMinor: number;
  refundsMinor: number;
  /** Credited payments (fractional under linear). */
  orders: number;
  cogsMinor: number;
  feesMinor: number;
  shippingMinor: number;
  contributionMinor: number;
  profitAfterAdsMinor: number;
  roas: number | null;
  poas: number | null;
  /** New customers credited in the period. */
  customers: number;
  /** Of those, the credited share with 2+ payments to date. */
  repeatRate: number | null;
  /** Of those, the credited share with at least one refund to date. */
  refunderRate: number | null;
  /** |refunds| ÷ gross payments credited in the period. */
  refundRate: number | null;
};

/** Profit and customer quality per platform, campaign or ad, from credited revenue under `p.model`. */
export async function profitRows(db: DB, ws: Workspace, p: ReportParams, level: ProfitLevel, ue?: UnitEconomics): Promise<ProfitRow[]> {
  const u = ue ?? (await getUnitEconomics(db, ws.id));
  const rc = ws.reportingCurrency;
  const col = sql.raw({ platform: "platform", campaign: "campaign_id", ad: "ad_id" }[level]);
  const key = level === "platform" ? sql`${col}::text` : col;
  const acKey = level === "platform" ? sql`ac.platform::text` : sql`ac.${col}`;
  const platformOnly = (alias: string) => (p.platform ? sql`and ${sql.raw(alias)}platform = ${p.platform}` : sql``);
  const entity =
    level === "campaign"
      ? { select: sql`e.name, e.platform, e.status, e.external_id, null::text parent_name`, join: sql`join campaigns e on e.id = ids.id` }
      : level === "ad"
        ? { select: sql`e.name, e.platform, e.status, e.external_id, pc.name parent_name`, join: sql`join ads e on e.id = ids.id left join campaigns pc on pc.id = e.campaign_id` }
        : { select: sql`ids.id::text name, ids.id::text platform, null::text status, null::text external_id, null::text parent_name`, join: sql`` };
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with s as (
        select ${key} id, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and currency = ${rc} and date between ${p.start}::date and ${p.end}::date ${platformOnly("")}
        group by 1
      ), rev as (
        select ${acKey} id, sum(ac.revenue_minor) net,
          coalesce(sum(ac.revenue_minor) filter (where r.type = 'payment'), 0) gross,
          coalesce(sum(ac.revenue_minor) filter (where r.type = 'refund'), 0) refunds,
          coalesce(sum(ac.credit) filter (where r.type = 'payment'), 0) orders
        from attribution_credits ac join revenue_events r on r.id = ac.conversion_id
        where ac.workspace_id = ${ws.id} and ac.model = ${p.model} and ac.conversion_type = 'revenue' and ac.currency = ${rc}
          and ac.${col} is not null and ac.campaign_id is not null and ${tsRange(sql`ac.conversion_at`, ws, p)} ${platformOnly("ac.")}
        group by 1
      ), buyer as (
        select contact_id, count(*) filter (where type = 'payment') payments, count(*) filter (where type = 'refund') refunds
        from revenue_events where workspace_id = ${ws.id} and contact_id is not null group by 1
      ), cust as (
        select ${acKey} id, sum(ac.credit) customers,
          coalesce(sum(ac.credit) filter (where b.payments >= 2), 0) repeaters,
          coalesce(sum(ac.credit) filter (where b.refunds > 0), 0) refunders
        from attribution_credits ac left join buyer b on b.contact_id = ac.contact_id
        where ac.workspace_id = ${ws.id} and ac.model = ${p.model} and ac.conversion_type = 'customer'
          and ac.${col} is not null and ac.campaign_id is not null and ${tsRange(sql`ac.conversion_at`, ws, p)} ${platformOnly("ac.")}
        group by 1
      ), ids as (
        select id from s union select id from rev union select id from cust
      ), x as (
        select ids.id, ${entity.select},
          coalesce(s.spend, 0) spend, coalesce(rev.net, 0) net, coalesce(rev.gross, 0) gross, coalesce(rev.refunds, 0) refunds,
          coalesce(rev.orders, 0) orders, coalesce(cust.customers, 0) customers, coalesce(cust.repeaters, 0) repeaters,
          coalesce(cust.refunders, 0) refunders,
          ${costLines(u, sql`coalesce(rev.net, 0)`, sql`coalesce(rev.gross, 0)`, sql`coalesce(rev.orders, 0)`)}
        from ids
        left join s on s.id = ids.id
        left join rev on rev.id = ids.id
        left join cust on cust.id = ids.id
        ${entity.join}
        ${level === "platform" ? sql`` : sql`where e.workspace_id = ${ws.id}`}
      )
      select *, net - cogs - fees - shipping as contribution from x
      order by spend desc, net desc, name`),
  );
  return result.map((r) => {
    const spendMinor = n(r.spend);
    const revenueMinor = n(r.net);
    const grossMinor = n(r.gross);
    const refundsMinor = n(r.refunds);
    const contributionMinor = n(r.contribution);
    const customers = n(r.customers);
    return {
      id: r.id!,
      name: r.name ?? r.id!,
      platform: r.platform as Platform,
      status: r.status,
      externalId: r.external_id,
      parentName: r.parent_name,
      spendMinor,
      revenueMinor,
      grossMinor,
      refundsMinor,
      orders: round2(n(r.orders)),
      cogsMinor: n(r.cogs),
      feesMinor: n(r.fees),
      shippingMinor: n(r.shipping),
      contributionMinor,
      profitAfterAdsMinor: contributionMinor - spendMinor,
      roas: ratio(revenueMinor, spendMinor),
      poas: ratio(contributionMinor, spendMinor),
      customers: round2(customers),
      repeatRate: ratio(n(r.repeaters), customers),
      refunderRate: ratio(n(r.refunders), customers),
      refundRate: ratio(Math.abs(refundsMinor), grossMinor),
    };
  });
}

// ================================================================ ad receipts

/**
 * How spend is priced into customers. Either way every ad-day's spend is split with allocate(),
 * so customer costs + unallocated = spend to the minor unit.
 *   share   (default) each ad's spend in a calendar month is shared by the customers credited to
 *           that ad that month, by credit. The fully loaded cost: what it took to win them.
 *   clicks  only the clicks a customer made: credit × the ad's cost per click that day. Clicks
 *           that never bought stay unallocated, so this is the marginal cost of the customer.
 */
export type CostBasis = "share" | "clicks";
export const COST_BASES: readonly CostBasis[] = ["share", "clicks"];
export const parseCostBasis = (v: unknown): CostBasis => (v === "clicks" ? "clicks" : "share");

/** One credited paid touch of a customer (their first-payment conversion) on one ad-day. */
export type CreditTouch = {
  contactId: string;
  touchpointId: string;
  adId: string;
  day: string;
  credit: number;
};

/** Spend and clicks of one ad on one workspace-local day, in the reporting currency. */
export type AdDaySpend = { adId: string; day: string; spendMinor: number; clicks: number };

export type Allocation = {
  /** touchpointId → cost in minor units. */
  costByTouch: Map<string, number>;
  allocatedMinor: number;
  /** Spend not linked to any customer (clicks that didn't buy, or ad-months with no buyer). */
  unallocatedMinor: number;
  /** Part of unallocatedMinor on ad-days that reported spend but zero clicks and no customers. */
  noClickMinor: number;
};

/** The day (clicks) or month (share) a day's spend is pooled in. */
const poolOf = (basis: CostBasis, day: string) => (basis === "clicks" ? day : day.slice(0, 7));
const poolKey = (adId: string, pool: string) => `${adId}|${pool}`;
const byContactThenTouch = (a: CreditTouch, b: CreditTouch) =>
  a.contactId < b.contactId ? -1 : a.contactId > b.contactId ? 1 : a.touchpointId < b.touchpointId ? -1 : a.touchpointId > b.touchpointId ? 1 : 0;
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
function monthEnd(day: string) {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDays(d.toISOString().slice(0, 10), -1);
}
/** First and last day of the pools that [from, to] touches. */
const poolBounds = (basis: CostBasis, from: string, to: string) => (basis === "clicks" ? [from, to] : [monthStart(from), monthEnd(to)]);

/**
 * Split each ad-day's spend between customers and "unallocated" (see CostBasis). With `clicks`,
 * every click costs spend ÷ clicks, a customer's touch takes `credit` clicks' worth and the clicks
 * nobody bought from keep the rest (when more credited touches than clicks were recorded,
 * customers share the whole ad-day). With `share`, the day's spend goes to the customers credited
 * to the ad in that month, by credit. allocate() makes the parts add up to each ad-day exactly.
 */
export function allocateAdDays(adDays: AdDaySpend[], credits: CreditTouch[], basis: CostBasis = "clicks"): Allocation {
  const byKey = new Map<string, CreditTouch[]>();
  for (const c of credits) {
    const k = poolKey(c.adId, poolOf(basis, c.day));
    const list = byKey.get(k);
    if (list) list.push(c);
    else byKey.set(k, [c]);
  }
  for (const list of byKey.values()) list.sort(byContactThenTouch);
  const costByTouch = new Map<string, number>();
  let allocatedMinor = 0;
  let unallocatedMinor = 0;
  let noClickMinor = 0;
  for (const d of adDays) {
    const cs = byKey.get(poolKey(d.adId, poolOf(basis, d.day))) ?? [];
    if (cs.length === 0) {
      unallocatedMinor += d.spendMinor;
      if (d.clicks === 0) noClickMinor += d.spendMinor;
      continue;
    }
    const weights = cs.map((c) => c.credit);
    if (basis === "clicks") weights.push(Math.max(0, d.clicks - weights.reduce((a, b) => a + b, 0)));
    const parts = allocate(d.spendMinor, weights);
    cs.forEach((c, i) => {
      costByTouch.set(c.touchpointId, (costByTouch.get(c.touchpointId) ?? 0) + parts[i]);
      allocatedMinor += parts[i];
    });
    if (basis === "clicks") unallocatedMinor += parts[cs.length];
  }
  return { costByTouch, allocatedMinor, unallocatedMinor, noClickMinor };
}

type CreditTouchRow = CreditTouch & {
  campaignId: string | null;
  platform: Platform | null;
  at: string;
  adName: string | null;
  campaignName: string | null;
};

async function customerCreditTouches(db: DB, ws: Workspace, model: AttributionModel, filter: SQL): Promise<CreditTouchRow[]> {
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      select ac.contact_id, ac.touchpoint_id, ac.ad_id, ac.campaign_id, ac.platform, ac.credit, t.occurred_at,
        to_char((t.occurred_at at time zone ${ws.timezone})::date, 'YYYY-MM-DD') as day, a.name ad_name, c.name campaign_name
      from attribution_credits ac
      join touchpoints t on t.id = ac.touchpoint_id
      left join ads a on a.id = ac.ad_id
      left join campaigns c on c.id = ac.campaign_id
      where ac.workspace_id = ${ws.id} and ac.model = ${model} and ac.conversion_type = 'customer'
        and ac.ad_id is not null and ac.contact_id is not null ${filter}`),
  );
  return result.map((r) => ({
    contactId: r.contact_id!,
    touchpointId: r.touchpoint_id!,
    adId: r.ad_id!,
    campaignId: r.campaign_id,
    platform: r.platform as Platform | null,
    credit: n(r.credit),
    at: iso(r.occurred_at)!,
    day: r.day!,
    adName: r.ad_name,
    campaignName: r.campaign_name,
  }));
}

async function adDaySpend(db: DB, ws: Workspace, filter: SQL): Promise<AdDaySpend[]> {
  const result = rows<Record<string, string>>(
    await db.execute(sql`
      select ad_id, to_char(date, 'YYYY-MM-DD') as day, sum(spend_minor) spend, sum(clicks) clicks
      from ad_insights_daily
      where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency} ${filter}
      group by 1, 2 order by 1, 2`),
  );
  return result.map((r) => ({ adId: r.ad_id, day: r.day, spendMinor: n(r.spend), clicks: n(r.clicks) }));
}

export type CostLine = {
  touchpointId: string;
  adId: string;
  adName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  platform: Platform | null;
  /** Workspace-local day of the click. */
  day: string;
  touchedAt: string;
  credit: number;
  costMinor: number;
  basis: CostBasis;
  /** The pool the cost comes from: the click's day (clicks) or month, YYYY-MM (share). */
  pool: string;
  /** The ad's spend and clicks in the pool (null when no spend was recorded). */
  poolSpendMinor: number | null;
  poolClicks: number | null;
  /** Σ customer credit on this ad in the pool: everyone who shares its spend (share basis). */
  poolCredits: number;
};

/**
 * Acquisition cost of each contact: their credited paid touches (first-payment conversion, `model`)
 * priced from the ad's spend (see CostBasis). Every pool involved is allocated with *all* customers
 * in it, so a contact's number matches the workspace ledger to the minor unit.
 */
export async function contactCosts(
  db: DB,
  ws: Workspace,
  model: AttributionModel,
  contactIds: string[],
  basis: CostBasis = "share",
): Promise<Map<string, { costMinor: number; lines: CostLine[] }>> {
  const out = new Map<string, { costMinor: number; lines: CostLine[] }>();
  if (contactIds.length === 0) return out;
  const own = await customerCreditTouches(db, ws, model, sql`and ac.contact_id in (${uuidList(contactIds)})`);
  for (const id of contactIds) out.set(id, { costMinor: 0, lines: [] });
  if (own.length === 0) return out;

  const keyOf = (adId: string, day: string) => poolKey(adId, poolOf(basis, day));
  const keys = new Set(own.map((c) => keyOf(c.adId, c.day)));
  const adIds = [...new Set(own.map((c) => c.adId))];
  const days = own.map((c) => c.day).sort();
  const [from, to] = poolBounds(basis, days[0], days.at(-1)!);
  // Local days can sit a day either side of the UTC timestamp; the exact pool filter follows.
  const [all, spend] = await Promise.all([
    customerCreditTouches(
      db,
      ws,
      model,
      sql`and ac.ad_id in (${uuidList(adIds)})
        and t.occurred_at >= ${addDays(from, -1)}::timestamptz and t.occurred_at < ${addDays(to, 2)}::timestamptz`,
    ).then((list) => list.filter((c) => keys.has(keyOf(c.adId, c.day)))),
    adDaySpend(db, ws, sql`and ad_id in (${uuidList(adIds)}) and date between ${from}::date and ${to}::date`).then((list) =>
      list.filter((d) => keys.has(keyOf(d.adId, d.day))),
    ),
  ]);
  const alloc = allocateAdDays(spend, all, basis);
  const pools = new Map<string, { spendMinor: number; clicks: number }>();
  for (const d of spend) {
    const k = keyOf(d.adId, d.day);
    const p = pools.get(k) ?? { spendMinor: 0, clicks: 0 };
    p.spendMinor += d.spendMinor;
    p.clicks += d.clicks;
    pools.set(k, p);
  }
  const creditsBy = new Map<string, number>();
  for (const c of all) creditsBy.set(keyOf(c.adId, c.day), (creditsBy.get(keyOf(c.adId, c.day)) ?? 0) + c.credit);
  for (const c of own.sort((a, b) => a.at.localeCompare(b.at))) {
    const k = keyOf(c.adId, c.day);
    const pool = pools.get(k);
    const costMinor = alloc.costByTouch.get(c.touchpointId) ?? 0;
    const entry = out.get(c.contactId)!;
    entry.costMinor += costMinor;
    entry.lines.push({
      touchpointId: c.touchpointId,
      adId: c.adId,
      adName: c.adName,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      platform: c.platform,
      day: c.day,
      touchedAt: c.at,
      credit: c.credit,
      costMinor,
      basis,
      pool: poolOf(basis, c.day),
      poolSpendMinor: pool?.spendMinor ?? null,
      poolClicks: pool?.clicks ?? null,
      poolCredits: round2(creditsBy.get(k) ?? c.credit),
    });
  }
  return out;
}

export type AcquisitionLedger = {
  currency: string;
  model: AttributionModel;
  basis: CostBasis;
  start: string;
  end: string;
  /** Σ ad spend in the period (reporting currency), the same number as the Overview. */
  spendMinor: number;
  /** Σ customer acquisition costs. allocatedMinor + unallocatedMinor = spendMinor exactly. */
  allocatedMinor: number;
  unallocatedMinor: number;
  noClickMinor: number;
  customers: number;
  contacts: { contactId: string; costMinor: number }[];
};

/**
 * Every ad-day of the period split into customer costs plus an "unallocated" line. With the
 * share basis, customers credited in the period's first or last month share that month's in-range
 * days, so a contact's cost here equals their receipt when the period covers whole months.
 */
export async function acquisitionLedger(
  db: DB,
  ws: Workspace,
  p: Pick<ReportParams, "start" | "end" | "model">,
  basis: CostBasis = "share",
): Promise<AcquisitionLedger> {
  const [from, to] = poolBounds(basis, p.start, p.end);
  const [credits, spend] = await Promise.all([
    customerCreditTouches(db, ws, p.model, sql`and (t.occurred_at at time zone ${ws.timezone})::date between ${from}::date and ${to}::date`),
    adDaySpend(db, ws, sql`and date between ${p.start}::date and ${p.end}::date`),
  ]);
  const alloc = allocateAdDays(spend, credits, basis);
  const perContact = new Map<string, number>();
  for (const c of credits) {
    const cost = alloc.costByTouch.get(c.touchpointId);
    if (cost !== undefined) perContact.set(c.contactId, (perContact.get(c.contactId) ?? 0) + cost);
  }
  return {
    currency: ws.reportingCurrency,
    model: p.model,
    basis,
    start: p.start,
    end: p.end,
    spendMinor: spend.reduce((s, d) => s + d.spendMinor, 0),
    allocatedMinor: alloc.allocatedMinor,
    unallocatedMinor: alloc.unallocatedMinor,
    noClickMinor: alloc.noClickMinor,
    customers: perContact.size,
    contacts: [...perContact].map(([contactId, costMinor]) => ({ contactId, costMinor })).sort((a, b) => b.costMinor - a.costMinor),
  };
}

export type Payback = {
  status: "paid_back" | "not_yet" | "no_ad_cost";
  /** When cumulative net revenue last crossed the acquisition cost (and stayed above it). */
  at: string | null;
  /** Days from the first paid click to `at`. */
  days: number | null;
  /** Still to earn back (0 once paid back). */
  remainingMinor: number;
};

type MoneyEvent = { id: string; type: "payment" | "refund"; amountMinor: number; currency: string; at: string; cumMinor: number };

async function contactMoney(db: DB, ws: Workspace, contactIds: string[]): Promise<Map<string, MoneyEvent[]>> {
  const out = new Map<string, MoneyEvent[]>();
  if (contactIds.length === 0) return out;
  const result = rows<Record<string, string>>(
    await db.execute(sql`
      select contact_id, id, type, amount_minor, currency, occurred_at,
        sum(amount_minor) filter (where currency = ${ws.reportingCurrency})
          over (partition by contact_id order by occurred_at, id) cum
      from revenue_events
      where workspace_id = ${ws.id} and contact_id in (${uuidList(contactIds)})
      order by contact_id, occurred_at, id`),
  );
  for (const r of result) {
    const list = out.get(r.contact_id) ?? [];
    list.push({ id: r.id, type: r.type as "payment" | "refund", amountMinor: n(r.amount_minor), currency: r.currency, at: iso(r.occurred_at)!, cumMinor: n(r.cum) });
    out.set(r.contact_id, list);
  }
  return out;
}

/** When a customer's net revenue covered what they cost (pure; exported for tests). */
export function paybackOf(costMinor: number, events: Pick<MoneyEvent, "at" | "cumMinor">[], firstClickAt: string | null): Payback {
  if (costMinor <= 0) return { status: "no_ad_cost", at: null, days: null, remainingMinor: 0 };
  let crossedAt: string | null = null;
  let prev = 0;
  for (const e of events) {
    if (e.cumMinor >= costMinor && prev < costMinor) crossedAt = e.at;
    if (e.cumMinor < costMinor) crossedAt = null;
    prev = e.cumMinor;
  }
  const last = events.at(-1)?.cumMinor ?? 0;
  if (!crossedAt || last < costMinor) return { status: "not_yet", at: null, days: null, remainingMinor: costMinor - Math.max(0, last) };
  const days = firstClickAt ? Math.max(0, Math.floor((Date.parse(crossedAt) - Date.parse(firstClickAt)) / DAY_MS)) : null;
  return { status: "paid_back", at: crossedAt, days, remainingMinor: 0 };
}

export type EarnedLine = {
  key: string;
  touchpointId: string | null;
  adId: string | null;
  adName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  platform: Platform | null;
  channel: Channel | null;
  source: string | null;
  /** Share of the payment (0–1). Aggregated lines sum shares weighted by amount. */
  credit: number;
  revenueMinor: number;
  touchedAt: string | null;
};

async function earnedLines(db: DB, ws: Workspace, model: AttributionModel, filter: SQL): Promise<(EarnedLine & { conversionId: string })[]> {
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      select ac.conversion_id, ac.touchpoint_id, ac.ad_id, ac.campaign_id, ac.platform, ac.channel, ac.credit, ac.revenue_minor,
        t.occurred_at, t.utm_source, a.name ad_name, c.name campaign_name
      from attribution_credits ac
      left join touchpoints t on t.id = ac.touchpoint_id
      left join ads a on a.id = ac.ad_id
      left join campaigns c on c.id = ac.campaign_id
      where ac.workspace_id = ${ws.id} and ac.model = ${model} and ac.conversion_type = 'revenue' ${filter}
      order by ac.revenue_minor desc, t.occurred_at nulls last`),
  );
  return result.map((r) => ({
    conversionId: r.conversion_id!,
    key: r.ad_id ?? r.campaign_id ?? (r.touchpoint_id ? `channel:${r.channel}` : "unattributed"),
    touchpointId: r.touchpoint_id,
    adId: r.ad_id,
    adName: r.ad_name,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    platform: r.platform as Platform | null,
    channel: r.channel as Channel | null,
    source: r.utm_source,
    credit: n(r.credit),
    revenueMinor: n(r.revenue_minor),
    touchedAt: iso(r.occurred_at),
  }));
}

export type ContactReceipt = {
  currency: string;
  model: AttributionModel;
  basis: CostBasis;
  contact: { id: string; name: string | null; email: string | null; lifecycle: string; firstSeenAt: string };
  /** What this customer cost under `basis` (see CostBasis). */
  costMinor: number;
  costLines: CostLine[];
  firstClickAt: string | null;
  lifetime: { grossMinor: number; refundsMinor: number; netMinor: number; payments: number; firstPaymentAt: string | null };
  payback: Payback;
  /** Revenue to date credited per ad / channel (sums to lifetime net in the reporting currency). */
  earnedBy: EarnedLine[];
  payments: { id: string; type: "payment" | "refund"; amountMinor: number; currency: string; at: string }[];
  /** Contribution after COGS, fees and shipping minus acquisition cost (null without unit economics). */
  profit: { contributionMinor: number; profitMinor: number } | null;
};

/**
 * The Ad Receipt of one contact: which ads earned their revenue, what acquiring them cost, and
 * when they paid it back. Email is masked unless `revealEmail` (the caller checked permission).
 */
export async function contactReceipt(
  db: DB,
  ws: Workspace,
  contactId: string,
  model: AttributionModel,
  opts: { revealEmail?: boolean; unitEconomics?: UnitEconomics; basis?: CostBasis } = {},
): Promise<ContactReceipt | null> {
  const [contact] = rows<Record<string, string | null>>(
    await db.execute(sql`select id, name, email, lifecycle, first_seen_at from contacts where workspace_id = ${ws.id} and id = ${contactId}::uuid`),
  );
  if (!contact) return null;
  const rc = ws.reportingCurrency;
  const [costs, money, earned, ue] = await Promise.all([
    contactCosts(db, ws, model, [contactId], opts.basis),
    contactMoney(db, ws, [contactId]),
    earnedLines(db, ws, model, sql`and ac.contact_id = ${contactId}::uuid and ac.currency = ${rc}`),
    opts.unitEconomics ? Promise.resolve(opts.unitEconomics) : getUnitEconomics(db, ws.id),
  ]);
  const { costMinor, lines } = costs.get(contactId)!;
  const events = money.get(contactId) ?? [];
  const inRc = events.filter((e) => e.currency === rc);
  const firstClickAt = lines[0]?.touchedAt ?? null;
  const grossMinor = inRc.filter((e) => e.type === "payment").reduce((s, e) => s + e.amountMinor, 0);
  const refundsMinor = inRc.filter((e) => e.type === "refund").reduce((s, e) => s + e.amountMinor, 0);
  const paymentsCount = inRc.filter((e) => e.type === "payment").length;

  const agg = new Map<string, EarnedLine>();
  for (const e of earned) {
    const prev = agg.get(e.key);
    if (prev) {
      prev.revenueMinor += e.revenueMinor;
      if (e.touchedAt && (!prev.touchedAt || e.touchedAt < prev.touchedAt)) prev.touchedAt = e.touchedAt;
    } else agg.set(e.key, { ...e });
  }
  const netMinor = grossMinor + refundsMinor;
  const earnedBy = [...agg.values()]
    .map((e) => ({ ...e, credit: netMinor !== 0 ? e.revenueMinor / netMinor : 0 }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);

  let profit: ContactReceipt["profit"] = null;
  if (ue.configured) {
    const [r] = rows<Record<string, string>>(
      await db.execute(sql`select ${costLines(ue, sql`${netMinor}::numeric`, sql`${grossMinor}::numeric`, sql`${paymentsCount}::numeric`)}`),
    );
    const contributionMinor = netMinor - n(r.cogs) - n(r.fees) - n(r.shipping);
    profit = { contributionMinor, profitMinor: contributionMinor - costMinor };
  }

  return {
    currency: rc,
    model,
    basis: opts.basis ?? "share",
    contact: {
      id: contact.id!,
      name: contact.name,
      email: opts.revealEmail ? contact.email : maskEmail(contact.email),
      lifecycle: contact.lifecycle!,
      firstSeenAt: iso(contact.first_seen_at)!,
    },
    costMinor,
    costLines: lines,
    firstClickAt,
    lifetime: { grossMinor, refundsMinor, netMinor, payments: paymentsCount, firstPaymentAt: inRc.find((e) => e.type === "payment")?.at ?? null },
    payback: paybackOf(costMinor, inRc, firstClickAt),
    earnedBy,
    payments: events.map((e) => ({ id: e.id, type: e.type, amountMinor: e.amountMinor, currency: e.currency, at: e.at })),
    profit,
  };
}

export type PaymentReceipt = {
  model: AttributionModel;
  payment: { id: string; type: "payment" | "refund"; amountMinor: number; currency: string; at: string; source: string };
  /** Credited touches of this payment; revenueMinor sums to the payment amount exactly. */
  earnedBy: EarnedLine[];
  contact: ContactReceipt | null;
};

/** The Ad Receipt of one payment (or refund). */
export async function paymentReceipt(
  db: DB,
  ws: Workspace,
  paymentId: string,
  model: AttributionModel,
  opts: { revealEmail?: boolean; basis?: CostBasis } = {},
): Promise<PaymentReceipt | null> {
  const [pay] = rows<Record<string, string | null>>(
    await db.execute(sql`select id, contact_id, type, amount_minor, currency, occurred_at, source from revenue_events
      where workspace_id = ${ws.id} and id = ${paymentId}::uuid`),
  );
  if (!pay) return null;
  const [earned, contact] = await Promise.all([
    earnedLines(db, ws, model, sql`and ac.conversion_id = ${paymentId}::uuid`),
    pay.contact_id ? contactReceipt(db, ws, pay.contact_id, model, opts) : Promise.resolve(null),
  ]);
  return {
    model,
    payment: {
      id: pay.id!,
      type: pay.type as "payment" | "refund",
      amountMinor: n(pay.amount_minor),
      currency: pay.currency!,
      at: iso(pay.occurred_at)!,
      source: pay.source!,
    },
    earnedBy: earned,
    contact,
  };
}

export type ReceiptListRow = {
  paymentId: string;
  at: string;
  amountMinor: number;
  currency: string;
  contactId: string | null;
  contactName: string | null;
  topEarner: { name: string; platform: Platform | null; channel: Channel | null; credit: number; touches: number } | null;
  costMinor: number | null;
  payback: Payback | null;
};

/** Payments in the period, newest first, each with its top-credited ad and customer cost. */
export async function receiptList(
  db: DB,
  ws: Workspace,
  p: Pick<ReportParams, "start" | "end" | "model">,
  opts: { limit?: number; offset?: number; basis?: CostBasis } = {},
): Promise<{ rows: ReceiptListRow[]; total: number }> {
  const where = sql`r.workspace_id = ${ws.id} and r.type = 'payment' and ${tsRange(sql`r.occurred_at`, ws, p)}`;
  const [{ total }] = rows<{ total: string }>(await db.execute(sql`select count(*) total from revenue_events r where ${where}`));
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      select r.id, r.occurred_at, r.amount_minor, r.currency, r.contact_id, ct.name contact_name,
        top.label, top.platform, top.channel, top.credit, top.touches
      from revenue_events r
      left join contacts ct on ct.id = r.contact_id
      left join lateral (
        select coalesce(a.name, c.name, case when ac.touchpoint_id is null then null else ac.channel end) label,
          ac.platform, ac.channel, ac.credit, count(*) over () touches
        from attribution_credits ac
        left join ads a on a.id = ac.ad_id
        left join campaigns c on c.id = ac.campaign_id
        where ac.conversion_id = r.id and ac.conversion_type = 'revenue' and ac.model = ${p.model} and ac.workspace_id = ${ws.id}
        order by ac.revenue_minor desc, ac.credit desc
        limit 1
      ) top on true
      where ${where}
      order by r.occurred_at desc, r.id
      limit ${opts.limit ?? 50} offset ${opts.offset ?? 0}`),
  );
  const contactIds = [...new Set(result.map((r) => r.contact_id).filter((v): v is string => Boolean(v)))];
  const [costs, money] = await Promise.all([contactCosts(db, ws, p.model, contactIds, opts.basis), contactMoney(db, ws, contactIds)]);
  return {
    total: n(total),
    rows: result.map((r) => {
      const cost = r.contact_id ? costs.get(r.contact_id) : undefined;
      const events = r.contact_id ? (money.get(r.contact_id) ?? []).filter((e) => e.currency === ws.reportingCurrency) : [];
      return {
        paymentId: r.id!,
        at: iso(r.occurred_at)!,
        amountMinor: n(r.amount_minor),
        currency: r.currency!,
        contactId: r.contact_id,
        contactName: r.contact_name,
        topEarner: r.label || r.channel ? { name: r.label ?? "Unattributed", platform: r.platform as Platform | null, channel: r.channel as Channel | null, credit: n(r.credit), touches: n(r.touches) } : null,
        costMinor: cost ? cost.costMinor : null,
        payback: cost ? paybackOf(cost.costMinor, events, cost.lines[0]?.touchedAt ?? null) : null,
      };
    }),
  };
}

/** The payments just before and after one payment (for previous / next on a receipt). */
export async function adjacentPayments(db: DB, ws: Workspace, paymentId: string): Promise<{ newer: string | null; older: string | null }> {
  const [r] = rows<{ newer: string | null; older: string | null }>(
    await db.execute(sql`
      with me as (select occurred_at, id from revenue_events where workspace_id = ${ws.id} and id = ${paymentId}::uuid)
      select
        (select r.id from revenue_events r, me where r.workspace_id = ${ws.id} and r.type = 'payment'
          and (r.occurred_at, r.id) > (me.occurred_at, me.id) order by r.occurred_at, r.id limit 1) newer,
        (select r.id from revenue_events r, me where r.workspace_id = ${ws.id} and r.type = 'payment'
          and (r.occurred_at, r.id) < (me.occurred_at, me.id) order by r.occurred_at desc, r.id desc limit 1) older`),
  );
  return { newer: r?.newer ?? null, older: r?.older ?? null };
}

// ================================================================ time to money

/** Fewer paying customers than this and a campaign borrows the workspace's lag. */
export const MIN_LAG_SAMPLES = 5;
/** Judge window when there is no lag history at all (new workspace). */
export const DEFAULT_JUDGE_DAYS = 7;
/** Customers whose first payment falls in this many days before `asOf` feed the lag. */
export const LAG_LOOKBACK_DAYS = 180;

export type LagStats = { samples: number; p50Days: number | null; p80Days: number | null };

export type LagRow = {
  campaignId: string;
  name: string;
  platform: Platform;
  status: string | null;
  firstSpendDate: string | null;
  /** Days from first spend to `asOf`. */
  ageDays: number | null;
  own: LagStats;
  /** Where the judge window comes from. */
  basis: "campaign" | "workspace" | "default";
  /** p80 lag (rounded up) of the basis: how long buyers usually take to pay. */
  judgeAfterDays: number;
  /** First day the campaign can be judged fairly. */
  judgeFrom: string | null;
  tooEarly: boolean;
};

export type TimeToMoney = { asOf: string; workspace: LagStats; campaigns: LagRow[] };

/**
 * The "too early to judge" rule: a campaign younger than the time 80% of its buyers take to pay
 * (first click → first payment) has not had the chance to earn its money back yet.
 */
export function tooEarlyRule(ageDays: number | null, judgeAfterDays: number): boolean {
  return ageDays === null || ageDays < judgeAfterDays;
}

const stats = (r: Record<string, string | null> | undefined): LagStats => ({
  samples: n(r?.n),
  p50Days: r?.p50 === null || r?.p50 === undefined ? null : round2(n(r.p50)),
  p80Days: r?.p80 === null || r?.p80 === undefined ? null : round2(n(r.p80)),
});

/** Payback lag per campaign (median and p80 days from first click on it to first payment). */
export async function timeToMoney(db: DB, ws: Workspace, opts: { asOf?: string; campaignIds?: string[] } = {}): Promise<TimeToMoney> {
  const asOf = opts.asOf ?? todayIn(ws.timezone);
  const window = sql`ac.conversion_at >= ((${asOf}::date - ${LAG_LOOKBACK_DAYS}::int))::timestamp at time zone ${ws.timezone}
    and ac.conversion_at < ((${asOf}::date + 1))::timestamp at time zone ${ws.timezone}`;
  const only = opts.campaignIds?.length ? sql`and e.id in (${uuidList(opts.campaignIds)})` : sql``;
  const [lags, campaigns] = await Promise.all([
    db
      .execute(
        sql`
        with t as (
          select ac.contact_id, ac.campaign_id, extract(epoch from (ac.conversion_at - tp.occurred_at)) / 86400.0 lag
          from attribution_credits ac join touchpoints tp on tp.id = ac.touchpoint_id
          where ac.workspace_id = ${ws.id} and ac.model = 'linear' and ac.conversion_type = 'customer'
            and ac.campaign_id is not null and ${window}
        ), per_campaign as (
          select campaign_id, contact_id, max(lag) lag from t group by 1, 2
        ), per_contact as (
          select contact_id, max(lag) lag from t group by 1
        )
        select campaign_id::text id, count(*) n,
          percentile_cont(0.5) within group (order by lag) p50, percentile_cont(0.8) within group (order by lag) p80
        from per_campaign group by 1
        union all
        select null, count(*), percentile_cont(0.5) within group (order by lag), percentile_cont(0.8) within group (order by lag)
        from per_contact`,
      )
      .then((r) => rows<Record<string, string | null>>(r)),
    db
      .execute(
        sql`
        select e.id, e.name, e.platform, e.status, to_char(f.first_spend, 'YYYY-MM-DD') first_spend
        from campaigns e
        join (select campaign_id, min(date) first_spend from ad_insights_daily
              where workspace_id = ${ws.id} and spend_minor > 0 and date <= ${asOf}::date group by 1) f on f.campaign_id = e.id
        where e.workspace_id = ${ws.id} ${only}
        order by e.name`,
      )
      .then((r) => rows<Record<string, string | null>>(r)),
  ]);
  const workspace = stats(lags.find((r) => r.id === null));
  const byCampaign = new Map(lags.filter((r) => r.id !== null).map((r) => [r.id!, stats(r)]));
  return {
    asOf,
    workspace,
    campaigns: campaigns.map((c) => {
      const own = byCampaign.get(c.id!) ?? { samples: 0, p50Days: null, p80Days: null };
      const basis: LagRow["basis"] =
        own.samples >= MIN_LAG_SAMPLES && own.p80Days !== null ? "campaign" : workspace.samples >= MIN_LAG_SAMPLES && workspace.p80Days !== null ? "workspace" : "default";
      const p80 = basis === "campaign" ? own.p80Days! : basis === "workspace" ? workspace.p80Days! : DEFAULT_JUDGE_DAYS;
      const judgeAfterDays = Math.max(1, Math.ceil(p80));
      const firstSpendDate = c.first_spend;
      const ageDays = firstSpendDate ? daysBetween(firstSpendDate, asOf) : null;
      return {
        campaignId: c.id!,
        name: c.name!,
        platform: c.platform as Platform,
        status: c.status,
        firstSpendDate,
        ageDays,
        own,
        basis,
        judgeAfterDays,
        judgeFrom: firstSpendDate ? addDays(firstSpendDate, judgeAfterDays) : null,
        tooEarly: tooEarlyRule(ageDays, judgeAfterDays),
      };
    }),
  };
}

/**
 * True when the campaign is younger than its payback lag (p80), so a low ROAS may just mean its
 * buyers haven't paid yet. For waste alerts and Insights cards. Unknown campaigns → false.
 */
export async function isTooEarly(db: DB, ws: Workspace, campaignId: string, asOf?: string): Promise<boolean> {
  const t = await timeToMoney(db, ws, { asOf, campaignIds: [campaignId] });
  return t.campaigns[0]?.tooEarly ?? false;
}

// ================================================================ draft pauses

/** Returned less than half its cost (ROAS, or POAS once unit economics are set). */
export const PAUSE_THRESHOLD = 0.5;

export type PauseDraft = {
  campaignId: string;
  externalId: string | null;
  name: string;
  platform: Platform;
  status: string | null;
  spendMinor: number;
  revenueMinor: number;
  contributionMinor: number;
  roas: number | null;
  poas: number | null;
  judgeAfterDays: number;
  ageDays: number | null;
};

export type PauseDrafts = {
  metric: "poas" | "roas";
  threshold: number;
  minSpendMinor: number;
  drafts: PauseDraft[];
  /** Would qualify, but too young to judge: shown, never drafted. */
  tooEarly: PauseDraft[];
};

const OFF_STATUS = /paus|inactive|disabled|removed|archived|deleted|ended|completed/i;

/**
 * Campaigns worth pausing: meaningful spend (≥ 2% of the period's spend), returning less than
 * half their cost, old enough to judge and still running. Nothing is changed on any platform:
 * the result only feeds a bulk-edit CSV the owner reviews and imports themselves.
 */
export async function pauseDrafts(
  db: DB,
  ws: Workspace,
  p: ReportParams,
  opts: { unitEconomics?: UnitEconomics; rows?: ProfitRow[]; lags?: TimeToMoney } = {},
): Promise<PauseDrafts> {
  const ue = opts.unitEconomics ?? (await getUnitEconomics(db, ws.id));
  const list = opts.rows ?? (await profitRows(db, ws, p, "campaign", ue));
  const lags = opts.lags ?? (await timeToMoney(db, ws, { asOf: p.end }));
  const lagBy = new Map(lags.campaigns.map((l) => [l.campaignId, l]));
  const total = list.reduce((s, r) => s + r.spendMinor, 0);
  const minSpendMinor = Math.max(1, Math.round(total * 0.02));
  const metric = ue.configured ? "poas" : "roas";
  const drafts: PauseDraft[] = [];
  const tooEarly: PauseDraft[] = [];
  for (const r of list) {
    if (r.spendMinor < minSpendMinor || (r.status && OFF_STATUS.test(r.status))) continue;
    const value = metric === "poas" ? r.poas : r.roas;
    if (value !== null && value >= PAUSE_THRESHOLD) continue;
    const lag = lagBy.get(r.id);
    const d: PauseDraft = {
      campaignId: r.id,
      externalId: r.externalId,
      name: r.name,
      platform: r.platform,
      status: r.status,
      spendMinor: r.spendMinor,
      revenueMinor: r.revenueMinor,
      contributionMinor: r.contributionMinor,
      roas: r.roas,
      poas: r.poas,
      judgeAfterDays: lag?.judgeAfterDays ?? DEFAULT_JUDGE_DAYS,
      ageDays: lag?.ageDays ?? null,
    };
    (lag?.tooEarly ? tooEarly : drafts).push(d);
  }
  return { metric, threshold: PAUSE_THRESHOLD, minSpendMinor, drafts, tooEarly };
}

export const PAUSE_CSV_PLATFORMS = ["meta", "google"] as const;
export type PauseCsvPlatform = (typeof PAUSE_CSV_PLATFORMS)[number];

/**
 * Bulk-edit CSV that pauses the drafted campaigns when the owner imports it:
 * - Meta Ads Manager → Export & import → Import ads in bulk (matches on Campaign ID)
 * - Google Ads Editor → Account → Import → From file (matches on the campaign name)
 * AdLedger never calls a platform's write API.
 */
export function pauseDraftCsv(drafts: PauseDraft[], platform: PauseCsvPlatform): string {
  const mine = drafts.filter((d) => d.platform === platform);
  const lines =
    platform === "meta"
      ? [["Campaign ID", "Campaign Name", "Campaign Status"], ...mine.map((d) => [d.externalId ?? "", d.name, "PAUSED"])]
      : [["Campaign", "Campaign Status"], ...mine.map((d) => [d.name, "Paused"])];
  return lines.map((l) => l.map((v) => csvCell(v)).join(",")).join("\r\n") + "\r\n";
}
