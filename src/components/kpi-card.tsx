import { ArrowDownRightIcon, ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  goodWhenUp = true as boolean | null,
  icon: Icon,
  hint,
  sub,
  accent,
}: {
  label: string;
  value: string;
  delta?: number | null;
  /** null = neutral (e.g. spend: up is neither good nor bad) */
  goodWhenUp?: boolean | null;
  icon: LucideIcon;
  hint?: string;
  sub?: string;
  accent?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const good = delta === null || delta === undefined ? null : goodWhenUp === null ? "neutral" : up === goodWhenUp;
  const body = (
    <Card
      className={cn(
        "@container/kpi relative h-full gap-0 overflow-hidden p-3.5 transition-shadow hover:shadow-md sm:p-4",
        accent && "bg-gradient-to-br from-primary/10 via-card to-card ring-primary/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:text-xs", hint && "underline decoration-dotted decoration-muted-foreground/50 underline-offset-4")}>
          {label}
        </span>
        {/* The icon is decoration: drop it in very narrow cards (6-up on small laptops) so the label never truncates. */}
        <span
          className={cn(
            "hidden size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            // Long labels ("Journey starters") keep the icon only when the card has room for both.
            label.length > 13 ? "@[12rem]/kpi:flex" : "@[8rem]/kpi:flex",
            accent && "bg-primary/15 text-primary",
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <div
        className={cn(
          "tabular mt-2.5 truncate font-semibold tracking-tight",
          // Container-query sizes (card content width), stepped down for long values like "$1,234,567".
          value.length >= 10 ? "text-lg @[9rem]/kpi:text-xl @[12rem]/kpi:text-2xl" : "text-xl @[8rem]/kpi:text-2xl @[13rem]/kpi:text-[1.75rem]",
        )}
        title={value}
      >
        {value}
      </div>
      {/* Delta chip and sub-metric stack in narrow cards (phones, 6-up rows) instead of truncating. */}
      <div className="mt-1.5 flex min-h-5 flex-col items-start gap-x-2 gap-y-1 text-xs @[11rem]/kpi:flex-row @[11rem]/kpi:items-center">
        {good !== null && delta !== null && delta !== undefined ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular",
              good === "neutral" ? "bg-muted text-muted-foreground" : good ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
            )}
          >
            {up ? <ArrowUpRightIcon className="size-3" /> : <ArrowDownRightIcon className="size-3" />}
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        ) : null}
        {sub ? <span className="tabular line-clamp-2 max-w-full min-w-0 break-words text-muted-foreground" title={sub}>{sub}</span> : null}
      </div>
    </Card>
  );
  if (!hint) return body;
  // A popover (not a tooltip) so the explanation also opens with a tap on phones; it still opens on hover on desktop.
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={250}
        nativeButton={false}
        render={<div className="h-full cursor-help rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />}
      >
        {body}
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-64 text-xs leading-relaxed">
        {hint}
      </PopoverContent>
    </Popover>
  );
}
