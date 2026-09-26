import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1760px] p-4 md:p-6 2xl:px-8" aria-busy="true" aria-label="Loading contact">
      <div className="mx-auto grid max-w-6xl items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <Skeleton className="h-44 rounded-xl lg:col-start-2 lg:row-start-1" />
        <div className="space-y-5 rounded-xl border bg-card p-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-2/3" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-56 rounded-xl lg:col-start-2 lg:row-start-2" />
      </div>
    </div>
  );
}
