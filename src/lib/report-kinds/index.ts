import { adLeaderboard } from "./ad-leaderboard";
import { attributionModels } from "./attribution-models";
import { channelMix } from "./channel-mix";
import { conversionFunnel } from "./conversion-funnel";
import { executiveSummary } from "./executive-summary";
import { leadQuality } from "./lead-quality";
import { ltvCohorts } from "./ltv-cohorts";
import { pipelineActivity } from "./pipeline-activity";
import { profitRefunds } from "./profit-refunds";
import type { ReportKind, ReportKindId } from "./types";
import { wastedSpendReport } from "./wasted-spend";
import { weeklyPerformance } from "./weekly-performance";

// Report-kind registry (like the connector registry): drives the Reports gallery, the PDF
// route (/api/v1/reports/{kind}/pdf) and scheduled deliveries.

export const REPORT_KINDS: Record<ReportKindId, ReportKind> = {
  "executive-summary": executiveSummary,
  "weekly-performance": weeklyPerformance,
  "attribution-models": attributionModels,
  "ltv-cohorts": ltvCohorts,
  "wasted-spend": wastedSpendReport,
  "channel-mix": channelMix,
  "lead-quality": leadQuality,
  "ad-leaderboard": adLeaderboard,
  "conversion-funnel": conversionFunnel,
  "pipeline-activity": pipelineActivity,
  "profit-refunds": profitRefunds,
};

export function getReportKind(id: string): ReportKind | undefined {
  return Object.prototype.hasOwnProperty.call(REPORT_KINDS, id) ? REPORT_KINDS[id as ReportKindId] : undefined;
}

export { REPORT_CATALOG, REPORT_LIST, isReportKindId } from "./catalog";
export * from "./types";
