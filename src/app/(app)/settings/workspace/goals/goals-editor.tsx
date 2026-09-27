"use client";

import { AlertTriangleIcon, Loader2Icon, PencilIcon, PlusIcon, TargetIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { deleteGoalAction, saveGoalAction } from "@/app/actions/goals";
import { ActionButton, useFormAction } from "@/components/action-button";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GoalMetric, GoalPeriod } from "@/lib/db/schema";
import { GOAL_METRIC_KEYS, GOAL_METRICS, GOAL_PERIODS } from "@/lib/goal-metrics";
import { cn } from "@/lib/utils";

export type GoalRowData = {
  id: string;
  metric: GoalMetric;
  period: GoalPeriod;
  /** Plain value for the edit form ("50000", "3.5"). */
  target: string;
  targetLabel: string;
  budget: string;
  budgetLabel: string | null;
  /** Set in a currency the workspace no longer reports in. */
  stale: boolean;
};

function currencySymbol(currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

function Adorned({ prefix, suffix, children }: { prefix?: string; suffix?: string; children: React.ReactElement }) {
  return (
    <div className="relative">
      {prefix ? <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span> : null}
      {children}
      {suffix ? <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function GoalDialog({
  open,
  onOpenChange,
  editing,
  available,
  currency,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: GoalRowData | null;
  available: GoalMetric[];
  currency: string;
}) {
  const uid = useId();
  const [metric, setMetric] = useState<GoalMetric>(editing?.metric ?? available[0] ?? "revenue");
  const [period, setPeriod] = useState<GoalPeriod>(editing?.period ?? "month");
  const save = useFormAction(saveGoalAction, (r) => r.ok && onOpenChange(false));
  const def = GOAL_METRICS[metric];
  const symbol = currencySymbol(currency);
  const periodWord = period === "quarter" ? "Quarterly" : "Monthly";
  const targetLabel = def.cumulative ? `${periodWord} ${def.noun} target` : def.better === "down" ? `Highest ${def.noun} you’ll accept` : `Lowest ${def.noun} you’ll accept`;
  const example = def.kind === "money" ? (def.cumulative ? "50,000" : "45") : def.kind === "ratio" ? "3.5" : "120";
  const options = editing ? [editing.metric] : available;

  return (
    <Dialog open={open} onOpenChange={(o) => !save.pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${GOAL_METRICS[editing.metric].label} target` : "Add a target"}</DialogTitle>
          <DialogDescription className="text-pretty">Amounts are in {currency}, the workspace reporting currency.</DialogDescription>
        </DialogHeader>
        <form action={save.submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-metric`}>Metric</Label>
            {editing ? <input type="hidden" name="metric" value={editing.metric} /> : null}
            <NativeSelect
              id={`${uid}-metric`}
              name={editing ? undefined : "metric"}
              value={metric}
              disabled={Boolean(editing)}
              onChange={(e) => setMetric(e.target.value as GoalMetric)}
              aria-describedby={`${uid}-metric-help`}
            >
              {options.map((m) => (
                <option key={m} value={m}>
                  {GOAL_METRICS[m].label}
                </option>
              ))}
            </NativeSelect>
            <p id={`${uid}-metric-help`} className="text-xs text-pretty text-muted-foreground">
              {def.help}
            </p>
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm leading-none font-medium">Period</legend>
            <div className="inline-flex w-fit rounded-lg bg-muted p-0.5">
              {GOAL_PERIODS.map((p) => (
                <label
                  key={p.value}
                  className={cn(
                    "relative cursor-pointer rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-[background-color,color,box-shadow] has-focus-visible:ring-3 has-focus-visible:ring-ring/50 max-md:py-2",
                    period === p.value && "bg-surface text-foreground shadow-sm",
                  )}
                >
                  <input type="radio" name="period" value={p.value} checked={period === p.value} onChange={() => setPeriod(p.value)} className="sr-only" />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-target`}>{targetLabel}</Label>
            <Adorned prefix={def.kind === "money" ? symbol : undefined} suffix={def.kind === "ratio" ? "×" : def.kind === "count" ? "people" : undefined}>
              <Input
                id={`${uid}-target`}
                name="target"
                inputMode="decimal"
                autoComplete="off"
                required
                defaultValue={editing?.target}
                placeholder={`${example}…`}
                className={cn("tabular-nums", def.kind === "money" && "pl-8", def.kind === "count" && "pr-16", def.kind === "ratio" && "pr-8")}
              />
            </Adorned>
            {!def.cumulative ? (
              <p className="text-xs text-muted-foreground">Checked against the {period === "quarter" ? "quarter" : "month"} to date, and used for the stoplights on performance tables.</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-budget`}>
              Ad budget <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Adorned prefix={symbol}>
              <Input id={`${uid}-budget`} name="budget" inputMode="decimal" autoComplete="off" defaultValue={editing?.budget} placeholder="15,000…" className="pl-8 tabular-nums" aria-describedby={`${uid}-budget-help`} />
            </Adorned>
            <p id={`${uid}-budget-help`} className="text-xs text-pretty text-muted-foreground">
              What you plan to spend on ads in the same {period === "quarter" ? "quarter" : "month"}. You’ll see when spend is on course to go over.
            </p>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="h-10 sm:h-8" disabled={save.pending} />}>Cancel</DialogClose>
            <Button type="submit" className="h-10 sm:h-8" disabled={save.pending}>
              {save.pending ? <Loader2Icon className="animate-spin" /> : null}
              {save.pending ? "Saving…" : "Save target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GoalsEditor({ goals, currency, canEdit }: { goals: GoalRowData[]; currency: string; canEdit: boolean }) {
  const [dialog, setDialog] = useState<{ key: number; editing: GoalRowData | null } | null>(null);
  const used = new Set(goals.map((g) => g.metric));
  const available = GOAL_METRIC_KEYS.filter((m) => !used.has(m));
  const openNew = () => setDialog({ key: Date.now(), editing: null });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Targets</CardTitle>
        <CardDescription>One target per metric. Cumulative goals (revenue, leads, customers) are projected to the end of the period.</CardDescription>
        {canEdit && goals.length > 0 && available.length > 0 ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={openNew}>
              <PlusIcon /> Add target
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {goals.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <TargetIcon aria-hidden className="size-4" />
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-medium">No targets yet</p>
              <p className="text-sm text-pretty text-muted-foreground">Most teams start with a monthly revenue target and a ROAS they won’t go below.</p>
            </div>
            {canEdit ? (
              <Button size="sm" onClick={openNew}>
                <PlusIcon /> Add your first target
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="grid">
            {goals.map((g) => {
              const def = GOAL_METRICS[g.metric];
              return (
                <li key={g.id} className="flex min-w-0 items-center gap-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13px] font-medium">
                      <span className="truncate">{def.label}</span>
                      <Badge variant="secondary">{g.period === "quarter" ? "Quarterly" : "Monthly"}</Badge>
                    </p>
                    <p className="tabular mt-0.5 truncate text-sm">
                      <span className="text-muted-foreground">{def.cumulative ? "Target " : def.better === "down" ? "At most " : "At least "}</span>
                      <span className="font-medium">{g.targetLabel}</span>
                      {g.budgetLabel ? <span className="text-muted-foreground"> · budget {g.budgetLabel}</span> : null}
                    </p>
                    {g.stale ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-negative">
                        <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" /> Set in another currency. Edit it to use {currency}.
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon-sm" className="max-md:size-10" aria-label={`Edit ${def.label} target`} onClick={() => setDialog({ key: Date.now(), editing: g })}>
                        <PencilIcon />
                      </Button>
                      <ActionButton
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive max-md:size-10"
                        aria-label={`Remove ${def.label} target`}
                        action={() => deleteGoalAction(g.id)}
                        confirm={`Remove the ${def.label} target? Pacing and stoplights for ${def.noun} stop showing.`}
                        confirmLabel="Remove target"
                      >
                        <Trash2Icon />
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {dialog ? (
        <GoalDialog key={dialog.key} open onOpenChange={(o) => !o && setDialog(null)} editing={dialog.editing} available={available} currency={currency} />
      ) : null}
    </Card>
  );
}
