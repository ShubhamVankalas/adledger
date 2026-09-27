import { PageBody, PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Contact" breadcrumbs={[{ href: "/contacts", label: "Contacts" }]} />
      <PageBody>
        <div className="reveal-delayed space-y-6" role="status" aria-busy="true" aria-label="Loading contact…">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-3.5 w-72 max-w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2 bg-card px-3.5 py-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-8">
            <div className="space-y-3">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
            <div className="space-y-4">
              <Skeleton className="h-7 w-64" />
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <span className="sr-only">Loading contact…</span>
        </div>
      </PageBody>
    </>
  );
}
