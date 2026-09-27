// Widget catalog: the client-safe half of the widget registry (metadata only, no components).
// The add-widget drawer, presets, layout validation and the server registry
// (src/lib/widgets/registry.tsx, which adds the component for each type) all read from here.
import type { MetricKey } from "@/lib/metrics";

export const WIDGET_SIZES = ["s", "m", "l", "xl"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export const SIZE_LABELS: Record<WidgetSize, string> = { s: "Small", m: "Medium", l: "Large", xl: "Full width" };

export const WIDGET_CATEGORIES = ["kpi", "chart", "list", "crm", "utility"] as const;
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<WidgetCategory, string> = { kpi: "KPIs", chart: "Charts", list: "Lists", crm: "CRM", utility: "Utility" };

/** Fixed heights so rows align and nothing jumps between loading, empty, error and data. */
export type WidgetHeight = "kpi" | "card" | "tall";

/** Settings a widget instance may carry (validated by src/lib/dashboard/layout.ts). */
export type WidgetSettings = {
  title?: string;
  metric?: MetricKey;
  sort?: "revenue" | "roas" | "worst";
  interval?: "day" | "week" | "month";
  topN?: number;
  /** KPI target in the metric's unit: minor units for money, a ratio for ROAS/MER. */
  target?: number;
};
export type WidgetSettingKey = keyof WidgetSettings;

export type WidgetMeta = {
  type: string;
  title: string;
  category: WidgetCategory;
  /** One line for the add-widget drawer. */
  description: string;
  allowedSizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  height: WidgetHeight;
  /** Can appear more than once on a board. */
  multi?: boolean;
  /** KPI tiles: the metric they show (and chart in the Metric explorer when clicked). */
  metric?: MetricKey;
  /** Which settings fields this widget reads. */
  settings: readonly WidgetSettingKey[];
  /** Phase the widget first shipped in (BRIEF §4.1). */
  availableFrom: number;
};

const kpi = (type: string, title: string, metric: MetricKey, description: string): WidgetMeta => ({
  type,
  title,
  category: "kpi",
  description,
  allowedSizes: ["s"],
  defaultSize: "s",
  height: "kpi",
  metric,
  settings: ["target"],
  availableFrom: 1,
});

export const WIDGETS = [
  kpi("kpi.revenue", "Revenue", "revenue", "All revenue with the part that came from ads, change and trend."),
  kpi("kpi.spend", "Ad spend", "spend", "Spend across every connected ad account. Neutral: up is not bad."),
  kpi("kpi.roas", "ROAS", "roas", "Revenue credited to ads ÷ ad spend, with blended MER underneath."),
  kpi("kpi.mer", "MER", "mer", "All revenue ÷ all ad spend. No attribution needed."),
  kpi("kpi.leads", "Leads · CPL", "leads", "New leads with the cost of each one."),
  kpi("kpi.customers", "Customers · CAC", "customers", "New customers with what each cost to acquire."),
  kpi("kpi.unattributed", "Unattributed share", "unattributedShare", "Revenue with no tracked ad or marketing touch."),
  {
    type: "chart.explorer",
    title: "Metric explorer",
    category: "chart",
    description: "A large trend of any metric. Click a KPI tile to chart it here.",
    allowedSizes: ["l", "xl"],
    defaultSize: "xl",
    height: "card",
    multi: true,
    settings: ["metric", "title"],
    availableFrom: 1,
  },
  {
    type: "chart.spendRevenue",
    title: "Spend vs revenue",
    category: "chart",
    description: "Daily spend bars against revenue from ads, with the previous period dashed.",
    allowedSizes: ["m", "l", "xl"],
    defaultSize: "xl",
    height: "card",
    settings: ["interval"],
    availableFrom: 1,
  },
  {
    type: "chart.channels",
    title: "Revenue by channel",
    category: "chart",
    description: "Where credited revenue came from: paid social, search, organic and more.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 1,
  },
  {
    type: "list.topCampaigns",
    title: "Top campaigns",
    category: "list",
    description: "Campaigns ranked by revenue, by ROAS, or worst first.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: ["sort", "topN"],
    availableFrom: 1,
  },
  {
    type: "list.wastedSpend",
    title: "Wasted spend",
    category: "list",
    description: "Campaigns with real spend and ROAS under 0.5×, flagged when it is too early to judge.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 1,
  },
  {
    type: "list.platforms",
    title: "Platform scorecard",
    category: "list",
    description: "Spend, revenue, ROAS and share of spend for each ad platform.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 1,
  },
  {
    type: "crm.recent",
    title: "Recent leads & customers",
    category: "crm",
    description: "The newest leads and payments with the ad that first brought each person in.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 1,
  },
  {
    type: "utility.insight",
    title: "AI insight",
    category: "utility",
    description: "Three highlights from the latest weekly report, every number verified.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 1,
  },
  {
    type: "live.now",
    title: "Live now",
    category: "utility",
    description: "Visitors on your site right now, today's revenue and leads, and the newest activity.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 2,
  },
  {
    type: "utility.goals",
    title: "Goals & pacing",
    category: "utility",
    description: "Month or quarter to date against your targets, with a projection and budget pacing.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 2,
  },
  {
    type: "list.truthGap",
    title: "Truth gap",
    category: "list",
    description: "What each platform claims vs the payments you received.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 2,
  },
  {
    type: "list.profit",
    title: "Profit after ads",
    category: "list",
    description: "Profit after ads with POAS, from your unit economics.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 2,
  },
  {
    type: "chart.funnel",
    title: "Funnel",
    category: "chart",
    description: "Visitors → leads → customers → revenue with step rates.",
    allowedSizes: ["m", "l", "xl"],
    defaultSize: "l",
    height: "card",
    settings: [],
    availableFrom: 5,
  },
  {
    type: "chart.heatmap",
    title: "Conversions heatmap",
    category: "chart",
    description: "Leads and payments by weekday and hour, in your timezone.",
    allowedSizes: ["m", "l"],
    defaultSize: "m",
    height: "card",
    settings: [],
    availableFrom: 5,
  },
] as const satisfies readonly WidgetMeta[];

export type WidgetType = (typeof WIDGETS)[number]["type"];

const BY_TYPE = new Map<string, WidgetMeta>(WIDGETS.map((w) => [w.type, w]));
export const widgetMeta = (type: string): WidgetMeta | undefined => BY_TYPE.get(type);
export const isKpiType = (type: string) => type.startsWith("kpi.");

/** Grid spans: 12 columns from 1280px, 6 columns from 768px (l and xl fill the row), 1 column below. */
export const SIZE_SPAN: Record<WidgetSize, string> = {
  s: "md:col-span-3 xl:col-span-3",
  m: "md:col-span-6 xl:col-span-6",
  l: "md:col-span-6 xl:col-span-8",
  xl: "md:col-span-6 xl:col-span-12",
};
