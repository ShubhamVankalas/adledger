import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder shaped like the report pages: header controls, optional KPI row, then a table. */
export function ReportSkeleton({
  kpis = false,
  rows = 8,
}: {
  kpis?: boolean;
  rows?: number;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading report…</span>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <Skeleton className="size-7 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="hidden h-3 w-72 md:block" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36 rounded-lg md:h-8" />
          <Skeleton className="h-9 w-32 rounded-lg md:h-8" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1920px] space-y-6 p-4 md:p-6 2xl:px-8">
        {kpis ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[7.5rem] rounded-xl bg-card p-3.5 ring-1 ring-foreground/10 sm:p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="size-7 rounded-lg" />
                </div>
                <Skeleton className="mt-3 h-6 w-24 max-w-full" />
                <Skeleton className="mt-2.5 h-3 w-28 max-w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 md:flex-row md:justify-between">
            <Skeleton className="h-10 w-full rounded-lg md:h-9 md:w-80" />
            <Skeleton className="h-10 w-full rounded-lg md:h-9 md:w-72" />
          </div>
        )}
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex h-10 items-center gap-4 bg-muted/50 px-3">
            <Skeleton className="h-3 w-24" />
            <span className="flex-1" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="hidden h-3 w-14 sm:block" />
            <Skeleton className="h-3 w-10" />
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-t px-3 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="hidden h-4 w-16 sm:block" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
