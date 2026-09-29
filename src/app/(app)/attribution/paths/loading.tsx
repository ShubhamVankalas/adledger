import { AnalysisSkeleton } from "@/components/analysis/skeleton";
import { ATTRIBUTION_TABS } from "@/components/analysis/tabs";

export default function Loading() {
  return <AnalysisSkeleton tabs={ATTRIBUTION_TABS} active="/attribution/paths" label="Attribution views" title="Attribution" description="The journeys people take before they buy" wide="list" />;
}
