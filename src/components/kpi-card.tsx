import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { pct } from "@/lib/format";
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
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  // Under 0.05% rounds to "0.0%": show it flat and neutral rather than as a tiny win or loss.
  const flat = hasDelta && Math.abs(delta) < 0.0005;
  const up = (delta ?? 0) > 0;
  const tone: "good" | "bad" | "neutral" | null = !hasDelta ? null : flat || goodWhenUp === null ? "neutral" : up === goodWhenUp ? "good" : "bad";
  const DeltaIcon = flat ? ArrowRightIcon : up ? ArrowUpRightIcon : ArrowDownRightIcon;
  const deltaText = hasDelta ? (Math.abs(delta) >= 10 ? ">999%" : pct(Math.abs(delta))) : "";
  const deltaLabel = hasDelta
    ? `${flat ? "Unchanged" : `${up ? "Up" : "Down"} ${deltaText}`} vs previous period${tone === "good" ? " (good)" : tone === "bad" ? " (worse)" : ""}`
    : undefined;
  const body = (
    <Card
      glow="lift"
      className={cn(
        "@container/kpi relative h-full gap-0 overflow-hidden p-3.5 transition-[box-shadow,background-color] sm:p-4",
        hint && "hover:ring-foreground/20",
        accent && "bg-gradient-to-br from-brand/8 via-card to-card ring-brand/35 dark:from-brand/12 dark:ring-brand/40",
      )}
    >
      {accent ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand-gradient" /> : null}
      <div className="flex items-center justify-between gap-2">
        <span className={cn("label-caps min-w-0 truncate", hint && "underline decoration-dotted decoration-muted-foreground/50 underline-offset-4")}>
          {label}
        </span>
        {/* The icon is decoration: drop it in very narrow cards (6-up on small laptops) so the label never truncates. */}
        <span
          className={cn(
            "hidden size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/5",
            // Long labels ("Journey starters") keep the icon only when the card has room for both.
            label.length > 12 ? "@[12rem]/kpi:flex" : "@[8rem]/kpi:flex",
            accent && "bg-brand-soft text-brand-foreground ring-brand/20",
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <div
        className={cn(
          "tabular mt-2 truncate leading-tight font-semibold tracking-tight",
          // Container-query sizes (card content width), stepped down for long values like "$1,234,567".
          value.length >= 10 ? "text-lg @[9rem]/kpi:text-xl @[12rem]/kpi:text-2xl" : "text-xl @[8rem]/kpi:text-2xl @[13rem]/kpi:text-[1.75rem]",
        )}
        title={value}
      >
        <CountUp value={value} />
      </div>
      {/* Delta chip and sub-metric stack in narrow cards (phones, 6-up rows) instead of truncating. */}
      <div className="mt-1.5 flex min-h-5 flex-col items-start gap-x-2 gap-y-1 text-xs @[11rem]/kpi:flex-row @[11rem]/kpi:items-center">
        {tone ? (
          <span
            title={deltaLabel}
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1.5 font-medium tabular",
              tone === "neutral" && "bg-muted text-muted-foreground ring-1 ring-foreground/5",
              tone === "good" && "bg-success/12 text-success dark:bg-success/15",
              tone === "bad" && "bg-destructive/10 text-destructive dark:bg-destructive/15",
            )}
          >
            <DeltaIcon aria-hidden className="size-3" />
            <span className="sr-only">{deltaLabel}</span>
            <span aria-hidden>{deltaText}</span>
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
