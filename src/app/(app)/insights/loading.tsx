import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="reveal-delayed mx-auto w-full max-w-[1440px] space-y-4 px-4 pt-[4.25rem] pb-8 md:space-y-5 md:px-6 md:pt-[4.5rem]" role="status" aria-busy="true" aria-label="Loading insights…">
      <div className="flex gap-1">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-14" />
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      </div>
      <div className="grid items-start gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-3 rounded-xl bg-card p-6 shadow-(--elev-card)">
          <Skeleton className="h-6 w-56 max-w-full" />
          {["w-full", "w-11/12", "w-4/5", "w-full", "w-3/4"].map((w, i) => (
            <Skeleton key={i} className={`h-3.5 ${w}`} />
          ))}
        </div>
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <span className="sr-only">Loading insights…</span>
    </div>
  );
}
