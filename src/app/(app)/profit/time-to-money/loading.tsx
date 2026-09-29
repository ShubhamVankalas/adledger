import { ReportSkeleton } from "@/components/reports/report-skeleton";

export default function Loading() {
  return <ReportSkeleton title="Time to money" description="How long buyers take to pay, and which campaigns are too young to judge" rows={10} label="Loading time to money…" />;
}
