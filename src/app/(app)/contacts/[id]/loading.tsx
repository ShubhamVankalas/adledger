import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1760px] p-4 md:p-6 2xl:px-8" aria-busy="true" aria-label="Loading contact">
      <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-4 p-4 sm:p-6">
            <Skeleton className="size-12 shrink-0 rounded-full sm:size-14" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2 bg-card px-4 py-3 sm:px-6 sm:py-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <div className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-2/3" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4 md:space-y-6">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
