// Performance table columns, presets and URL state. Client-safe and pure (no React), so the
// server page, the client table and the tests all read the same definitions.
//
// URL keys (every one optional; defaults are omitted from the URL):
//   preset  default · ecommerce · leadgen · creative (ignored when `cols` is set)
//   cols    custom column order, comma separated column keys ("spendMinor,leads,roas")
//   sort    a column key or "name" · dir asc | desc
//   density comfortable (default) | compact
//   mode    table (default) | quadrant
//   peek    id of the row whose peek sheet is open
import { credit, moneyShort, moneyWhole, num, pct, signedPct } from "@/lib/format";
import { ratioX } from "@/lib/metrics";
import type { PerfMetricKey } from "@/lib/reports-performance";

export type ColumnKey = PerfMetricKey | "status";
export type ColumnFormat = "money" | "count" | "credit" | "percent" | "ratio" | "gap" | "status";
/** Which direction is good, for Δ colours and stoplights. */
export type Polarity = "up" | "down" | "neutral";

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  /** Narrow header label when the full one is long. */
  short?: string;
  /** Plain-language definition, shown as the header tooltip and in the column chooser. */
  hint: string;
  format: ColumnFormat;
  polarity: Polarity;
  group: "Delivery" | "Leads & customers" | "Revenue" | "Trust";
};

export const COLUMNS: readonly ColumnDef[] = [
  { key: "status", label: "Status", hint: "Delivery status reported by the ad platform.", format: "status", polarity: "neutral", group: "Delivery" },
  { key: "spendMinor", label: "Spend", hint: "Ad spend in the period, in your reporting currency.", format: "money", polarity: "neutral", group: "Delivery" },
  { key: "impressions", label: "Impressions", short: "Impr.", hint: "Times the ads were shown.", format: "count", polarity: "neutral", group: "Delivery" },
  { key: "clicks", label: "Clicks", hint: "Link clicks reported by the platform.", format: "count", polarity: "up", group: "Delivery" },
  { key: "ctr", label: "CTR", hint: "Click-through rate: clicks ÷ impressions.", format: "percent", polarity: "up", group: "Delivery" },
  { key: "cpmMinor", label: "CPM", hint: "Cost per 1,000 impressions.", format: "money", polarity: "down", group: "Delivery" },
  { key: "cpcMinor", label: "CPC", hint: "Cost per click: spend ÷ clicks.", format: "money", polarity: "down", group: "Delivery" },
  { key: "leads", label: "Leads", hint: "Leads credited to the ad by the attribution model.", format: "credit", polarity: "up", group: "Leads & customers" },
  { key: "cplMinor", label: "CPL", hint: "Cost per lead: spend ÷ credited leads.", format: "money", polarity: "down", group: "Leads & customers" },
  { key: "cvr", label: "CVR", hint: "Click to lead rate: credited leads ÷ clicks.", format: "percent", polarity: "up", group: "Leads & customers" },
  { key: "customers", label: "Customers", hint: "New paying customers credited to the ad.", format: "credit", polarity: "up", group: "Leads & customers" },
  { key: "cacMinor", label: "CAC", hint: "Customer acquisition cost: spend ÷ credited new customers.", format: "money", polarity: "down", group: "Leads & customers" },
  { key: "leadToCustomer", label: "Lead → customer", short: "L → C", hint: "Share of credited leads that became paying customers.", format: "percent", polarity: "up", group: "Leads & customers" },
  { key: "purchases", label: "Purchases", hint: "Credited payments (first and repeat).", format: "credit", polarity: "up", group: "Revenue" },
  { key: "revenueMinor", label: "Revenue", hint: "Payments credited to the ad, net of refunds.", format: "money", polarity: "up", group: "Revenue" },
  { key: "aovMinor", label: "AOV", hint: "Average order value: credited payments ÷ purchases.", format: "money", polarity: "up", group: "Revenue" },
  { key: "roas", label: "ROAS", hint: "Return on ad spend: credited revenue ÷ spend. 1× is break-even.", format: "ratio", polarity: "up", group: "Revenue" },
  { key: "newCustomerRevenueMinor", label: "New customer revenue", short: "NC revenue", hint: "Revenue from customers' first payments only.", format: "money", polarity: "up", group: "Revenue" },
  { key: "ncRoas", label: "NC-ROAS", hint: "New-customer ROAS: first-payment revenue ÷ spend. Leaves out repeat buyers.", format: "ratio", polarity: "up", group: "Revenue" },
  { key: "platformConversions", label: "Platform conversions", short: "Platform conv.", hint: "Conversions the ad platform claims with its own attribution.", format: "credit", polarity: "neutral", group: "Trust" },
  { key: "verifiedConversions", label: "Verified conversions", short: "Verified conv.", hint: "Leads plus new customers AdLedger matched to real people.", format: "credit", polarity: "up", group: "Trust" },
  { key: "platformGap", label: "Platform gap", hint: "How far the platform's claim is above (or below) what AdLedger verified.", format: "gap", polarity: "neutral", group: "Trust" },
];

