import { FlagIcon, MegaphoneIcon, RocketIcon, ScaleIcon } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformBadge } from "@/components/platform-badge";
import { ReportControls } from "@/components/report-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { money, moneyKpi, num, roas } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { modelComparison, ROLE_THRESHOLD, type JourneyRole, type ModelResult } from "@/lib/reports-advanced";
import { cn } from "@/lib/utils";

export const metadata = { title: "Model comparison" };

const ROLE: Record<JourneyRole, { label: string; className: string; bar: string }> = {
  starter: { label: "Starts journeys", className: "bg-chart-2/15 text-chart-2", bar: "bg-chart-2" },
  closer: { label: "Closes journeys", className: "bg-chart-3/20 text-foreground", bar: "bg-chart-3" },
  balanced: { label: "Balanced", className: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/40" },
};

function ModelCells({ m, currency }: { m: ModelResult; currency: string }) {
  return (
    <>
      <TableCell className="tabular border-l text-right">{money(m.revenueMinor, currency, true)}</TableCell>
      <TableCell className={cn("tabular text-right text-xs", (m.roas ?? 0) >= 1 ? "text-success" : "text-muted-foreground")}>{roas(m.roas)}</TableCell>
    </>
  );
}

export default async function ModelComparisonPage({ searchParams }: PageProps<"/reports/models">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const p = await resolvePeriodParams(db, ws, await searchParams);
  const r = await modelComparison(db, ws, p);
  const c = ws.reportingCurrency;
  const starters = r.rows.filter((x) => x.role === "starter");
  const closers = r.rows.filter((x) => x.role === "closer");
  const maxDelta = Math.max(1, ...r.rows.map((x) => Math.abs(x.deltaMinor)));
  const sumFirst = (rows: typeof r.rows) => rows.reduce((s, x) => s + x.firstTouch.revenueMinor, 0);
  const sumLast = (rows: typeof r.rows) => rows.reduce((s, x) => s + x.lastTouch.revenueMinor, 0);

  return (
    <>
      <PageHeader title="Model comparison" description="How first-touch, last-touch and linear credit change each campaign's revenue">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showModel={false} />
      </PageHeader>
      <PageBody>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Campaign spend" value={moneyKpi(r.totals.spendMinor, c)} goodWhenUp={null} icon={MegaphoneIcon} sub={`${r.rows.length} campaigns`} />
          <KpiCard
            label="Linear ROAS"
            value={roas(r.totals.linear.roas)}
            icon={ScaleIcon}
            accent
            sub={`first ${roas(r.totals.firstTouch.roas)} · last ${roas(r.totals.lastTouch.roas)}`}
            hint="Revenue credited to campaigns ÷ campaign spend. Totals move between models only when some touches in a journey are not from campaigns (organic, email, direct…)."
          />
          <KpiCard
            label="Journey starters"
            value={num(starters.length)}
            icon={RocketIcon}
            sub={`${money(sumFirst(starters), c, true)} first-touch vs ${money(sumLast(starters), c, true)} last`}
            hint="Campaigns credited clearly more under first-touch than last-touch: they introduce people who later convert through something else. Judging them on last-touch undervalues them."
          />
          <KpiCard
            label="Journey closers"
            value={num(closers.length)}
            icon={FlagIcon}
            sub={`${money(sumLast(closers), c, true)} last-touch vs ${money(sumFirst(closers), c, true)} first`}
            hint="Campaigns credited clearly more under last-touch: they catch people who were already on their way (brand search, retargeting)."
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Revenue and ROAS by attribution model</CardTitle>
            <CardDescription>
              Delta = first-touch minus last-touch revenue. A campaign is a starter or closer when the gap is at least {Math.round(ROLE_THRESHOLD * 100)}% of the larger value.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {r.rows.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground sm:px-0">No campaign spend or credited revenue in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead rowSpan={2}>Campaign</TableHead>
                    <TableHead rowSpan={2} className="text-right">Spend</TableHead>
                    <TableHead colSpan={2} className="border-l text-center">First touch</TableHead>
                    <TableHead colSpan={2} className="border-l text-center">Last touch</TableHead>
                    <TableHead colSpan={2} className="border-l text-center">Linear</TableHead>
                    <TableHead rowSpan={2} className="border-l text-center">Delta (first − last)</TableHead>
                  </TableRow>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {["first", "last", "linear"].flatMap((k) => [
                      <TableHead key={`${k}-rev`} className="h-7 border-l text-right text-xs">
                        Revenue
                      </TableHead>,
                      <TableHead key={`${k}-roas`} className="h-7 text-right text-xs">
                        ROAS
                      </TableHead>,
                    ])}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.rows.map((x) => {
                    const role = ROLE[x.role];
                    const width = (Math.abs(x.deltaMinor) / maxDelta) * 50;
                    return (
                      <TableRow key={x.id}>
                        <TableCell className="max-w-72">
                          <div className="flex min-w-0 items-center gap-2">
                            <PlatformBadge platform={x.platform} compact />
                            <span className="truncate font-medium" title={x.name}>
                              {x.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular text-right">{money(x.spendMinor, c, true)}</TableCell>
                        <ModelCells m={x.firstTouch} currency={c} />
                        <ModelCells m={x.lastTouch} currency={c} />
                        <ModelCells m={x.linear} currency={c} />
                        <TableCell className="min-w-52 border-l">
                          <div className="flex items-center gap-2">
                            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                              <div
                                className={cn("absolute inset-y-0 rounded-full", role.bar)}
                                style={x.deltaMinor >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
                              />
                            </div>
                            <span className="tabular w-16 text-right text-xs font-medium">
                              {x.deltaMinor > 0 ? "+" : ""}
                              {money(x.deltaMinor, c, true)}
                            </span>
                          </div>
                          <Badge className={cn("mt-1.5", role.className)}>{role.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">All campaigns</TableCell>
                    <TableCell className="tabular text-right font-medium">{money(r.totals.spendMinor, c, true)}</TableCell>
                    <ModelCells m={r.totals.firstTouch} currency={c} />
                    <ModelCells m={r.totals.lastTouch} currency={c} />
                    <ModelCells m={r.totals.linear} currency={c} />
                    <TableCell className="border-l" />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Bars left of centre earn more under last-touch (closers); bars right of centre earn more under first-touch (starters). Revenue is credited within a {ws.attributionWindowDays}-day
          window in {c}; repeat payments inherit the journey that acquired the customer.
        </p>
      </PageBody>
    </>
  );
}
