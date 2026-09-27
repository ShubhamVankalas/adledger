import { channelLabel, platformLabel } from "../format";
import { change, credit, moneyShort, moneyWhole, pct, ratioX, safeText } from "../pdf/format";
import type { Overview, PerfRow } from "../reports";

/** Printable width of the page body (A4 minus 36 pt margins). */
export const CONTENT_WIDTH = { portrait: 595 - 72, landscape: 842 - 72 } as const;

export const labelPlatform = (p: string | null | undefined) => platformLabel(p);
export const labelChannel = (c: string | null | undefined) => channelLabel(c);

/** Formatters bound to the reporting currency. */
export function money(currency: string) {
  return {
    whole: (m: number | null | undefined) => moneyWhole(m, currency),
    short: (m: number | null | undefined) => moneyShort(m, currency),
  };
}

/** Daily ROAS series (attributed revenue ÷ spend per day), 0 on days without spend. */
export const dailyRatio = (num: number[], den: number[]) => num.map((v, i) => (den[i] > 0 ? v / den[i] : 0));

/** "up 12.4%" / "down 3.1%" / "flat" relative to the comparison, or "" without one. */
export function trendWords(cur: number | null, prev: number | null | undefined): string {
  const d = change(cur, prev ?? null);
  if (d === null) return "";
  if (Math.abs(d) < 0.02) return "flat on the previous period";
  return `${d > 0 ? "up" : "down"} ${pct(Math.abs(d))} on the previous period`;
}

/**
 * Three plain statements built from report numbers (no AI): money in vs out, the best
 * campaign, and the biggest caveat (waste or untracked revenue).
 */
export function summaryStatements(o: Overview, prev: Overview | null, campaigns: PerfRow[], currency: string): string[] {
  const m = money(currency);
  const out: string[] = [];
  const revTrend = trendWords(o.revenueMinor, prev?.revenueMinor);
  const spendTrend = trendWords(o.spendMinor, prev?.spendMinor);
  out.push(
    `Revenue was ${m.whole(o.revenueMinor)}${revTrend ? `, ${revTrend}` : ""}, from ${m.whole(o.spendMinor)} of ad spend${spendTrend ? ` (${spendTrend.replace(" on the previous period", "")})` : ""}. ROAS on attributed revenue was ${ratioX(o.roas)}.`,
  );
  const best = [...campaigns].filter((c) => c.revenueMinor > 0).sort((a, b) => b.revenueMinor - a.revenueMinor)[0];
  if (best) {
    out.push(`${safeText(best.name, 60)} on ${labelPlatform(best.platform)} brought in the most: ${m.whole(best.revenueMinor)} from ${m.whole(best.spendMinor)} (${ratioX(best.roas)}).`);
  } else {
    out.push("No campaign has attributed revenue in this period yet.");
  }
  const total = campaigns.reduce((s, c) => s + c.spendMinor, 0);
  const waste = campaigns.filter((c) => c.spendMinor >= Math.max(1, total * 0.02) && (c.roas === null || c.roas < 0.5));
  const wasted = waste.reduce((s, c) => s + c.spendMinor, 0);
  if (wasted > 0) {
    out.push(`${m.whole(wasted)} (${pct(total ? wasted / total : null, 0)} of spend) went to ${waste.length === 1 ? "1 campaign" : `${waste.length} campaigns`} returning under 0.5× ROAS.`);
  } else if (o.unattributedShare !== null) {
    out.push(`${pct(o.unattributedShare, 0)} of revenue had no tracked ad or website touch before the payment.`);
  }
  return out;
}

export { credit };
