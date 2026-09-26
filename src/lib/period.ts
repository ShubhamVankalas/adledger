import type { DB } from "./db";
import { dataBounds, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

export type SearchParams = Record<string, string | string[] | undefined>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Resolve ?from=&to=&range=&model=&platform= into report params. Defaults to the
 * last 30 days ending on the latest day that has data (so demos never look empty).
 */
export async function resolvePeriodParams(db: DB, ws: Workspace, sp: SearchParams): Promise<ReportParams & { range: string }> {
  const model = one(sp.model);
  const platform = one(sp.platform);
  const range = one(sp.range) ?? "30d";
  const from = one(sp.from);
  const to = one(sp.to);
  const base = {
    model: (["first_touch", "last_touch", "linear"].includes(model ?? "") ? model : "linear") as ReportParams["model"],
    platform: platform === "meta" || platform === "google" ? (platform as "meta" | "google") : undefined,
  };
  if (from && to && DATE.test(from) && DATE.test(to) && from <= to) return { ...base, start: from, end: to, range: "custom" };

  const today = todayIn(ws.timezone);
  const bounds = await dataBounds(db, ws);
  const end = bounds.max && bounds.max < today ? bounds.max : today;
  const days = { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "180d": 180 }[range] ?? 30;
  return { ...base, start: iso(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86_400_000), end, range };
}
