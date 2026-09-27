import { PageBody, PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

// Cold load only: matches the real layout (view tabs, toolbar, table rows) and waits 200ms before it shows.
export default function Loading() {
  return (
    <>
      <PageHeader title="Contacts" />
      <PageBody>
        <div className="reveal-delayed space-y-3" role="status" aria-busy="true" aria-label="Loading contacts…">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-1.5">
              {[64, 96, 104, 92].map((w, i) => (
                <Skeleton key={i} className="h-7 rounded-md" style={{ width: w }} />
              ))}
            </div>
            <div className="flex gap-1.5">
              <Skeleton className="h-8 w-full rounded-md md:w-56" />
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
          <div className="overflow-hidden rounded-xl bg-card shadow-sm">
            <div className="h-9 border-b bg-bg-subtle" />
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex h-9 items-center gap-3 border-b px-3 last:border-0">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="ml-auto h-3 w-16" />
                <Skeleton className="hidden h-3 w-32 md:block" />
                <Skeleton className="hidden h-3 w-20 md:block" />
              </div>
            ))}
          </div>
          <span className="sr-only">Loading contacts…</span>
        </div>
      </PageBody>
    </>
  );
}
