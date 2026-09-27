import { AnalysisSkeleton } from "@/components/analysis/skeleton";
import { CUSTOMERS_TABS } from "@/components/analysis/tabs";

export default function Loading() {
  return <AnalysisSkeleton tabs={CUSTOMERS_TABS} active="/customers/cohorts" label="Customer views" wide="grid" />;
}
