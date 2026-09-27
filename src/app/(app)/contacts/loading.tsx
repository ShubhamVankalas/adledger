import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1760px] space-y-6 p-4 md:p-6 2xl:px-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading contacts…">
      <Skeleton className="h-7 w-40" />
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Skeleton className="h-10 w-full rounded-lg sm:h-9 sm:max-w-sm" />
        <Skeleton className="h-11 w-full rounded-lg sm:h-8 sm:w-60" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3 md:px-4">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading contacts…</span>
    </div>
  );
}
