import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** An empty card frame so placeholders read as the cards that are about to appear, not grey slabs. */
function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("surface-card rounded-xl p-4", className)}>{children}</div>;
}

function CardHead() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-56 max-w-full" />
    </div>
  );
}

// Mirrors PageHeader (52px) + PageBody so the page doesn't jump when the report arrives. The
// placeholders fade in only after 200ms, so quick navigations never flash grey.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <div className="flex min-h-[52px] items-center gap-3 border-b px-4 md:px-6">
        <Skeleton className="hidden size-7 md:block" />
        <Skeleton className="h-4 w-28 reveal-delayed" />
        <div className="ml-auto flex items-center gap-1.5 reveal-delayed">
          <Skeleton className="h-9 w-40 md:h-8 xl:hidden" />
          <Skeleton className="hidden h-7 w-32 xl:block" />
          <Skeleton className="hidden h-7 w-36 xl:block" />
          <Skeleton className="hidden h-7 w-44 xl:block" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1920px] space-y-4 px-4 pt-4 reveal-delayed md:space-y-5 md:px-6 md:pt-5 2xl:px-8">
        {/* Same shape as Overview: 2-up KPIs on phones, one row of 6 on wide screens, then main + side columns from xl. */}
        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Frame key={i} className="h-[7.25rem] rounded-lg px-4 py-3.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-6 w-24 max-w-full" />
                <Skeleton className="mt-2.5 h-3 w-20 max-w-full" />
              </Frame>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4 md:space-y-5">
            <Frame className="space-y-5">
              <CardHead />
              <Skeleton className="h-44 w-full sm:h-60 2xl:h-72" />
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
          <div className="space-y-4 md:space-y-5">
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
          </div>
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
