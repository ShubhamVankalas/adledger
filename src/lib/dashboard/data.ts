import { desc, eq } from "drizzle-orm";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { AttributionModel, Platform } from "@/lib/db/schema";
import { channels, currencyWarnings, performance, previousPeriod, type ReportParams } from "@/lib/reports";
import { getTargets } from "@/lib/reports-goals";
import { kpiSeries, platformScorecard, recentActivity, wastedSpendWithMaturity, type WastedRow } from "@/lib/reports-metrics";
import { timeToMoney } from "@/lib/reports-profit";

// Per-request loaders shared by the Overview widgets (React.cache: every widget that needs the
// campaign rows or the KPI series gets the same promise, so each query runs once per render).
// Arguments are primitives so cache hits don't depend on object identity.

export type DashParams = ReportParams & {
  range: string;
  /** ?compare= mode (prev, year, none) and its window, from resolvePeriodParams. */
  compare?: string;
  comparison?: { start: string; end: string } | null;
};

export const getViewer = cache(() => requireUser());

const params = (start: string, end: string, model: AttributionModel, platform?: Platform): ReportParams => ({ start, end, model, platform });
const withWorkspace = async () => ({ db: await getDb(), ws: (await getViewer()).workspace });

export const loadKpis = cache(async (start: string, end: string, model: AttributionModel, platform?: Platform) => {
  const { db, ws } = await withWorkspace();
  return kpiSeries(db, ws, params(start, end, model, platform));
});

export const loadCampaigns = cache(async (start: string, end: string, model: AttributionModel, platform?: Platform) => {
  const { db, ws } = await withWorkspace();
  return performance(db, ws, { ...params(start, end, model, platform), level: "campaign" });
});

export type WastedWithLag = WastedRow & { judgeAfterDays: number | null; judgeFrom: string | null };

/**
 * Wasted-spend rows with the money-truth "too early" rule: a campaign younger than the time 80% of
 * its buyers take to pay (timeToMoney, per campaign or the workspace's lag) isn't judged yet, and
 * its spend doesn't count towards the "at risk" total.
 */
export const loadWasted = cache(async (start: string, end: string, model: AttributionModel, platform?: Platform) => {
  const { db, ws } = await withWorkspace();
  const p = params(start, end, model, platform);
  const w = await wastedSpendWithMaturity(db, ws, p, await loadCampaigns(start, end, model, platform));
  if (w.rows.length === 0) return { ...w, rows: [] as WastedWithLag[] };
  const ttm = await timeToMoney(db, ws, { asOf: end, campaignIds: w.rows.map((r) => r.id) });
  const lag = new Map(ttm.campaigns.map((c) => [c.campaignId, c]));
  const rows: WastedWithLag[] = w.rows.map((r) => {
    const l = lag.get(r.id);
    return l ? { ...r, ageDays: l.ageDays, tooEarly: l.tooEarly, judgeAfterDays: l.judgeAfterDays, judgeFrom: l.judgeFrom } : { ...r, judgeAfterDays: null, judgeFrom: null };
  });
  return { rows, medianDays: w.medianDays, totalMinor: rows.filter((r) => !r.tooEarly).reduce((s, r) => s + r.spendMinor, 0) };
});

/** Workspace targets from Settings → Targets & goals (KPI tile target bars fall back to these). */
export const loadTargets = cache(async () => {
  const { db, ws } = await withWorkspace();
  return getTargets(db, ws);
});

export const loadChannels = cache(async (start: string, end: string, model: AttributionModel) => {
  const { db, ws } = await withWorkspace();
  return channels(db, ws, params(start, end, model));
});

export const loadScorecard = cache(async (start: string, end: string, model: AttributionModel) => {
  const { db, ws } = await withWorkspace();
  return platformScorecard(db, ws, params(start, end, model));
});

export const loadRecent = cache(async (end: string) => {
  const { db, ws } = await withWorkspace();
  return recentActivity(db, ws, { end }, 6);
});

export const loadLatestInsight = cache(async () => {
  const { db, ws } = await withWorkspace();
  const [latest] = await db
    .select({
      id: schema.aiReports.id,
      periodStart: schema.aiReports.periodStart,
      periodEnd: schema.aiReports.periodEnd,
      modelName: schema.aiReports.modelName,
      contentMd: schema.aiReports.contentMd,
      unverified: schema.aiReports.unverifiedNumbers,
    })
    .from(schema.aiReports)
    .where(eq(schema.aiReports.workspaceId, ws.id))
    .orderBy(desc(schema.aiReports.createdAt))
    .limit(1);
  return latest ?? null;
});

export const loadWarnings = cache(async (start: string, end: string) => {
  const { db, ws } = await withWorkspace();
  return currencyWarnings(db, ws, params(start, end, "linear"));
});

/**
 * The current and comparison period's KPI series (the tiles, sparklines and explorer all use both).
 * The comparison follows ?compare= (previous period or previous year); with compare=none the tiles
 * still get the previous period so the sparkline has its dashed line.
 */
export function loadKpiPair(p: DashParams) {
  const prev = p.comparison ?? previousPeriod(p);
  return Promise.all([loadKpis(p.start, p.end, p.model, p.platform), loadKpis(prev.start, prev.end, p.model, p.platform)]);
}

/** Start the KPI queries before anything else renders, so the pinned strip paints first. */
export function preloadKpis(p: DashParams) {
  loadKpiPair(p).catch(() => {});
}
