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
