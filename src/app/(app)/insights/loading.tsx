import { SkeletonPage } from "@/components/page-skeleton";
import { Skeleton, SkeletonCard, SkeletonHead, SkeletonText } from "@/components/ui/skeleton";

// Insights: the tab row, two recommendation cards, then the weekly report beside its history.
export default function Loading() {
  return (
    <SkeletonPage title="Insights" description="What changed, what to do about it, and answers to your questions" label="Loading insights…" className="space-y-6 md:space-y-6">
      <div className="flex gap-1">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-14" />
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <SkeletonCard key={i} className="h-44 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-6 rounded-md" />
                <Skeleton className="h-4 w-40" />
              </div>
              <SkeletonText lines={3} />
              <Skeleton className="h-7 w-28" />
            </SkeletonCard>
          ))}
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <SkeletonCard className="space-y-4 p-6">
          <Skeleton className="h-6 w-56 max-w-full" />
          <SkeletonText lines={5} lineClassName="h-3.5" />
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={4} lineClassName="h-3.5" />
        </SkeletonCard>
        <SkeletonCard className="space-y-3">
          <SkeletonHead />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </SkeletonCard>
      </div>
    </SkeletonPage>
  );
}
