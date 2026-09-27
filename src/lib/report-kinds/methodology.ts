import { getIntegration } from "../connectors/registry";
import type { DB } from "../db";
import { overview, previousPeriod, syncStatus, type Overview } from "../reports";
import type { Workspace } from "../settings";
import type { Methodology, ReportRequest, SyncInfo } from "./types";

/** The comparison window of a request (previous period of equal length), or null. */
export function compareRange(req: ReportRequest): { start: string; end: string } | null {
  if (req.compare === "none") return null;
  const p = previousPeriod({ start: req.start, end: req.end, model: req.model });
  return { start: p.start, end: p.end };
}

/**
 * Methodology appendix data: model and window, unattributed share, currency exclusions, last
 * sync per data source and pixel activity. Pass the period's overview when the caller already
 * has it (saves a query).
 */
export async function loadMethodology(db: DB, ws: Workspace, req: ReportRequest, ov?: Overview): Promise<Methodology> {
  const o = ov ?? (await overview(db, ws, { start: req.start, end: req.end, model: req.model }));
  const status = await syncStatus(db, ws);
  const cmp = compareRange(req);
  const syncs: SyncInfo[] = status.connections
    .map((c) => ({ c, meta: getIntegration(String(c.provider)) }))
    // Data sources only: ads and revenue/CRM connections (not notification channels or the LLM).
    .filter(({ c, meta }) => c.enabled !== false && meta && meta.category !== "notifications" && String(c.provider) !== "llm")
    .map(({ c, meta }) => ({
      provider: String(c.provider),
      label: meta!.name,
      mode: c.mode === "mock" ? "mock" : "live",
      lastSyncedAt: c.last_synced_at ? new Date(String(c.last_synced_at)).toISOString() : null,
      failing: Boolean(c.last_error),
    }));
  return {
    model: req.model,
    windowDays: ws.attributionWindowDays,
    timezone: ws.timezone,
    currency: ws.reportingCurrency,
    start: req.start,
    end: req.end,
    compareStart: cmp?.start ?? null,
    compareEnd: cmp?.end ?? null,
    revenueMinor: o.revenueMinor,
    unattributedRevenueMinor: o.unattributedRevenueMinor,
    unattributedShare: o.unattributedShare,
    exclusions: o.warnings,
    syncs,
    pixel: { events24h: status.pixel.events24h, lastEventAt: status.pixel.lastEventAt ? new Date(String(status.pixel.lastEventAt)).toISOString() : null },
  };
}
