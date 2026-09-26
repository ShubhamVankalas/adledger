import { ArrowDownRightIcon, ArrowUpRightIcon, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
        "relative gap-0 overflow-hidden p-4 transition-shadow hover:shadow-md",
        accent && "border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className={cn("flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground", accent && "bg-primary/15 text-primary")}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="tabular mt-3 truncate text-2xl font-semibold tracking-tight" title={value}>{value}</div>
      <div className="mt-1.5 flex min-h-5 items-center gap-2 text-xs">
        {good !== null && delta !== null && delta !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular",
              good === "neutral" ? "bg-muted text-muted-foreground" : good ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
            )}
          >
            {up ? <ArrowUpRightIcon className="size-3" /> : <ArrowDownRightIcon className="size-3" />}
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        ) : null}
        {sub ? <span className="truncate text-muted-foreground">{sub}</span> : null}
      </div>
    </Card>
  );
  if (!hint) return body;
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{body}</TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  );
}
