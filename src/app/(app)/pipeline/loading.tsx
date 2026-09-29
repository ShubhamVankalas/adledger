import { SkeletonPage } from "@/components/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

const CARDS = [5, 4, 3, 2, 3];

/** Cold load only: real labels, blank numbers and the board's exact geometry. */
export default function Loading() {
  return (
    <SkeletonPage title="Pipeline" description="Every lead from first click to paid" label="Loading the pipeline…">
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 sm:flex sm:gap-x-8">
        {["Open", "Weighted value", "Won", "Won revenue", "Rotting"].map((l) => (
          <div key={l}>
            <dt className="text-caption text-muted-foreground">{l}</dt>
            <dd className="py-1">
              <Skeleton className="h-4 w-14" />
            </dd>
          </div>
        ))}
      </dl>
      <div className="-mx-4 flex gap-3 overflow-hidden px-4 md:-mx-6 md:px-6">
        {CARDS.map((n, i) => (
          <div key={i} className="flex w-[17.5rem] shrink-0 flex-col gap-1.5 rounded-xl bg-bg-subtle p-2 max-md:w-full max-md:[&:not(:first-child)]:hidden">
            <div className="flex h-12 flex-col justify-center gap-1.5 px-1">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            {Array.from({ length: n }).map((_, j) => (
              <div key={j} className="flex gap-2.5 rounded-lg bg-surface p-2.5 shadow-sm">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