export const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
export const isColumnKey = (v: string): v is ColumnKey => COLUMN_BY_KEY.has(v as ColumnKey);

export const PRESETS = [
  {
    key: "default",
    label: "Default",
    hint: "Spend through to ROAS",
    cols: ["spendMinor", "clicks", "leads", "cplMinor", "customers", "cacMinor", "platformGap", "revenueMinor", "roas"],
  },
  { key: "ecommerce", label: "E-commerce", hint: "Purchases, AOV and NC-ROAS", cols: ["spendMinor", "purchases", "revenueMinor", "roas", "ncRoas", "aovMinor"] },
  { key: "leadgen", label: "Lead gen", hint: "Leads, CPL and lead quality", cols: ["spendMinor", "leads", "cplMinor", "cvr", "customers", "cacMinor", "leadToCustomer"] },
  { key: "creative", label: "Creative", hint: "Delivery and click quality", cols: ["spendMinor", "impressions", "cpmMinor", "ctr", "cpcMinor", "cvr", "roas"] },
] as const satisfies readonly { key: string; label: string; hint: string; cols: readonly ColumnKey[] }[];

export type PresetKey = (typeof PRESETS)[number]["key"] | "custom";
export const DEFAULT_PRESET = "default";

export type SortKey = ColumnKey | "name";
export type Sort = { key: SortKey; dir: 1 | -1 };
export type Density = "comfortable" | "compact";
export type Mode = "table" | "quadrant";

export type TableState = {
  preset: PresetKey;
  columns: ColumnKey[];
  sort: Sort;
  density: Density;
  mode: Mode;
  peek: string | null;
};

export const DEFAULT_SORT: Sort = { key: "spendMinor", dir: -1 };
const MAX_COLS = COLUMNS.length;

const presetCols = (key: string) => PRESETS.find((p) => p.key === key)?.cols;

/** Parse `cols` into known, unique column keys (null when there are none). */
export function parseCols(v: string | null | undefined): ColumnKey[] | null {
  if (!v) return null;
  const out: ColumnKey[] = [];
  for (const k of v.split(",")) {
    const t = k.trim();
    if (isColumnKey(t) && !out.includes(t)) out.push(t);
    if (out.length >= MAX_COLS) break;
  }
  return out.length ? out : null;
}

type ParamSource = { get(key: string): string | null };

/** Read the table's display state from the URL, falling back to defaults for anything unknown. */
export function readTableState(sp: ParamSource): TableState {
  const custom = parseCols(sp.get("cols"));
  const rawPreset = sp.get("preset") ?? DEFAULT_PRESET;
  const preset: PresetKey = custom ? "custom" : presetCols(rawPreset) ? (rawPreset as PresetKey) : DEFAULT_PRESET;
  const columns: ColumnKey[] = custom ?? [...(presetCols(preset) ?? PRESETS[0].cols)];
  const sortKey = sp.get("sort");
  const sort: Sort =
    sortKey && (sortKey === "name" || isColumnKey(sortKey))
      ? { key: sortKey, dir: sp.get("dir") === "asc" ? 1 : sp.get("dir") === "desc" ? -1 : sortKey === "name" ? 1 : -1 }
      : DEFAULT_SORT;
  const peek = sp.get("peek");
  return {
    preset,
    columns,
    sort,
    density: sp.get("density") === "compact" ? "compact" : "comfortable",
    mode: sp.get("mode") === "quadrant" ? "quadrant" : "table",
    peek: peek && /^[0-9a-f-]{36}$/i.test(peek) ? peek : null,
  };
}

/** URL patch for a new state, leaving defaults out so links stay short. */
export function tableStatePatch(s: Partial<TableState>): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  if (s.preset !== undefined || s.columns !== undefined) {
    const preset = s.preset ?? "custom";
    const cols = s.columns ?? [];
    const matches = PRESETS.find((p) => p.key === preset && p.cols.length === cols.length && p.cols.every((c, i) => c === cols[i]));
    if (preset !== "custom" && (s.columns === undefined || matches)) {
      patch.preset = preset === DEFAULT_PRESET ? null : preset;
      patch.cols = null;
    } else {
      patch.preset = null;
      patch.cols = cols.join(",");
    }
  }
  if (s.sort) {
    const isDefault = s.sort.key === DEFAULT_SORT.key && s.sort.dir === DEFAULT_SORT.dir;
    patch.sort = isDefault ? null : s.sort.key;
    patch.dir = isDefault ? null : s.sort.dir === 1 ? "asc" : "desc";
  }
  if (s.density) patch.density = s.density === "comfortable" ? null : s.density;
  if (s.mode) patch.mode = s.mode === "table" ? null : s.mode;
  if (s.peek !== undefined) patch.peek = s.peek;
  return patch;
}

