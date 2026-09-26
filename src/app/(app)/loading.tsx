import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the PageHeader + PageBody layout so the page doesn't jump when the report arrives.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <div className="flex min-h-14 items-center gap-3 border-b px-4 py-2.5 md:min-h-16 md:px-6 md:py-3 2xl:px-8">
        <Skeleton className="hidden size-7 md:block" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-5 w-32 md:h-6 md:w-40" />
          <Skeleton className="hidden h-3.5 w-56 md:block" />
        </div>
        <Skeleton className="h-10 w-36 rounded-full md:hidden" />
        <div className="hidden items-center gap-2 md:flex">
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="hidden h-8 w-56 rounded-lg lg:block" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1760px] space-y-4 p-4 sm:space-y-6 md:p-6 2xl:px-8">
        {/* Same shape as Overview: 2-up KPIs on phones, one row of 6 on wide screens, then main + side columns from xl. */}
        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[7.25rem] rounded-xl" />
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4 md:space-y-6">
            <Skeleton className="h-72 rounded-xl md:h-96" />
            <Skeleton className="hidden h-80 rounded-xl xl:block" />
          </div>
          <div className="space-y-4 md:space-y-6">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="hidden h-64 rounded-xl xl:block" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
