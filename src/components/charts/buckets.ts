import { shortDate } from "@/lib/format";
import type { SpendRevenuePoint } from "./spend-revenue-chart";

/** Group daily points into weeks (Monday start) or months for the interval toggle. Display only. */
export function bucketSeries(
  days: { date: string; spendMinor: number; attributedRevenueMinor: number; prevAttributedRevenueMinor: number | null }[],
  interval: "day" | "week" | "month",
): SpendRevenuePoint[] {
  if (interval === "day") return days.map((d) => ({ ...d, label: shortDate(d.date) }));
  const out = new Map<string, SpendRevenuePoint>();
  for (const d of days) {
    const t = new Date(`${d.date}T00:00:00Z`);
    let key: string;
    let label: string;
    if (interval === "week") {
      t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      key = t.toISOString().slice(0, 10);
      label = shortDate(key);
    } else {
      key = `${d.date.slice(0, 7)}-01`;
      label = new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    }
    const b = out.get(key) ?? { date: key, label, spendMinor: 0, attributedRevenueMinor: 0, prevAttributedRevenueMinor: d.prevAttributedRevenueMinor === null ? null : 0 };
    b.spendMinor += d.spendMinor;
    b.attributedRevenueMinor += d.attributedRevenueMinor;
    if (b.prevAttributedRevenueMinor !== null && d.prevAttributedRevenueMinor !== null) b.prevAttributedRevenueMinor += d.prevAttributedRevenueMinor;
    out.set(key, b);
  }
  return [...out.values()];
}
