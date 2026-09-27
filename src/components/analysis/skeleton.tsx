import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SectionTabsStatic, type SectionTab } from "./tabs";

function Frame({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("surface-card rounded-xl p-4", className)}>{children}</div>;
}

function PanelHead() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-64 max-w-full" />
    </div>
  );
}

/**
 * Cold-load placeholder for the analysis pages, matching their layout: header, tab row (real
 * labels), the answer line, four KPI tiles, then either a list beside a side panel or one full-width
 * panel. Fades in after 200ms.
 */
export function AnalysisSkeleton({ tabs, active, label, wide = "list" }: { tabs: SectionTab[]; active: string; label: string; wide?: "list" | "grid" }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <div className="flex min-h-[52px] items-center gap-3 border-b px-4 md:px-6">
        <Skeleton className="hidden size-7 md:block" />
        <Skeleton className="h-4 w-28 reveal-delayed" />
        <div className="ml-auto flex items-center gap-1.5 reveal-delayed">
          <Skeleton className="h-9 w-40 md:h-8 xl:hidden" />
          <Skeleton className="hidden h-7 w-32 xl:block" />
          <Skeleton className="hidden h-7 w-36 xl:block" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 pt-4 md:space-y-5 md:px-6 md:pt-5">
        <SectionTabsStatic tabs={tabs} active={active} label={label} />
        <div className="space-y-4 reveal-delayed md:space-y-5">
          <Frame className="flex h-[46px] items-center gap-2.5 py-0">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </Frame>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Frame key={i} className="h-[7.5rem]">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-4 h-6 w-24 max-w-full" />
                <Skeleton className="mt-3 h-3 w-28 max-w-full" />
              </Frame>
            ))}
          </div>
          {wide === "grid" ? (
            <Frame className="space-y-4">
              <PanelHead />
              <Skeleton className="h-72 w-full" />
            </Frame>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-12">
              <Frame className="space-y-4 lg:col-span-8">
                <PanelHead />
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="flex items-center gap-4 border-t pt-3.5">
                    <Skeleton className="h-5 w-40" />
                    <span className="flex-1" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="hidden h-4 w-14 sm:block" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                ))}
              </Frame>
              <Frame className="space-y-4 lg:col-span-4">
                <PanelHead />
                <Skeleton className="h-48 w-full" />
              </Frame>
            </div>
          )}
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
