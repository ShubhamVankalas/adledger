import { attributionModels } from "./attribution-models";
import { executiveSummary } from "./executive-summary";
import { ltvCohorts } from "./ltv-cohorts";
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
};

export function getReportKind(id: string): ReportKind | undefined {
  return Object.prototype.hasOwnProperty.call(REPORT_KINDS, id) ? REPORT_KINDS[id as ReportKindId] : undefined;
}

export { REPORT_CATALOG, REPORT_LIST, isReportKindId } from "./catalog";
export * from "./types";
