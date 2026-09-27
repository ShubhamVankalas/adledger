import type { LiveFeedKind } from "@/lib/reports-live";

// Live page options shared by the server page (URL parsing) and the client view.

export type FeedFilter = "all" | "traffic" | "leads" | "money";
export const FEED_FILTERS: readonly { value: FeedFilter; label: string; kinds: readonly LiveFeedKind[] }[] = [
  { value: "all", label: "All", kinds: ["ad_click", "visit", "lead", "payment", "refund"] },
  { value: "traffic", label: "Visits", kinds: ["ad_click", "visit"] },
  { value: "leads", label: "Leads", kinds: ["lead"] },
  { value: "money", label: "Money", kinds: ["payment", "refund"] },
];
export const isFeedFilter = (v: unknown): v is FeedFilter => FEED_FILTERS.some((f) => f.value === v);

export type HourlyMetric = "revenue" | "visitors" | "leads";
export const HOURLY_METRICS: readonly { key: HourlyMetric; label: string; color: string }[] = [
  { key: "revenue", label: "Revenue", color: "var(--chart-revenue, var(--chart-1))" },
  { key: "visitors", label: "Visitors", color: "var(--chart-customers, var(--chart-4))" },
  { key: "leads", label: "Leads", color: "var(--chart-leads, var(--chart-3))" },
];
export const isHourlyMetric = (v: unknown): v is HourlyMetric => HOURLY_METRICS.some((m) => m.key === v);
