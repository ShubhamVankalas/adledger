import { AnalysisSkeleton } from "@/components/analysis/skeleton";
import { ATTRIBUTION_TABS } from "@/components/analysis/tabs";

export default function Loading() {
  return <AnalysisSkeleton tabs={ATTRIBUTION_TABS} active="/attribution/time-to-convert" label="Attribution views" wide="grid" />;
}
