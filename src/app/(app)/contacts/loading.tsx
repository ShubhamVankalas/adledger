import { SkeletonPage, TablePanelSkeleton } from "@/components/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Cold load only: the real header, the view tabs, the toolbar and a contacts table with avatars.
export default function Loading() {
  return (
    <SkeletonPage title="Contacts" description="Every lead and customer, with the ad that brought them in" label="Loading contacts…" className="space-y-3 md:space-y-3">
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
      <TablePanelSkeleton rows={12} head={false} lead cols={["w-16", "hidden w-32 md:block", "hidden w-20 md:block"]} />
    </SkeletonPage>
  );
}
