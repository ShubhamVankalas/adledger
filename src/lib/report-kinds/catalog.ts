import type { ReportKindId, ReportMeta } from "./types";

// Report metadata only (no react-pdf imports), so pages and client components can list the
// catalog without pulling in the PDF renderer.

export const REPORT_CATALOG: Record<ReportKindId, ReportMeta> = {
  "executive-summary": {
    id: "executive-summary",
    title: "Executive summary",
    description: "One page for founders and client executives: the six numbers that matter, the trend and the best and worst campaigns.",
    audience: "Founders, client executives",
    orientation: "portrait",
    length: "1 page",
    sections: ["Summary", "Six KPIs with change and trend", "Spend vs revenue", "Top and bottom campaigns"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: true,
  },
  "weekly-performance": {
    id: "weekly-performance",
    title: "Weekly performance",
    description: "What changed since last week: KPIs week over week, the daily trend, channel mix, every campaign and where money was wasted.",
    audience: "Marketing team, clients",
    orientation: "portrait",
    length: "2–3 pages",
    sections: ["KPIs week over week", "Daily spend and revenue", "What changed", "Channel mix", "Platforms", "Campaigns"],
    defaultDays: 7,
    usesModel: true,
    usesCompare: true,
  },
  "attribution-models": {
    id: "attribution-models",
    title: "Attribution model comparison",
    description: "How first touch, last touch and linear credit change each campaign's revenue, and which campaigns start or close journeys.",
    audience: "Founders, analysts",
    orientation: "portrait",
    length: "2 pages",
    sections: ["ROAS by model", "First vs last touch slope", "Starters and closers", "Revenue under every model"],
    defaultDays: 30,
    usesModel: false,
    usesCompare: false,
  },
  "ltv-cohorts": {
    id: "ltv-cohorts",
    title: "LTV and cohorts",
    description: "Lifetime value by first-payment month, LTV curves, LTV to CAC by channel and how long each cohort takes to pay back.",
    audience: "SaaS and subscription businesses",
    orientation: "landscape",
    length: "2–3 pages",
    sections: ["Cohort heatmap", "LTV curves", "LTV:CAC by channel", "Payback"],
    defaultDays: 180,
    usesModel: true,
    usesCompare: false,
  },
  "wasted-spend": {
    id: "wasted-spend",
    title: "Wasted spend and budget moves",
    description: "Campaigns that spent without returning revenue, suggested budget moves with stated assumptions, and what's too early to judge.",
    audience: "Founders, media buyers",
    orientation: "portrait",
    length: "2 pages",
    sections: ["Waste at a glance", "Suggested budget moves", "Waste by campaign", "Too early to judge", "Assumptions"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: false,
  },
  "channel-mix": {
    id: "channel-mix",
    title: "Channel mix and efficiency",
    description: "Where the budget goes and what each platform and channel returns: spend share against revenue share, ROAS against the blend, and the daily mix.",
    audience: "Founders, media buyers, agencies",
    orientation: "portrait",
    length: "2 pages",
    sections: ["Mix at a glance", "Spend share vs revenue share", "ROAS by platform", "Daily spend by platform", "Revenue by channel"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: true,
  },
  "lead-quality": {
    id: "lead-quality",
    title: "Lead source quality",
    description: "Which sources send leads that turn into customers: cost per lead next to close rate and revenue per lead, by channel and campaign.",
    audience: "Lead-gen teams, sales and marketing",
    orientation: "portrait",
    length: "2 pages",
    sections: ["Lead KPIs", "Quality by channel", "Close rate by campaign", "Cheap leads that don't buy", "Lead to payment timing"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: false,
  },
  "ad-leaderboard": {
    id: "ad-leaderboard",
    title: "Creative and ad leaderboard",
    description: "Every ad ranked: the creatives that bring in revenue, the most efficient, the click-through leaders and the ads spending without return.",
    audience: "Creative teams, media buyers",
    orientation: "portrait",
    length: "2 pages",
    sections: ["Leaderboard at a glance", "Top ads by revenue", "Most efficient", "Click-through leaders", "Spending without return"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: false,
  },
  "conversion-funnel": {
    id: "conversion-funnel",
    title: "Funnel and time to convert",
    description: "Visitors to leads to customers with each step's rate, how many days and touches a sale takes, and whether the attribution window fits.",
    audience: "Growth teams, analysts",
    orientation: "portrait",
    length: "2 pages",
    sections: ["Funnel", "Step rates vs previous period", "Days to convert", "Touches before buying", "Campaign timing"],
    defaultDays: 90,
    usesModel: true,
    usesCompare: true,
  },
  "pipeline-activity": {
    id: "pipeline-activity",
    title: "Pipeline and CRM activity",
    description: "How far new contacts got through your pipeline stages, the win rate, and what each stage costs in ad spend per campaign.",
    audience: "Sales-led and service businesses",
    orientation: "portrait",
    length: "1–2 pages",
    sections: ["Pipeline at a glance", "Stage funnel", "Stage by stage", "Cost per stage by campaign"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: false,
  },
  "profit-refunds": {
    id: "profit-refunds",
    title: "Profit and refunds",
    description: "From gross sales to profit after ads, with refunds, costs and POAS, and the campaigns whose customers refund the most.",
    audience: "Founders, finance",
    orientation: "portrait",
    length: "2 pages",
    sections: ["Profit KPIs", "Gross sales to profit", "Profit by campaign", "Refunds by campaign"],
    defaultDays: 30,
    usesModel: true,
    usesCompare: true,
  },
};

export const REPORT_LIST: ReportMeta[] = Object.values(REPORT_CATALOG);

/**
 * Text for use mid-sentence: "Weekly performance" → "weekly performance", while acronyms and
 * brand-cased words keep their case ("LTV and cohorts", "SaaS businesses").
 */
export const midSentence = (text: string) => {
  const word = /^\S+/.exec(text)?.[0] ?? "";
  return word.length > 1 && word.slice(1) === word.slice(1).toLowerCase() ? text[0].toLowerCase() + text.slice(1) : text;
};

export const isReportKindId = (v: string): v is ReportKindId => Object.prototype.hasOwnProperty.call(REPORT_CATALOG, v);

/** Default schedule name: "Executive summary, monthly", but plain "Weekly performance" when weekly. */
export const defaultScheduleName = (title: string, cadence: "weekly" | "monthly") => (title.toLowerCase().includes(cadence) ? title : `${title}, ${cadence}`);
