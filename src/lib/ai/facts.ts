import type { DB } from "../db";
import type { AttributionModel } from "../db/schema";
import { formatMoney } from "../money";
import { channels, compare, dataBounds, previousPeriod, wastedSpend, type Overview } from "../reports";
import type { Workspace } from "../settings";

// The facts pack is the ONLY thing the language model sees. Every number in it is
// computed in SQL and pre-formatted, so the model narrates instead of calculating.

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const roas = (x: number | null) => (x === null ? "n/a" : `${x.toFixed(2)}x`);
const change = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? "0%" : "new") : `${(((cur - prev) / prev) * 100).toFixed(1)}%`);

export type FactsPack = ReturnType<typeof shape> & { generatedFor: { start: string; end: string; model: AttributionModel } };

function shape(ws: Workspace, cur: Overview, prev: Overview) {
  const m = (v: number | null) => (v === null ? "n/a" : formatMoney(v, ws.reportingCurrency));
  return {
    currency: ws.reportingCurrency,
    attributionModel: cur.model,
    period: { start: cur.start, end: cur.end },
    previousPeriod: { start: prev.start, end: prev.end },
    totals: {
      spend: m(cur.spendMinor),
      revenue: m(cur.revenueMinor),
      revenueAttributedToAds: m(cur.attributedRevenueMinor),
      unattributedRevenue: m(cur.unattributedRevenueMinor),
      unattributedShare: pct(cur.unattributedShare),
      roas: roas(cur.roas),
      blendedRoas: roas(cur.blendedRoas),
      leads: cur.leads,
      customers: cur.customers,
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
  const m = (v: number | null) => (v === null ? "n/a" : formatMoney(v, ws.reportingCurrency));

  const cmp = await compare(db, ws, p);
  const [waste, ch] = await Promise.all([wastedSpend(db, ws, { ...p, level: "campaign" }), channels(db, ws, p)]);
  const byRevenue = [...cmp.movers].sort((a, b) => b.revenueMinor - a.revenueMinor);

  const facts = {
    ...shape(ws, cmp.current, cmp.previous),
    generatedFor: p,
    topCampaigns: byRevenue.slice(0, 5).map((c) => ({
      name: c.name,
      platform: c.platform,
      spend: m(c.spendMinor),
      revenue: m(c.revenueMinor),
      roas: roas(c.roas),
      previousRoas: roas(c.prevRoas),
    })),
    wastedSpend: waste.slice(0, 5).map((c) => ({
      name: c.name,
      platform: c.platform,
      spend: m(c.spendMinor),
      revenue: m(c.revenueMinor),
      roas: roas(c.roas),
      leads: c.leads,
    })),
    wastedSpendTotal: m(waste.reduce((s, c) => s + c.spendMinor, 0)),
    biggestChanges: cmp.movers.slice(0, 5).map((c) => ({
      name: c.name,
      revenueNow: m(c.revenueMinor),
      revenueBefore: m(c.prevRevenueMinor),
      spendNow: m(c.spendMinor),
      spendBefore: m(c.prevSpendMinor),
    })),
    channelMix: ch.map((c) => ({ channel: c.channel, revenue: m(c.revenueMinor), leads: c.leads, customers: c.customers })),
    warnings: cmp.current.warnings,
  };
  return { facts, overview: cmp.current, previous: cmp.previous, prevPeriod: previousPeriod(p) };
}

export type Facts = Awaited<ReturnType<typeof buildFacts>>["facts"];
