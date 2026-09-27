/**
 * Date presets and comparison periods for the report filter bar. Pure functions on ISO dates
 * (YYYY-MM-DD, already in the workspace timezone), shared by the server resolver (period.ts) and
 * the client filter bar, so both always agree on what "Last month" means.
 */

export const RANGE_PRESETS = [
  { key: "today", label: "Today", short: "Today" },
  { key: "yesterday", label: "Yesterday", short: "Yesterday" },
  { key: "7d", label: "Last 7 days", short: "7 days" },
  { key: "14d", label: "Last 14 days", short: "14 days" },
  { key: "30d", label: "Last 30 days", short: "30 days" },
  { key: "90d", label: "Last 90 days", short: "90 days" },
  { key: "180d", label: "Last 180 days", short: "180 days" },
  { key: "mtd", label: "Month to date", short: "MTD" },
  { key: "lastmonth", label: "Last month", short: "Last month" },
  { key: "qtd", label: "Quarter to date", short: "QTD" },
  { key: "ytd", label: "Year to date", short: "YTD" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];
export type RangeKey = RangePreset | "custom";

export const DEFAULT_RANGE: RangePreset = "30d";

export const COMPARE_MODES = [
  { key: "prev", label: "Previous period", short: "vs previous period" },
  { key: "year", label: "Previous year", short: "vs previous year" },
  { key: "none", label: "No comparison", short: "No comparison" },
] as const;

export type CompareMode = (typeof COMPARE_MODES)[number]["key"];
export const DEFAULT_COMPARE: CompareMode = "prev";

const PRESET_KEYS = new Set<string>(RANGE_PRESETS.map((p) => p.key));
const COMPARE_KEYS = new Set<string>(COMPARE_MODES.map((c) => c.key));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

export const isRangePreset = (v: unknown): v is RangePreset => typeof v === "string" && PRESET_KEYS.has(v);
export const parseCompare = (v: unknown): CompareMode => (typeof v === "string" && COMPARE_KEYS.has(v) ? (v as CompareMode) : DEFAULT_COMPARE);
export const rangeLabel = (key: string) => RANGE_PRESETS.find((p) => p.key === key)?.label ?? "Custom range";
export const rangeShort = (key: string) => RANGE_PRESETS.find((p) => p.key === key)?.short ?? "Custom";
export const compareLabel = (key: string) => COMPARE_MODES.find((c) => c.key === key)?.label ?? COMPARE_MODES[0].label;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && iso(t) === v;
}

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (start: string, end: string) => Math.round((ms(end) - ms(start)) / DAY) + 1;

/** Same calendar day `years` earlier, clamped to the month's last day (29 Feb → 28 Feb). */
export function shiftYears(d: string, years: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return iso(Date.UTC(y + years, m - 1, Math.min(day, last)));
}

/**
 * Resolve a preset into an inclusive [start, end]. `today` is the workspace's current date;
 * `anchor` is the day rolling ranges (7d, 30d…) end on, usually the latest day with data so a
 * workspace whose data stopped last week still opens on something. Calendar presets (Today,
 * MTD, Last month…) always follow the real calendar.
 */
export function presetRange(preset: RangePreset, today: string, anchor: string = today): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { start: d, end: d };
    }
    case "mtd":
      return { start: iso(Date.UTC(y, m - 1, 1)), end: today };
    case "lastmonth":
      return { start: iso(Date.UTC(y, m - 2, 1)), end: iso(Date.UTC(y, m - 1, 0)) };
    case "qtd":
      return { start: iso(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1)), end: today };
    case "ytd":
      return { start: iso(Date.UTC(y, 0, 1)), end: today };
    default: {
      const days = Number.parseInt(preset, 10);
      return { start: addDays(anchor, -(days - 1)), end: anchor };
    }
  }
}

/**
 * The period to compare against: the same number of days immediately before ("prev"), the same
 * dates one year earlier ("year"), or nothing.
 */
export function comparisonRange(start: string, end: string, mode: CompareMode): { start: string; end: string } | null {
  if (mode === "none") return null;
  if (mode === "year") return { start: shiftYears(start, -1), end: shiftYears(end, -1) };
  const len = daysBetween(start, end);
  return { start: addDays(start, -len), end: addDays(start, -1) };
}
