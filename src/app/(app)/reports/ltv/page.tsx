import { CoinsIcon, GaugeIcon, HandCoinsIcon, UsersIcon } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformBadge } from "@/components/platform-badge";
import { ReportControls } from "@/components/report-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CHANNEL_LABELS, MODEL_LABELS, money, moneyKpi, num } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { ltv, type LtvChannelRow } from "@/lib/reports-advanced";
import { cn } from "@/lib/utils";

export const metadata = { title: "Customer LTV" };

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const ratioLabel = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}:1`);

function ratioClass(v: number | null) {
  if (v === null) return "text-muted-foreground";
  if (v >= 3) return "bg-success/12 text-success";
  if (v >= 1) return "bg-warning/15 text-foreground";
  return "bg-destructive/10 text-destructive";
}

function Source({ row }: { row: LtvChannelRow }) {
  if (row.platform) return <PlatformBadge platform={row.platform} />;
  return <span className="font-medium">{CHANNEL_LABELS[row.key] ?? row.key}</span>;
}

export default async function LtvPage({ searchParams }: PageProps<"/reports/ltv">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  // Cohorts need a few months to mean anything: default to the last 180 days.
  const p = await resolvePeriodParams(db, ws, sp.range || sp.from ? sp : { ...sp, range: "180d" });
  const r = await ltv(db, ws, p);
  const c = ws.reportingCurrency;
  const width = Math.max(1, ...r.cohorts.map((x) => x.revenueMinor.length));
  const maxLtv = Math.max(1, ...r.cohorts.flatMap((x) => x.cumulativeLtvMinor));
  const paid = r.channels.filter((x) => x.spendMinor > 0);
  const paidRevenue = paid.reduce((s, x) => s + x.revenueMinor, 0);
  const paidSpend = paid.reduce((s, x) => s + x.spendMinor, 0);
  const blended = paidSpend > 0 ? paidRevenue / paidSpend : null;

  return (
    <>
      <PageHeader title="Customer LTV" description="What a customer is worth over time, and what it cost to acquire them">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} showPlatform={false} />
      </PageHeader>
      <PageBody>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="New customers" value={num(r.customers)} icon={UsersIcon} sub={`first paid ${p.start} → ${p.end}`} />
          <KpiCard label="Revenue to date" value={moneyKpi(r.revenueMinor, c)} icon={CoinsIcon} sub="net of refunds" />
          <KpiCard accent label="Average LTV" value={moneyKpi(r.ltvMinor, c)} icon={HandCoinsIcon} sub="per customer, to date" />
          <KpiCard
            label="Paid LTV:CAC"
            value={ratioLabel(blended)}
            icon={GaugeIcon}
            sub={`${money(paidRevenue, c, true)} from ${money(paidSpend, c, true)} spend`}
            hint="Lifetime revenue of customers acquired by ad platforms ÷ what those platforms cost in the same period. 3:1 or better is healthy for most businesses."
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Cohorts by first-payment month</CardTitle>
            <CardDescription>Cumulative revenue per customer at the end of each month after their first payment (month 0 = the month they first paid).</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {r.cohorts.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground sm:px-0">No first payments in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Cohort</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    {Array.from({ length: width }, (_, i) => (
                      <TableHead key={i} className="text-right">
                        Month {i}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.cohorts.map((co) => (
                    <TableRow key={co.cohort}>
                      <TableCell className="font-medium whitespace-nowrap">{monthLabel(co.cohort)}</TableCell>
                      <TableCell className="tabular text-right">{num(co.customers)}</TableCell>
                      <TableCell className="tabular text-right">{money(co.totalRevenueMinor, c, true)}</TableCell>
                      {Array.from({ length: width }, (_, i) => {
                        const v = co.cumulativeLtvMinor[i];
                        if (v === undefined) return <TableCell key={i} />;
                        const alpha = Math.max(0.06, Math.min(1, v / maxLtv) * 0.55);
                        return (
                          <TableCell key={i} className="p-1">
                            <div
                              className="tabular rounded-md px-2 py-1.5 text-right text-xs font-medium"
                              style={{ backgroundColor: `color-mix(in oklch, var(--primary) ${Math.round(alpha * 100)}%, transparent)` }}
                              title={`${money(co.revenueMinor[i], c)} revenue in month ${i}`}
                            >
                              {money(v, c, true)}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LTV:CAC by acquiring channel</CardTitle>
            <CardDescription>
              Customers credited to the platform or channel that acquired them ({MODEL_LABELS[p.model].toLowerCase()} model), their revenue to date, and ad spend in the same period.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {r.channels.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground sm:px-0">No customers acquired in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Acquired by</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">LTV</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Spend</TableHead>
                    <TableHead className="text-right">CAC</TableHead>
                    <TableHead className="text-right">LTV:CAC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.channels.map((x) => (
                    <TableRow key={x.key}>
                      <TableCell>
                        <Source row={x} />
                      </TableCell>
                      <TableCell className="tabular text-right">{num(x.customers, 1)}</TableCell>
                      <TableCell className="tabular text-right">{money(x.revenueMinor, c, true)}</TableCell>
                      <TableCell className="tabular text-right">{money(x.ltvMinor, c, true)}</TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground sm:table-cell">{x.spendMinor ? money(x.spendMinor, c, true) : "—"}</TableCell>
                      <TableCell className="tabular text-right">{money(x.cacMinor, c, true)}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn("tabular inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold", ratioClass(x.ltvCac))}>{ratioLabel(x.ltvCac)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Revenue is every payment minus refunds in {c} up to {p.end}. Customers are counted in the month of their first payment (workspace timezone {ws.timezone}). CAC only exists for ad
          platforms with spend in {c}; organic, referral and unattributed customers show LTV only.
        </p>
      </PageBody>
    </>
  );
}
