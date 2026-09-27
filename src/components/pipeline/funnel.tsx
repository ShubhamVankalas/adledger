import { CornerDownRightIcon } from "lucide-react";
import Link from "next/link";
import { PlatformBadge } from "@/components/platform-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moneyWhole, num, pct } from "@/lib/format";
import type { CostPerStageLevel, CostPerStageRow, StageFunnel } from "@/lib/reports-pipeline";
import type { Stage } from "@/lib/pipeline-shared";
import { cn } from "@/lib/utils";
import { StageDot } from "./stage-menu";

// Funnel & cost view: how far contacts first seen in the period got, and what each stage cost
// per campaign / ad set / ad. Server components; every number comes from reports-pipeline.ts.

export function StageFunnelCard({ funnel }: { funnel: StageFunnel }) {
  const flow = funnel.steps.filter((s) => s.kind !== "lost");
  const lost = funnel.steps.filter((s) => s.kind === "lost");
  const max = Math.max(1, ...flow.map((s) => s.reached));
  const c = funnel.currency;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage funnel</CardTitle>
        <CardDescription>
          {num(funnel.total)} contacts first seen in the period, and how far they got. Cost is all ad spend in the period ÷ contacts from ads that reached the stage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {funnel.total === 0 ? (
          <p className="py-8 text-center text-ui text-muted-foreground">No contacts were first seen in this period. Pick a longer range.</p>
        ) : (
          <ol className="flex flex-col">
            <li aria-hidden className="hidden grid-cols-[10rem_minmax(0,1fr)_4.5rem_4rem_6.5rem] gap-4 pb-2 text-caption font-medium text-muted-foreground md:grid">
              <span>Stage</span>
              <span />
              <span className="text-right">Reached</span>
              <span className="text-right">Of all</span>
              <span className="text-right">Cost each</span>
            </li>
            {flow.map((s, i) => (
              <li key={s.stageId} className="flex flex-col">
                {i > 0 ? (
                  <p className="flex items-center gap-1.5 py-1 pl-4 text-caption text-muted-foreground md:pl-[10.5rem]">
                    <CornerDownRightIcon aria-hidden className="size-3 text-fg-faint" />
                    <span className="num">{s.conversion === null ? "—" : pct(s.conversion)}</span> moved on
                  </p>
                ) : null}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1.5 md:grid-cols-[10rem_minmax(0,1fr)_4.5rem_4rem_6.5rem]">
                  <span className="flex min-w-0 items-center gap-2 text-ui font-medium">
                    <StageDot color={s.color} />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="col-span-3 row-start-2 h-2 overflow-hidden rounded-full bg-fill md:col-span-1 md:row-start-auto" aria-hidden>
                    <span
                      className={cn("block h-full rounded-full", s.kind === "won" ? "bg-chart-customers" : "bg-chart-leads")}
                      style={{ width: `${Math.max(s.reached > 0 ? 1.5 : 0, (s.reached / max) * 100)}%` }}
                    />
                  </span>
                  <span className="num text-right text-ui font-medium">{num(s.reached)}</span>
                  <span className="num hidden text-right text-ui text-muted-foreground md:block">{s.ofTotal === null ? "—" : pct(s.ofTotal)}</span>
                  <span className="num text-right text-ui" title={s.paidReached ? `${num(s.paidReached)} reached from ads` : "Nobody from ads reached this stage"}>
                    {moneyWhole(s.costMinor, c)}
                  </span>
                </div>
              </li>
            ))}
            {lost.map((s) => (
              <li key={s.stageId} className="mt-3 flex items-center gap-2 border-t pt-3 text-ui text-muted-foreground">
                <StageDot color={s.color} />
                <span className="font-medium text-foreground">{s.name}</span>
                <span className="num">{num(s.reached)}</span>
                <span>now, {s.ofTotal === null ? "—" : pct(s.ofTotal)} of these contacts</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const LEVELS: { id: CostPerStageLevel; label: string; noun: string }[] = [
  { id: "campaign", label: "Campaigns", noun: "Campaign" },
  { id: "ad_group", label: "Ad sets", noun: "Ad set" },
  { id: "ad", label: "Ads", noun: "Ad" },
];

export const COST_ROWS = 25;

export function CostPerStageCard({
  rows,
  stages,
  currency,
  level,
  levelHref,
}: {
  rows: CostPerStageRow[];
  stages: Stage[];
  currency: string;
  level: CostPerStageLevel;
  levelHref: (level: CostPerStageLevel) => string;
}) {
  const shown = rows.slice(0, COST_ROWS);
  const noun = LEVELS.find((l) => l.id === level)?.noun ?? "Campaign";
  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0 space-y-1">
          <CardTitle>Cost per stage</CardTitle>
          <CardDescription>Spend ÷ contacts whose first touch was this {noun.toLowerCase()} and who reached the stage. Lower is better.</CardDescription>
        </div>
        <nav aria-label="Level" className="flex h-7 shrink-0 rounded-md bg-fill p-0.5">
          {LEVELS.map((l) => (
            <Link
              key={l.id}
              href={levelHref(l.id)}
              scroll={false}
              aria-current={l.id === level ? "page" : undefined}
              className={cn(
                "flex items-center rounded-[5px] px-2.5 text-caption font-medium text-muted-foreground transition-colors duration-100 hover:text-foreground",
                l.id === level && "bg-surface text-foreground shadow-sm",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </CardHeader>
      {shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-ui text-muted-foreground">No ad spend or ad-sourced contacts in this period.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-56 bg-bg-subtle">{noun}</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              {stages.map((s) => (
                <TableHead key={s.id} className="text-right">
                  <span className="inline-flex items-center gap-1.5">
                    <StageDot color={s.color} />
                    {s.name}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="sticky left-0 z-10 max-w-72 bg-surface">
                  <span className="flex min-w-0 items-center gap-2">
                    <PlatformBadge platform={r.platform} compact />
                    <span className="min-w-0">
                      <span className="block truncate" title={r.name}>
                        {r.name}
                      </span>
                      {r.parentName ? (
                        <span className="block truncate text-caption text-muted-foreground" title={r.parentName}>
                          in {r.parentName}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="num text-right">{moneyWhole(r.spendMinor, currency)}</TableCell>
                {r.stages.map((s) => (
                  <TableCell key={s.stageId} className="text-right">
                    <span className="num block">{moneyWhole(s.costMinor, currency)}</span>
                    <span className="num block text-caption text-muted-foreground">{s.reached ? `${num(s.reached)} reached` : "none"}</span>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.length > COST_ROWS ? (
        <p className="border-t px-4 py-2.5 text-caption text-muted-foreground">
          Showing the {COST_ROWS} with the most spend of {num(rows.length)}.
        </p>
      ) : null}
    </Card>
  );
}
