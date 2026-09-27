// Metric registry: one entry per headline metric with its label, plain-language definition,
// display format, polarity (which direction is good) and where the number comes from.
// It feeds KPI tiles, the ⓘ popovers, the Metric explorer and (later) table columns, alert rules
// and MCP tool descriptions. Client-safe: no server imports. The numbers themselves are computed
// in SQL by src/lib/reports-metrics.ts; nothing here does arithmetic on money beyond formatting.
import { credit, moneyShort, moneyWhole, num, pct } from "./format";

export const METRIC_KEYS = [
  "revenue",
  "attributedRevenue",
  "spend",
  "roas",
  "mer",
  "leads",
  "cpl",
  "customers",
  "cac",
  "unattributedShare",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricFormat = "money" | "ratio" | "count" | "percent";
/** "up" = higher is better, "down" = lower is better (CAC, CPL), "neutral" = neither (spend). */
export type Polarity = "up" | "down" | "neutral";

export type MetricDef = {
  key: MetricKey;
  label: string;
  /** One or two plain sentences for the ⓘ popover. */
  definition: string;
  format: MetricFormat;
  polarity: Polarity;
  /** CSS colour of the metric's series, the same on every chart. */
  color: string;
  /** SQL expression (over the kpiSeries columns) documenting how the number is computed. */
  sql: string;
  /** The reports function that computes it. */
  source: string;
  /** Where "drill into the report" goes. */
  href: string;
};

// Quiet Ledger chart tokens, with the current theme's chart colours as fallbacks.
const REVENUE = "var(--chart-revenue, var(--chart-1))";
const SPEND = "var(--chart-spend, var(--chart-2))";
const LEADS = "var(--chart-leads, var(--chart-3))";
const CUSTOMERS = "var(--chart-customers, var(--chart-2))";
const MUTED = "var(--fg-muted, var(--muted-foreground))";

export const METRICS: Record<MetricKey, MetricDef> = {
  revenue: {
    key: "revenue",
    label: "Revenue",
    definition: "All payments in the period, net of refunds, in your reporting currency. Counted on the day the payment happened.",
    format: "money",
    polarity: "up",
    color: REVENUE,
    sql: "sum(revenue_minor) where conversion_type = 'revenue'",
    source: "reports-metrics.kpiSeries",
    href: "/reports/ltv",
  },
  attributedRevenue: {
    key: "attributedRevenue",
    label: "Revenue from ads",
    definition: "The part of revenue credited to an ad campaign by the selected attribution model.",
    format: "money",
    polarity: "up",
    color: REVENUE,
    sql: "sum(revenue_minor) where conversion_type = 'revenue' and campaign_id is not null",
    source: "reports-metrics.kpiSeries",
    href: "/performance",
  },
  spend: {
    key: "spend",
    label: "Ad spend",
    definition: "What your connected ad accounts spent in the period. Spending more is neither good nor bad on its own.",
    format: "money",
    polarity: "neutral",
    color: SPEND,
    sql: "sum(ad_insights_daily.spend_minor)",
    source: "reports-metrics.kpiSeries",
    href: "/performance",
  },
  roas: {
    key: "roas",
    label: "ROAS",
    definition: "Return on ad spend: revenue credited to ads ÷ ad spend, using the selected attribution model. Break-even is 1.00×.",
    format: "ratio",
    polarity: "up",
    color: REVENUE,
    sql: "attributed_revenue_minor / spend_minor",
    source: "reports-metrics.kpiSeries",
    href: "/performance",
  },
  mer: {
    key: "mer",
    label: "MER",
    definition: "Marketing efficiency ratio: all revenue ÷ all ad spend. Needs no attribution, so it is a good sanity check on ROAS.",
    format: "ratio",
    polarity: "up",
    color: REVENUE,
    sql: "revenue_minor / spend_minor",
    source: "reports-metrics.kpiSeries",
    href: "/performance",
  },
  leads: {
    key: "leads",
    label: "Leads",
    definition: "People who filled in a form or an ad lead form in the period, counted once per submission.",
    format: "count",
    polarity: "up",
    color: LEADS,
    sql: "count(distinct conversion_id) where conversion_type = 'lead'",
    source: "reports-metrics.kpiSeries",
    href: "/contacts?lifecycle=lead",
  },
  cpl: {
    key: "cpl",
    label: "Cost per lead",
    definition: "Ad spend ÷ leads credited to ad campaigns. Lower is better.",
    format: "money",
    polarity: "down",
    color: LEADS,
    sql: "spend_minor / sum(credit) where conversion_type = 'lead' and campaign_id is not null",
    source: "reports-metrics.kpiSeries",
    href: "/performance",
  },
  customers: {
    key: "customers",
    label: "Customers",
    definition: "People whose first payment landed in the period.",
    format: "count",
    polarity: "up",
    color: CUSTOMERS,
    sql: "count(distinct conversion_id) where conversion_type = 'customer'",
    source: "reports-metrics.kpiSeries",
    href: "/contacts?lifecycle=customer",
  },
  cac: {
    key: "cac",
    label: "Customer acquisition cost",
    definition: "Ad spend ÷ new customers credited to ad campaigns. Lower is better.",
    format: "money",
    polarity: "down",
    color: CUSTOMERS,
    sql: "spend_minor / sum(credit) where conversion_type = 'customer' and campaign_id is not null",
    source: "reports-metrics.kpiSeries",
    href: "/performance",
  },
  unattributedShare: {
    key: "unattributedShare",
    label: "Unattributed",
    definition:
      "Share of revenue from people with no tracked ad or marketing touch in the attribution window. Lower is better: put the pixel on every landing page and pass the visitor ID to checkout.",
    format: "percent",
    polarity: "down",
    color: MUTED,
    sql: "unattributed_revenue_minor / revenue_minor",
    source: "reports-metrics.kpiSeries",
    href: "/settings/workspace/tracking",
  },
};

export const isMetricKey = (v: unknown): v is MetricKey => typeof v === "string" && (METRIC_KEYS as readonly string[]).includes(v);

// ---------------------------------------------------------------- formatting

/** "3.25×", "0×" when nothing came back, "—" when undefined (no spend). */
export function ratioX(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return Number(s) === 0 ? "0×" : `${s.replace(/^-/, "−")}×`;
}

/**
 * Format a metric value. `compact` for tiles and chips ($553.9K), full for tooltips and tables.
 */
export function formatMetric(key: MetricKey, value: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (METRICS[key].format) {
    case "money":
      return opts.compact ? moneyShort(value, currency) : moneyWhole(value, currency);
    case "ratio":
      return ratioX(value);
    case "percent":
      return pct(value, 1);
    case "count":
      return opts.compact ? credit(value) : num(value, Math.abs(value) >= 10 ? 0 : 2);
  }
}

/** Axis tick labels: short and round. */
export function formatAxis(key: MetricKey, value: number, currency: string): string {
  switch (METRICS[key].format) {
    case "money":
      return moneyShort(value, currency);
    case "ratio":
      return ratioX(value, value >= 10 ? 0 : 1);
    case "percent":
      return pct(value, 0);
    case "count":
      return num(value, value < 10 && !Number.isInteger(value) ? 1 : 0);
  }
}

// ---------------------------------------------------------------- deltas and polarity

/** Changes smaller than this (2%) read as "flat" rather than a win or a loss. */
export const FLAT_THRESHOLD = 0.02;

export type DeltaTone = "good" | "bad" | "neutral" | "flat" | "none";
export type Delta = {
  /** Relative change, e.g. 0.124 for +12.4%. Null when there is nothing to compare against. */
  change: number | null;
  direction: "up" | "down" | "flat" | null;
  tone: DeltaTone;
  /** Short visible text: "12.4%", "Flat", ">999%" or "" (arrow drawn separately). */
  text: string;
  /** Full sentence for screen readers and tooltips. */
  label: string;
};

/**
 * Change between two values, coloured by the metric's polarity: spend is neutral, CAC and CPL are
 * good when they go down, and anything within ±2% is "flat" (muted).
 */
export function metricDelta(cur: number | null | undefined, prev: number | null | undefined, polarity: Polarity): Delta {
  if (cur === null || cur === undefined || prev === null || prev === undefined || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) {
    return { change: null, direction: null, tone: "none", text: "", label: "No comparison available" };
  }
  const change = (cur - prev) / Math.abs(prev);
  if (Math.abs(change) < FLAT_THRESHOLD) {
    return { change, direction: "flat", tone: "flat", text: "Flat", label: `Flat (${pct(change, 1)}) vs previous period` };
  }
  const direction = change > 0 ? "up" : "down";
  const tone: DeltaTone = polarity === "neutral" ? "neutral" : (direction === "up") === (polarity === "up") ? "good" : "bad";
  const text = Math.abs(change) >= 10 ? ">999%" : pct(Math.abs(change), 1);
  const judgement = tone === "good" ? ", better" : tone === "bad" ? ", worse" : "";
  return { change, direction, tone, text, label: `${direction === "up" ? "Up" : "Down"} ${text} vs previous period${judgement}` };
}
