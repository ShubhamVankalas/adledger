import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** An empty card frame so placeholders read as the cards that are about to appear, not grey slabs. */
function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl bg-card p-4 shadow-[0_1px_2px_0_oklch(0.2_0.02_250/0.05)] ring-1 ring-foreground/10", className)}>{children}</div>;
}

function CardHead() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-56 max-w-full" />
    </div>
  );
}

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
              <Frame key={i} className="h-[7.25rem] p-3.5 sm:p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="size-7 rounded-lg" />
                </div>
                <Skeleton className="mt-3 h-6 w-24 max-w-full" />
                <Skeleton className="mt-2.5 h-3 w-20 max-w-full" />
              </Frame>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4 md:space-y-6">
            <Frame className="space-y-5">
              <CardHead />
              {/* Bars of a chart, fading in height so it reads as a chart placeholder. */}
              <div className="flex h-44 items-end gap-1.5 sm:h-60 2xl:h-72">
                {Array.from({ length: 24 }).map((_, i) => (
                  <Skeleton key={i} className={cn("flex-1 rounded-sm", i % 3 === 0 && "max-sm:hidden")} style={{ height: `${35 + ((i * 37) % 55)}%` }} />
                ))}
              </div>
            </Frame>
            <Frame className="hidden space-y-4 xl:block">
              <CardHead />
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-t pt-3.5">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </Frame>
          </div>
          <div className="space-y-4 md:space-y-6">
            <Frame className="space-y-4">
              <CardHead />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </Frame>
            <Frame className="hidden space-y-4 xl:block">
              <CardHead />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </Frame>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
