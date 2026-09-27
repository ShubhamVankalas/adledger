import { sql } from "drizzle-orm";
import { rows, type DB } from "./db";
import { performance, wastedSpend, type PerfRow, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

// Wasted spend with "too early to judge" exclusions and suggested budget moves. Same
// conventions as reports.ts: numbers come from SQL, money is integer minor units of the
// reporting currency. The move sizes below are plain arithmetic on those numbers, with the
// assumptions returned alongside so reports can print them.

/** A campaign needs this many days of spend before we call its spend wasted. */
export const MIN_DAYS_LIVE = 7;

export type CampaignActivity = { id: string; firstSpendDate: string; activeDays: number };

/** First day each campaign ever spent (up to `end`) and its days with spend inside [start, end]. */
export async function campaignActivity(db: DB, ws: Workspace, p: Pick<ReportParams, "start" | "end">): Promise<CampaignActivity[]> {
  const result = rows<{ id: string; first_date: string; active_days: string }>(
    await db.execute(sql`
      select campaign_id id, to_char(min(date), 'YYYY-MM-DD') first_date,
        count(distinct date) filter (where date >= ${p.start}::date and spend_minor > 0) active_days
      from ad_insights_daily
      where workspace_id = ${ws.id} and currency = ${ws.reportingCurrency} and date <= ${p.end}::date and spend_minor > 0
      group by 1`),
  );
  return result.map((r) => ({ id: r.id, firstSpendDate: r.first_date, activeDays: Number(r.active_days) }));
}

export type WasteRow = PerfRow & { firstSpendDate: string | null; activeDays: number };

export type BudgetMove = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  /** Suggested amount to move over the next period of the same length (25%–50% of the source's spend). */
  lowMinor: number;
  highMinor: number;
  /** The destination's ROAS in this period. */
  toRoas: number;
  /** Revenue the moved budget could return at 50%–80% of the destination's current ROAS. */
  revenueLowMinor: number;
  revenueHighMinor: number;
};

export const MOVE_ASSUMPTIONS = {
  shareLow: 0.25,
  shareHigh: 0.5,
  /** Returns diminish as a campaign scales: assume the extra budget earns 50%–80% of today's ROAS. */
  efficiencyLow: 0.5,
  efficiencyHigh: 0.8,
  /** A destination needs at least this ROAS and 2% of total spend to receive budget. */
  minDestinationRoas: 1.5,
};

export type WasteReport = {
  totalSpendMinor: number;
  wasteMinor: number;
  waste: WasteRow[];
  tooEarly: WasteRow[];
  winners: PerfRow[];
  moves: BudgetMove[];
  minSpendMinor: number;
};

/**
 * Campaigns with meaningful spend and ROAS under 0.5× (see wastedSpend), minus those live for
 * fewer than MIN_DAYS_LIVE days by the end of the period ("too early to judge"), plus up to
 * three suggested budget moves from the biggest wasters to the best performers.
 */
export async function wasteReport(db: DB, ws: Workspace, p: ReportParams): Promise<WasteReport> {
  const [all, flagged, activity] = await Promise.all([
    performance(db, ws, { ...p, level: "campaign" }),
    wastedSpend(db, ws, { ...p, level: "campaign" }),
    campaignActivity(db, ws, p),
  ]);
  const byId = new Map(activity.map((a) => [a.id, a]));
  const totalSpendMinor = all.reduce((s, r) => s + r.spendMinor, 0);
  const minSpendMinor = Math.max(1, Math.round(totalSpendMinor * 0.02));
  const earliestJudged = new Date(Date.parse(`${p.end}T00:00:00Z`) - (MIN_DAYS_LIVE - 1) * 86_400_000).toISOString().slice(0, 10);
  const withActivity = (r: PerfRow): WasteRow => ({ ...r, firstSpendDate: byId.get(r.id)?.firstSpendDate ?? null, activeDays: byId.get(r.id)?.activeDays ?? 0 });
  const isEarly = (r: WasteRow) => r.firstSpendDate !== null && r.firstSpendDate > earliestJudged;

  const flaggedRows = flagged.map(withActivity);
  const waste = flaggedRows.filter((r) => !isEarly(r));
  const tooEarly = flaggedRows.filter(isEarly);
  const wasteMinor = waste.reduce((s, r) => s + r.spendMinor, 0);

  const A = MOVE_ASSUMPTIONS;
  const winners = all
    .filter((r) => r.roas !== null && r.roas >= A.minDestinationRoas && r.spendMinor >= minSpendMinor)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0) || b.spendMinor - a.spendMinor)
    .slice(0, 3);
  const moves: BudgetMove[] = winners.length
    ? waste.slice(0, 3).map((from, i) => {
        const to = winners[i % winners.length];
        const lowMinor = Math.round(from.spendMinor * A.shareLow);
        const highMinor = Math.round(from.spendMinor * A.shareHigh);
        const roas = to.roas ?? 0;
        return {
          fromId: from.id,
          fromName: from.name,
          toId: to.id,
          toName: to.name,
          lowMinor,
          highMinor,
          toRoas: roas,
          revenueLowMinor: Math.round(lowMinor * roas * A.efficiencyLow),
          revenueHighMinor: Math.round(highMinor * roas * A.efficiencyHigh),
        };
      })
    : [];

  return { totalSpendMinor, wasteMinor, waste, tooEarly, winners, moves, minSpendMinor };
}
