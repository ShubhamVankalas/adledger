import type { DB } from "../db";
import type { AttributionModel } from "../db/schema";
import { channelLabel, MODEL_LABELS, periodDays, platformLabel } from "../format";
import { credit, dateRange, longDate, moneyWhole, num, pct, ratioX, shortDate, signedPct } from "../pdf/format";
import { channels, compare, performance, pickWastedSpend, platforms, previousPeriod, timeseries } from "../reports";
import { funnel } from "../reports-analysis";
import { stageFunnel } from "../reports-pipeline";
import { profitLedger } from "../reports-profit";
import type { Workspace } from "../settings";
import type { ChartType } from "./document-schema";

// The data pack behind an AI document: every figure the document can show, computed by
// src/lib/reports*.ts and given a stable id. The model reads a formatted copy (packForModel)
// and may only point at ids; the PDF draws KPI rows, tables and charts from the raw values here.
// Contacts and anything person-level are never part of the pack.

export type ValueKind = "money" | "ratio" | "credit" | "count" | "pct" | "text" | "platform" | "channel" | "date";
export type Polarity = "up" | "down" | "neutral";

export type DocFact = {
  id: string;
  label: string;
  kind: Exclude<ValueKind, "text" | "platform" | "channel" | "date">;
  value: number | null;
  /** Same metric over the previous period of equal length, when it has one. */
  previous: number | null;
  polarity: Polarity;
};

export type DocColumn = { key: string; label: string; kind: ValueKind };
export type DocRow = Record<string, string | number | null>;

export type DocDataset = {
  id: string;
  title: string;
  description: string;
  /** First column: the row label (campaign name, date, platform…). */
  columns: DocColumn[];
  rows: DocRow[];
  /** Columns shown when the document doesn't pick any (label column included). */
  defaultColumns: string[];
  /** Numeric columns a chart may plot. */
  metrics: string[];
  charts: ChartType[];
  defaultChart: ChartType | null;
  defaultMetric: string | null;
  noun: string;
};

export type DocumentPack = {
  currency: string;
  model: AttributionModel;
  modelLabel: string;
  period: { start: string; end: string; label: string; days: number };
  previousPeriod: { start: string; end: string; label: string };
  facts: DocFact[];
  datasets: DocDataset[];
  /** Currency exclusions and similar caveats from reports.ts. */
  warnings: string[];
};

/** Print a raw value the way the PDF prints it (and the way the model is shown it). */
export function formatValue(kind: ValueKind, v: string | number | null | undefined, currency: string): string {
  if (v === null || v === undefined) return "—";
  switch (kind) {
    case "money":
      return moneyWhole(Number(v), currency);
    case "ratio":
      return ratioX(Number(v));
    case "credit":
      return credit(Number(v));
    case "count":
      return num(Number(v));
    case "pct":
      return pct(Number(v));
    case "platform":
      return platformLabel(String(v));
    case "channel":
      return channelLabel(String(v));
    case "date":
      return shortDate(String(v));
    default:
      return String(v);
  }
}

