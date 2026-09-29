import { PageBody, PageHeader } from "@/components/page-header";
import { Skeleton, SkeletonCard, SkeletonChart, SkeletonHead, SkeletonKpi, SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Building blocks for the loading.tsx files under src/app/(app)/. A loading state is a wireframe of
// the page it stands in for: the real header (title and description are known before the data
// arrives), then blocks in the page's own geometry. Everything inside fades in after 200ms
// (`reveal-delayed`), so quick navigations never flash grey, and the real page then arrives with
// PageBody's soft blur/fade.

/** The report filter bar (period, model, platform) as it sits in the header: one button below xl, three from xl. */
export function FilterControlsSkeleton({ count = 3 }: { count?: 1 | 2 | 3 }) {
  return (
    <div aria-hidden className="reveal-delayed flex items-center gap-1.5">
      <Skeleton className="h-9 w-40 md:h-8 xl:hidden" />
      <Skeleton className="hidden h-7 w-32 xl:block" />
      {count > 1 ? <Skeleton className="hidden h-7 w-36 xl:block" /> : null}
      {count > 2 ? <Skeleton className="hidden h-7 w-44 xl:block" /> : null}
    </div>
  );
}

/**
 * The frame of a loading page: the real PageHeader, then a status region holding `children`.
 * Screen readers hear one "Loading …" announcement; the wireframe itself is aria-hidden.
 */
export function SkeletonPage({
  title,
  description,
  breadcrumbs,
  controls,
  label,
  children,
  className,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { href: string; label: string }[];
  /** Header controls: `filters` (report filter bar), `none`, or a custom node. */
  controls?: "filters" | "none" | React.ReactNode;
  /** Announcement, e.g. "Loading contacts…". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" aria-label={label}>
      <PageHeader title={title} description={description} breadcrumbs={breadcrumbs}>
        {controls === "filters" ? <FilterControlsSkeleton /> : controls === "none" || controls === undefined ? null : controls}
      </PageHeader>
      <PageBody instant>
        <div aria-hidden className={cn("reveal-delayed space-y-4 md:space-y-5", className)}>
          {children}
        </div>
      </PageBody>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** A row of KPI tiles. 4-up from lg (report pages) or 6-up from @4xl (Overview). */
export function KpiRowSkeleton({ count = 4, className }: { count?: 4 | 6; className?: string }) {
  return (
    <div className="@container">
      <div className={cn("grid grid-cols-2 gap-3", count === 6 ? "@2xl:grid-cols-3 @4xl:grid-cols-6" : "lg:grid-cols-4", className)}>
        {Array.from({ length: count }, (_, i) => (
          <SkeletonKpi key={i} className={count === 6 ? "h-24 md:h-[124px]" : "h-24 md:h-[7.5rem]"} spark={count === 6} />
        ))}
      </div>
    </div>
  );
}

/** A card holding a table: optional title block, a column-header strip, then `rows` rows. */
export function TablePanelSkeleton({
  rows = 8,
  cols,
  lead,
  head = true,
  className,
}: {
  rows?: number;
  cols?: string[];
  lead?: boolean;
  /** A title + description block above the table. */
  head?: boolean;
  className?: string;
}) {
  return (
    <SkeletonCard className={cn("overflow-hidden p-0", className)}>
      {head ? <SkeletonHead className="px-4 pt-4 pb-3" /> : null}
      <div className={cn("flex h-9 items-center gap-4 bg-bg-subtle px-3", head && "border-t")}>
        <Skeleton className="h-3 w-24" />
        <span className="flex-1" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="hidden h-3 w-14 sm:block" />
        <Skeleton className="h-3 w-10" />
      </div>
      <SkeletonRows rows={rows} cols={cols} lead={lead} />
    </SkeletonCard>
  );
}

/** A card holding a chart: title block, then the chart wireframe. */
export function ChartPanelSkeleton({ className, chartClassName, variant }: { className?: string; chartClassName?: string; variant?: "area" | "bars" }) {
  return (
    <SkeletonCard className={cn("space-y-5", className)}>
      <SkeletonHead />
      <SkeletonChart className={chartClassName} variant={variant} />
    </SkeletonCard>
  );
}

/** A card holding a short list: title block, then icon + label + value rows. */
export function ListPanelSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <SkeletonCard className={cn("space-y-4", className)}>
      <SkeletonHead />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className={cn("h-4 flex-1", i % 2 ? "max-w-[55%]" : "max-w-[70%]")} />
          <span className="flex-1" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </SkeletonCard>
  );
}
