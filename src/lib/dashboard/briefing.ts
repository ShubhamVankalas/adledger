import type { Platform } from "@/lib/db/schema";
import { metricDelta, type Delta } from "@/lib/metrics";

// The Overview's opening sentence. A template filled from SQL numbers (reports.ts), never written
// by the LLM, so it can always be trusted and it never needs an API key.

export type BriefingInput = {
  campaigns: { id: string; name: string; platform: Platform; spendMinor: number; revenueMinor: number }[];
  spendMinor: number;
  revenueMinor: number;
  attributedRevenueMinor: number;
  roas: number | null;
  prevRoas: number | null;
};

export type Briefing =
  /** The campaign with the most profit (credited revenue − spend) and how ROAS moved. */
  | { kind: "top"; campaign: { id: string; name: string; platform: Platform }; revenueMinor: number; spendMinor: number; roasDelta: Delta; roas: number | null }
  /** Spend, but no campaign has paid back yet. */
  | { kind: "noProfit"; spendMinor: number; attributedRevenueMinor: number; roasDelta: Delta; roas: number | null }
  /** Revenue without ad spend (organic, or ads not connected). */
  | { kind: "noSpend"; revenueMinor: number }
  | { kind: "empty" };

export function buildBriefing(i: BriefingInput): Briefing {
  const roasDelta = metricDelta(i.roas, i.prevRoas, "up");
  let top: BriefingInput["campaigns"][number] | null = null;
  for (const c of i.campaigns) {
    const profit = c.revenueMinor - c.spendMinor;
    if (profit > 0 && (!top || profit > top.revenueMinor - top.spendMinor)) top = c;
  }
  if (top) {
    return {
      kind: "top",
      campaign: { id: top.id, name: top.name, platform: top.platform },
      revenueMinor: top.revenueMinor,
      spendMinor: top.spendMinor,
      roasDelta,
      roas: i.roas,
    };
  }
  if (i.spendMinor > 0) return { kind: "noProfit", spendMinor: i.spendMinor, attributedRevenueMinor: i.attributedRevenueMinor, roasDelta, roas: i.roas };
  if (i.revenueMinor !== 0) return { kind: "noSpend", revenueMinor: i.revenueMinor };
  return { kind: "empty" };
}

/** "this week", "in the last 30 days", "in this period": how the sentence names the date range. */
export function periodPhrase(range: string): { inPeriod: string; vsPrevious: string } {
  const days = { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "180d": 180 }[range];
  if (days === 7) return { inPeriod: "this week", vsPrevious: "last week" };
  if (days) return { inPeriod: `in the last ${days} days`, vsPrevious: `the ${days} days before` };
  return { inPeriod: "in this period", vsPrevious: "the period before" };
}