const col = (key: string, label: string, kind: ValueKind): DocColumn => ({ key, label, kind });
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export async function buildDocumentPack(db: DB, ws: Workspace, p: { start: string; end: string; model: AttributionModel }): Promise<DocumentPack> {
  const prev = previousPeriod(p);
  const [cmp, series, plat, prevPlat, chan, ads, fun, ledger, prevLedger, pipeline] = await Promise.all([
    compare(db, ws, p),
    timeseries(db, ws, p),
    platforms(db, ws, p),
    platforms(db, ws, prev),
    channels(db, ws, p),
    performance(db, ws, { ...p, level: "ad" }),
    funnel(db, ws, p),
    profitLedger(db, ws, p),
    profitLedger(db, ws, prev),
    stageFunnel(db, ws, { start: p.start, end: p.end }),
  ]);
  const cur = cmp.current;
  const before = cmp.previous;
  const campaigns = await performance(db, ws, { ...p, level: "campaign" });
  const waste = pickWastedSpend(campaigns);
  const wasteMinor = waste.reduce((s, r) => s + r.spendMinor, 0);

  const facts: DocFact[] = [
    { id: "spend", label: "Ad spend", kind: "money", value: cur.spendMinor, previous: before.spendMinor, polarity: "neutral" },
    { id: "revenue", label: "Revenue", kind: "money", value: cur.revenueMinor, previous: before.revenueMinor, polarity: "up" },
    { id: "ad_revenue", label: "Revenue credited to ads", kind: "money", value: cur.attributedRevenueMinor, previous: before.attributedRevenueMinor, polarity: "up" },
    { id: "unattributed_share", label: "Revenue with no tracked touch", kind: "pct", value: cur.unattributedShare, previous: before.unattributedShare, polarity: "down" },
    { id: "roas", label: "ROAS", kind: "ratio", value: cur.roas, previous: before.roas, polarity: "up" },
    { id: "mer", label: "MER (all revenue ÷ ad spend)", kind: "ratio", value: cur.blendedRoas, previous: before.blendedRoas, polarity: "up" },
    { id: "leads", label: "Leads", kind: "credit", value: cur.leads, previous: before.leads, polarity: "up" },
    { id: "customers", label: "Customers", kind: "credit", value: cur.customers, previous: before.customers, polarity: "up" },
    { id: "cpl", label: "Cost per lead", kind: "money", value: cur.cplMinor, previous: before.cplMinor, polarity: "down" },
    { id: "cac", label: "Cost per customer", kind: "money", value: cur.cacMinor, previous: before.cacMinor, polarity: "down" },
    { id: "clicks", label: "Clicks", kind: "count", value: cur.clicks, previous: before.clicks, polarity: "up" },
    { id: "impressions", label: "Impressions", kind: "count", value: cur.impressions, previous: before.impressions, polarity: "neutral" },
    { id: "wasted_spend", label: "Wasted spend (ROAS under 0.5×)", kind: "money", value: wasteMinor, previous: null, polarity: "down" },
    { id: "wasted_campaigns", label: "Campaigns flagged as waste", kind: "count", value: waste.length, previous: null, polarity: "down" },
    { id: "visitors", label: "Website visitors", kind: "count", value: fun.visitors, previous: fun.previous?.visitors ?? null, polarity: "up" },
    { id: "lead_rate", label: "Visitor to lead rate", kind: "pct", value: fun.leadRate, previous: fun.previous?.leadRate ?? null, polarity: "up" },
    { id: "close_rate", label: "Lead to customer rate", kind: "pct", value: fun.closeRate, previous: fun.previous?.closeRate ?? null, polarity: "up" },
    { id: "gross_sales", label: "Gross sales", kind: "money", value: ledger.grossSalesMinor, previous: prevLedger.grossSalesMinor, polarity: "up" },
    { id: "refunds", label: "Refunds", kind: "money", value: ledger.refundsMinor, previous: prevLedger.refundsMinor, polarity: "neutral" },
    { id: "refund_share", label: "Refunded share of sales", kind: "pct", value: ratio(Math.abs(ledger.refundsMinor), ledger.grossSalesMinor), previous: ratio(Math.abs(prevLedger.refundsMinor), prevLedger.grossSalesMinor), polarity: "down" },
    { id: "orders", label: "Orders", kind: "count", value: ledger.orders, previous: prevLedger.orders, polarity: "up" },
    { id: "profit_after_ads", label: "Profit after ads", kind: "money", value: ledger.profitAfterAdsMinor, previous: prevLedger.profitAfterAdsMinor, polarity: "up" },
    ...(ledger.unitEconomics.configured ? [{ id: "poas", label: "POAS (contribution ÷ ad spend)", kind: "ratio" as const, value: ledger.poas, previous: prevLedger.poas, polarity: "up" as const }] : []),
    { id: "new_contacts", label: "New contacts in the pipeline", kind: "count", value: pipeline.total, previous: null, polarity: "up" },
  ];
  const spendTotal = plat.reduce((s, r) => s + r.spendMinor, 0);
  const prevPlatBy = new Map(prevPlat.map((r) => [r.platform, r]));
  for (const r of plat) {
    const before = prevPlatBy.get(r.platform);
    const name = platformLabel(r.platform);
    facts.push(
      { id: `${r.platform}.spend`, label: `${name} ad spend`, kind: "money", value: r.spendMinor, previous: before?.spendMinor ?? null, polarity: "neutral" },
      { id: `${r.platform}.ad_revenue`, label: `${name} revenue credited`, kind: "money", value: r.revenueMinor, previous: before?.revenueMinor ?? null, polarity: "up" },
      { id: `${r.platform}.roas`, label: `${name} ROAS`, kind: "ratio", value: r.roas, previous: before?.roas ?? null, polarity: "up" },
      { id: `${r.platform}.customers`, label: `${name} customers`, kind: "credit", value: r.customers, previous: before?.customers ?? null, polarity: "up" },
      { id: `${r.platform}.spend_share`, label: `${name} share of spend`, kind: "pct", value: ratio(r.spendMinor, spendTotal), previous: null, polarity: "neutral" },
    );
  }

  const perfColumns = [col("name", "Campaign", "text"), col("platform", "Platform", "platform"), col("spend", "Spend", "money"), col("revenue", "Revenue", "money"), col("roas", "ROAS", "ratio"), col("leads", "Leads", "credit"), col("customers", "Customers", "credit"), col("cac", "Cost per customer", "money"), col("cpl", "Cost per lead", "money")];
  const perfRow = (r: (typeof campaigns)[number]): DocRow => ({ name: r.name, platform: r.platform, spend: r.spendMinor, revenue: r.revenueMinor, roas: r.roas, leads: r.leads, customers: r.customers, cac: r.cacMinor, cpl: r.cplMinor });
  const chanTotal = chan.reduce((s, c) => s + Math.max(0, c.revenueMinor), 0);
  const stepsFlow = pipeline.steps.filter((s) => s.kind !== "lost");

  const datasets: DocDataset[] = [
    {
      id: "daily",
      title: "Spend and revenue by day",
      description: "One row per day of the period.",
      columns: [col("date", "Date", "date"), col("spend", "Ad spend", "money"), col("revenue", "Revenue", "money"), col("ad_revenue", "Credited to ads", "money"), col("leads", "Leads", "count")],
      rows: series.map((d) => ({ date: d.date, spend: d.spendMinor, revenue: d.revenueMinor, ad_revenue: d.attributedRevenueMinor, leads: d.leads })),
      defaultColumns: ["date", "spend", "revenue", "leads"],
      metrics: ["spend", "revenue", "ad_revenue", "leads"],
      charts: ["combo", "line", "bar"],
      defaultChart: "combo",
      defaultMetric: "revenue",
      noun: "days",
    },
    {
      id: "platforms",
      title: "Ad platforms",
      description: "Spend, credited revenue and results per ad platform, with the previous period's ROAS.",
      columns: [col("platform", "Platform", "platform"), col("spend", "Spend", "money"), col("spend_share", "Share of spend", "pct"), col("ad_revenue", "Revenue credited", "money"), col("roas", "ROAS", "ratio"), col("prev_roas", "ROAS, previous period", "ratio"), col("leads", "Leads", "credit"), col("customers", "Customers", "credit")],
      rows: plat.map((r) => ({ platform: r.platform, spend: r.spendMinor, spend_share: ratio(r.spendMinor, spendTotal), ad_revenue: r.revenueMinor, roas: r.roas, prev_roas: prevPlatBy.get(r.platform)?.roas ?? null, leads: r.leads, customers: r.customers })),
      defaultColumns: ["platform", "spend", "ad_revenue", "roas", "prev_roas", "customers"],
      metrics: ["spend", "ad_revenue", "roas", "leads", "customers"],
      charts: ["bar", "donut"],
      defaultChart: "bar",
      defaultMetric: "ad_revenue",
      noun: "platforms",
    },
    {
      id: "channels",
      title: "Revenue by channel",
      description: "All revenue, leads and customers by marketing channel (including unattributed).",
      columns: [col("channel", "Channel", "channel"), col("revenue", "Revenue", "money"), col("share", "Share of revenue", "pct"), col("leads", "Leads", "credit"), col("customers", "Customers", "credit"), col("close_rate", "Lead to customer", "pct")],
      rows: chan.map((c) => ({ channel: c.channel, revenue: c.revenueMinor, share: ratio(Math.max(0, c.revenueMinor), chanTotal), leads: c.leads, customers: c.customers, close_rate: ratio(c.customers, c.leads) })),
      defaultColumns: ["channel", "revenue", "share", "leads", "customers"],
      metrics: ["revenue", "leads", "customers"],
      charts: ["donut", "bar"],
      defaultChart: "donut",
      defaultMetric: "revenue",
      noun: "channels",
    },
    {
      id: "campaigns",
      title: "Campaigns by spend",
      description: "Every campaign with spend or credited results, highest spend first.",
      columns: perfColumns,
      rows: campaigns.slice(0, 40).map(perfRow),
      defaultColumns: ["name", "spend", "revenue", "roas", "customers", "cac"],
      metrics: ["spend", "revenue", "roas", "leads", "customers"],
      charts: ["bar"],
      defaultChart: "bar",
      defaultMetric: "spend",
      noun: "campaigns",
    },
    {
      id: "top_campaigns",
      title: "Top campaigns by revenue",
      description: "Campaigns ranked by credited revenue.",
      columns: perfColumns,
      rows: [...campaigns]
        .filter((c) => c.revenueMinor > 0)
        .sort((a, b) => b.revenueMinor - a.revenueMinor)
        .slice(0, 15)
        .map(perfRow),
      defaultColumns: ["name", "spend", "revenue", "roas", "customers"],
      metrics: ["revenue", "spend", "roas", "customers"],
      charts: ["bar"],
      defaultChart: "bar",
      defaultMetric: "revenue",
      noun: "campaigns",
    },
    {
      id: "wasted_campaigns",
      title: "Wasted spend",
      description: "Campaigns with at least 2% of spend and ROAS under 0.5×.",
      columns: perfColumns,
      rows: waste.slice(0, 15).map(perfRow),
      defaultColumns: ["name", "spend", "revenue", "roas", "leads"],
      metrics: ["spend", "revenue", "leads"],
      charts: ["bar"],
      defaultChart: "bar",
      defaultMetric: "spend",
      noun: "campaigns",
    },
    {
      id: "movers",
      title: "Biggest changes vs the previous period",
      description: "Campaigns whose credited revenue moved the most.",
      columns: [col("name", "Campaign", "text"), col("platform", "Platform", "platform"), col("revenue", "Revenue", "money"), col("prev_revenue", "Revenue, previous period", "money"), col("spend", "Spend", "money"), col("prev_spend", "Spend, previous period", "money"), col("roas", "ROAS", "ratio"), col("prev_roas", "ROAS, previous period", "ratio")],
      rows: cmp.movers.slice(0, 10).map((r) => ({ name: r.name, platform: r.platform, revenue: r.revenueMinor, prev_revenue: r.prevRevenueMinor, spend: r.spendMinor, prev_spend: r.prevSpendMinor, roas: r.roas, prev_roas: r.prevRoas })),
      defaultColumns: ["name", "revenue", "prev_revenue", "spend", "prev_spend"],
      metrics: ["revenue", "spend"],
      charts: ["bar"],
      defaultChart: "bar",
      defaultMetric: "revenue",
      noun: "campaigns",
    },
    {
      id: "ads",
      title: "Top ads by revenue",
      description: "Individual ads (creatives) ranked by credited revenue, with their ad set.",
      columns: [col("name", "Ad", "text"), col("ad_set", "Ad set", "text"), col("platform", "Platform", "platform"), col("spend", "Spend", "money"), col("revenue", "Revenue", "money"), col("roas", "ROAS", "ratio"), col("ctr", "CTR", "pct"), col("customers", "Customers", "credit")],
      rows: [...ads]
        .filter((a) => a.revenueMinor > 0)
        .sort((a, b) => b.revenueMinor - a.revenueMinor)
        .slice(0, 15)
        .map((a) => ({ name: a.name, ad_set: a.parentName, platform: a.platform, spend: a.spendMinor, revenue: a.revenueMinor, roas: a.roas, ctr: a.ctr, customers: a.customers })),
      defaultColumns: ["name", "spend", "revenue", "roas", "ctr"],
      metrics: ["revenue", "spend", "roas", "customers"],
      charts: ["bar"],
      defaultChart: "bar",
      defaultMetric: "revenue",
      noun: "ads",
    },
    {
      id: "funnel",
      title: "Visitors to customers",
      description: "Website visitors, first leads and first payments in the period.",
      columns: [col("step", "Step", "text"), col("count", "Count", "credit")],
      rows: [
        { step: "Visitors", count: fun.visitors },
        { step: "Leads", count: fun.leads },
        { step: "Customers", count: fun.customers },
      ],
      defaultColumns: ["step", "count"],
      metrics: ["count"],
      charts: ["funnel", "bar"],
      defaultChart: "funnel",
      defaultMetric: "count",
      noun: "steps",
    },
    {
      id: "profit",
      title: "Gross sales to profit",
      description: "Gross sales, refunds, costs and ad spend down to profit after ads (whole business).",
      columns: [col("line", "Line", "text"), col("amount", "Amount", "money")],
      rows: [
        { line: "Gross sales", amount: ledger.grossSalesMinor },
        { line: "Refunds", amount: ledger.refundsMinor },
        ...(ledger.cogsMinor ? [{ line: "Cost of goods", amount: -ledger.cogsMinor }] : []),
        ...(ledger.feesMinor ? [{ line: "Payment fees", amount: -ledger.feesMinor }] : []),
        ...(ledger.shippingMinor ? [{ line: "Shipping", amount: -ledger.shippingMinor }] : []),
        { line: "Ad spend", amount: -ledger.spendMinor },
        { line: "Profit after ads", amount: ledger.profitAfterAdsMinor },
      ],
      defaultColumns: ["line", "amount"],
      metrics: ["amount"],
      charts: ["waterfall"],
      defaultChart: "waterfall",
      defaultMetric: "amount",
      noun: "lines",
    },
    {
      id: "pipeline",
      title: "Pipeline stages",
      description: "Contacts first seen in the period, by the furthest pipeline stage reached.",
      columns: [col("stage", "Stage", "text"), col("reached", "Reached", "count"), col("of_total", "Of new contacts", "pct"), col("conversion", "From previous stage", "pct"), col("cost", "Ad spend per contact", "money")],
      rows: stepsFlow.map((s) => ({ stage: s.name, reached: s.reached, of_total: s.ofTotal, conversion: s.conversion, cost: s.costMinor })),
      defaultColumns: ["stage", "reached", "of_total", "conversion"],
      metrics: ["reached"],
      charts: ["funnel", "bar"],
      defaultChart: "funnel",
      defaultMetric: "reached",
      noun: "stages",
    },
  ];

  return {
    currency: ws.reportingCurrency,
    model: p.model,
    modelLabel: MODEL_LABELS[p.model] ?? p.model,
    period: { start: p.start, end: p.end, label: dateRange(p.start, p.end), days: periodDays(p.start, p.end) },
    previousPeriod: { start: prev.start, end: prev.end, label: dateRange(prev.start, prev.end) },
    facts,
    datasets,
    warnings: cur.warnings,
  };
}

