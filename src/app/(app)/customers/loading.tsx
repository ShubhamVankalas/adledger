import { AnalysisSkeleton } from "@/components/analysis/skeleton";
import { CUSTOMERS_TABS } from "@/components/analysis/tabs";

export default function Loading() {
  return <AnalysisSkeleton tabs={CUSTOMERS_TABS} active="/customers" label="Customer views" title="Customers" description="What a customer is worth over time, and what it cost to acquire them" wide="stack" />;
}
