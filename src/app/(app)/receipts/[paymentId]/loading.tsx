import { ChartPanelSkeleton, ListPanelSkeleton, SkeletonPage, TablePanelSkeleton } from "@/components/page-skeleton";

// One payment: the journey behind it beside the money breakdown, then the touchpoints.
export default function Loading() {
  return (
    <SkeletonPage title="Receipt" breadcrumbs={[{ href: "/receipts", label: "Receipts" }]} label="Loading receipt…">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ChartPanelSkeleton chartClassName="sm:h-48" variant="bars" />
        <ListPanelSkeleton rows={6} />
      </div>
      <TablePanelSkeleton rows={4} />
    </SkeletonPage>
  );
}
