import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1760px] p-4 md:p-6 2xl:px-8" aria-busy="true" aria-label="Loading insights">
      <div className="mx-auto grid max-w-3xl items-start gap-4 md:gap-6 xl:max-w-none xl:grid-cols-[minmax(0,48rem)_18rem] xl:justify-center">
        <Skeleton className="h-24 rounded-xl xl:col-start-2 xl:row-start-1" />
        <div className="space-y-4 rounded-xl border bg-card p-4 xl:col-start-1 xl:row-start-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-64 max-w-full" />
          <div className="max-w-[72ch] space-y-2 pt-2">
            {["w-full", "w-11/12", "w-4/5", "w-full", "w-3/4", "w-5/6", "w-2/3"].map((w, i) => (
              <Skeleton key={i} className={`h-3.5 ${w}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
