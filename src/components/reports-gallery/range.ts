// Period presets for the report gallery. Presets end on `anchor`: the latest day with data (or
// today), so a demo or a paused account never produces an empty report.

export const RANGE_PRESETS = {
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  "last-month": "Last full month",
  custom: "Custom range",
} as const;

export type RangeKey = keyof typeof RANGE_PRESETS;

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function resolveRange(key: RangeKey, anchor: string, custom?: { from: string; to: string }): { start: string; end: string } {
  const end = Date.parse(`${anchor}T00:00:00Z`);
  if (key === "custom" && custom?.from && custom?.to) return { start: custom.from, end: custom.to };
  if (key === "last-month") {
    const firstOfAnchorMonth = `${anchor.slice(0, 7)}-01`;
    const lastDay = iso(Date.parse(`${firstOfAnchorMonth}T00:00:00Z`) - DAY);
    return { start: `${lastDay.slice(0, 7)}-01`, end: lastDay };
  }
  const days = { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "180d": 180 }[key as "7d"] ?? 30;
  return { start: iso(end - (days - 1) * DAY), end: anchor };
}

export const defaultRangeKey = (days: number): RangeKey => (`${days}d` in RANGE_PRESETS ? (`${days}d` as RangeKey) : "30d");
