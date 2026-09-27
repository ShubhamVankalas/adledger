import { TargetIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { longDate, moneyWhole, num, roas, shortDate } from "@/lib/format";
import type { BudgetStatus, GoalPacing, GoalsPacing, PaceStatus } from "@/lib/goal-metrics";
import { cn } from "@/lib/utils";

// Goals & pacing: month- or quarter-to-date against each workspace target. A server component
// that only formats what goalsPacing() (src/lib/reports-goals.ts) computed in SQL.

const STATUS: Record<PaceStatus, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  on_pace: { label: "On pace", tone: "good" },
  at_risk: { label: "At risk", tone: "warn" },
  behind: { label: "Behind", tone: "bad" },
  early: { label: "Too early", tone: "neutral" },
  no_data: { label: "No data yet", tone: "neutral" },
};
const BUDGET: Record<BudgetStatus, string> = { on_track: "on track", under: "under budget", over: "over budget", early: "too early to tell" };

const TONE_TAG = {
  good: "bg-success/12 text-success dark:bg-success/15",
  warn: "bg-warning/15 text-[oklch(0.5_0.12_65)] dark:text-warning",
  bad: "bg-destructive/10 text-destructive dark:bg-destructive/15",
  neutral: "bg-muted text-muted-foreground",
} as const;
const TONE_FILL = { good: "bg-success", warn: "bg-warning", bad: "bg-destructive", neutral: "bg-muted-foreground/45" } as const;

export function formatGoalValue(item: Pick<GoalPacing, "kind">, v: number | null | undefined, currency: string): string {
  if (v === null || v === undefined) return "—";
  if (item.kind === "money") return moneyWhole(v, currency);
  if (item.kind === "ratio") return roas(v);
  return num(v, Number.isInteger(v) ? 0 : 1);
}

export function StatusTag({ status, achieved, className }: { status: PaceStatus; achieved?: boolean; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap", TONE_TAG[s.tone], className)}>
      {achieved ? "Reached" : s.label}
    </span>
  );
}

function Track({ value, marker, tone, label }: { value: number; marker?: number | null; tone: keyof typeof TONE_FILL; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div role="img" aria-label={label} className="relative h-1.5 w-full rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      {marker !== null && marker !== undefined && marker > 0 && marker < 1 ? (
        <span aria-hidden className="absolute -top-1 h-3.5 w-px bg-foreground/55" style={{ left: `${marker * 100}%` }} title="Where you'd be on a straight line to the target" />
      ) : null}
    </div>
  );
}

function GoalRow({ item, currency }: { item: GoalPacing; currency: string }) {
  const f = (v: number | null | undefined) => formatGoalValue(item, v, currency);
  const tone = item.achieved ? "good" : STATUS[item.status].tone;
  const periodWord = item.period === "quarter" ? "quarter" : "month";
  const dayLine = `Day ${num(Math.max(1, Math.ceil(item.daysElapsed)))} of ${item.daysTotal}`;

  let headline: React.ReactNode;
  let detail: string;
  let barValue: number;
  let barLabel: string;
  if (item.cumulative) {
    headline = (
      <>
        <span className="font-semibold text-foreground">{f(item.actual)}</span>
        <span className="text-muted-foreground"> of {f(item.target)}</span>
      </>
    );
    barValue = item.progress ?? 0;
    barLabel = `${f(item.actual)} of ${f(item.target)} ${item.label.toLowerCase()} target, ${Math.round((item.progress ?? 0) * 100)}%`;
    detail =
      item.achieved
        ? `Target reached · ${dayLine}`
        : item.projected !== null && item.status !== "early"
          ? `Projected ${f(item.projected)} by ${shortDate(item.end)} · ${dayLine}`
          : `${dayLine} · a projection appears after day 3`;
  } else {
    headline = (
      <>
        <span className="font-semibold text-foreground">{f(item.actual)}</span>
        <span className="text-muted-foreground">
          {" "}
          · target {item.better === "down" ? "≤" : "≥"} {f(item.target)}
        </span>
      </>
    );
    // Ratios: the bar fills to the target and is capped at 2× (lower-is-better metrics fill as they fall).
    const r = item.actual === null ? 0 : item.better === "up" ? item.actual / item.target : item.actual > 0 ? item.target / item.actual : 1;
    barValue = r;
    barLabel = `${item.label} ${f(item.actual)} against a target of ${f(item.target)}`;
    detail = item.actual === null ? `Needs ad spend this ${periodWord}` : `${item.label} ${periodWord} to date · ${dayLine}`;
  }

  return (
    <li className="grid gap-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">
            {item.label}
            <span className="font-normal text-muted-foreground"> · {item.period === "quarter" ? "this quarter" : "this month"}</span>
          </p>
        </div>
        <StatusTag status={item.status} achieved={item.achieved} />
      </div>
      <p className="tabular truncate text-sm">{headline}</p>
      <Track value={barValue} marker={item.cumulative && !item.achieved ? item.daysElapsed / item.daysTotal : null} tone={tone} label={barLabel} />
      <p className="tabular text-xs text-muted-foreground">{detail}</p>
      {item.budget ? (
        <p className={cn("tabular text-xs", item.budget.status === "over" ? "text-destructive" : "text-muted-foreground")}>
          Ad budget: {moneyWhole(item.budget.spentMinor, currency)} of {moneyWhole(item.budget.budgetMinor, currency)} spent
          {item.budget.projectedMinor !== null && item.budget.status !== "early" ? ` · on course for ${moneyWhole(item.budget.projectedMinor, currency)}` : ""} ·{" "}
          {BUDGET[item.budget.status]}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The Goals & pacing card. `setupHref` shows a link to the targets settings (pass it only to people
 * who can edit them). Handles its own empty state.
 */
export function GoalsPacingWidget({
  data,
  setupHref,
  className,
  title = "Goals & pacing",
}: {
  data: GoalsPacing;
  setupHref?: string | null;
  className?: string;
  title?: string;
}) {
  const periods = new Set(data.items.map((i) => i.period));
  const range =
    periods.size > 1
      ? "Month and quarter to date"
      : data.items[0]
        ? `${data.items[0].period === "quarter" ? "Quarter" : "Month"} to date · since ${longDate(data.items[0].start)}`
        : null;
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader className="grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription className="tabular">
            {range ?? "Progress against your monthly or quarterly targets"}
          </CardDescription>
        </div>
        {setupHref && data.items.length ? (
          <Button variant="ghost" size="sm" render={<Link href={setupHref} />}>
            Edit targets
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {data.items.length ? (
          <ul className="grid">
            {data.items.map((item) => (
              <GoalRow key={item.id} item={item} currency={data.currency} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <TargetIcon aria-hidden className="size-4" />
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-medium">No targets yet</p>
              <p className="text-sm text-pretty text-muted-foreground">Set a monthly revenue, lead or ROAS target to see whether you’re on pace, and where the month will land.</p>
            </div>
            {setupHref ? (
              <Button size="sm" variant="outline" render={<Link href={setupHref} />}>
                Set targets
              </Button>
            ) : null}
          </div>
        )}
        {data.skipped.length ? (
          <p className="mt-3 text-xs text-pretty text-muted-foreground">
            {data.skipped.length === 1 ? "1 target is" : `${data.skipped.length} targets are`} hidden: {data.skipped[0].reason}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
