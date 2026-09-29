import { ReportSkeleton } from "@/components/reports/report-skeleton";

export default function Loading() {
  return <ReportSkeleton title="Performance" description="Spend, leads, customers and revenue per campaign, ad set and ad" rows={10} label="Loading performance…" />;
}
