import { Skeleton, SkeletonChart, SkeletonSpark } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WidgetCard } from "./widget-card";

// Cold-load placeholders with the real labels and blank values, the same size as the widget. They
// fade in only after 200ms, so fast widgets never flash a skeleton, and the real body then arrives
// with a soft blur/fade (WidgetCard / KpiWidget `arrive`).

export function KpiSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy aria-label={`${label}, loading`} className="flex h-full flex-col px-3.5 pt-3 pb-3 md:px-4 md:pt-3.5">
      <span className="text-xs leading-4 font-medium text-muted-foreground">{label}</span>
      <div className="reveal-delayed flex flex-1 flex-col">
        <Skeleton className="mt-2 h-6 w-24" />
        <Skeleton className="mt-2 h-3 w-28" />
        <SkeletonSpark className="mt-auto hidden md:block" />
      </div>
    </div>
  );
}

export function CardSkeleton({ title, description, variant = "list" }: { title: string; description?: string; variant?: "list" | "chart" | "text" }) {
  return (
    <div aria-busy aria-label={`${title}, loading`} className="h-full">
      <WidgetCard title={title} description={description} arrive={false}>
        <div className="reveal-delayed h-full">
          {variant === "chart" ? (
            <div className="flex h-full flex-col gap-3">
              <div className="flex gap-2">
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-7 w-16" />
              </div>
              <SkeletonChart className="h-auto min-h-0 flex-1 sm:h-auto" />
            </div>
          ) : variant === "text" ? (
            <div className="flex flex-col gap-3 pt-1">
              {["w-11/12", "w-4/5", "w-5/6", "w-2/3"].map((w) => (
                <Skeleton key={w} className={cn("h-4", w)} />
              ))}
              <Skeleton className="mt-2 h-8 w-32" />
            </div>
          ) : (
            <div className="flex flex-col">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex h-11 items-center justify-between gap-4 border-b border-border/60 last:border-0">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Skeleton className="size-5 shrink-0 rounded-full" />
                    <Skeleton className={cn("h-3.5", i % 2 ? "w-2/5" : "w-1/2")} />
                  </div>
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          )}
        </div>
      </WidgetCard>
    </div>
  );
}
