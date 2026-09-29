import { AnalysisSkeleton } from "@/components/analysis/skeleton";
import { ATTRIBUTION_TABS } from "@/components/analysis/tabs";

export default function Loading() {
  return <AnalysisSkeleton tabs={ATTRIBUTION_TABS} active="/attribution" label="Attribution views" title="Attribution" description="How first-touch, last-touch and linear credit change each campaign's revenue" wide="grid" />;
}
