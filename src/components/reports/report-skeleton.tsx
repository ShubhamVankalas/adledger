import { FilterControlsSkeleton, KpiRowSkeleton, SkeletonPage, TablePanelSkeleton } from "@/components/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading wireframe for the report pages: the real header, then either a row of KPI tiles or a
 * search + filter toolbar, then a table with a header strip and rows of varying width.
 */
export function ReportSkeleton({
  title,
  description,
  kpis = false,
  rows = 8,
  label = "Loading report…",
}: {
  title: string;
  description?: string;
  kpis?: boolean;
  rows?: number;
  label?: string;
}) {
  return (
    <SkeletonPage title={title} description={description} controls={<FilterControlsSkeleton />} label={label}>
      {kpis ? (
        <KpiRowSkeleton />
      ) : (
        <div className="flex flex-col gap-2 md:flex-row md:justify-between">
          <Skeleton className="h-10 w-full rounded-lg md:h-9 md:w-80" />
          <Skeleton className="h-10 w-full rounded-lg md:h-9 md:w-72" />
        </div>
      )}
      <TablePanelSkeleton rows={rows} head={false} />
    </SkeletonPage>
  );
}
