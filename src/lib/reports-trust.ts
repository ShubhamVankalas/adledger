import { sql, type SQL } from "drizzle-orm";
import { rows, type DB } from "./db";
import type { AttributionModel, Platform } from "./db/schema";
import type { ReportParams } from "./reports";
import type { Workspace } from "./settings";

// Truth Gap: what each ad platform says it sold vs what AdLedger can verify from real payments.
// Same conventions as reports.ts: numbers computed in SQL, money in integer minor units of the
// reporting currency, day boundaries in the workspace timezone.
//
// Two verified numbers per platform or campaign:
//   credited   revenue credited to it under the selected attribution model (sums to attributed revenue)
//   best case  every payment (net of refunds) from a buyer who clicked it at least once within the
//              attribution window, regardless of model. This is the most generous number AdLedger
//              can defend, so a platform claiming more than this is over-claiming by at least the gap.
// Best case comes from the linear model's rows, which list every eligible touch of every conversion.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round2 = (v: number) => Math.round(v * 100) / 100;

function tsRange(col: SQL, ws: Workspace, p: Pick<ReportParams, "start" | "end">) {
  return sql`${col} >= (${p.start}::date)::timestamp at time zone ${ws.timezone}
    and ${col} < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
}

export type TruthRow = {
  /** Platform id (platform level) or campaign id (campaign level). */
  id: string;
  name: string;
  platform: Platform;
  spendMinor: number;
  /** Conversions the platform reported (all conversion actions it counts: leads and purchases). */
  platformConversions: number;
  /** Purchase value the platform claimed; null when it reported no value for the period. */
  platformValueMinor: number | null;
  /** Leads and first purchases from people who clicked it at least once (best case). */
  verifiedConversions: number;
  /** First purchases (new customers) from people who clicked it at least once (best case). */
  verifiedCustomers: number;
  /** Net revenue from buyers who clicked it at least once (best case). */
  verifiedRevenueMinor: number;
  /** Net revenue credited under the selected model. */
  creditedRevenueMinor: number;
  /** platformConversions ÷ verifiedConversions (1.8 = claims 80% more than happened). */
  conversionRatio: number | null;
  /** platformValueMinor ÷ verifiedRevenueMinor. */
  valueRatio: number | null;
  /** platformValueMinor − verifiedRevenueMinor (positive = over-claim). */
  valueGapMinor: number | null;
  /** ROAS the platform implies (its value ÷ spend) vs ROAS on credited revenue. */
  platformRoas: number | null;
  creditedRoas: number | null;
};

export type TruthGap = {
  currency: string;
  model: AttributionModel;
  start: string;
  end: string;
  platforms: TruthRow[];
  campaigns: TruthRow[];
  totals: {
    spendMinor: number;
    platformConversions: number;
    /** Sum of claimed value over platforms that report value. */
    platformValueMinor: number;
    /** Net revenue from every source in the period, including organic and unattributed. */
    revenueMinor: number;
    /** Net revenue credited to ad platforms under the selected model. */
    creditedRevenueMinor: number;
    /** Claimed value ÷ all revenue: above 1 means platforms claim more than the business took in. */
    claimToRevenue: number | null;
  };
};

type Level = "platform" | "campaign";

async function truthRows(db: DB, ws: Workspace, p: ReportParams, level: Level): Promise<TruthRow[]> {
  const rc = ws.reportingCurrency;
  const key = sql.raw(level === "platform" ? "platform::text" : "campaign_id::text");
  const platformOnly = p.platform ? sql`and platform = ${p.platform}` : sql``;
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with s as (
        select ${key} as id, min(platform) platform, sum(spend_minor) spend,
          sum(platform_conversions) conv,
          sum(platform_conversion_value_minor) value,
          count(platform_conversion_value_minor) value_rows
        from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc} ${platformOnly}
        group by 1
      ), touched as (
        -- One row per (conversion, entity) the buyer clicked: linear rows list every eligible touch.
        select distinct ac.conversion_id, ac.conversion_type, ${key} as id
        from attribution_credits ac
        where ac.workspace_id = ${ws.id} and ac.model = 'linear' and ac.campaign_id is not null
          and ${tsRange(sql`ac.conversion_at`, ws, p)} ${platformOnly}
      ), best as (
        select t.id,
          count(*) filter (where t.conversion_type in ('lead', 'customer')) conv,
          count(*) filter (where t.conversion_type = 'customer') customers,
          coalesce(sum(r.amount_minor) filter (where t.conversion_type = 'revenue' and r.currency = ${rc}), 0) revenue
        from touched t
        left join revenue_events r on t.conversion_type = 'revenue' and r.id = t.conversion_id
        group by 1
      ), credited as (
        select ${key} as id, coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc}), 0) revenue
        from attribution_credits
        where workspace_id = ${ws.id} and model = ${p.model} and campaign_id is not null
          and ${tsRange(sql`conversion_at`, ws, p)} ${platformOnly}
        group by 1
      ), ids as (
        select id from s union select id from best union select id from credited
      )
      select ids.id,
        ${level === "platform" ? sql`ids.id` : sql`c.name`} as name,
        ${level === "platform" ? sql`ids.id` : sql`c.platform`} as platform,
        coalesce(s.spend, 0) spend, coalesce(s.conv, 0) conv,
        case when coalesce(s.value_rows, 0) > 0 then s.value end as value,
        coalesce(best.conv, 0) best_conv, coalesce(best.customers, 0) best_customers, coalesce(best.revenue, 0) best_revenue,
        coalesce(credited.revenue, 0) credited
      from ids
      left join s on s.id = ids.id
      left join best on best.id = ids.id
      left join credited on credited.id = ids.id
      ${level === "campaign" ? sql`join campaigns c on c.id::text = ids.id and c.workspace_id = ${ws.id}` : sql``}
      order by coalesce(s.spend, 0) desc, 2`),
  );
  return result.map((r) => {
    const spendMinor = n(r.spend);
    const platformConversions = round2(n(r.conv));
    const platformValueMinor = r.value === null ? null : n(r.value);
    const verifiedConversions = n(r.best_conv);
    const verifiedRevenueMinor = n(r.best_revenue);
    const creditedRevenueMinor = n(r.credited);
    return {
      id: r.id!,
      name: r.name ?? r.id!,
      platform: r.platform as Platform,
      spendMinor,
      platformConversions,
      platformValueMinor,
      verifiedConversions,
      verifiedCustomers: n(r.best_customers),
      verifiedRevenueMinor,
      creditedRevenueMinor,
      conversionRatio: ratio(platformConversions, verifiedConversions),
      valueRatio: platformValueMinor === null ? null : ratio(platformValueMinor, verifiedRevenueMinor),
      valueGapMinor: platformValueMinor === null ? null : platformValueMinor - verifiedRevenueMinor,
      platformRoas: platformValueMinor === null ? null : ratio(platformValueMinor, spendMinor),
      creditedRoas: ratio(creditedRevenueMinor, spendMinor),
    };
  });
}

