import type { DB } from "../db";
import type { AttributionModel } from "../db/schema";
import { channelLabel, credit, dateRange, MODEL_LABELS, moneyWhole, pct as pctRatio, periodDays, platformLabel, roas as roasX, signedPct } from "../format";
import { channels, compare, dataBounds, previousPeriod, wastedSpend, type Overview } from "../reports";
import type { Workspace } from "../settings";

// The facts pack is the ONLY thing the language model sees. Every number in it is
// computed in SQL and pre-formatted for reading (whole currency units, display names,
// human dates), so the model narrates instead of calculating.

const pct = (x: number | null) => (x === null ? "n/a" : pctRatio(x));
const roas = (x: number | null) => (x === null ? "n/a" : roasX(x));
const change = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "0%" : "new") : signedPct((cur - prev) / Math.abs(prev)));

export type FactsPack = ReturnType<typeof shape> & { generatedFor: { start: string; end: string; model: AttributionModel } };

function shape(ws: Workspace, cur: Overview, prev: Overview) {
  const m = (v: number | null) => (v === null ? "n/a" : moneyWhole(v, ws.reportingCurrency));
  return {
    currency: ws.reportingCurrency,
    attributionModel: cur.model,
    attributionModelLabel: MODEL_LABELS[cur.model] ?? cur.model,
    period: { start: cur.start, end: cur.end, label: dateRange(cur.start, cur.end, { year: true }), days: periodDays(cur.start, cur.end) },
    previousPeriod: { start: prev.start, end: prev.end, label: dateRange(prev.start, prev.end, { year: true }) },
    totals: {
      spend: m(cur.spendMinor),
      revenue: m(cur.revenueMinor),
      revenueAttributedToAds: m(cur.attributedRevenueMinor),
      unattributedRevenue: m(cur.unattributedRevenueMinor),
      unattributedShare: pct(cur.unattributedShare),
      roas: roas(cur.roas),
      blendedRoas: roas(cur.blendedRoas),
      leads: credit(cur.leads),
      customers: credit(cur.customers),
      costPerLead: m(cur.cplMinor),
      customerAcquisitionCost: m(cur.cacMinor),
    },
    changeVsPreviousPeriod: {
      spend: change(cur.spendMinor, prev.spendMinor),
      revenue: change(cur.revenueMinor, prev.revenueMinor),
      leads: change(cur.leads, prev.leads),
      customers: change(cur.customers, prev.customers),
      previousRoas: roas(prev.roas),
    },
  };
}

export async function buildFacts(
  db: DB,
  ws: Workspace,
  opts: { start?: string; end?: string; model?: AttributionModel; days?: number } = {},
) {
  const bounds = await dataBounds(db, ws);
  const end = opts.end ?? bounds.max ?? new Date().toISOString().slice(0, 10);
  const days = opts.days ?? 7;
  const start = opts.start ?? new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const p = { start, end, model: opts.model ?? ("linear" as AttributionModel) };
  const m = (v: number | null) => (v === null ? "n/a" : moneyWhole(v, ws.reportingCurrency));

  const cmp = await compare(db, ws, p);
  const [waste, ch] = await Promise.all([wastedSpend(db, ws, { ...p, level: "campaign" }), channels(db, ws, p)]);
  const byRevenue = [...cmp.movers].sort((a, b) => b.revenueMinor - a.revenueMinor);

  const facts = {
    ...shape(ws, cmp.current, cmp.previous),
    generatedFor: p,
    topCampaigns: byRevenue.slice(0, 5).map((c) => ({
      name: c.name,
      platform: platformLabel(c.platform),
      spend: m(c.spendMinor),
      revenue: m(c.revenueMinor),
      roas: roas(c.roas),
      previousRoas: roas(c.prevRoas),
    })),
    wastedSpend: waste.slice(0, 5).map((c) => ({
      name: c.name,
      platform: platformLabel(c.platform),
      spend: m(c.spendMinor),
      revenue: m(c.revenueMinor),
      roas: roas(c.roas),
      leads: credit(c.leads),
    })),
    wastedSpendTotal: m(waste.reduce((s, c) => s + c.spendMinor, 0)),
    biggestChanges: cmp.movers.slice(0, 5).map((c) => ({
      name: c.name,
      platform: platformLabel(c.platform),
      revenueNow: m(c.revenueMinor),
      revenueBefore: m(c.prevRevenueMinor),
      spendNow: m(c.spendMinor),
      spendBefore: m(c.prevSpendMinor),
    })),
    channelMix: ch.map((c) => ({ channel: channelLabel(c.channel), revenue: m(c.revenueMinor), leads: credit(c.leads), customers: credit(c.customers) })),
    warnings: cmp.current.warnings,
  };
  return { facts, overview: cmp.current, previous: cmp.previous, prevPeriod: previousPeriod(p) };
}

export type Facts = Awaited<ReturnType<typeof buildFacts>>["facts"];
