import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1760px] p-4 md:p-6 2xl:px-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading insights…">
      <div className="mx-auto grid max-w-6xl items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="space-y-2.5 border-b px-5 py-5 sm:px-8 sm:py-6">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-56 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="max-w-[70ch] space-y-2.5 px-5 py-6 sm:px-8 sm:py-8">
            <Skeleton className="mb-4 h-5 w-32" />
            {["w-full", "w-11/12", "w-4/5", "w-full", "w-3/4", "w-5/6", "w-2/3"].map((w, i) => (
              <Skeleton key={i} className={`h-3.5 ${w}`} />
            ))}
          </div>
        </div>
        <div className="space-y-4 md:space-y-6">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
      <span className="sr-only">Loading insights…</span>
    </div>
  );
}