/** Platform-reported conversions and value vs verified payments, per platform and campaign. */
export async function truthGap(db: DB, ws: Workspace, p: ReportParams): Promise<TruthGap> {
  const [platforms, campaigns, [rev]] = await Promise.all([
    truthRows(db, ws, p, "platform"),
    truthRows(db, ws, p, "campaign"),
    db
      .execute(
        sql`select coalesce(sum(amount_minor), 0) revenue from revenue_events
          where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency} and ${tsRange(sql`occurred_at`, ws, p)}`,
      )
      .then((r) => rows<{ revenue: string }>(r)),
  ]);
  const spendMinor = platforms.reduce((s, r) => s + r.spendMinor, 0);
  const platformValueMinor = platforms.reduce((s, r) => s + (r.platformValueMinor ?? 0), 0);
  const revenueMinor = n(rev?.revenue);
  return {
    currency: ws.reportingCurrency,
    model: p.model,
    start: p.start,
    end: p.end,
    platforms,
    campaigns,
    totals: {
      spendMinor,
      platformConversions: round2(platforms.reduce((s, r) => s + r.platformConversions, 0)),
      platformValueMinor,
      revenueMinor,
      creditedRevenueMinor: platforms.reduce((s, r) => s + r.creditedRevenueMinor, 0),
      claimToRevenue: ratio(platformValueMinor, revenueMinor),
    },
  };
}

/** The platform with the largest claimed-value gap (the headline), or null when nobody reports value. */
export function biggestGap(rows: TruthRow[]): TruthRow | null {
  let best: TruthRow | null = null;
  for (const r of rows) {
    if (r.valueGapMinor === null || r.platformValueMinor === null || r.platformValueMinor <= 0) continue;
    if (!best || r.valueGapMinor > (best.valueGapMinor ?? 0)) best = r;
  }
  return best;
}
