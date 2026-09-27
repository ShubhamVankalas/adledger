import { desc, eq } from "drizzle-orm";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { AttributionModel, Platform } from "@/lib/db/schema";
import { channels, currencyWarnings, performance, previousPeriod, type ReportParams } from "@/lib/reports";
import { kpiSeries, platformScorecard, recentActivity, wastedSpendWithMaturity } from "@/lib/reports-metrics";

// Per-request loaders shared by the Overview widgets (React.cache: every widget that needs the
// campaign rows or the KPI series gets the same promise, so each query runs once per render).
// Arguments are primitives so cache hits don't depend on object identity.

export type DashParams = ReportParams & { range: string };

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

export const loadWasted = cache(async (start: string, end: string, model: AttributionModel, platform?: Platform) => {
  const { db, ws } = await withWorkspace();
  const p = params(start, end, model, platform);
  return wastedSpendWithMaturity(db, ws, p, await loadCampaigns(start, end, model, platform));
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

/** The current and previous period's KPI series (the tiles, sparklines and explorer all use both). */
export function loadKpiPair(p: DashParams) {
  const prev = previousPeriod(p);
  return Promise.all([loadKpis(p.start, p.end, p.model, p.platform), loadKpis(prev.start, prev.end, p.model, p.platform)]);
}

/** Start the KPI queries before anything else renders, so the pinned strip paints first. */
export function preloadKpis(p: DashParams) {
  loadKpiPair(p).catch(() => {});
}
