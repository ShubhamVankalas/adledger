import { ReportSkeleton } from "@/components/reports/report-skeleton";

export default function Loading() {
  return <ReportSkeleton title="Reports" description="Branded PDF reports from your ledger" kpis rows={6} label="Loading reports…" />;
}
