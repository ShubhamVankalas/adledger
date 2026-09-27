import { AD_PLATFORMS, type Platform } from "./connectors/types";
import type { DB } from "./db";
import {
  comparisonRange,
  DEFAULT_RANGE,
  isIsoDate,
  isRangePreset,
  parseCompare,
  presetRange,
  type CompareMode,
  type RangeKey,
} from "./period-presets";
import { dataBounds, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

export type SearchParams = Record<string, string | string[] | undefined>;
export type { CompareMode, RangeKey } from "./period-presets";

export type ResolvedPeriod = ReportParams & {
  range: RangeKey;
  /** ?compare= (prev by default). */
  compare: CompareMode;
  /** The comparison window for `compare`, or null for "none". Same model/platform as the period. */
  comparison: { start: string; end: string } | null;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Resolve ?range=&from=&to=&compare=&model=&platform= into report params.
 *
 * - range: a preset from period-presets.ts (today, yesterday, 7d, 14d, 30d, 90d, 180d, mtd,
 *   lastmonth, qtd, ytd) or custom with from/to. Defaults to the last 30 days.
 * - Rolling ranges end on the latest day that has data (so demos and paused workspaces never
 *   open empty); calendar ranges follow the workspace's real calendar.
 * - compare: prev (default), year or none.
 */
export async function resolvePeriodParams(db: DB, ws: Workspace, sp: SearchParams): Promise<ResolvedPeriod> {
  const model = one(sp.model);
  const platform = one(sp.platform);
  const rawRange = one(sp.range);
  const from = one(sp.from);
  const to = one(sp.to);
  const compare = parseCompare(one(sp.compare));
  const base = {
    model: (["first_touch", "last_touch", "linear"].includes(model ?? "") ? model : "linear") as ReportParams["model"],
    platform: (AD_PLATFORMS as readonly string[]).includes(platform ?? "") ? (platform as Platform) : undefined,
  };
  const withCompare = (start: string, end: string, range: RangeKey): ResolvedPeriod => ({
    ...base,
    start,
    end,
    range,
    compare,
    comparison: comparisonRange(start, end, compare),
  });

  if (isIsoDate(from) && isIsoDate(to) && from <= to) return withCompare(from, to, "custom");

  const preset = isRangePreset(rawRange) ? rawRange : DEFAULT_RANGE;
  const today = todayIn(ws.timezone);
  let anchor = today;
  if (/^\d+d$/.test(preset)) {
    const bounds = await dataBounds(db, ws);
    if (bounds.max && bounds.max < today) anchor = bounds.max;
  }
  const { start, end } = presetRange(preset, today, anchor);
  return withCompare(start, end, preset);
}

/** "?a=1&b=2" from Next's searchParams (repeated keys kept), or "" when empty. */
export function toQueryString(sp: SearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, item);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** The comparison period as full report params (null when compare=none). */
export function comparisonParams(p: ResolvedPeriod): ReportParams | null {
  return p.comparison ? { model: p.model, platform: p.platform, start: p.comparison.start, end: p.comparison.end } : null;
}
