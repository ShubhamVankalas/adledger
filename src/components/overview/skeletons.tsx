import { cn } from "@/lib/utils";
import { WidgetCard } from "./widget-card";

// Cold-load placeholders with the real labels and blank values, the same size as the widget.
// They fade in only after 200ms, so fast widgets never flash a skeleton.

const DELAY = "animate-in fade-in fill-mode-both delay-200 duration-300";
const Bar = ({ className }: { className?: string }) => <span aria-hidden className={cn("block animate-pulse rounded bg-foreground/[0.055] [animation-duration:1.6s]", className)} />;

export function KpiSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy aria-label={`${label}, loading`} className="flex h-full flex-col px-3.5 pt-3 pb-3 md:px-4 md:pt-3.5">
      <span className="text-xs leading-4 font-medium text-muted-foreground">{label}</span>
      <div className={cn("flex flex-1 flex-col", DELAY)}>
        <Bar className="mt-2 h-6 w-24" />
        <Bar className="mt-2 h-3 w-28" />
        <Bar className="mt-auto hidden h-5 w-full md:block" />
      </div>
    </div>
  );
}

export function CardSkeleton({ title, description, variant = "list" }: { title: string; description?: string; variant?: "list" | "chart" | "text" }) {
  return (
    <div aria-busy aria-label={`${title}, loading`} className="h-full">
      <WidgetCard title={title} description={description}>
        <div className={cn("h-full", DELAY)}>
          {variant === "chart" ? (
            <div className="flex h-full flex-col gap-3">
              <Bar className="h-7 w-40" />
              <Bar className="flex-1 rounded-lg" />
            </div>
          ) : variant === "text" ? (
            <div className="flex flex-col gap-3 pt-1">
              {["w-11/12", "w-4/5", "w-5/6"].map((w) => (
                <Bar key={w} className={cn("h-4", w)} />
              ))}
              <Bar className="mt-2 h-8 w-32" />
            </div>
          ) : (
            <div className="flex flex-col">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex h-11 items-center justify-between gap-4 border-b border-border/60 last:border-0">
                  <Bar className={cn("h-3.5", i % 2 ? "w-2/5" : "w-1/2")} />
                  <Bar className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          )}
        </div>
      </WidgetCard>
    </div>
  );
}