/** A fact's value, previous value and change as printed. */
export function factText(f: DocFact, currency: string) {
  const change = f.value !== null && f.previous !== null && f.previous !== 0 ? signedPct((f.value - f.previous) / Math.abs(f.previous)) : null;
  return { value: formatValue(f.kind, f.value, currency), previous: f.previous === null ? null : formatValue(f.kind, f.previous, currency), change };
}

/** Rows the model sees per dataset (enough to write about; the PDF can show more). */
export const MODEL_ROWS = 15;

/**
 * The formatted copy of the pack the model reads (and the source of truth for the number check):
 * every figure pre-formatted, no raw minor units, ids to reference.
 */
export function packForModel(pack: DocumentPack) {
  return {
    period: pack.period.label,
    previousPeriod: pack.previousPeriod.label,
    days: pack.period.days,
    currency: pack.currency,
    attribution: `${pack.modelLabel} attribution`,
    facts: pack.facts.map((f) => {
      const t = factText(f, pack.currency);
      return { id: f.id, label: f.label, value: t.value, ...(t.previous !== null ? { previous: t.previous } : {}), ...(t.change ? { changeVsPrevious: t.change } : {}) };
    }),
    datasets: pack.datasets.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      columns: Object.fromEntries(d.columns.map((c) => [c.key, c.label])),
      chartTypes: d.charts,
      chartMetrics: d.metrics,
      totalRows: d.rows.length,
      rows: d.rows.slice(0, MODEL_ROWS).map((r) => Object.fromEntries(d.columns.map((c) => [c.label, formatValue(c.kind, r[c.key], pack.currency)]))),
    })),
    caveats: pack.warnings,
  };
}

/** "27 Sep 2026" for prose built by code (mock writer). */
export const printedDate = longDate;
