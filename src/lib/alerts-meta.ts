import type { AlertMetric } from "./db/schema";

// Client-safe alert constants (the rule form and the Insights page import these; lib/alerts.ts
// holds the database side).

export type MetricUnit = "money" | "ratio" | "count";

export const ALERT_METRICS: { id: AlertMetric; label: string; unit: MetricUnit; description: string }[] = [
  { id: "cac", label: "CAC", unit: "money", description: "Ad spend per customer won from ads" },
  { id: "cpl", label: "CPL", unit: "money", description: "Ad spend per lead from ads" },
  { id: "roas", label: "ROAS", unit: "ratio", description: "Revenue credited to ads ÷ ad spend" },
  { id: "spend", label: "Ad spend", unit: "money", description: "Total ad spend" },
  { id: "revenue", label: "Revenue", unit: "money", description: "Revenue (credited to ads when scoped to a platform or campaign)" },
  { id: "leads", label: "Leads", unit: "count", description: "New leads (from ads when scoped to a platform or campaign)" },
];
export const ALERT_METRIC_IDS = ALERT_METRICS.map((m) => m.id) as [AlertMetric, ...AlertMetric[]];
export const metricDef = (id: string) => ALERT_METRICS.find((m) => m.id === id) ?? ALERT_METRICS[0];

export const ANOMALY_METRICS = ["revenue", "spend", "leads"] as const;
export type AnomalyMetric = (typeof ANOMALY_METRICS)[number];
/** Sensitivity presets for the anomaly rule (z-score threshold). */
export const ANOMALY_SENSITIVITY = [
  { z: 2.5, label: "High", description: "More alerts, including smaller swings" },
  { z: 3, label: "Medium", description: "Clear outliers only (recommended)" },
  { z: 4, label: "Low", description: "Only extreme days" },
] as const;
export const ANOMALY_LOOKBACK_DAYS = 28;
/** Days of history with activity needed before the anomaly rule speaks up. */
export const ANOMALY_MIN_ACTIVE_DAYS = 14;

export const WINDOW_DAY_OPTIONS = [1, 2, 3, 7, 14, 30] as const;
export const COOLDOWN_HOUR_OPTIONS = [6, 12, 24, 48, 168] as const;

export function windowLabel(days: number) {
  return days === 1 ? "yesterday" : `over the last ${days} days`;
}
