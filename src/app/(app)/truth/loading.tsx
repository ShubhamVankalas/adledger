import { ReportSkeleton } from "@/components/reports/report-skeleton";

export default function Loading() {
  return <ReportSkeleton title="Truth gap" description="What ad platforms claim, next to the payments you actually received" rows={10} label="Loading the truth gap…" />;
}