/** Next sort when a header is clicked: flip the direction on the same column, else its natural first direction. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key === key) return { key, dir: cur.dir === 1 ? -1 : 1 };
  // Names read A–Z first; costs (lower is better) show the cheapest first; everything else biggest first.
  const pol = key === "name" ? null : COLUMN_BY_KEY.get(key)?.polarity;
  return { key, dir: key === "name" || pol === "down" ? 1 : -1 };
}

/** Sort rows client-side. Nulls ("—") always sink to the bottom whatever the direction. */
export function sortRows<T extends { name: string; status: string | null } & Partial<Record<ColumnKey, unknown>>>(rows: readonly T[], sort: Sort): T[] {
  const key = sort.key;
  return [...rows].sort((a, b) => {
    const av = key === "name" ? a.name : (a[key] as number | string | null | undefined);
    const bv = key === "name" ? b.name : (b[key] as number | string | null | undefined);
    const an = av === null || av === undefined;
    const bn = bv === null || bv === undefined;
    if (an || bn) return an === bn ? a.name.localeCompare(b.name) : an ? 1 : -1;
    const c = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    return c === 0 ? a.name.localeCompare(b.name) : c * sort.dir;
  });
}

// ---------------------------------------------------------------- targets and stoplights

/**
 * Workspace targets that colour a stoplight dot in the matching cells. Goals are optional: with no
 * targets the table shows no dots. Money targets are in minor units.
 */
export type PerfTargets = Partial<Record<"roas" | "cacMinor" | "cplMinor" | "ncRoas", number>>;
export type Stoplight = "good" | "warn" | "bad";
/** Within this share of the target counts as "close" (amber). */
export const STOPLIGHT_TOLERANCE = 0.2;

/**
 * Green when the value meets the target, amber when it misses by less than 20%, red otherwise.
 * `polarity` "down" means lower is better (CAC, CPL). Null when there is no value or no target.
 */
export function stoplight(value: number | null | undefined, target: number | null | undefined, polarity: Polarity): Stoplight | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !target || target <= 0) return null;
  const miss = polarity === "down" ? (value - target) / target : (target - value) / target;
  if (miss <= 0) return "good";
  return miss < STOPLIGHT_TOLERANCE ? "warn" : "bad";
}

/**
 * Width of the ROAS bar, 0–1. Scaled to the column's best ROAS but capped at twice the target
 * (break-even 1× when there is no target) so one outlier doesn't flatten every other bar.
 */
export function roasBar(value: number | null, columnMax: number, target?: number): number {
  if (value === null || value <= 0) return 0;
  const cap = 2 * (target && target > 0 ? target : 1);
  const scale = Math.max(Math.min(columnMax, cap), target && target > 0 ? target : 1);
  return Math.min(1, value / scale);
}

// ---------------------------------------------------------------- formatting

/** Display text for one value. `compact` for cards and chips ($41.3K), full for the table. */
export function formatValue(format: ColumnFormat, v: number | null | undefined, currency: string, compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (format) {
    case "money":
      return compact ? moneyShort(v, currency) : moneyWhole(v, currency);
    case "count":
      return num(v);
    case "credit":
      return credit(v);
    case "percent":
      return pct(v, Math.abs(v) < 0.1 ? 2 : 1);
    case "ratio":
      return ratioX(v);
    case "gap":
      return signedPct(v, 0);
    default:
      return String(v);
  }
}

/** Status text from the platform ("ACTIVE", "paused", "CAMPAIGN_PAUSED") as a short sentence-case label. */
export function statusLabel(status: string | null | undefined): { label: string; tone: "active" | "paused" | "other" } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (/(^|_)(active|enabled|serving|delivering)$/.test(s) || s === "active") return { label: "Active", tone: "active" };
  if (/paused|inactive|disabled|off/.test(s)) return { label: "Paused", tone: "paused" };
  if (/archived|deleted|removed|ended|completed/.test(s)) return { label: "Ended", tone: "other" };
  const words = s.replace(/[_-]+/g, " ").trim();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: "other" };
}

// ---------------------------------------------------------------- deltas

export type DeltaTone = "good" | "bad" | "neutral" | "flat";
/** Changes smaller than 2% read as flat (muted), matching the Overview. */
export const FLAT = 0.02;

/** Tone of a relative change for a column: good or bad by polarity, muted when neutral or tiny. */
export function deltaTone(change: number, polarity: Polarity): DeltaTone {
  if (Math.abs(change) < FLAT) return "flat";
  if (polarity === "neutral") return "neutral";
  return change > 0 === (polarity === "up") ? "good" : "bad";
}
