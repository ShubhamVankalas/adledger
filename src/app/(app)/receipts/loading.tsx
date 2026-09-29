import { ReportSkeleton } from "@/components/reports/report-skeleton";

export default function Loading() {
  return <ReportSkeleton title="Receipts" description="Every payment, the ads that earned it and what the customer cost" rows={10} label="Loading receipts…" />;
}
