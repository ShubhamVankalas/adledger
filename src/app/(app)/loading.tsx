import { ChartPanelSkeleton, KpiRowSkeleton, ListPanelSkeleton, SkeletonPage, TablePanelSkeleton } from "@/components/page-skeleton";

// Overview wireframe (also the fallback for pages without their own): the header, one row of 6 KPI
// tiles (2-up on phones), then the main column (chart, table) beside a side list from xl. Same
// geometry as the real board, so nothing jumps when it arrives.
export default function Loading() {
  return (
    <SkeletonPage title="Overview" description="Which ads actually made you money" controls="filters" label="Loading…">
      <KpiRowSkeleton count={6} />
      <div className="grid gap-4 md:gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4 md:space-y-5">
          <ChartPanelSkeleton />
          <TablePanelSkeleton rows={5} className="hidden xl:block" cols={["w-16", "w-16", "w-12"]} />
        </div>
        <div className="space-y-4 md:space-y-5">
          <ListPanelSkeleton rows={5} />
        </div>
      </div>
    </SkeletonPage>
  );
}
