import { ReportSkeleton } from "@/components/reports/report-skeleton";

export default function Loading() {
  return <ReportSkeleton title="Profit" description="Profit per ad after refunds, fees and cost of goods" kpis rows={10} label="Loading profit…" />;
}
