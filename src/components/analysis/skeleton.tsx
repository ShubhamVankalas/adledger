import { PageBody, PageHeader } from "@/components/page-header";
import { ChartPanelSkeleton, FilterControlsSkeleton, KpiRowSkeleton, ListPanelSkeleton, TablePanelSkeleton } from "@/components/page-skeleton";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { SectionTabsStatic, type SectionTab } from "./tabs";

/**
 * Cold-load wireframe for the analysis pages, matching their layout: header, tab row (real labels),
 * the answer line, four KPI tiles, then either a table beside a side panel (`list`), one full-width
 * chart (`grid`) or two tables (`stack`). The content fades in after 200ms.
 */
export function AnalysisSkeleton({
  tabs,
  active,
  label,
  title,
  description,
  wide = "list",
}: {
  tabs: SectionTab[];
  active: string;
  label: string;
  title: string;
  description?: string;
  wide?: "list" | "grid" | "stack";
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" aria-label="Loading">
      <PageHeader title={title} description={description}>
        <FilterControlsSkeleton count={2} />
      </PageHeader>
      <PageBody instant>
        <SectionTabsStatic tabs={tabs} active={active} label={label} />
        <div aria-hidden className="reveal-delayed space-y-4 md:space-y-5">
          <SkeletonCard className="flex h-[46px] items-center gap-2.5 py-0">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </SkeletonCard>
          <KpiRowSkeleton />
          {wide === "grid" ? (
            <ChartPanelSkeleton chartClassName="sm:h-72" />
          ) : wide === "stack" ? (
            <div className="grid items-start gap-4 min-[1700px]:grid-cols-2">
              <TablePanelSkeleton rows={6} cols={["w-16", "hidden w-14 sm:block", "w-12"]} />
              <TablePanelSkeleton rows={6} cols={["w-16", "hidden w-14 sm:block", "w-12"]} className="hidden sm:block" />
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-12">
              <TablePanelSkeleton rows={7} cols={["w-16", "hidden w-14 sm:block", "w-10"]} className="lg:col-span-8" />
              <ListPanelSkeleton rows={5} className="lg:col-span-4" />
            </div>
          )}
        </div>
      </PageBody>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
