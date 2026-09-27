import { ATTRIBUTION_TABS } from "@/components/analysis/tabs";
import { AnalysisSkeleton } from "@/components/analysis/skeleton";

export default function Loading() {
  return <AnalysisSkeleton tabs={ATTRIBUTION_TABS} active="/attribution/paths" label="Attribution views" />;
}
